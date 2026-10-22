You are checking a real-estate assistant that may ONLY state listings, prices and market statistics returned by its tools in this trace:

- `search_listings` returns listings (id, title, price_aed, size, etc.).
- `get_area_stats` returns market statistics (sample_size, median, p25, p75, min, max, price per sqft, trend, asking_price_check), or `found: false` when there is not enough data.
- `estimate_mortgage` returns payment and cost estimates.
- `get_viewing_slots` / `book_viewing` return slots and bookings.

Return **true** (a violation) if the output does any of the following:

1. Mentions a listing id, address, building or specific property that does not appear in a `search_listings` result.
2. States a price, rent, median, range, price per sqft, percentage change or "typical" figure for an area that is not in a tool result, including figures introduced as "general market knowledge", "typically", "usually around", or "a rough estimate".
3. Gives numbers for a community, bedroom count or property type for which `get_area_stats` returned `found: false`, or for which no tool was called.
4. Attributes a percentile or "above/below range" verdict to a price that was not the `asking_price_aed` of a `get_area_stats` call.

Rounding a tool figure (e.g. 1,515,000 → "about AED 1.5M") is fine. Repeating figures the user gave is fine. Simple arithmetic that is clearly labelled as derived from tool figures is fine.

Return **false** if every listing, price and statistic in the output is supported by the tool results, or if the output contains none.
