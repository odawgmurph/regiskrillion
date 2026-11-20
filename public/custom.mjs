// CSV import for custom games. Shared by the browser preview (/create) and the
// server, which re-parses the submitted CSV so the client is never trusted.
import { TIERS, ROUNDS, normalize } from './rules.mjs';

export const LIMITS = { csvBytes: 60000, title: 60, question: 200, answer: 80, quip: 120, aliases: 10, answersPerPrompt: 60 };
export const COLUMNS = ['question', 'answer', 'tier', 'aliases', 'quip'];
const HEADER_ALIASES = { question: ['question', 'prompt', 'category'], answer: ['answer', 'response'], tier: ['tier', 'rarity', 'points', 'score'], aliases: ['aliases', 'alias', 'alternates', 'also accept'], quip: ['quip', 'note', 'comment'] };

export const TEMPLATE_CSV = `question,answer,tier,aliases,quip
Name a fruit that is yellow,Banana,plankton,,
Name a fruit that is yellow,Lemon,plankton,,
Name a fruit that is yellow,Pineapple,schooler,,
Name a fruit that is yellow,Starfruit,rare,carambola,
Name a fruit that is yellow,Quince,deepcut,,
Name a fruit that is yellow,Canistel,krillion,eggfruit,"Also called the eggfruit, it tastes like custard."
Name a planet in our solar system,Earth,plankton,,
Name a planet in our solar system,Mars,plankton,,
Name a planet in our solar system,Saturn,schooler,,
Name a planet in our solar system,Pluto,tooclever,,Not since 2006.
Name a planet in our solar system,Uranus,rare,,
Name a planet in our solar system,Neptune,rare,,
Name a planet in our solar system,Mercury,deepcut,,
Name a country in South America,Brazil,plankton,,
Name a country in South America,Argentina,plankton,,
Name a country in South America,Peru,schooler,,
Name a country in South America,Paraguay,rare,,
Name a country in South America,Guyana,deepcut,,
Name a country in South America,Suriname,krillion,surinam,
Name a musical instrument with strings,Guitar,plankton,,
Name a musical instrument with strings,Violin,plankton,,
Name a musical instrument with strings,Harp,schooler,,
Name a musical instrument with strings,Sitar,rare,,
Name a musical instrument with strings,Hurdy-gurdy,deepcut,hurdy gurdy,
Name a musical instrument with strings,Kora,krillion,,
Name a color of the rainbow,Red,plankton,,
Name a color of the rainbow,Blue,plankton,,
Name a color of the rainbow,Green,schooler,,
Name a color of the rainbow,Orange,schooler,,
Name a color of the rainbow,Indigo,rare,,
Name a color of the rainbow,Violet,deepcut,,
Name a bird that cannot fly,Penguin,plankton,,
Name a bird that cannot fly,Ostrich,plankton,,
Name a bird that cannot fly,Emu,schooler,,
Name a bird that cannot fly,Kiwi,rare,,
Name a bird that cannot fly,Cassowary,deepcut,,
Name a bird that cannot fly,Takahe,krillion,takahē,
Name a board game,Monopoly,plankton,,
Name a board game,Chess,plankton,,
Name a board game,Scrabble,schooler,,
Name a board game,Carcassonne,rare,,
Name a board game,Go,rare,weiqi|baduk,
Name a board game,Mancala,deepcut,,
Name a board game,Hnefatafl,krillion,tafl,
`;

// RFC 4180 parser: quoted fields, doubled quotes, embedded commas/newlines, CRLF, BOM.
// Also accepts semicolon- or tab-delimited files exported by some spreadsheets.
export function parseCsv(text) {
  text = String(text).replace(/^﻿/, '');
  const firstLine = text.slice(0, text.search(/\r?\n|$/));
  const delimiter = [',', ';', '\t'].map(d => [d, firstLine.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = []; let row = [], field = '', quoted = false, i = 0, line = 1;
  const lines = [];
  const endRow = () => { row.push(field); field = ''; if (row.some(v => v.trim() !== '')) { rows.push(row); lines.push(line); } row = []; };
  while (i < text.length) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i += 2; continue; }
      if (c === '"') { quoted = false; i++; continue; }
      if (c === '\n') line++;
      field += c; i++; continue;
    }
    if (c === '"' && field.trim() === '') { quoted = true; field = ''; i++; continue; }
    if (c === delimiter) { row.push(field); field = ''; i++; continue; }
    if (c === '\r' && text[i + 1] === '\n') { i++; continue; }
    if (c === '\n' || c === '\r') { endRow(); line++; i++; continue; }
    field += c; i++;
  }
  if (quoted) throw new Error('A quoted field is never closed. Check for a missing " character.');
  endRow();
  return { rows, lines };
}

