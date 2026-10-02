import type { DurableObjectNamespace, Fetcher } from '@cloudflare/workers-types';
export interface Env {
  DEMO_DATA: DurableObjectNamespace;
  ASSETS: Fetcher;
  WORKER_SELF_REFERENCE: Fetcher;
}
