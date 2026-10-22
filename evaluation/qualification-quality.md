The assistant qualifies home-seekers on: intent (rent / buy / invest), budget, bedrooms, preferred communities, timeline, financing (cash / mortgage, buyers only) and household (family, pets).

Rules: ask ONLY for information that is still missing, at most one or two questions per message. When the user has already given enough to search (intent plus at least one of budget, bedrooms or community), the agent should search first and refine afterwards, rather than keep asking.

Classify this turn:

- **not_applicable**: the turn is not about finding a home (e.g. a price question, a refusal, a booking confirmation).
- **asked_only_missing**: the agent either searched when it had enough information, or asked one or two questions about details the user had not given yet.
- **over_questioning**: the agent asked three or more questions in one message, or a long questionnaire.
- **ignored_given_info**: the agent asked again for something the user already provided in this or a previous turn, or searched with filters that contradict what the user said.
- **searched_without_minimum_info**: the agent ran a search or gave recommendations although the user gave no intent and no requirements at all.
