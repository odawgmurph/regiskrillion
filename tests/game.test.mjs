import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { sqliteDatabase, migrate } from '../src/db.mjs';
import { buildCustomGame, parseCsv, TEMPLATE_CSV } from '../public/custom.mjs';
import worker, { validateReference } from '../src/worker.mjs';
import { DEMO } from '../src/demo.mjs';
import { SITE } from '../src/config.mjs';
import { documents, aiLinks } from '../src/docs.mjs';
import { etDate, resetAt, normalize, matchAnswer, TIERS } from '../public/rules.mjs';
import { homePage } from '../src/html.mjs';

function database(){
  const db=sqliteDatabase(':memory:',DatabaseSync);
  db.ready=migrate(db);
  return db;
}
function service(){const env={DB:database(),BUCKET:{put:async()=>{},get:async()=>null},LOCAL_DEVELOPMENT:'true',REFERENCE_SYNC:'false',};let cookie='';return{env,async call(path,data,extra={}){await env.DB.ready;const r=await worker.fetch(new Request('http://localhost:3051'+path,{...(data===undefined?{}:{method:'POST',body:JSON.stringify(data),headers:{'Content-Type':'application/json','Cookie':cookie,...extra}}),...(data===undefined?{headers:{Cookie:cookie,...extra}}:{})}),env,{});if(r.headers.get('Set-Cookie'))cookie=r.headers.get('Set-Cookie').split(';')[0];return{status:r.status,body:await r.json()}},cookie:()=>cookie};}

