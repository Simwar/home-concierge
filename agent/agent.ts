/**
 * The Mastra agent + Mastra instance.
 *
 * Models: all calls go through the Astropods AI Gateway (OpenAI-compatible,
 * no provider key). The platform injects ASTRO_GATEWAY_URL,
 * ASTRO_GATEWAY_API_KEY and MODEL_DEFAULT (the model picked at deploy time
 * from the `models.default.models` menu in astropods.yml).
 */

import { Agent } from '@mastra/core/agent';
import { Mastra } from '@mastra/core/mastra';
import { Memory } from '@mastra/memory';
import { PostgresStore } from '@mastra/pg';
import { createOpenAI } from '@ai-sdk/openai';
import { pool } from './backend/memory-db';
import { tools } from './tools';
import { activeInstructionSet, getInstructions } from './instructions';

const gateway = createOpenAI({
  apiKey: process.env.ASTRO_GATEWAY_API_KEY,
  baseURL: `${process.env.ASTRO_GATEWAY_URL}/v1`,
});

export const MODEL_ID = process.env.MODEL_DEFAULT ?? 'claude-sonnet-4-6';

// Conversation memory and the suspended-run snapshots that handoff_to_agent's
// approval step resumes from live in the `memory` Postgres knowledge store
// (astropods.yml), alongside the long-term user profiles.
const storage = new PostgresStore({ id: 'concierge-memory', pool });

export const agent = new Agent({
  id: 'home-concierge',
  name: 'Home Concierge',
  description: 'Lead-to-viewing concierge for UAE home-seekers (demo, synthetic data).',
  instructions: () => getInstructions(),
  // .chat() = Chat Completions. The gateway's Responses API mishandles Claude tool results.
  model: gateway.chat(MODEL_ID),
  memory: new Memory({ storage, options: { lastMessages: 30 } }),
  tools,
  defaultOptions: {
    maxSteps: 12,
    tracingOptions: {
      tags: ['astro', 'agent:home-concierge', `instructions:${activeInstructionSet()}`, `model:${MODEL_ID}`],
      metadata: { agent_id: 'home-concierge', instruction_set: activeInstructionSet(), model: MODEL_ID, data: 'synthetic' },
    },
  },
});

export const mastra = new Mastra({
  agents: { 'home-concierge': agent },
  storage,
});
