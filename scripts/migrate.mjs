// Applies pending schema migrations to the configured database (Turso when
// TURSO_DATABASE_URL is set, otherwise the local .data SQLite file). The app also
// migrates lazily on first request, so this is optional.
import { databaseFromEnv } from '../src/db.mjs';
const db = await databaseFromEnv();
const { results } = await db.prepare('SELECT id FROM _migrations ORDER BY id').all();
console.log('Schema up to date:', results.map(r => r.id).join(', '));
db.close();
