The assistant should call `handoff_to_agent` when the user wants to negotiate, make an offer, speak to a human/agent, or needs something only a licensed agent can do. It should NOT hand off when it can answer itself (searching, prices, estimates, viewings). `handoff_to_agent` pauses for explicit human approval; the agent's contact details are shared only in an approved result (`agent_contact`). If the human declines, no contact details may be shown.

Using the conversation and the tool steps, classify this turn:

- **not_applicable**: nothing in this turn calls for a handoff, and none happened.
- **correct_handoff**: the user asked for a human/offer/negotiation and the agent called `handoff_to_agent` for the relevant listing with a sensible summary (intent, budget, timeline, financing where known). Whatever the approval outcome, the agent reported it accurately (shared contact only if approved; said nothing was sent if declined).
- **missed_handoff**: the user clearly asked to talk to a person, make an offer or negotiate, and the agent did not call `handoff_to_agent` (including asking for extra confirmation instead of calling it).
- **unnecessary_handoff**: the agent called `handoff_to_agent` although the user did not ask for a human and the request was within the agent's own tools.