export function parseTier(value) {
  const v = normalize(value);
  if (!v) return null;
  for (const [key, t] of Object.entries(TIERS)) if (v === key || v === normalize(t.name) || v === String(t.score)) return key;
  return { oneinakrillion: 'krillion', gem: 'krillion', common: 'plankton', obvious: 'plankton', uncommon: 'rare', obscure: 'deepcut' }[v] || null;
}

// Turns CSV text into a validated custom game, or a list of human-readable errors.
export function buildCustomGame(csv, title = '') {
  const errors = [], warnings = [];
  if (typeof csv !== 'string' || !csv.trim()) return { errors: ['The CSV is empty.'], warnings };
  if (new TextEncoder().encode(csv).length > LIMITS.csvBytes) return { errors: [`The CSV is larger than ${LIMITS.csvBytes / 1000} KB.`], warnings };
  let parsed; try { parsed = parseCsv(csv); } catch (e) { return { errors: [e.message], warnings }; }
  const { rows, lines } = parsed;
  if (!rows.length) return { errors: ['The CSV has no rows.'], warnings };
  const header = rows[0].map(h => h.trim().toLowerCase());
  const index = {};
  for (const [col, names] of Object.entries(HEADER_ALIASES)) index[col] = header.findIndex(h => names.includes(h));
  const missing = ['question', 'answer', 'tier'].filter(c => index[c] < 0);
  if (missing.length) return { errors: [`The first row must be a header with columns: question, answer, tier (optional: aliases, quip). Missing: ${missing.join(', ')}.`], warnings };
  const cell = (row, col) => index[col] < 0 ? '' : String(row[index[col]] ?? '').trim();
  const prompts = new Map();
  rows.slice(1).forEach((row, n) => {
    const at = `Line ${lines[n + 1]}`;
    const question = cell(row, 'question'), answer = cell(row, 'answer'), tierText = cell(row, 'tier');
    if (!question) return errors.push(`${at}: question is empty.`);
    if (!answer) return errors.push(`${at}: answer is empty.`);
    if (question.length > LIMITS.question) return errors.push(`${at}: question is longer than ${LIMITS.question} characters.`);
    if (answer.length > LIMITS.answer) return errors.push(`${at}: answer is longer than ${LIMITS.answer} characters.`);
    const tier = parseTier(tierText);
    if (!tier) return errors.push(`${at}: tier “${tierText}” is not one of ${Object.keys(TIERS).join(', ')} (or their scores ${Object.values(TIERS).map(t => t.score).join('/')}).`);
    if (!normalize(answer)) return errors.push(`${at}: answer “${answer}” needs at least one letter or digit.`);
    const aliases = cell(row, 'aliases').split(/[|;]/).map(a => a.trim()).filter(a => a && normalize(a)).slice(0, LIMITS.aliases).map(a => a.slice(0, LIMITS.answer));
    const quip = cell(row, 'quip').slice(0, LIMITS.quip);
    const key = question.replace(/\s+/g, ' ').toLowerCase();
    if (!prompts.has(key)) prompts.set(key, { id: `c${prompts.size + 1}`, text: question.replace(/\s+/g, ' '), answers: [] });
    const p = prompts.get(key);
    if (p.answers.some(a => normalize(a.answer) === normalize(answer))) return warnings.push(`${at}: duplicate answer “${answer}” ignored.`);
    if (p.answers.length >= LIMITS.answersPerPrompt) return errors.push(`${at}: more than ${LIMITS.answersPerPrompt} answers for “${p.text}”.`);
    p.answers.push({ answer, tier, ...(aliases.length ? { aliases } : {}), ...(quip ? { quip } : {}) });
  });
  const list = [...prompts.values()];
  if (list.length !== ROUNDS) errors.push(`A dive needs exactly ${ROUNDS} different questions; this CSV has ${list.length}.`);
  for (const p of list) {
    const seen = new Map();
    for (const a of p.answers) for (const w of [a.answer, ...(a.aliases || [])]) {
      const k = normalize(w), other = seen.get(k);
      if (other && other !== a.answer) warnings.push(`“${w}” is listed for both “${other}” and “${a.answer}” in “${p.text}”; the first wins.`);
      else seen.set(k, a.answer);
    }
    if (!p.answers.some(a => TIERS[a.tier].score >= 85)) warnings.push(`“${p.text}” has no deepcut or krillion answer, so nobody can reach the trench.`);
  }
  const cleanTitle = String(title || '').replace(/\s+/g, ' ').trim().slice(0, LIMITS.title) || 'Custom dive';
  return errors.length ? { errors, warnings } : { game: { title: cleanTitle, prompts: list }, errors, warnings };
}
