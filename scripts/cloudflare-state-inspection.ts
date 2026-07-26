import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";

// State commands need stack services but must not evaluate the application graph.
export default Alchemy.Stack(
  "CloudflareStateInspection",
  {
    providers: Cloudflare.providers(),
    state: Cloudflare.state(),
  },
  Effect.void
);
