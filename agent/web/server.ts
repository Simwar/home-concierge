/**
 * Branded web chat for the demo (agent.interfaces.frontend: true → port 80).
 *
 * Streams the same Mastra agent the messaging sidecar uses, as Server-Sent
 * Events. handoff_to_agent's suspend is rendered as Approve / Decline buttons
 * and resumed with agent.resumeStream(), mirroring what the built-in chat does
 * with its approval form.
 *
 * Identity: every request goes through the Astropods auth guard
 * (@astropods/adapter-core/auth), which verifies the platform's sign-in
 * headers and checks this interface's access list. The verified user id is
 * the memory resource, so it matches the id the built-in chat uses and the
 * user's memory follows them across both UIs. In local dev (`ast project
 * start`, no deploy token) the guard runs in dev mode; a browser-generated
 * visitor id stands in so cross-conversation memory can still be shown.
 */

import { join } from 'node:path';
import { agent } from '../agent';
import { Authorizer, withAuth, type Principal } from '@astropods/adapter-core/auth';
import { activeInstructionSet } from '../instructions';
import { recallProfile } from '../backend/profiles';

const PUBLIC_DIR = join(import.meta.dir, 'public');
const authz = new Authorizer();

/** The memory resource for this caller, or an anonymous per-conversation one. */
function resourceFor(principal: Principal | null, visitorId: unknown, threadId: string): { resource: string; remembered: boolean } {
  if (principal?.userId) return { resource: principal.userId, remembered: true };
  if (authz.devMode && typeof visitorId === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(visitorId)) {
    return { resource: `local-visitor-${visitorId}`, remembered: true };
  }
  return { resource: `anon:${threadId}`, remembered: false };
}

type Emit = (event: string, data: unknown) => void;

/** Forward one Mastra stream to the browser. Returns when the stream ends. */
async function pipe(stream: Awaited<ReturnType<typeof agent.stream>>, emit: Emit) {
  emit('trace', { traceId: stream.traceId ?? null });
  for await (const chunk of stream.fullStream as AsyncIterable<any>) {
    switch (chunk.type) {
      case 'text-delta':
        emit('text', { text: chunk.payload.text });
        break;
      case 'tool-call':
        emit('tool', { phase: 'start', name: chunk.payload.toolName, toolCallId: chunk.payload.toolCallId });
        break;
      case 'tool-result': {
        const result = chunk.payload.result as any;
        emit('tool', {
          phase: 'end',
          name: chunk.payload.toolName,
          toolCallId: chunk.payload.toolCallId,
          denied: result?.code === 'SCOPE_DENIED',
          // Listing cards are rendered client-side from the tool result itself.
          listings: chunk.payload.toolName === 'search_listings' ? (result?.listings ?? []) : undefined,
          // The raw result is what the model saw; scripts/run-conversations.ts
          // uses it to check that every figure in a reply is grounded.
          result,
        });
        break;
      }
      case 'tool-error':
        console.error(`[web] tool ${chunk.payload.toolName} failed:`, chunk.payload.error?.message ?? chunk.payload.error);
        emit('tool', { phase: 'end', name: chunk.payload.toolName, toolCallId: chunk.payload.toolCallId, error: String(chunk.payload.error?.message ?? chunk.payload.error ?? 'tool error') });
        break;
      case 'tool-call-suspended':
        emit('approval', {
          runId: stream.runId,
          toolCallId: chunk.payload.toolCallId,
          toolName: chunk.payload.toolName,
          message: chunk.payload.suspendPayload?.message ?? 'Approve this action?',
        });
        break;
      case 'error':
        emit('error', { message: String(chunk.payload?.error?.message ?? chunk.payload?.error ?? 'error') });
        break;
    }
  }
}

function sse(run: (emit: Emit) => Promise<void>): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    async start(controller) {
      const emit: Emit = (event, data) => controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      try {
        await run(emit);
      } catch (err) {
        console.error('[web] stream failed', err);
        emit('error', { message: 'The assistant hit an error. Please try again.' });
      }
      emit('done', {});
      controller.close();
    },
  });
  return new Response(body, { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' } });
}

const tracing = (threadId: string) => ({
  metadata: { 'langfuse.session.id': threadId, channel: 'branded-web-ui' },
});

async function handle(req: Request, principal: Principal | null): Promise<Response> {
  const url = new URL(req.url);

  if (req.method === 'GET' && url.pathname === '/api/config') {
    return Response.json({ instruction_set: activeInstructionSet(), synthetic_data: true, signed_in: !!principal?.userId, auth_dev_mode: authz.devMode });
  }

  // What the concierge remembers about the caller (memory panel).
  if (req.method === 'POST' && url.pathname === '/api/profile') {
    const { visitorId } = (await req.json().catch(() => ({}))) as { visitorId?: string };
    const { resource, remembered } = resourceFor(principal, visitorId, 'none');
    if (!remembered) return Response.json({ found: false, reason: 'anonymous' });
    return Response.json(await recallProfile(resource));
  }

  if (req.method === 'POST' && url.pathname === '/api/chat') {
    const { threadId, message, visitorId } = (await req.json()) as { threadId?: string; message?: string; visitorId?: string };
    if (!threadId || !message?.trim()) return Response.json({ error: 'threadId and message are required' }, { status: 400 });
    const { resource } = resourceFor(principal, visitorId, threadId);
    return sse(async (emit) => {
      const stream = await agent.stream(message.slice(0, 4000), {
        // Thread ids are namespaced by user so one caller can never open another's thread.
        memory: { thread: `web:${resource}:${threadId}`, resource },
        tracingOptions: tracing(threadId),
        abortSignal: req.signal,
      });
      await pipe(stream, emit);
    });
  }

  if (req.method === 'POST' && url.pathname === '/api/approve') {
    const { threadId, runId, toolCallId, approve, visitorId } = (await req.json()) as {
      threadId?: string; runId?: string; toolCallId?: string; approve?: boolean; visitorId?: string;
    };
    if (!threadId || !runId || !toolCallId) return Response.json({ error: 'threadId, runId and toolCallId are required' }, { status: 400 });
    const { resource } = resourceFor(principal, visitorId, threadId);
    return sse(async (emit) => {
      const stream = await agent.resumeStream({ approve: approve === true }, {
        runId,
        toolCallId,
        memory: { thread: `web:${resource}:${threadId}`, resource },
        tracingOptions: tracing(threadId),
      } as any);
      await pipe(stream, emit);
    });
  }

  if (req.method === 'GET') {
    const path = url.pathname === '/' ? '/index.html' : url.pathname;
    if (!path.includes('..')) {
      const file = Bun.file(join(PUBLIC_DIR, path));
      if (await file.exists()) return new Response(file);
    }
  }
  return new Response('Not found', { status: 404 });
}

export function startWebServer() {
  const port = Number(process.env.PORT || 80);
  const guarded = withAuth(authz, handle);
  Bun.serve({
    port,
    hostname: '0.0.0.0',
    idleTimeout: 120,
    fetch: (req) => (new URL(req.url).pathname === '/healthz' ? new Response('ok') : guarded(req)),
  });
  if (authz.devMode) console.warn('[web] auth guard in dev mode (no deploy token): browser visitor ids stand in for users');
  console.log(`[web] Home Concierge UI listening on :${port}`);
}
