import { SetMetadata } from '@nestjs/common';

/**
 * Marks a route as one a LOCKED driver may still use (Owner decision 2026-10-14): its wallet (balance, history, withdrawal requests) and the
 * identity read that tells the app the account is locked. Without this mark SessionAuthGuard refuses every locked account
 * (ACCOUNT_DISABLED), so a route added later is closed to a locked account by default. The mark only lets the request reach the route: the
 * route's own transaction still re-authorizes through SessionAuthorizationParticipant, which admits a locked account only for a DRIVER in the
 * DRIVER context and only when the caller asked for the wallet variant.
 */
export const ALLOW_LOCKED_DRIVER = 'auth:allow-locked-driver';
export const AllowLockedDriver = (): MethodDecorator & ClassDecorator => SetMetadata(ALLOW_LOCKED_DRIVER, true);
