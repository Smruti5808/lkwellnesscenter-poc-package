import { DurableObject } from 'cloudflare:workers';
import type { DurableObjectState } from '@cloudflare/workers-types';
import { handleApi } from '../src/server/api';
import { CloudflareStore, type BundledBootstrap } from '../src/server/cloudflare-storage';
// Generated privately by data:cloudflare:prepare before every Cloudflare build.
// @ts-ignore A clean checkout generates this ignored snapshot at build time.
import bootstrap from './bootstrap.generated.json';
import { withStorage } from '../src/server/storage';
import type { Env } from './env';

export class DemoData extends DurableObject<Env> {
  private readonly store: CloudflareStore;
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.store = new CloudflareStore(ctx.storage, bootstrap as BundledBootstrap);
  }

  async fetch(request: Request): Promise<Response> {
    const segments = new URL(request.url).pathname.slice('/api/v1/'.length).split('/').map(decodeURIComponent);
    return withStorage(this.store, () => handleApi(request, segments));
  }
}
