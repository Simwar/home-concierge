/**
 * Long-term memory: a small home-search profile per user, stored in the
 * `memory` Postgres knowledge store (see memory-db.ts). It follows the user
 * across conversations, restarts and redeploys, and across the built-in chat
 * and the branded UI once deployed (both key on the Astropods user id).
 *
 * Data minimisation: only search preferences and an optional first name.
 * Phone numbers, emails and ID numbers are stripped before anything is stored.
 */

import { checkScope, type ScopeDenial } from './policy';
import { audit, db } from './db';
import { getListing } from './data';
import { ensureMemorySchema, pool } from './memory-db';

export interface Profile {
  first_name?: string;
  intent?: 'rent' | 'buy' | 'invest';
  budget_aed?: number;
  beds?: number;
  communities?: string[];
  property_types?: string[];
  timeline?: string;
  financing?: 'cash' | 'mortgage' | 'undecided' | 'not_applicable';
  household?: string;
  pets?: boolean;
  must_haves?: string[];
  shortlisted_listing_ids?: string[];
  notes?: string;
}

export interface ProfilePatch extends Omit<Profile, 'shortlisted_listing_ids'> {
  add_to_shortlist?: string[];
  remove_from_shortlist?: string[];
}

const STORAGE_NOTE = 'Postgres knowledge store "memory" declared in astropods.yml; persists across conversations, restarts and redeploys.';

const PII_PATTERNS: [RegExp, string][] = [
  [/[\w.+-]+@[\w-]+\.[\w.]+/g, '[email removed]'],
  [/\b784-?\d{4}-?\d{7}-?\d\b/g, '[id removed]'], // Emirates ID shape
  [/\+?\d[\d\s-]{7,}\d/g, '[number removed]'],
];

function scrub(text: string | undefined): { text: string | undefined; redacted: boolean } {
  if (text == null) return { text, redacted: false };
  let out = text;
  for (const [re, label] of PII_PATTERNS) out = out.replace(re, label);
  return { text: out.slice(0, 300), redacted: out !== text };
}

// Bookings and handoffs live in the mock backend (SQLite), linked by user id.
const viewingsStmt = db.prepare<{ id: string; listing_id: string; slot: string }, [string]>(
  "SELECT id, listing_id, slot FROM viewings WHERE user_id = ? AND status = 'confirmed' ORDER BY slot",
);
const leadsStmt = db.prepare<{ id: string; listing_id: string; approved_at: string }, [string]>(
  'SELECT id, listing_id, approved_at FROM leads WHERE user_id = ? ORDER BY approved_at',
);

interface Row { profile: Profile; conversations: number; created_at: Date; updated_at: Date }

async function readRow(userId: string): Promise<Row | null> {
  await ensureMemorySchema();
  const r = await pool.query<Row>('SELECT profile, conversations, created_at, updated_at FROM user_profiles WHERE user_id = $1', [userId]);
  return r.rows[0] ?? null;
}

export async function recallProfile(userId: string | null, opts: { countConversation?: boolean } = {}) {
  const denied = checkScope('recall_user_profile', 'profile:read');
  if (denied) return denied;
  if (!userId) return { found: false as const, reason: 'Anonymous session: nothing is remembered between conversations.' };

  const viewings = viewingsStmt.all(userId).map((v) => ({ ...v, listing_title: getListing(v.listing_id)?.title }));
  const handoffs = leadsStmt.all(userId);
  let row = await readRow(userId);
  if (!row) {
    return { found: false as const, reason: 'No saved profile yet for this user.', upcoming_viewings: viewings, handoffs, storage: STORAGE_NOTE };
  }
  if (opts.countConversation) {
    const r = await pool.query<Row>(
      'UPDATE user_profiles SET conversations = conversations + 1 WHERE user_id = $1 RETURNING profile, conversations, created_at, updated_at',
      [userId],
    );
    row = r.rows[0] ?? row;
  }
  const profile = row.profile;
  return {
    found: true as const,
    profile,
    shortlist: (profile.shortlisted_listing_ids ?? []).map((id) => {
      const l = getListing(id);
      return l ? { id, title: l.title, price_aed: l.price_aed, purpose: l.purpose } : { id, title: 'no longer listed' };
    }),
    upcoming_viewings: viewings,
    handoffs,
    conversations_seen: row.conversations,
    first_saved: row.created_at.toISOString(),
    last_updated: row.updated_at.toISOString(),
    storage: STORAGE_NOTE,
  };
}

export async function saveProfile(
  userId: string | null,
  patch: ProfilePatch,
): Promise<{ ok: true; profile: Profile; redacted: boolean; changed: string[] } | { ok: false; error: string } | ScopeDenial> {
  const denied = checkScope('save_user_preferences', 'profile:write');
  if (denied) return denied;
  if (!userId) return { ok: false, error: 'Anonymous session: preferences cannot be saved between conversations.' };

  const next: Profile = { ...((await readRow(userId))?.profile ?? {}) };
  const changed: string[] = [];
  let redacted = false;

  const { add_to_shortlist, remove_from_shortlist, first_name, notes, ...rest } = patch;
  for (const [k, v] of Object.entries(rest)) {
    if (v === undefined || v === null) continue;
    (next as Record<string, unknown>)[k] = v;
    changed.push(k);
  }
  for (const [key, value] of [['first_name', first_name], ['notes', notes]] as const) {
    if (value === undefined) continue;
    const s = scrub(key === 'first_name' ? value.trim().split(/\s+/)[0] : value);
    redacted ||= s.redacted;
    next[key] = s.text;
    changed.push(key);
  }
  if (add_to_shortlist?.length || remove_from_shortlist?.length) {
    const set = new Set(next.shortlisted_listing_ids ?? []);
    for (const id of add_to_shortlist ?? []) {
      const l = getListing(id);
      if (l) set.add(l.id);
    }
    for (const id of remove_from_shortlist ?? []) set.delete(id.trim().toUpperCase());
    next.shortlisted_listing_ids = [...set];
    changed.push('shortlisted_listing_ids');
  }

  await pool.query(
    `INSERT INTO user_profiles (user_id, profile) VALUES ($1, $2)
     ON CONFLICT (user_id) DO UPDATE SET profile = EXCLUDED.profile, updated_at = now()`,
    [userId, JSON.stringify(next)],
  );
  audit('profile_saved', { changed, redacted });
  return { ok: true, profile: next, redacted, changed };
}

export async function forgetUser(userId: string | null) {
  const denied = checkScope('forget_me', 'profile:write');
  if (denied) return denied;
  if (!userId) return { ok: false as const, error: 'Anonymous session: nothing is stored.' };
  await ensureMemorySchema();
  const deleted = (await pool.query('DELETE FROM user_profiles WHERE user_id = $1', [userId])).rowCount ?? 0;
  // Bookings and leads are business records: keep them, but unlink them from the person.
  const viewings = db.prepare('UPDATE viewings SET user_id = NULL WHERE user_id = ?').run(userId).changes;
  const leads = db.prepare('UPDATE leads SET user_id = NULL WHERE user_id = ?').run(userId).changes;
  audit('profile_forgotten', { deleted_profile: deleted > 0, viewings_unlinked: viewings, leads_unlinked: leads });
  return {
    ok: true as const,
    deleted_profile: deleted > 0,
    viewings_unlinked: viewings,
    handoffs_unlinked: leads,
    note: 'Saved preferences deleted from the memory database. Existing bookings/handoffs are kept but no longer linked to you. This conversation stays until you start a new one.',
  };
}
