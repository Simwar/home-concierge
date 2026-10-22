/**
 * Generates the SYNTHETIC seed data used by the demo backend.
 *
 *   bun run data:generate
 *
 * Output (committed): agent/data/{listings,transactions,brokers}.json
 *
 * Nothing here is real. Listings, prices, transactions, brokers, phone numbers
 * and permit numbers are invented. Shapes are loosely modelled on what public
 * UAE property portals and Dubai Land Department (DLD) open data expose, so the
 * agent's tools look realistic, but every record carries `synthetic: true`.
 *
 * Deterministic: a fixed seed means re-running produces identical files.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SEED = 20261022;
const OUT_DIR = join(import.meta.dir, '..', 'agent', 'data');

// mulberry32: tiny seeded PRNG so output is reproducible.
function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = prng(SEED);
const between = (min: number, max: number) => min + rand() * (max - min);
const int = (min: number, max: number) => Math.floor(between(min, max + 1));
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!;
const roundTo = (n: number, step: number) => Math.round(n / step) * step;
// Gaussian-ish noise (sum of uniforms) for price dispersion.
const noise = (spread: number) => ((rand() + rand() + rand()) / 3 - 0.5) * 2 * spread;

type PropertyType = 'Apartment' | 'Villa' | 'Townhouse' | 'Penthouse';

interface Community {
  name: string;
  city: 'Dubai' | 'Abu Dhabi' | 'Sharjah';
  types: PropertyType[];
  /** Synthetic median sale price per sqft (AED). */
  salePsf: number;
  /** Synthetic gross rental yield used to derive annual rents. */
  yield: number;
  beds: number[];
  /** Relative weight in listings/transactions volume. */
  weight: number;
  amenities: string[];
}

const COMMUNITIES: Community[] = [
  { name: 'Dubai Marina', city: 'Dubai', types: ['Apartment', 'Penthouse'], salePsf: 1950, yield: 0.068, beds: [0, 1, 2, 3, 4], weight: 14, amenities: ['Marina view', 'Gym', 'Pool', 'Metro nearby', 'Concierge'] },
  { name: 'Downtown Dubai', city: 'Dubai', types: ['Apartment', 'Penthouse'], salePsf: 2650, yield: 0.06, beds: [0, 1, 2, 3], weight: 12, amenities: ['Burj Khalifa view', 'Gym', 'Pool', 'Mall access', 'Concierge'] },
  { name: 'Dubai Hills Estate', city: 'Dubai', types: ['Apartment', 'Villa', 'Townhouse'], salePsf: 2100, yield: 0.058, beds: [1, 2, 3, 4, 5], weight: 12, amenities: ['Park view', 'Golf course', 'Pool', 'Kids play area', 'Gym'] },
  { name: 'Jumeirah Village Circle', city: 'Dubai', types: ['Apartment', 'Townhouse'], salePsf: 1180, yield: 0.078, beds: [0, 1, 2, 3], weight: 14, amenities: ['Pool', 'Gym', 'Covered parking', 'Kids play area'] },
  { name: 'Business Bay', city: 'Dubai', types: ['Apartment'], salePsf: 2050, yield: 0.065, beds: [0, 1, 2, 3], weight: 10, amenities: ['Canal view', 'Gym', 'Pool', 'Metro nearby'] },
  { name: 'Palm Jumeirah', city: 'Dubai', types: ['Apartment', 'Villa', 'Penthouse'], salePsf: 3600, yield: 0.052, beds: [1, 2, 3, 4, 5], weight: 7, amenities: ['Beach access', 'Sea view', 'Pool', 'Gym', 'Concierge'] },
  { name: 'Jumeirah Lake Towers', city: 'Dubai', types: ['Apartment'], salePsf: 1420, yield: 0.072, beds: [0, 1, 2, 3], weight: 8, amenities: ['Lake view', 'Metro nearby', 'Gym', 'Pool'] },
  { name: 'Arabian Ranches', city: 'Dubai', types: ['Villa', 'Townhouse'], salePsf: 1550, yield: 0.055, beds: [2, 3, 4, 5], weight: 6, amenities: ['Private garden', 'Golf course', 'Community pool', 'Kids play area'] },
  { name: 'Dubai Creek Harbour', city: 'Dubai', types: ['Apartment'], salePsf: 2200, yield: 0.062, beds: [1, 2, 3], weight: 6, amenities: ['Creek view', 'Gym', 'Pool', 'Park view'] },
  { name: 'Al Reem Island', city: 'Abu Dhabi', types: ['Apartment'], salePsf: 1300, yield: 0.07, beds: [0, 1, 2, 3], weight: 5, amenities: ['Sea view', 'Gym', 'Pool', 'Mall access'] },
  { name: 'Saadiyat Island', city: 'Abu Dhabi', types: ['Apartment', 'Villa'], salePsf: 2350, yield: 0.055, beds: [1, 2, 3, 4, 5], weight: 3, amenities: ['Beach access', 'Pool', 'Gym', 'Cultural district nearby'] },
  { name: 'Yas Island', city: 'Abu Dhabi', types: ['Apartment', 'Townhouse'], salePsf: 1400, yield: 0.068, beds: [0, 1, 2, 3, 4], weight: 3, amenities: ['Pool', 'Gym', 'Theme parks nearby', 'Golf course'] },
  { name: 'Al Majaz', city: 'Sharjah', types: ['Apartment'], salePsf: 720, yield: 0.085, beds: [1, 2, 3], weight: 3, amenities: ['Lagoon view', 'Covered parking', 'Gym'] },
  { name: 'Aljada', city: 'Sharjah', types: ['Apartment', 'Townhouse'], salePsf: 1000, yield: 0.075, beds: [0, 1, 2, 3], weight: 3, amenities: ['Pool', 'Gym', 'Kids play area', 'Park view'] },
];

