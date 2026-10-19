import {
  AudienceRole,
  ComplaintCategory,
  ComplaintStatus,
  CLOSED_STATUSES,
  MessageVisibility,
  PartyRole,
  RECONSIDERATION_WINDOW_MS,
} from './feedback-constants';

// Pure rules of M11: who may rate whom, what a party may read and when a closed file may be looked at again. No I/O, no clock (the caller passes the
// server time), so each rule is proven by a unit test and the services only add the locks and the writes around them.

export interface AssignmentFact {
  readonly assignmentId: string;
  readonly driverId: string;
  readonly status: string;
}

export interface DeliveryFact {
  readonly state: string;
}

/**
 * The assignment that actually carried the delivery to its end: the one that ended COMPLETED or FAILED. A Shipper who gave the delivery back before
 * pickup has an assignment ended CANCELLED_BY_SHIPPER / RELEASED_BY_ADMIN / CANCELLED_BY_SHOP: such a run is never rated (a problem there is a complaint).
 */
export function executingAssignment(assignments: readonly AssignmentFact[]): AssignmentFact | undefined {
  return assignments.find((a) => a.status === 'COMPLETED' || a.status === 'FAILED');
}

/** The shop rates the Shipper once the delivery ended in a result of the run: delivered or failed. */
export function shopMayRateShipper(delivery: DeliveryFact, assignments: readonly AssignmentFact[]): AssignmentFact | undefined {
  if (delivery.state !== 'completed' && delivery.state !== 'failed') {
    return undefined;
  }
  return executingAssignment(assignments);
}

/** The customer rates the Shipper only when THIS delivery of their order succeeded. */
export function customerMayRateShipper(delivery: DeliveryFact, assignments: readonly AssignmentFact[]): AssignmentFact | undefined {
  if (delivery.state !== 'completed') {
    return undefined;
  }
  const executing = executingAssignment(assignments);
  return executing?.status === 'COMPLETED' ? executing : undefined;
}

export interface Summary {
  readonly average: number | null;
  readonly count: number;
  readonly distribution: { readonly '1': number; '2': number; '3': number; '4': number; '5': number };
}

/** Average to one decimal (half up). No rating means no average and no default star. */
export function summarize(counts: readonly [number, number, number, number, number]): Summary {
  const count = counts.reduce((a, b) => a + b, 0);
  const sum = counts.reduce((acc, n, i) => acc + n * (i + 1), 0);
  return {
    average: count === 0 ? null : Math.round((sum / count) * 10) / 10,
    count,
    distribution: { '1': counts[0], '2': counts[1], '3': counts[2], '4': counts[3], '5': counts[4] },
  };
}

/** True while a closed file may still be sent back for another look: strictly inside the window, measured from the closing instant. */
export function reconsiderationOpen(status: ComplaintStatus, closedAtMs: number | null, nowMs: number): boolean {
  return CLOSED_STATUSES.includes(status) && closedAtMs !== null && nowMs < closedAtMs + RECONSIDERATION_WINDOW_MS && nowMs >= closedAtMs;
}

export interface MessageFact {
  readonly visibility: MessageVisibility;
  readonly audienceRole: AudienceRole | null;
}

/** What the SUBMITTER may read of the thread. */
export function visibleToSubmitter(m: MessageFact): boolean {
  return m.visibility === 'SUBMITTER' || m.visibility === 'PARTIES';
}

/** What a RELATED PARTY (not the submitter) may read: what was shown to all parties, and what was addressed to its own role. */
export function visibleToParty(m: MessageFact, role: AudienceRole): boolean {
  return m.visibility === 'PARTIES' || (m.visibility === 'PARTY_ONLY' && m.audienceRole === role);
}

export function partyHasDisclosure(messages: readonly MessageFact[], role: AudienceRole): boolean {
  return messages.some((m) => visibleToParty(m, role));
}

/** Categories every party may open about an order or delivery of their own; the rating category is the Shipper's about a rating of them only. */
export function categoryAllowedFor(role: PartyRole, category: ComplaintCategory): boolean {
  return category === 'SHIPPER_REVIEW' ? role === 'SHIPPER' : true;
}

/**
 * A request for information goes to the submitter or to a related party of the file: the SHOP party exists on every file, the SHIPPER party only when
 * a Shipper is linked. Asking the party who is the submitter themself is the submitter's own request.
 */
export function awaitingTargetValid(from: 'SUBMITTER' | AudienceRole, submitterRole: PartyRole, hasDriver: boolean): boolean {
  if (from === 'SUBMITTER') {
    return true;
  }
  if (from === 'SHIPPER') {
    return hasDriver && submitterRole !== 'SHIPPER';
  }
  return submitterRole !== 'SHOP';
}

/** A result correction must say something different from what the delivery's result stored. */
export function correctionDiffers(originalState: string, corrected: 'DELIVERED' | 'NOT_DELIVERED'): boolean {
  return (originalState === 'completed' && corrected === 'NOT_DELIVERED') || (originalState === 'failed' && corrected === 'DELIVERED');
}