test('New York reset follows DST rather than device midnight',()=>{
  assert.equal(etDate(Date.parse('2026-10-17T03:59:59Z')),'2026-10-16');
  assert.equal(etDate(Date.parse('2026-10-17T04:00:00Z')),'2026-10-17');
  assert.equal(new Date(resetAt('2026-10-17')).toISOString(),'2026-10-18T04:00:00.000Z');
  assert.equal(new Date(resetAt('2026-12-17')).toISOString(),'2026-12-18T05:00:00.000Z');
});
test('answer matching normalizes accents, uses known aliases and avoids short fuzzy guesses',()=>{
  assert.equal(normalize('São Tomé & Príncipe'),'saotomeandprincipe');
  assert.equal(matchAnswer('mashed',DEMO.prompts[0].answers).answer,'Mashed potatoes');
  assert.equal(matchAnswer('Yttrum',DEMO.prompts[3].answers).correction,true);
  assert.equal(matchAnswer('xyz',DEMO.prompts[3].answers),null);
  assert.equal(matchAnswer('zzzzzzzzzz',DEMO.prompts[0].answers),null);
});
test('reference import validates date, question identity and tier whitelist',()=>{
  const date='2026-10-17';const today={date,dayNumber:94,prompts:DEMO.prompts.map(({id,text})=>({id,text}))},reveal={date,prompts:structuredClone(DEMO.prompts)};
  assert.equal(validateReference(today,reveal,date).prompts.length,7);
  assert.throws(()=>validateReference(today,{...reveal,date:'2026-10-18'},date));
  reveal.prompts[0].text='Different question';assert.throws(()=>validateReference(today,reveal,date));
});
test('seven rounds are scored on server; retries cannot duplicate points; other browsers cannot read the run',async()=>{
  const s=service();let{body:game}=await s.call('/api/start',{});const id=game.runId;
  const correction=await s.call('/api/answer',{runId:id,round:0,answer:'mashed'});assert.equal(correction.body.correction,'Mashed potatoes');
  const rejected=await s.call('/api/answer',{runId:id,round:0,answer:'zzzzzzzzzz'});assert.equal(rejected.body.rejected,true);
  for(let i=0;i<7;i++){
    const answer=DEMO.prompts[i].answers.find(a=>a.tier==='krillion').answer;
    const result=await s.call('/api/answer',{runId:id,round:i,answer,confirm:true,score:99999});assert.equal(result.status,200);assert.equal(result.body.result.score,TIERS.krillion.score);game=result.body.state;
    const duplicate=await s.call('/api/answer',{runId:id,round:i,answer});assert.equal(duplicate.body.alreadyScored,true);assert.equal(duplicate.body.state.results.length,i+1);
    if(i<6){const n=await s.call('/api/next',{runId:id});assert.equal(n.body.round,i+1);}
  }
  assert.equal(game.score,700);assert.equal(game.completed,true);
  const same=await s.call('/api/start',{});assert.equal(same.body.runId,id);
  const review=await s.call('/api/review?run='+id);assert.equal(review.status,200);assert.equal(review.body.betterThan,null);assert.equal(review.body.population,0);
  const other=service();const missing=await other.call('/api/state?run='+id);assert.equal(missing.status,404);
  const csrf=await s.call('/api/start',{}, {Origin:'https://evil.example'});assert.equal(csrf.status,403);
  s.env.DB.close();other.env.DB.close();
});
test('review stays locked, pause is server-side and practice is separate',async()=>{
  const s=service();const{body:g}=await s.call('/api/start',{});
  assert.equal((await s.call('/api/review?run='+g.runId)).status,403);
  const paused=await s.call('/api/pause',{runId:g.runId,paused:true});assert.ok(paused.body.pausedAt);
  const resumed=await s.call('/api/pause',{runId:g.runId,paused:false});assert.equal(resumed.body.pausedAt,null);assert.ok(resumed.body.roundStart>=g.roundStart);
  const practice=await s.call('/api/start',{practice:true});assert.notEqual(practice.body.runId,g.runId);assert.equal(practice.body.mode,'practice');
  s.env.DB.close();
});
test('expired server windows cannot score late answers or be revived by pausing',async()=>{
  const s=service();const{body:g}=await s.call('/api/start',{});
  s.env.LOCAL_DEVELOPMENT='false';
  await s.env.DB.prepare('UPDATE runs SET round_start=? WHERE id=?').bind(Date.now()-30000,g.runId).run();
  const paused=await s.call('/api/pause',{runId:g.runId,paused:true});assert.equal(paused.body.pausedAt,null);
  const late=await s.call('/api/answer',{runId:g.runId,round:0,answer:'Pommes soufflées',confirm:true,timeout:true});
  assert.equal(late.body.result.score,0);assert.equal(late.body.state.round,1);s.env.DB.close();
});
test('four docs share product facts, full composes all three, config mutations propagate without private keys',()=>{
  const a=documents();assert.equal(Object.keys(a).length,4);
  for(const key of ['/llms.txt','/pricing.md','/models.md'])assert.ok(a['/llms-full.txt'].includes(a[key]));
  const changed=structuredClone(SITE);changed.price.amount=7;changed.price.label='Test pricing';changed.features.push('Isolated capability test');changed.secret='DO_NOT_LEAK';
  const b=documents(changed);assert.ok(b['/pricing.md'].includes('7 USD'));assert.ok(b['/models.md'].includes('Isolated capability test'));assert.ok(b['/llms-full.txt'].includes('Test pricing'));assert.ok(!JSON.stringify(b).includes('DO_NOT_LEAK'));
});
test('five AI destinations share one localized prompt, canonical docs and native link safety',()=>{
  for(const lang of SITE.languages){const links=aiLinks(lang);assert.equal(links.length,5);const q=links.map(a=>new URL(a.href).searchParams.get('q'));assert.equal(new Set(q).size,1);assert.ok(q[0].includes(SITE.origin+'/llms-full.txt'));assert.ok(q[0].includes(lang==='zh'?'用中文回答':'answer in English'));assert.equal(new URL(links.find(a=>a.name==='Google AI Mode').href).searchParams.get('udm'),'50');const html=homePage(lang);assert.ok(html.includes('noopener noreferrer nofollow'));assert.ok(html.includes('original-footer'));assert.ok(html.includes('AI &amp; Agent Docs'));}
});
test('SSR SEO exposes an expandable guide, correct canonical and no crawler-specific cloaking',()=>{
  const html=homePage();assert.ok(html.includes('<h1 aria-label="Krillion Game'));assert.ok(html.includes('<details id="guide"'));assert.ok(html.includes('https://openkrillion.com/assets/og.png'));
  const text=html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<[^>]+>/g,' '),words=text.match(/[A-Za-z]+(?:[’'-][A-Za-z]+)*/g),density=words.filter(w=>w.toLowerCase()==='krillion').length/words.length;
  assert.ok(words.length>1500);assert.ok(density>.03);assert.ok(!html.includes('googlebot'));
});
test('public docs GET and HEAD are readable UTF-8 and not SPA HTML',async()=>{
  const s=service();for(const path of Object.keys(documents()))for(const method of ['GET','HEAD']){await s.env.DB.ready;const r=await worker.fetch(new Request('http://localhost:3051'+path,{method}),s.env,{});assert.equal(r.status,200);assert.match(r.headers.get('Content-Type'),/text\/plain; charset=utf-8/);const body=await r.text();if(method==='HEAD')assert.equal(body,'');else{assert.ok(body.startsWith('# OpenKrillion'));assert.ok(!body.includes('<!doctype html>'));}}s.env.DB.close();
});

test('migrations apply once and are idempotent',async()=>{
  const db=sqliteDatabase(':memory:',DatabaseSync);
  assert.deepEqual(await migrate(db),['0001_initial','0002_pause','0003_custom_games']);
  assert.deepEqual(await migrate(db),[]);
  db.close();
});
test('CSV parser handles quotes, embedded commas/newlines, CRLF, BOM and semicolons',()=>{
  const {rows}=parseCsv('\uFEFFquestion,answer\r\n"Say ""hi"", please","multi\nline"\r\n\r\nx,y');
  assert.deepEqual(rows,[['question','answer'],['Say "hi", please','multi\nline'],['x','y']]);
  assert.deepEqual(parseCsv('a;b;c\n1;2;3').rows[1],['1','2','3']);
  assert.throws(()=>parseCsv('a,"open'));
});
test('CSV import groups seven prompts, parses tiers/aliases and reports line-numbered errors',()=>{
  const ok=buildCustomGame(TEMPLATE_CSV,'  My   dive ');
  assert.deepEqual(ok.errors,[]);assert.equal(ok.game.title,'My dive');assert.equal(ok.game.prompts.length,7);
  const go=ok.game.prompts[6].answers.find(a=>a.answer==='Go');assert.equal(go.tier,'rare');assert.deepEqual(go.aliases,['weiqi','baduk']);
  assert.equal(ok.game.prompts[0].answers.at(-1).quip,'Also called the eggfruit, it tastes like custard.');
  const numeric=buildCustomGame(TEMPLATE_CSV.replace('Banana,plankton','Banana,10').replace('Lemon,plankton','Lemon,One in a Krillion'));
  assert.equal(numeric.game.prompts[0].answers[0].tier,'plankton');assert.equal(numeric.game.prompts[0].answers[1].tier,'krillion');
  const bad=buildCustomGame('question,answer,tier\nQ1,A,legendary\nQ1,,rare\n');
  assert.ok(bad.errors.some(e=>e.startsWith('Line 2: tier')));assert.ok(bad.errors.some(e=>e.startsWith('Line 3: answer is empty')));assert.ok(bad.errors.some(e=>e.includes('exactly 7')));
  assert.match(buildCustomGame('foo,bar\n1,2').errors[0],/Missing: question, answer, tier/);
  const dup=buildCustomGame(TEMPLATE_CSV+'Name a board game,chess,rare,,\n');assert.ok(dup.warnings.some(w=>w.includes('duplicate')));
});
test('custom dives are created from CSV on the server, playable by link, server-scored and excluded from daily stats',async()=>{
  const s=service();
  const bad=await s.call('/api/custom',{title:'Bad',csv:'question,answer,tier\nQ,A,plankton'});assert.equal(bad.status,422);assert.ok(bad.body.errors.length);
  const created=await s.call('/api/custom',{title:'Trivia night',csv:TEMPLATE_CSV});assert.equal(created.status,201);assert.match(created.body.id,/^[a-z0-9]{10}$/);assert.equal(created.body.path,'/?custom='+created.body.id);
  const info=await s.call('/api/custom?id='+created.body.id);assert.equal(info.body.title,'Trivia night');assert.equal(info.body.prompts.length,7);assert.ok(!JSON.stringify(info.body).includes('Canistel'));
  assert.equal((await s.call('/api/custom?id=nope')).status,404);
  const player=service();
  let{body:game}=await player.call('/api/start',{custom:created.body.id});
  assert.equal(game.mode,'custom');assert.equal(game.customId,created.body.id);assert.equal(game.title,'Trivia night');assert.equal(game.prompts[0].text,'Name a fruit that is yellow');
  const parsed=buildCustomGame(TEMPLATE_CSV).game;
  for(let i=0;i<7;i++){
    const best=[...parsed.prompts[i].answers].sort((a,b)=>TIERS[b.tier].score-TIERS[a.tier].score)[0];
    const r=await player.call('/api/answer',{runId:game.runId,round:i,answer:best.answer,confirm:true});assert.equal(r.body.result.tier,best.tier);game=r.body.state;
    if(i<6)await player.call('/api/next',{runId:game.runId});
  }
  assert.equal(game.completed,true);assert.equal(game.score,parsed.prompts.reduce((n,p)=>n+Math.max(...p.answers.map(a=>TIERS[a.tier].score)),0));
  const review=await player.call('/api/review?run='+game.runId);assert.equal(review.status,200);assert.equal(review.body.population,0);assert.ok(review.body.prompts[0].answers.some(a=>a.answer==='Canistel'));
  const daily=await player.call('/api/start',{});assert.equal(daily.body.mode,'daily');assert.notEqual(daily.body.runId,game.runId);assert.equal(daily.body.results.length,0);
  assert.equal((await player.call('/api/start',{custom:'zzzzzzzzzz'})).status,404);
  assert.equal((await s.call('/api/custom',{csv:TEMPLATE_CSV},{Origin:'https://evil.example'})).status,403);
  const page=await worker.fetch(new Request('http://localhost:3051/create'),s.env,{});assert.equal(page.status,200);assert.ok((await page.text()).includes('id="create-form"'));
  s.env.DB.close();player.env.DB.close();
});
