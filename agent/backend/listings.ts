import { checkScope, type ScopeDenial } from './policy';
import { COMMUNITIES, DATA_NOTICE, LISTINGS, resolveCommunity, type Listing, type PropertyType, type Purpose } from './data';

export interface ListingFilters {
  purpose?: Purpose;
  communities?: string[];
  city?: string;
  min_price_aed?: number;
  max_price_aed?: number;
  min_beds?: number;
  max_beds?: number;
  property_types?: PropertyType[];
  furnished?: 'furnished' | 'unfurnished' | 'partly-furnished';
  pets_allowed?: boolean;
  verified_only?: boolean;
  amenities?: string[];
  sort?: 'price_asc' | 'price_desc' | 'size_desc' | 'newest';
  limit?: number;
}

function matches(l: Listing, f: ListingFilters, canonicalCommunities: string[] | undefined): boolean {
  if (f.purpose && l.purpose !== f.purpose) return false;
  if (canonicalCommunities && !canonicalCommunities.includes(l.community)) return false;
  if (f.city && l.city.toLowerCase() !== f.city.toLowerCase()) return false;
  if (f.min_price_aed != null && l.price_aed < f.min_price_aed) return false;
  if (f.max_price_aed != null && l.price_aed > f.max_price_aed) return false;
  if (f.min_beds != null && l.beds < f.min_beds) return false;
  if (f.max_beds != null && l.beds > f.max_beds) return false;
  if (f.property_types?.length && !f.property_types.includes(l.type)) return false;
  if (f.furnished && l.furnished !== f.furnished) return false;
  if (f.pets_allowed && !l.pets_allowed) return false;
  if (f.verified_only && !l.verified) return false;
  if (f.amenities?.length) {
    const have = l.amenities.map((a) => a.toLowerCase());
    if (!f.amenities.every((a) => have.some((h) => h.includes(a.toLowerCase())))) return false;
  }
  return true;
}

function publicView(l: Listing) {
  // Broker contact details are deliberately NOT part of a listing result.
  const { agent_id: _agentId, ...rest } = l;
  return rest;
}

export type SearchResult =
  | {
      data_notice: string;
      total_matches: number;
      returned: number;
      listings: ReturnType<typeof publicView>[];
      unknown_communities: string[];
      /** When there are no matches: which single relaxation would produce results, and how many. */
      relaxation_suggestions: { relax: string; would_match: number; cheapest_price_aed: number }[];
      known_communities?: string[];
    }
  | ScopeDenial;

export function searchListings(f: ListingFilters): SearchResult {
  const denied = checkScope('search_listings', 'listings:read');
  if (denied) return denied;

  const unknown: string[] = [];
  let canonical: string[] | undefined;
  if (f.communities?.length) {
    canonical = [];
    for (const c of f.communities) {
      const r = resolveCommunity(c);
      if (r) canonical.push(r);
      else unknown.push(c);
    }
    // Every requested community is unknown: return nothing rather than ignore the filter.
    if (canonical.length === 0) canonical = ['__none__'];
  }

  let hits = LISTINGS.filter((l) => matches(l, f, canonical));
  const sort = f.sort ?? 'price_asc';
  hits = [...hits].sort((a, b) => {
    if (sort === 'price_desc') return b.price_aed - a.price_aed;
    if (sort === 'size_desc') return b.size_sqft - a.size_sqft;
    if (sort === 'newest') return a.available_from < b.available_from ? -1 : 1;
    return a.price_aed - b.price_aed;
  });
  const limit = Math.min(Math.max(f.limit ?? 5, 1), 10);

  const suggestions: { relax: string; would_match: number; cheapest_price_aed: number }[] = [];
  if (hits.length === 0) {
    const relaxations: [string, Partial<ListingFilters>][] = [
      ['remove the community filter', { communities: undefined }],
      ['raise max price by 20%', f.max_price_aed != null ? { max_price_aed: Math.round(f.max_price_aed * 1.2) } : {}],
      ['remove the max price', { max_price_aed: undefined }],
      ['accept one bedroom fewer', f.min_beds != null ? { min_beds: Math.max(0, f.min_beds - 1) } : {}],
      ['any property type', { property_types: undefined }],
      ['any furnishing', { furnished: undefined }],
      ['drop the amenity requirements', { amenities: undefined }],
      ['include unverified listings', { verified_only: undefined }],
      ['drop the pets requirement', { pets_allowed: undefined }],
    ];
    for (const [label, patch] of relaxations) {
      if (Object.keys(patch).length === 0) continue;
      const relaxed: ListingFilters = { ...f, ...patch };
      const relaxedCanonical = relaxed.communities ? canonical : undefined;
      const relaxedHits = LISTINGS.filter((l) => matches(l, relaxed, relaxedCanonical));
      if (relaxedHits.length > 0) {
        suggestions.push({ relax: label, would_match: relaxedHits.length, cheapest_price_aed: Math.min(...relaxedHits.map((l) => l.price_aed)) });
      }
    }
  }

  return {
    data_notice: DATA_NOTICE,
    total_matches: hits.length,
    returned: Math.min(limit, hits.length),
    listings: hits.slice(0, limit).map(publicView),
    unknown_communities: unknown,
    relaxation_suggestions: suggestions,
    ...(unknown.length ? { known_communities: COMMUNITIES } : {}),
  };
}
