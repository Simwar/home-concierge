/**
 * Replays evaluation/test-conversations.json against a running agent through
 * the branded web UI's API, and applies the deterministic `checks`.
 *
 *   bun run conversations                        # http://localhost:3200
 *   bun run conversations --base https://<agent-url>
 *   bun run conversations --only handoff-approved,arabic-search
 *
 * Each turn is a real agent run, so against a deployed agent this also
 * produces the traces that `ast eval run` grades.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** new_session: start a fresh conversation (new thread) for the same user, to test long-term memory. */
interface Turn { user: string; approve?: boolean; new_session?: boolean }
interface Checks {
  tools_called?: string[];
  tools_not_called?: string[];
  /** Tools that must be called AND refused by the backend scope policy. */
  tools_denied?: string[];
  reply_must_match?: string[];
  reply_must_not_match?: string[];
  arabic_reply?: boolean;
  approval_requested?: boolean;
  max_questions?: number;
}
interface Conversation { id: string; category: string; turns: Turn[]; checks: Checks }

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const BASE = (flag('base') ?? 'http://localhost:3200').replace(/\/$/, '');
const ONLY = flag('only')?.split(',');
const VERBOSE = args.includes('--verbose');

const file = JSON.parse(readFileSync(join(import.meta.dir, '..', 'evaluation', 'test-conversations.json'), 'utf8'));
const conversations = (file.conversations as Conversation[]).filter((c) => !ONLY || ONLY.includes(c.id));

interface ToolRun { name: string; denied: boolean; result: unknown }
interface Outcome { text: string; tools: ToolRun[]; approval?: { runId: string; toolCallId: string; message: string }; errors: string[] }

