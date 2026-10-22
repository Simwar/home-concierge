/**
 * Mastra tools. Each is a thin, Zod-typed wrapper over the mock backend in
 * ./backend — the backend owns data access and scope enforcement.
 */

import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { searchListings } from './backend/listings';
import { getAreaStats } from './backend/stats';
import { estimateMortgage } from './backend/mortgage';
import { bookViewing, getViewingSlots } from './backend/calendar';
import { commitLead, prepareLead } from './backend/leads';
import { exportCustomerPii, submitMortgageApplication } from './backend/restricted';
import { forgetUser, recallProfile, saveProfile } from './backend/profiles';

const purpose = z.enum(['rent', 'sale']);
const propertyType = z.enum(['Apartment', 'Villa', 'Townhouse', 'Penthouse']);

type Observe = { log?: (level: 'info' | 'warn' | 'error', message: string, data?: Record<string, unknown>) => void };

/**
 * The current user, from the run context (the Mastra memory resource), set by
 * the messaging adapter or the branded UI's authenticated session. Never from
 * model-supplied arguments, so the model cannot address another user's memory.
 */
function currentUserId(ctx: unknown): string | null {
  const id = (ctx as { agent?: { resourceId?: string } })?.agent?.resourceId;
  // `ast project start` has no sign-in, so the built-in chat reports "anonymous".
  // Without a deploy token (local dev only) treat that as one local user.
  if (id === 'anonymous' && !process.env.ASTRO_AUTHZ_TOKEN) return 'local-dev-user';
  if (!id || id === 'anonymous' || id.startsWith('anon:')) return null;
  return id;
}

/** Record scope denials as a structured event on the tool's own span. */
function traceDenial<T>(result: T, ctx: unknown): T {
  const r = result as { code?: string; operation?: string; required_scope?: string };
  if (r?.code === 'SCOPE_DENIED') {
    (ctx as { observe?: Observe })?.observe?.log?.('warn', 'SCOPE_DENIED', { operation: r.operation, required_scope: r.required_scope });
  }
  return result;
}

export const searchListingsTool = createTool({
  id: 'search_listings',
  description:
    'Search the (synthetic) listings inventory. Returns matching listings with id, title, community, type, beds, baths, size, price (AED; per_year for rentals), furnishing, amenities, verified flag and permit number, plus total_matches. When nothing matches, relaxation_suggestions says which single filter change would return results. This is the ONLY source of listings.',
  inputSchema: z.object({
    purpose: purpose.optional().describe('rent or sale. Use "sale" for buy and invest intents.'),
    communities: z.array(z.string()).optional().describe('Community names, e.g. ["Dubai Marina", "JVC"]. Common abbreviations work.'),
    city: z.enum(['Dubai', 'Abu Dhabi', 'Sharjah']).optional(),
    min_price_aed: z.number().optional().describe('For rentals this is annual rent.'),
    max_price_aed: z.number().optional().describe('For rentals this is annual rent.'),
    min_beds: z.number().int().min(0).optional().describe('0 = studio.'),
    max_beds: z.number().int().min(0).optional(),
    property_types: z.array(propertyType).optional(),
    furnished: z.enum(['furnished', 'unfurnished', 'partly-furnished']).optional(),
    pets_allowed: z.boolean().optional().describe('true to require pet-friendly homes.'),
    verified_only: z.boolean().optional(),
    amenities: z.array(z.string()).optional().describe('Required amenities, e.g. ["Pool", "Maid room"].'),
    sort: z.enum(['price_asc', 'price_desc', 'size_desc', 'newest']).optional(),
    limit: z.number().int().min(1).max(10).optional().describe('Default 5.'),
  }),
  execute: async (input, ctx) => traceDenial(searchListings(input), ctx),
});

export const getAreaStatsTool = createTool({
  id: 'get_area_stats',
  description:
    'Market statistics from the (synthetic) DLD-style transactions dataset for one community: sample size, median / p25 / p75 / min / max price, price per sqft, and a simple trend. Pass asking_price_aed to see where a price sits in the distribution. Use this before making ANY claim about typical prices, fairness, or trends.',
  inputSchema: z.object({
    community: z.string().describe('e.g. "Dubai Marina", "Downtown", "JVC".'),
    purpose: purpose.describe('"sale" for purchase prices, "rent" for annual rents.'),
    beds: z.number().int().min(0).optional().describe('0 = studio. Omit for all sizes.'),
    property_type: propertyType.optional(),
    months: z.number().int().min(1).max(18).optional().describe('Look-back window, default 12.'),
    asking_price_aed: z.number().optional().describe('A price to position against the data (fair-price checks).'),
  }),
  execute: async (input, ctx) => traceDenial(getAreaStats(input), ctx),
});

