/**
 * Least-privilege scope policy for the mock backend.
 *
 * The backend exposes more operations than the concierge is allowed to use
 * (a real CRM/mortgage stack would too). Every operation declares the scope it
 * needs; the concierge's credential carries only GRANTED_SCOPES. Anything else
 * is refused here, inside the backend, regardless of what the model asks for.
 *
 * This is app-level enforcement: Astropods access control governs who can see
 * and operate a deployment, not which backend calls an agent's tools may make.
 */

import { audit } from './db';

export type Scope =
  | 'listings:read'
  | 'market_stats:read'
  | 'calendar:read'
  | 'calendar:write'
  | 'leads:write'
  | 'profile:read'
  | 'profile:write'
  | 'brokers:contact:read'
  | 'mortgage:submit'
  | 'customer_pii:export';

/** What the concierge agent's credential is allowed to do. Nothing more. */
export const GRANTED_SCOPES: readonly Scope[] = [
  'listings:read',
  'market_stats:read',
  'calendar:read',
  'calendar:write',
  'leads:write',
  // Memory: the CURRENT user's own profile only. The user id comes from the
  // authenticated run context, never from model-supplied arguments.
  'profile:read',
  'profile:write',
  // Broker contact details are only released by handoff_to_agent, and only
  // after a human approves the handoff in the conversation.
  'brokers:contact:read',
];

export interface ScopeDenial {
  status: 'DENIED';
  code: 'SCOPE_DENIED';
  operation: string;
  required_scope: Scope;
  granted_scopes: readonly Scope[];
  message: string;
}

export function hasScope(scope: Scope): boolean {
  return GRANTED_SCOPES.includes(scope);
}

/**
 * Returns a denial object (and writes an audit row) when the scope is missing,
 * or null when the call may proceed.
 */
export function checkScope(operation: string, scope: Scope): ScopeDenial | null {
  if (hasScope(scope)) return null;
  const denial: ScopeDenial = {
    status: 'DENIED',
    code: 'SCOPE_DENIED',
    operation,
    required_scope: scope,
    granted_scopes: GRANTED_SCOPES,
    message: `The concierge agent is not authorised to call ${operation} (requires scope "${scope}"). This action needs a licensed human.`,
  };
  audit('scope_denied', { operation, required_scope: scope });
  console.warn(`[policy] SCOPE_DENIED operation=${operation} required=${scope}`);
  return denial;
}
