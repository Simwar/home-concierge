/**
 * Long-term memory against a real Postgres (the `memory` knowledge store).
 * Skipped unless POSTGRES_HOST is set. With the local stack running:
 *
 *   bun run test:memory
 */
import { afterAll, describe, expect, test } from 'bun:test';

process.env.BACKEND_DB = ':memory:';
const enabled = !!process.env.POSTGRES_HOST;
const { recallProfile, saveProfile, forgetUser } = await import('../agent/backend/profiles');
const { pool } = await import('../agent/backend/memory-db');

const user = `test-user-${Date.now()}`;
const other = `${user}-other`;

describe.skipIf(!enabled)('memory knowledge store (Postgres)', () => {
  afterAll(async () => {
    await forgetUser(user);
    await forgetUser(other);
    await pool.end();
  });

  test('save then recall in a later "conversation"', async () => {
    const saved = (await saveProfile(user, { intent: 'rent', beds: 2, communities: ['JVC'], add_to_shortlist: ['PFD-1081', 'PFD-9999'] })) as any;
    expect(saved.ok).toBe(true);
    expect(saved.profile.shortlisted_listing_ids).toEqual(['PFD-1081']); // unknown ids are ignored

    const r = (await recallProfile(user, { countConversation: true })) as any;
    expect(r.found).toBe(true);
    expect(r.profile).toMatchObject({ intent: 'rent', beds: 2, communities: ['JVC'] });
    expect(r.shortlist[0].id).toBe('PFD-1081');
    expect(r.conversations_seen).toBe(1);
  });

  test('patches merge instead of overwriting', async () => {
    await saveProfile(user, { budget_aed: 110_000, remove_from_shortlist: ['PFD-1081'] });
    const r = (await recallProfile(user)) as any;
    expect(r.profile).toMatchObject({ intent: 'rent', beds: 2, budget_aed: 110_000 });
    expect(r.profile.shortlisted_listing_ids).toEqual([]);
  });

  test('PII is scrubbed before storage', async () => {
    const s = (await saveProfile(user, { first_name: 'Layla Ahmed', notes: 'call me on +971 50 123 4567 or layla@mail.com' })) as any;
    expect(s.redacted).toBe(true);
    expect(s.profile.first_name).toBe('Layla');
    expect(s.profile.notes).not.toMatch(/123 4567|layla@mail\.com/);
  });

  test('users are isolated', async () => {
    const r = (await recallProfile(other)) as any;
    expect(r.found).toBe(false);
  });

  test('forget deletes the profile', async () => {
    const f = (await forgetUser(user)) as any;
    expect(f.deleted_profile).toBe(true);
    expect(((await recallProfile(user)) as any).found).toBe(false);
  });

  test('anonymous sessions are never stored', async () => {
    expect(((await saveProfile(null, { beds: 1 })) as any).ok).toBe(false);
  });
});
