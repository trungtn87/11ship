import { Injectable } from '@nestjs/common';
import { AppError } from '../common/app-errors';
import { TransactionContext } from '../transaction/transaction-context';
import { DriverStatus } from './driver-types';

/** What a caller learns about a driver that passed the active guard. */
export interface ActiveDriver {
  readonly driverId: string;
}

/**
 * The server-side guard of operations only an ACTIVE driver may perform (M01-A2D, task section 10.3). Selecting
 * the DRIVER role is weaker on purpose (PENDING, SUSPENDED and CLOSING drivers can enter the app and read their
 * status); anything that acts as a working driver goes through `requireDriverActive`.
 *
 * It decides from the DATABASE, at call time: the Driver row and its status are read through the caller's
 * TransactionContext, never taken from a token, a session or a request. Nothing about the role or the session
 * is trusted here.
 *
 * What it takes: no lock. It is a read. A caller that needs the answer to hold until its own commit must hold
 * the Driver row (or the user row) under its own lock protocol; the guard does not take a shared lock that a
 * later lifecycle writer's exclusive lock would have to wait behind, or deadlock against when upgrading.
 *
 * Outcomes:
 * - ACTIVE                                  -> resolves with the driver id.
 * - PENDING                                 -> DRIVER_PENDING_APPROVAL (the contracted answer).
 * - SUSPENDED, CLOSING, CLOSED, no profile  -> ROLE_NOT_AVAILABLE. The A2 error contract names no code for these
 *   states. The guard fails CLOSED with the existing registry code rather than invent one, and no HTTP endpoint
 *   of A2D calls the guard, so no client sees this answer yet. Owner decision pending before a later slice wires
 *   the guard to an endpoint.
 */
@Injectable()
export class DriverActiveGuard {
  async requireDriverActive(context: TransactionContext, userId: string): Promise<ActiveDriver> {
    const result = await context.query<{ driver_id: string; status: DriverStatus }>(
      `SELECT driver_id, status
         FROM app.drivers
        WHERE user_id = $1::uuid`,
      [userId],
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new AppError('ROLE_NOT_AVAILABLE');
    }
    switch (row.status) {
      case 'ACTIVE':
        return { driverId: row.driver_id };
      case 'PENDING':
        throw new AppError('DRIVER_PENDING_APPROVAL');
      case 'SUSPENDED':
      case 'CLOSING':
      case 'CLOSED':
        throw new AppError('ROLE_NOT_AVAILABLE');
    }
  }
}