// Typical unit sizes (sqft) by type and bedrooms.
function typicalSize(type: PropertyType, beds: number): number {
  if (type === 'Villa') return [0, 0, 2200, 3000, 3900, 5200][beds] ?? 6000;
  if (type === 'Townhouse') return [0, 1100, 1500, 2000, 2600, 3200][beds] ?? 3500;
  if (type === 'Penthouse') return [0, 1500, 2200, 3200, 4500, 6000][beds] ?? 7000;
  return [420, 780, 1180, 1650, 2300, 3000][beds] ?? 3200;
}

// Premium multiplier per sqft for each type.
const TYPE_PREMIUM: Record<PropertyType, number> = { Apartment: 1, Townhouse: 0.92, Villa: 1.05, Penthouse: 1.35 };

function compatibleTypes(c: Community, beds: number): PropertyType[] {
  return c.types.filter((t) => {
    if (t === 'Villa') return beds >= 2;
    if (t === 'Townhouse') return beds >= 1 && beds <= 5;
    if (t === 'Penthouse') return beds >= 2;
    return beds <= 4;
  });
}

// Penthouses are rare in real inventory; keep them to a few percent so they
// don't distort medians.
function pickType(types: PropertyType[]): PropertyType {
  const common = types.filter((t) => t !== 'Penthouse');
  if (common.length > 0 && rand() > 0.06) return pick(common);
  return pick(types);
}

function weightedCommunity(): Community {
  const total = COMMUNITIES.reduce((s, c) => s + c.weight, 0);
  let r = rand() * total;
  for (const c of COMMUNITIES) {
    r -= c.weight;
    if (r <= 0) return c;
  }
  return COMMUNITIES[0]!;
}

// ---------------------------------------------------------------- brokers

const FIRST = ['Aisha', 'Omar', 'Priya', 'James', 'Fatima', 'Karim', 'Elena', 'Yousef', 'Sara', 'Daniel'];
const LAST = ['Demo-Haddad', 'Demo-Khan', 'Demo-Rahman', 'Demo-Smith', 'Demo-Nasser', 'Demo-Costa', 'Demo-Ali', 'Demo-Murphy'];
const AGENCIES = ['Example Realty (demo)', 'Sample Homes LLC (demo)', 'Placeholder Properties (demo)'];

const brokers = Array.from({ length: 10 }, (_, i) => {
  const first = FIRST[i]!;
  const last = LAST[i % LAST.length]!;
  return {
    agent_id: `AG-${String(101 + i)}`,
    name: `${first} ${last}`,
    agency: AGENCIES[i % AGENCIES.length]!,
    // 555 numbers and example.com addresses are reserved/fake by design.
    phone: `+971 50 555 ${String(1000 + i * 37).padStart(4, '0')}`,
    email: `${first.toLowerCase()}.${i}@example.com`,
    brn: `FAKE-BRN-${String(40000 + i * 113)}`,
    languages: i % 3 === 0 ? ['English', 'Arabic'] : i % 3 === 1 ? ['English', 'Hindi'] : ['English', 'Arabic', 'French'],
    synthetic: true,
  };
});

// ---------------------------------------------------------------- listings

const FURNISHING = ['furnished', 'unfurnished', 'partly-furnished'] as const;
const EXTRA_AMENITIES = ['Balcony', 'Maid room', 'Study', 'Built-in wardrobes', 'Central A/C', 'Shared spa', 'Security', 'Pets allowed'];

