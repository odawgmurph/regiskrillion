// A small D1-compatible database facade (prepare/bind/first/all/run/batch) over
// either Turso/libSQL (production on Vercel) or Node's built-in SQLite (local
// development, tests and the explicit ephemeral fallback).
import { MIGRATIONS, statements } from './migrations.mjs';

function facade(exec, batch, close = () => {}) {
  const statement = (sql, args = []) => ({
    sql, args,
    bind: (...values) => statement(sql, values),
    async first() { return (await exec(sql, args))[0] ?? null; },
    async all() { return { results: await exec(sql, args) }; },
    async run() { await exec(sql, args); return { success: true }; },
  });
  return { prepare: sql => statement(sql), batch: list => batch(list.map(s => ({ sql: s.sql, args: s.args }))), close };
}

export function sqliteDatabase(path = ':memory:', DatabaseSync) {
  const db = new DatabaseSync(path);
  const exec = async (sql, args) => {
    const s = db.prepare(sql);
    return s.columns().length ? s.all(...args) : (s.run(...args), []);
  };
  const batch = async list => {
    db.exec('BEGIN');
    try { const out = []; for (const s of list) out.push({ results: await exec(s.sql, s.args) }); db.exec('COMMIT'); return out; }
    catch (e) { db.exec('ROLLBACK'); throw e; }
  };
  return facade(exec, batch, () => db.close());
}

export function libsqlDatabase(client) {
  const rows = r => r.rows.map(row => Object.fromEntries(r.columns.map((c, i) => [c, row[i]])));
  const exec = async (sql, args) => rows(await client.execute({ sql, args }));
  const batch = async list => (await client.batch(list, 'write')).map(r => ({ results: rows(r) }));
  return facade(exec, batch, () => client.close());
}

export async function migrate(db) {
  await db.prepare('CREATE TABLE IF NOT EXISTS _migrations (id TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)').run();
  const done = new Set((await db.prepare('SELECT id FROM _migrations').all()).results.map(r => r.id));
  const applied = [];
  for (const m of MIGRATIONS) {
    if (done.has(m.id)) continue;
    try {
      await db.batch([...statements(m.sql).map(sql => db.prepare(sql)), db.prepare('INSERT INTO _migrations(id,applied_at) VALUES(?,?)').bind(m.id, Date.now())]);
      applied.push(m.id);
    } catch (e) {
      // Another cold-started instance may have applied it concurrently.
      const row = await db.prepare('SELECT id FROM _migrations WHERE id=?').bind(m.id).first();
      if (!row) throw e;
    }
  }
  return applied;
}

let shared;
// Resolves the database from environment variables. Cached per server instance.
export function databaseFromEnv(env = process.env) {
  shared ??= (async () => {
    const url = env.TURSO_DATABASE_URL || env.DATABASE_URL;
    let db;
    if (url && !url.startsWith('file:')) {
      const { createClient } = await import('@libsql/client/web');
      db = libsqlDatabase(createClient({ url, authToken: env.TURSO_AUTH_TOKEN || env.DATABASE_AUTH_TOKEN }));
    } else {
      if (env.VERCEL && !url && env.ALLOW_EPHEMERAL_DB !== 'true') throw new Error('No database configured. Set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN.');
      const { DatabaseSync } = await import('node:sqlite');
      const path = url ? url.slice(5) : env.VERCEL ? '/tmp/openkrillion.sqlite' : '.data/openkrillion.sqlite';
      if (path !== ':memory:') { const { mkdirSync } = await import('node:fs'); const { dirname } = await import('node:path'); mkdirSync(dirname(path), { recursive: true }); }
      db = sqliteDatabase(path, DatabaseSync);
    }
    await migrate(db);
    return db;
  })().catch(e => { shared = undefined; throw e; });
  return shared;
}
