import { describe, expect, test } from 'bun:test';

process.env.BACKEND_DB = ':memory:';
const { searchListings } = await import('../agent/backend/listings');
const { getAreaStats } = await import('../agent/backend/stats');
const { estimateMortgage } = await import('../agent/backend/mortgage');
const { getViewingSlots, bookViewing } = await import('../agent/backend/calendar');
const { prepareLead, commitLead } = await import('../agent/backend/leads');
const { submitMortgageApplication, exportCustomerPii } = await import('../agent/backend/restricted');
const { LISTINGS, TRANSACTIONS, resolveCommunity } = await import('../agent/backend/data');

describe('seed data', () => {
  test('sizes and synthetic flags', () => {
    expect(LISTINGS.length).toBeGreaterThanOrEqual(60);
    expect(LISTINGS.length).toBeLessThanOrEqual(100);
    expect(LISTINGS.every((l) => l.synthetic === true && l.permit_number.startsWith('FAKE-'))).toBe(true);
    expect(TRANSACTIONS.every((t) => t.synthetic === true)).toBe(true);
    expect(new Set(LISTINGS.map((l) => l.city))).toEqual(new Set(['Dubai', 'Abu Dhabi', 'Sharjah']));
  });

  test('community aliases, including Arabic', () => {
    expect(resolveCommunity('JVC')).toBe('Jumeirah Village Circle');
    expect(resolveCommunity('marina')).toBe('Dubai Marina');
    expect(resolveCommunity('دبي مارينا')).toBe('Dubai Marina');
    expect(resolveCommunity('Atlantis Moon Base')).toBeNull();
  });
});

describe('search_listings', () => {
  test('filters are honoured and agent contact never leaks', () => {
    const r = searchListings({ purpose: 'rent', communities: ['Dubai Marina'], limit: 10 }) as any;
    expect(r.total_matches).toBeGreaterThan(0);
    for (const l of r.listings) {
      expect(l.purpose).toBe('rent');
      expect(l.community).toBe('Dubai Marina');
      expect(l.agent_id).toBeUndefined();
      expect(JSON.stringify(l)).not.toMatch(/555|example\.com/);
    }
  });

  test('no match returns zero results plus grounded relaxation suggestions', () => {
    const r = searchListings({ purpose: 'sale', communities: ['Palm Jumeirah'], max_price_aed: 300_000 }) as any;
    expect(r.total_matches).toBe(0);
    expect(r.listings).toHaveLength(0);
    expect(r.relaxation_suggestions.length).toBeGreaterThan(0);
  });

  test('unknown community does not silently widen the search', () => {
    const r = searchListings({ communities: ['Atlantis Moon Base'] }) as any;
    expect(r.total_matches).toBe(0);
    expect(r.unknown_communities).toEqual(['Atlantis Moon Base']);
  });
});

describe('get_area_stats', () => {
  test('1BR Marina sale stats are computed from the dataset', () => {
    const r = getAreaStats({ community: 'Marina', purpose: 'sale', beds: 1, asking_price_aed: 1_400_000 }) as any;
    expect(r.found).toBe(true);
    expect(r.sample_size).toBeGreaterThanOrEqual(5);
    expect(r.price_aed.p25).toBeLessThanOrEqual(r.price_aed.median);
    expect(r.price_aed.median).toBeLessThanOrEqual(r.price_aed.p75);
    expect(r.asking_price_check.position).toBeDefined();
    expect(r.data_notice).toMatch(/SYNTHETIC/);
  });

  test('thin data returns found=false instead of a number', () => {
    const r = getAreaStats({ community: 'Saadiyat Island', purpose: 'rent', beds: 5, months: 1 }) as any;
    expect(r.found).toBe(false);
    expect(r.price_aed).toBeUndefined();
  });
});

describe('estimate_mortgage', () => {
  test('standard annuity maths and labelled output', () => {
    const r = estimateMortgage({ price_aed: 1_400_000, down_payment_pct: 20, years: 25, annual_rate_pct: 4.5 });
    expect(r.loan_amount_aed).toBe(1_120_000);
    // 1.12M at 4.5% over 25y ≈ 6,225/month
    expect(r.monthly_payment_aed).toBeGreaterThan(6_200);
    expect(r.monthly_payment_aed).toBeLessThan(6_250);
    expect(r.label).toMatch(/not financial advice/i);
    expect(r.warnings).toHaveLength(0);
  });

  test('warns when down payment is below the expat minimum', () => {
    const r = estimateMortgage({ price_aed: 1_400_000, down_payment_pct: 10 });
    expect(r.warnings.join(' ')).toMatch(/below the typical minimum of 20%/);
  });

  test('rent vs buy comparison', () => {
    const r = estimateMortgage({ price_aed: 1_400_000, comparable_annual_rent_aed: 100_000, size_sqft: 800 });
    expect(r.rent_vs_buy?.horizon_years).toBe(5);
    expect(['renting', 'buying']).toContain(r.rent_vs_buy!.cheaper_option_on_these_assumptions);
  });
});

describe('calendar', () => {
  test('book an offered slot, then it is gone', () => {
    const id = LISTINGS[0]!.id;
    const slots = (getViewingSlots(id) as any).available_slots as string[];
    expect(slots.length).toBeGreaterThan(0);
    const b = bookViewing(id, slots[0]!, 'Sam') as any;
    expect(b.ok).toBe(true);
    expect((getViewingSlots(id) as any).available_slots).not.toContain(slots[0]);
    expect((bookViewing(id, slots[0]!) as any).ok).toBe(false);
  });

  test('rejects unknown listings and made-up slots', () => {
    expect((bookViewing('PFD-9999', '2026-10-24T15:00+04:00') as any).ok).toBe(false);
    expect((bookViewing(LISTINGS[0]!.id, 'tomorrow at 3') as any).ok).toBe(false);
  });
});

describe('least privilege', () => {
  test('mortgage_application and customer_pii_export are denied by scope', () => {
    const a = submitMortgageApplication({}) as any;
    const b = exportCustomerPii({}) as any;
    expect(a.code).toBe('SCOPE_DENIED');
    expect(a.required_scope).toBe('mortgage:submit');
    expect(b.code).toBe('SCOPE_DENIED');
    expect(b.required_scope).toBe('customer_pii:export');
  });

  test('handoff: prepare shares no contact details; commit (after approval) does', () => {
    const listing = LISTINGS[3]!;
    const p = prepareLead(listing.id, { intent: 'buy', budget_aed: 2_000_000, financing: 'cash', timeline: 'this month', beds: 2 }, []) as any;
    expect(p.ok).toBe(true);
    expect(JSON.stringify(p)).not.toMatch(/555|example\.com/);
    expect(p.draft.readiness_score).toBeGreaterThan(50);
    const c = commitLead(p.draft) as any;
    expect(c.agent_contact.phone).toMatch(/555/);
  });
});
