/**
 * Home Concierge (demo) — entry point.
 *
 * Two ways in, one agent:
 *   - Astropods built-in chat / messaging sidecar, via serve() from
 *     @astropods/adapter-mastra (this also turns on OpenTelemetry tracing when
 *     the platform sets OTEL_EXPORTER_OTLP_ENDPOINT on a deployed container).
 *   - A small branded web UI on port 80 (agent.interfaces.frontend), which
 *     calls the same agent in-process, so its turns are traced the same way.
 */

import { serve } from '@astropods/adapter-mastra';
import { agent, mastra } from './agent';
import { startWebServer } from './web/server';
import { activeInstructionSet } from './instructions';
import { MODEL_ID } from './agent';

serve(agent);

// When tracing is on, serve() registers the agent on a new Mastra instance that
// carries the Astropods exporter. Move our Postgres store (the `memory`
// knowledge store) onto it so suspended handoff approvals survive restarts.
const active = agent.getMastraInstance();
if (active && active !== mastra) active.setStorage(mastra.getStorage()!);

startWebServer();

console.log(`[home-concierge] model=${MODEL_ID} instructions=${activeInstructionSet()}`);
if (activeInstructionSet() !== 'strict') {
  console.warn('[home-concierge] WARNING: running the lenient-UNSAFE instruction set (eval demo only).');
}