export const estimateMortgageTool = createTool({
  id: 'estimate_mortgage',
  description:
    'Illustrative mortgage estimate (monthly payment, down payment, upfront costs, cash needed) with labelled UAE assumptions, plus an optional rent-vs-buy comparison when comparable_annual_rent_aed is given. Arithmetic only: not an approval, offer or advice.',
  inputSchema: z.object({
    price_aed: z.number().positive(),
    down_payment_pct: z.number().min(0).max(100).optional().describe('Defaults to the typical minimum (20% for expats under AED 5M).'),
    years: z.number().int().min(1).max(30).optional().describe('Loan term, default 25 (UAE max).'),
    annual_rate_pct: z.number().min(0).max(20).optional().describe('Default 4.5 (illustrative).'),
    buyer_status: z.enum(['expat', 'uae_national']).optional(),
    comparable_annual_rent_aed: z.number().positive().optional().describe('Annual rent of a comparable home, e.g. median from get_area_stats(purpose="rent").'),
    size_sqft: z.number().positive().optional().describe('Used to estimate service charges.'),
    horizon_years: z.number().int().min(1).max(25).optional().describe('Rent-vs-buy horizon, default 5.'),
  }),
  execute: async (input) => estimateMortgage(input),
});

export const getViewingSlotsTool = createTool({
  id: 'get_viewing_slots',
  description: 'List open viewing slots (Dubai time) for a listing from the mock broker calendar. Call before book_viewing.',
  inputSchema: z.object({
    listing_id: z.string().describe('A listing id returned by search_listings, e.g. "PFD-1004".'),
    max_slots: z.number().int().min(1).max(20).optional(),
  }),
  execute: async ({ listing_id, max_slots }, ctx) => traceDenial(getViewingSlots(listing_id, max_slots), ctx),
});

export const bookViewingTool = createTool({
  id: 'book_viewing',
  description: 'Book a viewing in the mock broker calendar. The slot must be one returned by get_viewing_slots. Only book after the user has chosen a slot.',
  inputSchema: z.object({
    listing_id: z.string(),
    slot: z.string().describe('Exact slot string from get_viewing_slots, e.g. "2026-10-24T15:00+04:00".'),
    attendee_first_name: z.string().max(40).optional().describe('Optional first name only. Do not ask for phone, email or ID.'),
  }),
  execute: async ({ listing_id, slot, attendee_first_name }, ctx) => traceDenial(bookViewing(listing_id, slot, attendee_first_name, currentUserId(ctx)), ctx),
});

export const handoffToAgentTool = createTool({
  id: 'handoff_to_agent',
  description:
    'Hand the user over to the human property agent for a listing. Builds a structured lead (needs, budget, shortlist, readiness score). PAUSES for explicit human approval before the lead is sent and before the agent\'s contact details are shared. Use when the user wants to negotiate, make an offer, talk to a person, or asks for things outside your scope that a licensed agent handles.',
  inputSchema: z.object({
    listing_id: z.string().describe('The listing the user is most interested in.'),
    summary: z.object({
      intent: z.enum(['rent', 'buy', 'invest']),
      budget_aed: z.number().optional(),
      beds: z.number().int().min(0).optional(),
      communities: z.array(z.string()).optional(),
      timeline: z.string().optional().describe('e.g. "within 1 month".'),
      financing: z.enum(['cash', 'mortgage', 'undecided', 'not_applicable']).optional(),
      household: z.string().optional().describe('e.g. "couple, one cat".'),
      notes: z.string().max(500).optional().describe('Anything the human agent should know. No phone numbers, emails or IDs.'),
    }),
    shortlisted_listing_ids: z.array(z.string()).default([]),
  }),
  suspendSchema: z.object({ message: z.string() }),
  resumeSchema: z.object({
    approve: z.boolean().describe('Set true to send the lead and share the agent\'s contact details. False cancels.'),
  }),
  execute: async (input, ctx) => {
    const prepared = prepareLead(input.listing_id, input.summary, input.shortlisted_listing_ids);
    if ('code' in prepared || !prepared.ok) return traceDenial(prepared, ctx);
    const { draft } = prepared;

    const resumeData = ctx?.agent?.resumeData as { approve?: boolean } | undefined;
    if (resumeData?.approve === true) {
      return traceDenial(commitLead(draft, currentUserId(ctx)), ctx);
    }
    if (resumeData) {
      return { ok: false, approved: false, message: 'Handoff declined. No lead was sent and no contact details were shared.' };
    }

    await ctx!.agent!.suspend({
      message:
        `Approve handoff to ${draft.agent_name} (${draft.agency}) for "${draft.listing_title}" [${draft.listing_id}]? ` +
        `This sends your requirements (readiness score ${draft.readiness_score}/100) to the agent and shows you their contact details. ` +
        '(Demo: fictional agent, no one is actually contacted.)',
    });
    return { ok: false, pending_approval: true, message: 'Waiting for human approval. Contact details are not shared yet.' };
  },
});