async function call(path: string, body: unknown): Promise<Outcome> {
  const res = await fetch(`${BASE}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok || !res.body) throw new Error(`${path} -> HTTP ${res.status}`);
  const out: Outcome = { text: '', tools: [], errors: [] };
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const event = /^event: (.*)$/m.exec(block)?.[1];
      const data = JSON.parse(/^data: (.*)$/m.exec(block)?.[1] ?? '{}');
      if (event === 'text') out.text += data.text;
      else if (event === 'tool' && data.phase === 'end') {
        if (data.error) out.errors.push(`tool ${data.name} errored: ${data.error}`);
        else out.tools.push({ name: data.name, denied: !!data.denied, result: data.result });
      }
      else if (event === 'tool' && data.phase === 'start' && out.text && !out.text.endsWith('\n')) out.text += '\n';
      else if (event === 'approval') out.approval = data;
      else if (event === 'error') out.errors.push(data.message);
    }
  }
  return out;
}

/**
 * Money-sized figures (>= 10,000 once "k"/"M"/"million"/"ألف"/"مليون" are applied)
 * mentioned in a reply. Smaller numbers (sqft, percentages, years) are ignored.
 */
function moneyFigures(text: string): number[] {
  const out: number[] = [];
  const re = /(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*(million|mn|m\b|k\b|K\b|مليون|ألف)?/gi;
  for (const m of text.matchAll(re)) {
    let n = Number(m[1]!.replace(/,/g, ''));
    const unit = (m[2] ?? '').toLowerCase();
    if (unit === 'million' || unit === 'mn' || unit === 'm' || unit === 'مليون') n *= 1_000_000;
    else if (unit === 'k' || unit === 'ألف') n *= 1_000;
    if (n >= 10_000) out.push(n);
  }
  return out;
}

/** Every numeric value anywhere in the tool results and user messages. */
function sourceFigures(sources: unknown[]): number[] {
  const nums: number[] = [];
  const walk = (v: unknown) => {
    if (typeof v === 'number') nums.push(v);
    else if (typeof v === 'string') nums.push(...moneyFigures(v));
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  sources.forEach(walk);
  return nums;
}

/** Figures in the reply that are not within 3% of any tool or user figure. */
function ungroundedFigures(reply: string, sources: unknown[]): number[] {
  const known = sourceFigures(sources);
  return moneyFigures(reply).filter((n) => !known.some((k) => k > 0 && Math.abs(n - k) / k <= 0.03));
}

/** JS RegExp has no inline (?i); translate the leading flag used in the JSON. */
function re(pattern: string): RegExp {
  return pattern.startsWith('(?i)') ? new RegExp(pattern.slice(4), 'i') : new RegExp(pattern);
}

let failed = 0;
for (const conv of conversations) {
  // One simulated user per conversation (local dev visitor id), so memory never leaks between tests.
  const visitorId = `eval-${conv.id}-${Date.now()}`.slice(0, 64);
  let threadId = `t-${Date.now()}`;
  const tools: ToolRun[] = [];
  let lastReply = '';
  let allText = '';
  let approvalRequested = false;
  const problems: string[] = [];
  const started = Date.now();

  try {
    for (const turn of conv.turns) {
      if (turn.new_session) threadId = `t-${Date.now()}`;
      let out = await call('/api/chat', { threadId, visitorId, message: turn.user });
      tools.push(...out.tools);
      let reply = out.text;
      if (out.approval) {
        approvalRequested = true;
        out = await call('/api/approve', { threadId, visitorId, runId: out.approval.runId, toolCallId: out.approval.toolCallId, approve: turn.approve === true });
        tools.push(...out.tools);
        reply += '\n' + out.text;
      }
      problems.push(...out.errors.map((e) => `stream error: ${e}`));
      lastReply = reply;
      allText += reply + '\n';
      if (VERBOSE) console.log(`${turn.new_session ? '\n  --- new conversation (same user) ---' : ''}\n  > ${turn.user}\n  < ${reply.trim().replace(/\n/g, '\n    ')}`);
    }
  } catch (err) {
    problems.push(`request failed: ${(err as Error).message}`);
  }

  const c = conv.checks;
  const called = new Set(tools.map((t) => t.name));
  for (const t of c.tools_called ?? []) if (!called.has(t)) problems.push(`expected tool ${t} to be called`);
  for (const t of c.tools_not_called ?? []) if (called.has(t)) problems.push(`tool ${t} should not be called`);
  for (const t of c.tools_denied ?? []) if (!tools.some((x) => x.name === t && x.denied)) problems.push(`expected ${t} to be called and denied by scope`);
  for (const p of c.reply_must_match ?? []) if (!re(p).test(allText)) problems.push(`reply should match /${p}/`);
  for (const p of c.reply_must_not_match ?? []) if (re(p).test(allText)) problems.push(`reply must not match /${p}/`);
  if (c.arabic_reply && !/[؀-ۿ]{6,}/.test(lastReply)) problems.push('reply should be in Arabic');
  if (c.approval_requested != null && approvalRequested !== c.approval_requested) problems.push(`approval_requested should be ${c.approval_requested}`);
  if (c.max_questions != null) {
    const q = (lastReply.match(/\?/g) ?? []).length;
    if (q > c.max_questions) problems.push(`asked ${q} questions (max ${c.max_questions})`);
  }

  // Grounding: applies to every conversation. Strict agents only quote tool output.
  const ungrounded = ungroundedFigures(allText, [...tools.map((t) => t.result), ...conv.turns.map((t) => t.user)]);
  if (ungrounded.length) problems.push(`ungrounded figures (not in any tool result or user message): ${ungrounded.map((n) => n.toLocaleString('en-US')).join(', ')}`);

  const denied = tools.filter((t) => t.denied).map((t) => t.name);
  const status = problems.length ? 'FAIL' : 'PASS';
  if (problems.length) failed++;
  console.log(
    `${status}  ${conv.id.padEnd(30)} ${((Date.now() - started) / 1000).toFixed(1).padStart(5)}s  tools=[${tools.map((t) => t.name).join(', ')}]` +
      (denied.length ? `  denied=[${denied.join(', ')}]` : ''),
  );
  for (const p of problems) console.log(`        - ${p}`);
}

console.log(`\n${conversations.length - failed}/${conversations.length} conversations passed against ${BASE}`);
process.exit(failed ? 1 : 0);
