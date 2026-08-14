import type worker from "../src/worker";
import type { Env as WorkerEnv } from "../src/worker";

declare module "cloudflare:test" {
  interface ProvidedEnv extends WorkerEnv {}
}

declare global {
  namespace Cloudflare {
    interface Env extends WorkerEnv {}
    interface GlobalProps {
      mainModule: { default: typeof worker };
      durableNamespaces: "Room";
    }
  }
}

export {};
