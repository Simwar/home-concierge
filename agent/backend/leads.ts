/**
 * Lead store + readiness scoring for handoff to a human property agent.
 *
 * Two steps, so contact details can never leave before sign-off:
 *   1. prepareLead()  — validate and score; returns NO broker contact details.
 *   2. commitLead()   — only after explicit human approval; writes the lead and
 *                       releases the broker's contact card.
 */

import { randomUUID } from 'node:crypto';
import { checkScope, type ScopeDenial } from './policy';
import { db, audit } from './db';
import { DATA_NOTICE, getBroker, getListing } from './data';
import { countViewingsForListings } from './calendar';

export interface LeadSummary {
  intent: 'rent' | 'buy' | 'invest';
  budget_aed?: number;
  beds?: number;
  communities?: string[];
  timeline?: string;
  financing?: 'cash' | 'mortgage' | 'undecided' | 'not_applicable';
  household?: string;
  notes?: string;
}

export interface LeadDraft {
  listing_id: string;
  listing_title: string;
  agent_name: string;
  agency: string;
  summary: LeadSummary;
  shortlisted_listing_ids: string[];
  readiness_score: number;
  readiness_breakdown: Record<string, number>;
}

/** Transparent 0-100 score so the human agent can see why a lead ranks where it does. */
export function scoreReadiness(s: LeadSummary, shortlisted: string[]): { score: number; breakdown: Record<string, number> } {
  const breakdown: Record<string, number> = {};
  breakdown.budget_known = s.budget_aed ? 20 : 0;
  breakdown.requirements_clear = (s.beds != null ? 8 : 0) + (s.communities?.length ? 7 : 0);
  const t = (s.timeline ?? '').toLowerCase();
  breakdown.timeline =
    /(now|asap|immediate|this week|this month|within (a|1|one|2|two) (week|month)|days)/.test(t) ? 20
    : /(1|2|3|one|two|three)[- ]?(month|months)|next month|soon/.test(t) ? 14
    : t ? 6 : 0;
  breakdown.financing =
    s.intent === 'rent' ? (s.financing ? 15 : 8)
    : s.financing === 'cash' ? 20
    : s.financing === 'mortgage' ? 14
    : s.financing === 'undecided' ? 5 : 0;
  breakdown.shortlist = Math.min(shortlisted.length, 3) * 3;
  breakdown.viewings_booked = Math.min(countViewingsForListings(shortlisted), 2) * 8;
  const score = Math.min(100, Object.values(breakdown).reduce((a, b) => a + b, 0));
  return { score, breakdown };
}

export function prepareLead(listingId: string, summary: LeadSummary, shortlisted: string[]): { ok: true; draft: LeadDraft } | { ok: false; error: string } | ScopeDenial {
  const denied = checkScope('handoff_to_agent', 'leads:write');
  if (denied) return denied;
  const listing = getListing(listingId);
  if (!listing) return { ok: false, error: `Unknown listing id "${listingId}". Only ids returned by search_listings exist.` };
  const broker = getBroker(listing.agent_id);
  if (!broker) return { ok: false, error: `No broker on file for ${listing.id}.` };
  const ids = Array.from(new Set([listing.id, ...shortlisted.filter((id) => getListing(id))]));
  const { score, breakdown } = scoreReadiness(summary, ids);
  return {
    ok: true,
    draft: {
      listing_id: listing.id,
      listing_title: listing.title,
      agent_name: broker.name,
      agency: broker.agency,
      summary,
      shortlisted_listing_ids: ids,
      readiness_score: score,
      readiness_breakdown: breakdown,
    },
  };
}

const insertLead = db.prepare(
  'INSERT INTO leads (id, listing_id, agent_id, summary_json, readiness_score, approved_at, user_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
);

export function commitLead(draft: LeadDraft, userId?: string | null) {
  const denied = checkScope('handoff_to_agent', 'leads:write') ?? checkScope('handoff_to_agent', 'brokers:contact:read');
  if (denied) return denied;
  const listing = getListing(draft.listing_id)!;
  const broker = getBroker(listing.agent_id)!;
  const id = `LEAD-${randomUUID().slice(0, 8).toUpperCase()}`;
  const approvedAt = new Date().toISOString();
  insertLead.run(id, listing.id, broker.agent_id, JSON.stringify({ ...draft.summary, shortlisted_listing_ids: draft.shortlisted_listing_ids, readiness_breakdown: draft.readiness_breakdown }), draft.readiness_score, approvedAt, userId ?? null);
  audit('lead_handed_off', { id, listing_id: listing.id, agent_id: broker.agent_id, readiness: draft.readiness_score });
  return {
    ok: true as const,
    data_notice: DATA_NOTICE,
    lead_id: id,
    approved_at: approvedAt,
    readiness_score: draft.readiness_score,
    agent_contact: {
      name: broker.name,
      agency: broker.agency,
      phone: broker.phone,
      email: broker.email,
      brn: broker.brn,
      languages: broker.languages,
      note: 'Fictional broker for the demo. Phone numbers use the reserved 555 range; emails use example.com.',
    },
  };
}
