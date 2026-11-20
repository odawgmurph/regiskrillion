// Builds the Worker-style `env` object from process.env plus the database binding,
// so the same request handler runs on Vercel Functions and the local Node server.
import { databaseFromEnv } from './db.mjs';

const VARS = ['SITE_URL', 'REFERENCE_SYNC', 'LOCAL_DEVELOPMENT', 'ADMIN_TOKEN', 'CRON_SECRET', 'GA4_ID', 'CLARITY_ID', 'BING_VERIFY', 'GSC_VERIFY'];
export async function nodeEnv(source = process.env) {
  const env = { DB: await databaseFromEnv(source) };
  for (const key of VARS) if (typeof source[key] === 'string') env[key] = source[key];
  return env;
}
export const noopContext = { waitUntil() {}, passThroughOnException() {} };