function listingTitle(type: PropertyType, beds: number, community: string, flavour: string): string {
  const bedLabel = beds === 0 ? 'Studio' : `${beds}BR`;
  return `${flavour} ${bedLabel} ${type} in ${community}`;
}
const FLAVOURS = ['Bright', 'Spacious', 'Upgraded', 'High-floor', 'Corner', 'Brand-new', 'Well-kept', 'Family-friendly', 'Vacant', 'Modern'];

const listings: unknown[] = [];
const TODAY = new Date('2026-10-22T00:00:00Z');
for (let i = 0; i < 76; i++) {
  const c = i < COMMUNITIES.length ? COMMUNITIES[i]! : weightedCommunity(); // every community appears at least once
  let beds = pick(c.beds);
  let types = compatibleTypes(c, beds);
  while (types.length === 0) {
    beds = pick(c.beds);
    types = compatibleTypes(c, beds);
  }
  const type = pickType(types);
  const purpose = rand() < 0.5 ? 'sale' : 'rent';
  const size = roundTo(typicalSize(type, beds) * (1 + noise(0.18)), 5);
  const psf = c.salePsf * TYPE_PREMIUM[type] * (1 + noise(0.2));
  const salePrice = roundTo(size * psf, 5000);
  const annualRent = roundTo(salePrice * c.yield * (1 + noise(0.12)), 1000);
  const amenities = Array.from(new Set([...c.amenities.filter(() => rand() < 0.6), ...EXTRA_AMENITIES.filter(() => rand() < 0.25)]));
  if (type !== 'Apartment' && !amenities.includes('Private garden') && rand() < 0.6) amenities.push('Private garden');
  const petsAllowed = amenities.includes('Pets allowed') || (type !== 'Apartment' && rand() < 0.5);
  if (petsAllowed && !amenities.includes('Pets allowed')) amenities.push('Pets allowed');
  const availableInDays = int(0, 75);
  const id = `PFD-${String(1001 + i)}`;
  listings.push({
    id,
    title: listingTitle(type, beds, c.name, pick(FLAVOURS)),
    community: c.name,
    city: c.city,
    type,
    beds,
    baths: Math.max(1, beds + (rand() < 0.6 ? 1 : 0)),
    size_sqft: size,
    price_aed: purpose === 'sale' ? salePrice : annualRent,
    price_period: purpose === 'sale' ? 'total' : 'per_year',
    purpose,
    furnished: pick(FURNISHING),
    amenities,
    pets_allowed: petsAllowed,
    verified: rand() < 0.7,
    agent_id: brokers[i % brokers.length]!.agent_id,
    permit_number: `FAKE-PERMIT-${String(7100000 + int(0, 899999))}`,
    available_from: new Date(TODAY.getTime() + availableInDays * 86400000).toISOString().slice(0, 10),
    image_url: `https://placehold.co/640x400/f3f4f6/c8102e?text=${encodeURIComponent(`${beds === 0 ? 'Studio' : beds + 'BR'} ${type} - demo`)}`,
    synthetic: true,
  });
}

