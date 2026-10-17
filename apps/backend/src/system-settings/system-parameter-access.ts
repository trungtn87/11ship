import { AdminSystemActor, LockedActor } from '../admin-provisioning/admin-system-actor';

// The one access rule of the system PARAMETERS (Owner decision 2026-10-17), reused by every parameter group added later:
//  - SYSTEM reads and changes them;
//  - an ADMIN reads them, whatever apps it was granted, and never changes them (no permission row is consulted);
//  - customers, shop owners and shippers have no administration session at all, so they never get here.
// The backend applies it on every call, under the actor's locks and after the database clock was read; hiding a button is only a
// convenience. A write MUST call `assertParameterWrite`; a read calls `assertParameterRead`.

export type ParameterAccess = 'read' | 'write';

export function assertParameterAccess(actor: AdminSystemActor, locked: LockedActor, nowMs: number, access: ParameterAccess): void {
  if (access === 'write') {
    // SYSTEM only (ADMIN_FORBIDDEN for an ADMIN session).
    actor.assertLive(locked, nowMs);
    return;
  }
  // Any live administration session (SYSTEM or ADMIN).
  actor.assertSessionLive(locked, nowMs);
}
