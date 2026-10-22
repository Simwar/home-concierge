/** Read-only synthetic datasets, loaded once at startup. */

import listingsFile from '../data/listings.json';
import transactionsFile from '../data/transactions.json';
import brokersFile from '../data/brokers.json';

export const DATA_NOTICE =
  'SYNTHETIC DEMO DATA: generated for this demo, not real listings, prices, transactions or people.';

export type Purpose = 'rent' | 'sale';
export type PropertyType = 'Apartment' | 'Villa' | 'Townhouse' | 'Penthouse';

export interface Listing {
  id: string;
  title: string;
  community: string;
  city: string;
  type: PropertyType;
  beds: number;
  baths: number;
  size_sqft: number;
  price_aed: number;
  price_period: 'total' | 'per_year';
  purpose: Purpose;
  furnished: 'furnished' | 'unfurnished' | 'partly-furnished';
  amenities: string[];
  pets_allowed: boolean;
  verified: boolean;
  agent_id: string;
  permit_number: string;
  available_from: string;
  image_url: string;
  synthetic: true;
}

export interface Transaction {
  transaction_id: string;
  date: string;
  city: string;
  community: string;
  property_type: PropertyType;
  beds: number;
  size_sqft: number;
  purpose: Purpose;
  price_aed: number;
  price_period: 'total' | 'per_year';
  price_per_sqft: number;
  registration_type: string;
  synthetic: true;
}

export interface Broker {
  agent_id: string;
  name: string;
  agency: string;
  phone: string;
  email: string;
  brn: string;
  languages: string[];
  synthetic: true;
}

export const LISTINGS = listingsFile.listings as Listing[];
export const TRANSACTIONS = transactionsFile.transactions as Transaction[];
export const BROKERS = brokersFile.brokers as Broker[];

export const COMMUNITIES = Array.from(new Set(LISTINGS.map((l) => l.community))).sort();

const ALIASES: Record<string, string> = {
  marina: 'Dubai Marina',
  'dubai marina': 'Dubai Marina',
  downtown: 'Downtown Dubai',
  'downtown dubai': 'Downtown Dubai',
  'dubai hills': 'Dubai Hills Estate',
  'dubai hills estate': 'Dubai Hills Estate',
  jvc: 'Jumeirah Village Circle',
  'jumeirah village circle': 'Jumeirah Village Circle',
  'business bay': 'Business Bay',
  palm: 'Palm Jumeirah',
  'the palm': 'Palm Jumeirah',
  'palm jumeirah': 'Palm Jumeirah',
  jlt: 'Jumeirah Lake Towers',
  'jumeirah lake towers': 'Jumeirah Lake Towers',
  'arabian ranches': 'Arabian Ranches',
  'creek harbour': 'Dubai Creek Harbour',
  'dubai creek harbour': 'Dubai Creek Harbour',
  'dubai creek': 'Dubai Creek Harbour',
  reem: 'Al Reem Island',
  'reem island': 'Al Reem Island',
  'al reem island': 'Al Reem Island',
  saadiyat: 'Saadiyat Island',
  'saadiyat island': 'Saadiyat Island',
  yas: 'Yas Island',
  'yas island': 'Yas Island',
  majaz: 'Al Majaz',
  'al majaz': 'Al Majaz',
  aljada: 'Aljada',
  // Arabic names users are likely to type.
  'دبي مارينا': 'Dubai Marina',
  'مرسى دبي': 'Dubai Marina',
  'وسط مدينة دبي': 'Downtown Dubai',
  'داون تاون': 'Downtown Dubai',
  'دبي هيلز': 'Dubai Hills Estate',
  'قرية جميرا الدائرية': 'Jumeirah Village Circle',
  'الخليج التجاري': 'Business Bay',
  'نخلة جميرا': 'Palm Jumeirah',
  'أبراج بحيرات جميرا': 'Jumeirah Lake Towers',
  'المرابع العربية': 'Arabian Ranches',
  'جزيرة الريم': 'Al Reem Island',
  'جزيرة السعديات': 'Saadiyat Island',
  'جزيرة ياس': 'Yas Island',
  'المجاز': 'Al Majaz',
  'الجادة': 'Aljada',
};

/** Map a user-typed community name to the canonical dataset name, or null. */
export function resolveCommunity(input: string): string | null {
  const key = input.trim().toLowerCase().replace(/\s+/g, ' ');
  if (ALIASES[key]) return ALIASES[key];
  const exact = COMMUNITIES.find((c) => c.toLowerCase() === key);
  if (exact) return exact;
  const partial = COMMUNITIES.filter((c) => c.toLowerCase().includes(key) || key.includes(c.toLowerCase()));
  return partial.length === 1 ? partial[0]! : null;
}

export function getListing(id: string): Listing | undefined {
  return LISTINGS.find((l) => l.id.toUpperCase() === id.trim().toUpperCase());
}

export function getBroker(agentId: string): Broker | undefined {
  return BROKERS.find((b) => b.agent_id === agentId);
}
