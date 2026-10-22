/**
 * Mock broker calendar. Viewing slots are generated for the next days (Dubai
 * time, UTC+4); some are pre-blocked by a deterministic hash so the calendar
 * looks lived-in. Bookings are written to SQLite.
 */

import { randomUUID } from 'node:crypto';
import { checkScope, type ScopeDenial } from './policy';
import { db, audit } from './db';
import { DATA_NOTICE, getListing } from './data';

const SLOT_HOURS = [10, 12, 15, 17];
const DAYS_AHEAD = 10;
const DUBAI_OFFSET_H = 4;

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Canonical slot id, e.g. "2026-10-24T15:00+04:00". */
function slotId(date: Date, hour: number): string {
  return `${date.toISOString().slice(0, 10)}T${String(hour).padStart(2, '0')}:00+04:00`;
}

function slotToDate(slot: string): Date | null {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):00\+04:00$/.exec(slot.trim());
  if (!m) return null;
  return new Date(`${m[1]}T${String(Number(m[2]) - DUBAI_OFFSET_H).padStart(2, '0')}:00:00Z`);
}

function generatedSlots(agentId: string, now = new Date()): string[] {
  const out: string[] = [];
  const dubaiNow = new Date(now.getTime() + DUBAI_OFFSET_H * 3600_000);
  for (let d = 1; d <= DAYS_AHEAD; d++) {
    const day = new Date(Date.UTC(dubaiNow.getUTCFullYear(), dubaiNow.getUTCMonth(), dubaiNow.getUTCDate() + d));
    if (day.getUTCDay() === 0 && hash(agentId) % 2 === 0) continue; // some brokers are off on Sundays
    for (const h of SLOT_HOURS) {
      const id = slotId(day, h);
      if (hash(`${agentId}|${id}`) % 3 !== 0) out.push(id); // ~1/3 pre-blocked
    }
  }
  return out;
}

const bookedStmt = db.prepare<{ slot: string }, [string]>("SELECT slot FROM viewings WHERE agent_id = ? AND status = 'confirmed'");

export function getViewingSlots(listingId: string, maxSlots = 8) {
  const denied = checkScope('get_viewing_slots', 'calendar:read');
  if (denied) return denied;
  const listing = getListing(listingId);
  if (!listing) return { ok: false as const, error: `Unknown listing id "${listingId}". Only ids returned by search_listings exist.` };
  const booked = new Set(bookedStmt.all(listing.agent_id).map((r) => r.slot));
  const free = generatedSlots(listing.agent_id).filter((s) => !booked.has(s));
  return {
    ok: true as const,
    data_notice: DATA_NOTICE,
    listing_id: listing.id,
    listing_title: listing.title,
    timezone: 'Asia/Dubai (UTC+4)',
    available_slots: free.slice(0, Math.min(Math.max(maxSlots, 1), 20)),
  };
}

const insertViewing = db.prepare(
  'INSERT INTO viewings (id, listing_id, agent_id, slot, attendee, user_id) VALUES (?, ?, ?, ?, ?, ?)',
);

export type BookingResult =
  | { ok: true; data_notice: string; booking_id: string; listing_id: string; listing_title: string; slot: string; timezone: string; status: 'confirmed'; note: string }
  | { ok: false; error: string; available_slots?: string[] }
  | ScopeDenial;

export function bookViewing(listingId: string, slot: string, attendeeFirstName?: string, userId?: string | null): BookingResult {
  const denied = checkScope('book_viewing', 'calendar:write');
  if (denied) return denied;
  const listing = getListing(listingId);
  if (!listing) return { ok: false, error: `Unknown listing id "${listingId}". Only ids returned by search_listings exist.` };

  const when = slotToDate(slot);
  const free = (getViewingSlots(listing.id, 20) as { available_slots?: string[] }).available_slots ?? [];
  if (!when) return { ok: false, error: `Slot "${slot}" is not in the expected format (e.g. "${free[0] ?? '2026-10-24T15:00+04:00'}").`, available_slots: free.slice(0, 6) };
  if (!free.includes(slot.trim())) {
    return { ok: false, error: `Slot ${slot} is not available for ${listing.id}.`, available_slots: free.slice(0, 6) };
  }

  const id = `VW-${randomUUID().slice(0, 8).toUpperCase()}`;
  try {
    insertViewing.run(id, listing.id, listing.agent_id, slot.trim(), attendeeFirstName ?? null, userId ?? null);
  } catch {
    return { ok: false, error: `Slot ${slot} was just taken.`, available_slots: free.filter((s) => s !== slot).slice(0, 6) };
  }
  audit('viewing_booked', { id, listing_id: listing.id, slot });
  return {
    ok: true,
    data_notice: DATA_NOTICE,
    booking_id: id,
    listing_id: listing.id,
    listing_title: listing.title,
    slot: slot.trim(),
    timezone: 'Asia/Dubai (UTC+4)',
    status: 'confirmed',
    note: 'Demo booking in a mock calendar. No real broker is notified.',
  };
}

export function countViewingsForListings(listingIds: string[]): number {
  if (listingIds.length === 0) return 0;
  const placeholders = listingIds.map(() => '?').join(',');
  const row = db.query(`SELECT COUNT(*) AS n FROM viewings WHERE status = 'confirmed' AND listing_id IN (${placeholders})`).get(...listingIds) as { n: number };
  return row.n;
}
