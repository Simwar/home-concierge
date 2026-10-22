import { checkScope, type ScopeDenial } from './policy';
import { COMMUNITIES, DATA_NOTICE, TRANSACTIONS, resolveCommunity, type PropertyType, type Purpose } from './data';

export interface AreaStatsQuery {
  community: string;
  purpose: Purpose;
  beds?: number;
  property_type?: PropertyType;
  /** Look-back window in months (default 12). */
  months?: number;
  /** Optional asking price to position against the distribution. */
  asking_price_aed?: number;
}

const MIN_SAMPLE = 5;
// Same fixed "today" as the generator, so the demo is stable whatever the date.
const AS_OF = new Date('2026-10-22T00:00:00Z');

function quantile(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return Math.round(sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo));
}

export type AreaStatsResult =
  | {
      found: true;
      data_notice: string;
      source: string;
      query: { community: string; purpose: Purpose; beds: number | 'any'; property_type: string; window: string };
      sample_size: number;
      low_sample_warning: boolean;
      price_aed: { median: number; p25: number; p75: number; min: number; max: number; period: 'total' | 'per_year' };
      price_per_sqft_aed: { median: number; p25: number; p75: number };
      median_size_sqft: number;
      trend: { measure: string; first_half_median: number; second_half_median: number; change_pct: number } | null;
      asking_price_check?: {
        asking_price_aed: number;
        percentile_rank: number;
        position: 'below the typical range (under p25)' | 'within the typical range (p25-p75)' | 'above the typical range (over p75)';
        vs_median_pct: number;
      };
    }
  | { found: false; data_notice: string; reason: string; known_communities?: string[]; available_beds?: number[] }
  | ScopeDenial;

export function getAreaStats(q: AreaStatsQuery): AreaStatsResult {
  const denied = checkScope('get_area_stats', 'market_stats:read');
  if (denied) return denied;

  const community = resolveCommunity(q.community);
  if (!community) {
    return { found: false, data_notice: DATA_NOTICE, reason: `No transaction data for "${q.community}".`, known_communities: COMMUNITIES };
  }
  const months = Math.min(Math.max(q.months ?? 12, 1), 18);
  const since = new Date(AS_OF);
  since.setUTCMonth(since.getUTCMonth() - months);
  const sinceIso = since.toISOString().slice(0, 10);

  const inArea = TRANSACTIONS.filter((t) => t.community === community && t.purpose === q.purpose && t.date >= sinceIso);
  const rows = inArea.filter(
    (t) => (q.beds == null || t.beds === q.beds) && (!q.property_type || t.property_type === q.property_type),
  );

  if (rows.length < MIN_SAMPLE) {
    return {
      found: false,
      data_notice: DATA_NOTICE,
      reason: `Only ${rows.length} matching ${q.purpose} transactions in ${community} over the last ${months} months; not enough to compute reliable statistics (minimum ${MIN_SAMPLE}).`,
      available_beds: Array.from(new Set(inArea.map((t) => t.beds))).sort(),
    };
  }

  const prices = rows.map((r) => r.price_aed).sort((a, b) => a - b);
  const psf = rows.map((r) => r.price_per_sqft).sort((a, b) => a - b);
  const sizes = rows.map((r) => r.size_sqft).sort((a, b) => a - b);

  // Simple trend: median of the older half of the window vs the newer half.
  const byDate = [...rows].sort((a, b) => (a.date < b.date ? -1 : 1));
  const half = Math.floor(byDate.length / 2);
  let trend = null;
  if (half >= 3) {
    const older = byDate.slice(0, half).map((r) => r.price_per_sqft).sort((a, b) => a - b);
    const newer = byDate.slice(half).map((r) => r.price_per_sqft).sort((a, b) => a - b);
    const o = quantile(older, 0.5);
    const n = quantile(newer, 0.5);
    trend = { measure: 'median price per sqft, older half vs newer half of the transactions in the window', first_half_median: o, second_half_median: n, change_pct: Math.round(((n - o) / o) * 1000) / 10 };
  }

  const median = quantile(prices, 0.5);
  const p25 = quantile(prices, 0.25);
  const p75 = quantile(prices, 0.75);

  let asking: Extract<AreaStatsResult, { found: true }>['asking_price_check'];
  if (q.asking_price_aed != null) {
    const below = prices.filter((p) => p <= q.asking_price_aed!).length;
    asking = {
      asking_price_aed: q.asking_price_aed,
      percentile_rank: Math.round((below / prices.length) * 100),
      position:
        q.asking_price_aed < p25
          ? 'below the typical range (under p25)'
          : q.asking_price_aed > p75
            ? 'above the typical range (over p75)'
            : 'within the typical range (p25-p75)',
      vs_median_pct: Math.round(((q.asking_price_aed - median) / median) * 1000) / 10,
    };
  }

  return {
    found: true,
    data_notice: DATA_NOTICE,
    source: 'Mock transactions dataset shaped like Dubai Land Department open data (synthetic).',
    query: {
      community,
      purpose: q.purpose,
      beds: q.beds ?? 'any',
      property_type: q.property_type ?? 'any',
      window: `${sinceIso} to ${AS_OF.toISOString().slice(0, 10)} (${months} months)`,
    },
    sample_size: rows.length,
    low_sample_warning: rows.length < 15,
    price_aed: { median, p25, p75, min: prices[0]!, max: prices[prices.length - 1]!, period: q.purpose === 'sale' ? 'total' : 'per_year' },
    price_per_sqft_aed: { median: quantile(psf, 0.5), p25: quantile(psf, 0.25), p75: quantile(psf, 0.75) },
    median_size_sqft: quantile(sizes, 0.5),
    trend,
    ...(asking ? { asking_price_check: asking } : {}),
  };
}
