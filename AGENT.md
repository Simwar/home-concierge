---
description: "Home Concierge (demo): lead-to-viewing assistant for UAE home-seekers. Qualifies, finds listings, checks prices, books viewings. Synthetic data."
tags:
  - real-estate
  - property
  - lead-qualification
  - concierge
  - mastra
  - arabic
  - demo
authors:
  - name: Simon Guerrier
capabilities:
  - Qualifies home-seekers on intent, budget, bedrooms, communities, timeline and financing
  - Searches a synthetic listings inventory for Dubai, Abu Dhabi and Sharjah
  - Answers price questions from mock DLD-style transaction data, citing medians and sample sizes
  - Estimates mortgage payments and compares rent vs buy, with labelled assumptions
  - Books viewings in a mock broker calendar
  - Hands off to a human agent, sharing contact details only after human approval
  - Replies in Arabic when the user writes in Arabic
  - Remembers each user's search preferences across conversations (Postgres knowledge store)
integrations:
  - Astropods AI Gateway
  - PostgreSQL
---

# Home Concierge (demo)

A conversational concierge for people looking to rent or buy a home in the UAE. It takes a home-seeker from first message to a booked viewing, and hands off to a human property agent when that is the right next step.

> **All data is synthetic.** Listings, prices, transactions, brokers, phone numbers and permit numbers are generated for this demo. Not affiliated with, or using data from, any property portal.

## What it does

1. **Qualifies.** Asks only for what is missing (intent, budget, bedrooms, communities, timeline, financing, household), one or two questions at a time.
2. **Searches listings** with `search_listings` over 84 synthetic listings. When nothing matches it says so and suggests which filter to loosen.
3. **Answers price questions** with `get_area_stats` over about 2,300 mock transactions shaped like Dubai Land Department data: median, p25 to p75, price per sqft, trend, and where an asking price sits.
4. **Estimates affordability** with `estimate_mortgage`: monthly payment, down payment, upfront costs and rent vs buy. Every estimate states its assumptions.
5. **Books viewings** with `get_viewing_slots` and `book_viewing`.
6. **Remembers** each user across conversations with `recall_user_profile`, `save_user_preferences` and `forget_me`, backed by a Postgres knowledge store declared in `astropods.yml`.
7. **Hands off** with `handoff_to_agent`: a structured lead with a readiness score. The tool pauses for explicit human approval before the lead is sent or any contact details are shown.

## Guardrails

- **Grounded:** it only states listings, prices and statistics that a tool returned.
- **Least privilege:** the backend grants only listings and stats (read), plus calendar and lead writes. `mortgage_application` and `customer_pii_export` exist, but the backend rejects them with `SCOPE_DENIED`, and the denial is visible in the trace.
- **No legal, visa, tax or personalised financial advice.**
- **Human sign-off** before any agent contact details are shared.
- **Prompt-injection resistant**, and checked by the bundled evaluation set.

## Try

- "Looking to rent a 2BR in Dubai Marina, up to 160k a year"
- "Is AED 1.4M fair for a 1BR in Dubai Marina?"
- "What would the monthly payment be on 2.1M with 20% down, vs renting at 152k?"
- "أبحث عن شقة بغرفتي نوم للإيجار في قرية جميرا الدائرية"

## Limitations

- Demo data only. Real figures would come from a listings feed, DLD data and a CRM.
- Mortgage figures are simple estimates, not lender quotes.
- The viewing calendar and lead store are local mocks. Nobody is actually contacted.