// Fixed "demo anchor" listings so the scripted demo always has the same
// happy path (still synthetic). Appended after the random ones.
const ANCHORS: Array<[string, string, PropertyType, number, number, number, 'rent' | 'sale', string, string[], boolean]> = [
  // title, community, type, beds, size, price, purpose, furnished, amenities, pets
  ['Marina-view 2BR Apartment in Dubai Marina', 'Dubai Marina', 'Apartment', 2, 1210, 152000, 'rent', 'furnished', ['Marina view', 'Balcony', 'Gym', 'Pool', 'Metro nearby'], false],
  ['Pet-friendly 2BR Apartment in Dubai Marina', 'Dubai Marina', 'Apartment', 2, 1305, 158000, 'rent', 'unfurnished', ['Pool', 'Gym', 'Pets allowed', 'Covered parking'], true],
  ['High-floor 1BR Apartment in Dubai Marina', 'Dubai Marina', 'Apartment', 1, 790, 98000, 'rent', 'furnished', ['Marina view', 'Gym', 'Pool'], false],
  ['Upgraded 1BR Apartment in Dubai Marina', 'Dubai Marina', 'Apartment', 1, 805, 1400000, 'sale', 'unfurnished', ['Marina view', 'Balcony', 'Gym', 'Pool', 'Metro nearby'], false],
  ['Garden-facing 2BR Apartment in Jumeirah Village Circle', 'Jumeirah Village Circle', 'Apartment', 2, 1150, 105000, 'rent', 'unfurnished', ['Pool', 'Gym', 'Kids play area', 'Pets allowed'], true],
  ['Family 4BR Villa in Dubai Hills Estate', 'Dubai Hills Estate', 'Villa', 4, 3950, 6200000, 'sale', 'unfurnished', ['Private garden', 'Park view', 'Maid room', 'Pool', 'Kids play area', 'Pets allowed'], true],
  ['Burj-view 2BR Apartment in Downtown Dubai', 'Downtown Dubai', 'Apartment', 2, 1240, 4200000, 'sale', 'furnished', ['Burj Khalifa view', 'Gym', 'Pool', 'Concierge'], false],
  ['Corner 3BR Townhouse in Dubai Hills Estate', 'Dubai Hills Estate', 'Townhouse', 3, 2050, 240000, 'rent', 'unfurnished', ['Private garden', 'Community pool', 'Kids play area', 'Pets allowed'], true],
];
ANCHORS.forEach(([title, community, type, beds, size, price, purpose, furnished, amenities, pets], k) => {
  const c = COMMUNITIES.find((x) => x.name === community)!;
  listings.push({
    id: `PFD-${String(1001 + 76 + k)}`,
    title,
    community,
    city: c.city,
    type,
    beds,
    baths: beds + 1,
    size_sqft: size,
    price_aed: price,
    price_period: purpose === 'sale' ? 'total' : 'per_year',
    purpose,
    furnished,
    amenities,
    pets_allowed: pets,
    verified: true,
    agent_id: brokers[k % brokers.length]!.agent_id,
    permit_number: `FAKE-PERMIT-${String(7300000 + k * 7919)}`,
    available_from: new Date(TODAY.getTime() + (7 + k * 4) * 86400000).toISOString().slice(0, 10),
    image_url: `https://placehold.co/640x400/f3f4f6/c8102e?text=${encodeURIComponent(`${beds}BR ${type} - demo`)}`,
    synthetic: true,
  });
});

// ---------------------------------------------------------- transactions
// Shaped like DLD open data: one row per registered sale or rent contract.

const transactions: unknown[] = [];
let txSeq = 1;
for (const c of COMMUNITIES) {
  const volume = c.weight * 22;
  for (let k = 0; k < volume; k++) {
    let beds = pick(c.beds);
    let types = compatibleTypes(c, beds);
    while (types.length === 0) {
      beds = pick(c.beds);
      types = compatibleTypes(c, beds);
    }
    const type = pickType(types);
    const daysAgo = int(1, 540); // ~18 months of history
    const date = new Date(TODAY.getTime() - daysAgo * 86400000);
    // Mild synthetic appreciation: ~8%/yr, so older rows are cheaper.
    const timeFactor = 1 - (daysAgo / 365) * 0.08;
    const size = roundTo(typicalSize(type, beds) * (1 + noise(0.2)), 5);
    const psf = c.salePsf * TYPE_PREMIUM[type] * timeFactor * (1 + noise(0.22));
    const purpose = rand() < 0.55 ? 'sale' : 'rent';
    const price = purpose === 'sale' ? roundTo(size * psf, 1000) : roundTo(size * psf * c.yield * (1 + noise(0.1)), 500);
    transactions.push({
      transaction_id: `TX-DEMO-${String(txSeq++).padStart(6, '0')}`,
      date: date.toISOString().slice(0, 10),
      city: c.city,
      community: c.name,
      property_type: type,
      beds,
      size_sqft: size,
      purpose,
      price_aed: price,
      price_period: purpose === 'sale' ? 'total' : 'per_year',
      price_per_sqft: Math.round(price / size),
      registration_type: purpose === 'sale' ? (rand() < 0.35 ? 'off-plan' : 'ready') : 'ejari-contract',
      synthetic: true,
    });
  }
}
transactions.sort((a: any, b: any) => (a.date < b.date ? -1 : 1));

mkdirSync(OUT_DIR, { recursive: true });
const banner = 'SYNTHETIC DEMO DATA. Not real listings, prices, transactions or people. Do not use for decisions.';
writeFileSync(join(OUT_DIR, 'listings.json'), JSON.stringify({ _notice: banner, generated_with_seed: SEED, listings }, null, 1));
writeFileSync(join(OUT_DIR, 'transactions.json'), JSON.stringify({ _notice: banner, generated_with_seed: SEED, transactions }, null, 0));
writeFileSync(join(OUT_DIR, 'brokers.json'), JSON.stringify({ _notice: banner, generated_with_seed: SEED, brokers }, null, 1));
console.log(`listings=${listings.length} transactions=${transactions.length} brokers=${brokers.length} -> ${OUT_DIR}`);
