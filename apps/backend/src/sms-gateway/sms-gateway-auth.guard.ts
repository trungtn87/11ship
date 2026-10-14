import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { digestToken, parseCanonicalToken } from '../auth/tokens';
import { AppError } from '../common/app-errors';
import { TransactionManager } from '../transaction/transaction-manager';
import { SmsGatewayRepository } from './sms-gateway-repository';

export interface GatewayRequest {
  headers: Record<string, string | string[] | undefined>;
  gatewayDeviceId?: string;
}

/**
 * Authenticates a paired SMS gateway device (issue #102). The only credential is the 256-bit device token issued once by the
 * operator pairing tool; user sessions and admin credentials are different things and are never accepted here. A missing,
 * malformed, unknown or revoked token is the same 401.
 */
@Injectable()
export class SmsGatewayAuthGuard implements CanActivate {
  constructor(
    private readonly transactions: TransactionManager,
    private readonly repository: SmsGatewayRepository,
  ) {}

  async canActivate(executionContext: ExecutionContext): Promise<boolean> {
    const request = executionContext.switchToHttp().getRequest<GatewayRequest>();
    const header = request.headers.authorization;
    const value = typeof header === 'string' ? header : undefined;
    const match = value === undefined ? null : /^Bearer ([A-Za-z0-9_-]{43})$/.exec(value);
    const token = match === null ? undefined : parseCanonicalToken(match[1]);
    if (token === undefined) {
      throw new AppError('GATEWAY_UNAUTHORIZED');
    }
    const digest = digestToken(token);
    const deviceId = await this.transactions.withTransaction((context) => this.repository.findActiveDeviceByDigest(context, digest));
    if (deviceId === undefined) {
      throw new AppError('GATEWAY_UNAUTHORIZED');
    }
    request.gatewayDeviceId = deviceId;
    return true;
  }
}
