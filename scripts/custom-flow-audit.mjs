// Browser acceptance for the CSV importer: upload a CSV on /create, see the
// preview and errors, create a dive, open its link and play all seven rounds.
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { TEMPLATE_CSV, buildCustomGame } from '../public/custom.mjs';
import { TIERS } from '../public/rules.mjs';

const base = process.argv[2] || 'http://localhost:3051', out = process.argv[3] || 'output/custom-flow', local = base.includes('localhost');
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: 'chrome' }) });
const errors = [];
try {
  for (const [label, viewport] of [['desktop', { width: 1280, height: 860 }], ['mobile', { width: 390, height: 844 }]]) {
    const context = await browser.newContext({ viewport, ...(label === 'mobile' ? { isMobile: true, hasTouch: true } : {}) });
    await context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
    const page = await context.newPage();
    page.on('pageerror', e => errors.push(`${label}: ${e.message}`));
    page.on('console', m => { if (m.type() === 'error') errors.push(`${label} console: ${m.text()}`); });
    await page.goto(base + '/create');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'no horizontal scroll');
    // Invalid CSV shows line-numbered errors and keeps Create disabled.
    await page.locator('#csv-text').fill('question,answer,tier\nQ1,A,legendary\n');
    await page.waitForSelector('.csv-report .errors li');
    assert.match(await page.locator('.csv-report .errors').textContent(), /Line 2: tier/);
    assert.equal(await page.locator('#create-btn').isDisabled(), true);
    // Upload a real file.
    const file = `${out}/trivia-night.csv`;
    await writeFile(file, TEMPLATE_CSV);
    await page.locator('#csv-file').setInputFiles(file);
    await page.waitForSelector('.csv-report .ok');
    assert.equal(await page.locator('#title').inputValue(), 'trivia night');
    assert.equal(await page.locator('.preview-list li').count(), 7);
    await page.screenshot({ path: `${out}/${label}-preview.png`, fullPage: true });
    await page.locator('#create-btn').click();
    await page.waitForSelector('#created:not([hidden])');
    const link = await page.locator('#share-url').inputValue();
    assert.match(link, /\/\?custom=[a-z0-9]{10}$/);
    await page.screenshot({ path: `${out}/${label}-created.png` });
    // Play the custom dive from its link.
    await page.goto(link + '&test=1');
    await page.waitForFunction(() => window.render_game_to_text);
    await page.waitForFunction(() => document.querySelector('.tagline').textContent === 'TRIVIA NIGHT');
    await page.screenshot({ path: `${out}/${label}-intro.png` });
    await page.locator('#start-btn').click({ force: true });
    const game = buildCustomGame(TEMPLATE_CSV).game;
    let expected = 0;
    for (let i = 0; i < 7; i++) {
      await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).phase === 'preview');
      assert.equal(await page.locator('#prompt-text').textContent(), game.prompts[i].text);
      if (local) await page.evaluate(() => window.advanceTime(3100));
      await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).phase === 'answering');
      const best = [...game.prompts[i].answers].sort((a, b) => TIERS[b.tier].score - TIERS[a.tier].score)[i % 2];
      expected += TIERS[best.tier].score;
      await page.locator('#answer').fill(best.answer.toLowerCase());
      await page.locator('#answer').press('Enter');
      await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).phase === 'landed', null, { timeout: 20000 });
      if (i === 0) await page.screenshot({ path: `${out}/${label}-landed.png` });
      await page.locator('#next-btn').click();
    }
    await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).phase === 'done');
    await page.waitForTimeout(600);
    const header = await page.locator('.result-header').textContent();
    assert.match(header, /trivia night · Custom dive complete/);
    assert.equal(Number(await page.locator('.result-score strong').textContent()), expected);
    await page.waitForFunction(() => document.getElementById('distribution').textContent.includes('Custom dive'));
    await page.screenshot({ path: `${out}/${label}-results.png` });
    // The daily dive on the homepage is untouched by the custom run.
    await page.goto(base + '/?test=1');
    await page.waitForFunction(() => window.render_game_to_text);
    assert.equal(JSON.parse(await page.evaluate(() => window.render_game_to_text())).phase, 'intro');
    await context.close();
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ok: true, output: out, flows: ['desktop', 'mobile'] }));
} finally { await browser.close(); }
