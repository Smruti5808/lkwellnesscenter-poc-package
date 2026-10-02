// @ts-ignore OpenNext generates this module during build.
import nextWorker from './.open-next/worker.js';
import type { Env } from './cloudflare/env';
import type { ExecutionContext, Request as WorkerRequest } from '@cloudflare/workers-types';
export { DemoData } from './cloudflare/demo-object';

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/v1/')) return nextWorker.fetch(request, env, ctx);
    let response: Response;
    if (request.method === 'OPTIONS') {
      response = new Response(null, { status: 204, headers: { Allow: 'GET, HEAD, POST, PATCH, DELETE, OPTIONS' } });
    } else if (!['GET', 'HEAD', 'POST', 'PATCH', 'DELETE'].includes(request.method)) {
      response = new Response(null, { status: 405, headers: { Allow: 'GET, HEAD, POST, PATCH, DELETE, OPTIONS' } });
    } else {
      // One stable ID is shared by ALL users and deployments. The API's access checks are retained.
      const stub = env.DEMO_DATA.get(env.DEMO_DATA.idFromName('lk-wellness-demo-v1'));
      const forwarded = request.method === 'HEAD' ? new Request(request, { method: 'GET' }) : request;
      response = await stub.fetch(forwarded as unknown as WorkerRequest) as unknown as Response;
      response = new Response(request.method === 'HEAD' ? null : response.body, response);
    }
    response.headers.set('X-Content-Type-Options', 'nosniff');
    response.headers.set('Referrer-Policy', 'no-referrer');
    response.headers.set('X-Frame-Options', 'SAMEORIGIN');
    response.headers.set('Cache-Control', 'no-store');
    return response;
  },
};
