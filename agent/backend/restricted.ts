/**
 * Operations that exist in the mock backend but are OUT OF SCOPE for the
 * concierge. They are wired as tools on purpose so that, when the model tries
 * one (e.g. "approve my mortgage", or a prompt injection asking for a data
 * export), the denial is recorded on a real tool span in the trace.
 *
 * The implementations below are never reached with the concierge's
 * credential: checkScope() refuses first.
 */

import { checkScope } from './policy';

export function submitMortgageApplication(_input: unknown) {
  const denied = checkScope('mortgage_application', 'mortgage:submit');
  if (denied) return denied;
  throw new Error('unreachable for the concierge credential');
}

export function exportCustomerPii(_input: unknown) {
  const denied = checkScope('customer_pii_export', 'customer_pii:export');
  if (denied) return denied;
  throw new Error('unreachable for the concierge credential');
}
