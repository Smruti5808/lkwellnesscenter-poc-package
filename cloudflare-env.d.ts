// Keep Worker types scoped to the backend; global Worker declarations conflict with Next's DOM/Node types.
declare module 'cloudflare:workers' {
  import type { DurableObjectState } from '@cloudflare/workers-types';
  export class DurableObject<Env> {
    constructor(ctx: DurableObjectState, env: Env);
  }
}
