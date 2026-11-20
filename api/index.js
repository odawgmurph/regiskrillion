// Vercel Function: every non-static path is rewritten here (see vercel.json).
import app from '../src/worker.mjs';
import { nodeEnv, noopContext } from '../src/node-env.mjs';

async function handle(request) {
  const url = new URL(request.url);
  // vercel.json passes the original path as ?__path= in case the runtime reports
  // the rewritten /api/index URL instead of the visitor's URL.
  if (url.pathname === '/api/index' && url.searchParams.has('__path')) {
    url.pathname = '/' + url.searchParams.get('__path');
    url.searchParams.delete('__path');
    request = new Request(url, request);
  }
  let env;
  try { env = await nodeEnv(); }
  catch (e) {
    console.error('Database unavailable:', e.message);
    return Response.json({ error: 'The game database is not configured or unreachable.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
  return app.fetch(request, env, noopContext);
}
export const GET = handle, HEAD = handle, POST = handle, PUT = handle, PATCH = handle, DELETE = handle, OPTIONS = handle;