// ---------------------------------------------------------------- memory

export const recallUserProfileTool = createTool({
  id: 'recall_user_profile',
  description:
    "Recall what you remember about the CURRENT user from earlier conversations: saved search preferences, shortlist, upcoming viewings and handoffs. Takes no arguments; the user is identified by the session. Call once at the start of each conversation, and when the user asks what you remember.",
  // Tools with no parameters get empty argument strings through the gateway, so
  // each memory tool takes one required, meaningful argument.
  inputSchema: z.object({
    reason: z.enum(['conversation_start', 'user_asked']).describe('"conversation_start" on the first message of a conversation, "user_asked" when the user asks what you remember.'),
  }),
  execute: async ({ reason }, ctx) => traceDenial(await recallProfile(currentUserId(ctx), { countConversation: reason === 'conversation_start' }), ctx),
});

export const saveUserPreferencesTool = createTool({
  id: 'save_user_preferences',
  description:
    "Remember the CURRENT user's home-search preferences for future conversations. Send only fields the user stated or changed; omitted fields are kept. Never send phone numbers, emails, ID numbers or income details.",
  inputSchema: z.object({
    first_name: z.string().max(40).optional().describe('Only if the user offered it.'),
    intent: z.enum(['rent', 'buy', 'invest']).optional(),
    budget_aed: z.number().positive().optional().describe('Annual rent for renters, purchase price for buyers.'),
    beds: z.number().int().min(0).optional(),
    communities: z.array(z.string()).optional().describe('Replaces the saved list.'),
    property_types: z.array(z.string()).optional(),
    timeline: z.string().max(80).optional(),
    financing: z.enum(['cash', 'mortgage', 'undecided', 'not_applicable']).optional(),
    household: z.string().max(120).optional().describe('e.g. "couple with a toddler".'),
    pets: z.boolean().optional(),
    must_haves: z.array(z.string()).optional().describe('e.g. ["balcony", "near metro"]. Replaces the saved list.'),
    add_to_shortlist: z.array(z.string()).optional().describe('Listing ids the user liked.'),
    remove_from_shortlist: z.array(z.string()).optional(),
    notes: z.string().max(300).optional(),
  }),
  execute: async (input, ctx) => traceDenial(await saveProfile(currentUserId(ctx), input), ctx),
});

export const forgetMeTool = createTool({
  id: 'forget_me',
  description:
    'Delete everything remembered about the CURRENT user (saved preferences and shortlist) and unlink their bookings and handoffs. Only call when the user explicitly asks you to forget them or delete their data.',
  inputSchema: z.object({
    user_requested: z.literal(true).describe('true: the user asked to be forgotten / have their data deleted. Their request is the confirmation; do not ask again.'),
  }),
  execute: async (_input, ctx) => traceDenial(await forgetUser(currentUserId(ctx)), ctx),
});

// ---------------------------------------------------------------- denied by scope

export const mortgageApplicationTool = createTool({
  id: 'mortgage_application',
  description: 'Submit a mortgage application to a partner bank on the user\'s behalf.',
  inputSchema: z.object({
    applicant_name: z.string().optional(),
    loan_amount_aed: z.number().optional(),
    listing_id: z.string().optional(),
  }),
  execute: async (input, ctx) => traceDenial(submitMortgageApplication(input), ctx),
});

export const customerPiiExportTool = createTool({
  id: 'customer_pii_export',
  description: 'Export customer or agent contact records (names, phone numbers, emails) from the CRM.',
  inputSchema: z.object({
    scope: z.string().optional().describe('What to export, e.g. "all agents".'),
  }),
  execute: async (input, ctx) => traceDenial(exportCustomerPii(input), ctx),
});

export const tools = {
  search_listings: searchListingsTool,
  get_area_stats: getAreaStatsTool,
  estimate_mortgage: estimateMortgageTool,
  get_viewing_slots: getViewingSlotsTool,
  book_viewing: bookViewingTool,
  handoff_to_agent: handoffToAgentTool,
  recall_user_profile: recallUserProfileTool,
  save_user_preferences: saveUserPreferencesTool,
  forget_me: forgetMeTool,
  mortgage_application: mortgageApplicationTool,
  customer_pii_export: customerPiiExportTool,
};
