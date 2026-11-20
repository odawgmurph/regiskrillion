# OpenKrillion 🦐

An independent, open-source daily rare-answer trivia game. Play at **[openkrillion.com](https://openkrillion.com)**.

Seven prompts, 25 seconds each. Familiar answers float; rare answers descend. This release includes the home scene, all seven rounds, answer correction and rejection, six rarity tiers, animated descent, synthesized audio, surfacing, results, answer review, sharing, practice, settings, dive buddies, and a browser logbook.

**Source:** [openkrillion.com-service](https://github.com/VulcanEon/openkrillion.com-service). Application code and original procedural assets are MIT licensed. This project is independent of, and not affiliated with, [krillion.io](https://krillion.io). See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for the separate treatment of reference data, fonts, and provider icons.

## Run locally

Use Node.js 22.16+ (24 recommended) and npm. No cloud account, API key, AI model, or production database is needed for the sample game.

```sh
git clone https://github.com/VulcanEon/openkrillion.com-service.git
cd openkrillion.com-service
npm ci
npm run build
npm run dev
```

Open `http://localhost:3051`. The dev server serves `public/` as static files and sends every other request to the same handler Vercel runs, backed by Node's built-in SQLite in the ignored `.data/` folder. Migrations apply automatically on first request (or run `npm run migrate`). Set `TURSO_DATABASE_URL`/`TURSO_AUTH_TOKEN` to develop against a remote database instead.

The included independent sample bank is small and visibly labeled. Production can synchronize the current reference day's publicly exposed prompts and prepared answer tiers; these snapshots and production player records are **not** distributed with this repository. No player answers are sent to the reference service. If the reference is unavailable for a new day, a labeled sample bank keeps the game playable. This dependency can be disabled with `REFERENCE_SYNC=false`.

## Custom dives from CSV

Open `/create` (also linked from the menu and the home screen) to import your own seven prompts. Upload or paste a CSV with one row per accepted answer:

```csv
question,answer,tier,aliases,quip
Name a bird that cannot fly,Penguin,plankton,,
Name a bird that cannot fly,Kiwi,rare,,
Name a bird that cannot fly,Takahe,krillion,takahē,Only a few hundred remain.
```

- `question`, `answer`, `tier` are required; `aliases` (separated by `|` or `;`) and `quip` are optional. Header names are case-insensitive.
- `tier` is one of `plankton` (10), `tooclever` (15), `schooler` (30), `rare` (60), `deepcut` (85), `krillion` (100); the display name or score also works.
- Rows sharing a question become one prompt, in first-appearance order. Exactly seven distinct questions are required.
- Quoted fields, embedded commas/newlines, CRLF, a UTF-8 BOM, and semicolon- or tab-delimited exports are accepted. Limits: 60 KB, 60 answers per prompt.

The page previews the result with line-numbered errors before anything is uploaded. The server parses the CSV again with the same module (`public/custom.mjs`), stores the dive, and returns a link (`/?custom=<id>`). Anyone with the link plays it with the normal timer, server scoring, review and sharing. Custom runs never count toward daily statistics or streaks. A template is at `/assets/custom-dive-template.csv`.

## Architecture

```text
Browser: canvas ocean + HTML game + Web Audio
                 |
                 v
Vercel static files (public/) ── everything else ──> Vercel Function api/index.js
                                                      (src/worker.mjs: timing, matching,
                                                       scoring, ownership, CSV import)
                                                              |
                                                              v
                                        Turso / libSQL (production) · Node SQLite (local)
                                        puzzles, runs, answers, custom_games
```

The request handler in `src/worker.mjs` uses standard `Request`/`Response` objects and a small D1-style database facade (`src/db.mjs`), so the same code runs in the Vercel Function, the local dev server and the tests. The server owns the score and round deadline. The essential `ok_player` cookie is HttpOnly, SameSite=Lax, and Secure over HTTPS. Answers are hidden until the dive is completed. Daily results, practice and custom dives are separate; population comparisons use this service's completed daily dives, not the original game's player statistics. A small timed-submission network grace period does not allow late manual requests to revive a round.

`src/config.mjs` holds public product facts. The handler renders `/llms.txt`, `/pricing.md`, `/models.md`, and `/llms-full.txt` from those same facts; `npm run build` also generates matching checked-in documentation snapshots. There are no AI models, paid plans, credits, subscriptions, account login, or multiplayer in this release.

The homepage includes a native, accessible expandable guide with over 1,500 English words. Its content is delivered in the initial HTML to every visitor. English and Chinese help/AI prompts are available through `?lang=en` and `?lang=zh`; game questions and the long reference guide currently remain English. Five local brand icons open public product questions in ChatGPT, Claude, Perplexity, Google AI Mode, and Grok. Opening a provider link does not guarantee its answer or a citation.

## Deploy to Vercel (free Hobby plan)

Vercel functions have no persistent disk, so game records need a hosted database. [Turso](https://turso.tech) has a free tier and speaks the same SQLite dialect the game uses.

1. Create a free Turso database (via the Vercel Marketplace Turso integration, or `turso db create` plus `turso db tokens create`).
2. Import this repository in Vercel. `vercel.json` already sets the build command (`npm run build`), the static output directory (`public`), the rewrite of all other paths to `api/index.js`, security headers and one daily cron.
3. In Project → Settings → Environment Variables, set `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` (the Marketplace integration adds these for you). Never commit them.
4. Deploy (push to the connected branch, or `npx vercel deploy --prod`). The schema is created automatically on the first request.
5. Update `src/config.mjs`, canonical URLs, and public brand/guide copy for your own domain. The supplied code describes the deployed OpenKrillion site. Add your domain in Vercel; the `www.openkrillion.com` redirect in `vercel.json` is specific to this site.

Optional variables: `REFERENCE_SYNC=true` (synchronize the daily reference puzzle), `CRON_SECRET` (enables the daily `/api/cron/sync` Vercel Cron call; Hobby crons run once a day), `ADMIN_TOKEN` (enables an authenticated `POST /api/admin/sync`), `GA4_ID`, `CLARITY_ID`, `BING_VERIFY`, `GSC_VERIFY`. The supplied production Plausible public script URL is in `src/config.mjs`; replace it with your own. Analytics only load on the configured production hostname, are disabled for automated browser runs, and never receive raw answers through custom events.

Without a database URL the Vercel function returns 503 rather than silently losing games between instances. For a throwaway preview only, `ALLOW_EPHEMERAL_DB=true` uses SQLite in `/tmp` (data disappears whenever the function instance is recycled).

Vercel's Hobby plan is for personal, non-commercial projects; check Vercel's and Turso's current free-tier limits for your traffic.

## Validation

```sh
npm test
npm run build
npm run check
node scripts/browser-audit.mjs http://localhost:3051 output/playwright/audit
npm run test:audio
npm run test:mobile
npm run test:art
npm run test:custom
```

Browser audits use installed Google Chrome by default; set `CHROMIUM_PATH=/path/to/chromium` to use another Chromium build. `test:custom` uploads a CSV on `/create`, creates a dive, and plays all seven rounds from its link on desktop and mobile. The mobile flow audit's answers target a reference-synchronized day, so its final score assertion does not match the local sample bank.

The art audit samples five depth zones and all six outcome effects on desktop and mobile. Companion SVGs are generated from original pixel geometry in `scripts/pixel-art.mjs`; scenery is drawn and cached by `public/seascape.mjs`, without downloading any reference artwork at build or runtime. The mobile flow audit runs all seven rounds at 390×844 and checks a long question at 390×480 before restoring the viewport. The audio audit renders synthesized cues through OfflineAudioContext, checks envelopes, clipping, mute and countdown timing, and writes WAV samples under ignored `output/audio/`. The visual fidelity pass and remaining differences are recorded in [docs/fidelity-audit.md](docs/fidelity-audit.md).

The unit/integration suite runs against in-memory Node SQLite through the same database facade used in production, including migrations, CSV parsing and custom-dive import/play, seven-round server scoring, duplicate protection, ownership, CSRF checks, deadline expiry, pause/resume, reference validation, DST rollover, and the documentation/SEO contract. Browser validation uses installed Google Chrome (`channel: chrome`) and covers desktop/mobile, correction/rejection, seven rounds, results/review/share, reload, Chinese AI prompts, and a short mobile viewport. Install Chrome or change the browser channel for your environment. Production browser audits use practice mode to avoid contaminating daily population statistics.

Run artifacts are generated under ignored `output/`. `render_game_to_text()` exposes readable UI state; `advanceTime(ms)` is available only in local development for animation checks. Production timers use server deadlines.

## Project scope and fidelity

This is a working reconstruction of the classic seven-question experience, not the original source code. The ocean, boat, pixel buddies, UI, and sounds are independently implemented. Animation curves, sounds, art details, aliases, and changing reference data may differ. Archive/themed packs, original player distributions, and paid features are outside this release. A title or screenshot similarity is not a claim of pixel-perfect equivalence.

Contributions and bug reports are welcome through this repository. Please avoid including credentials or private player data in issues.
