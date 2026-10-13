import { CanActivate, ExecutionContext, Injectable, Optional } from '@nestjs/common';
import { isNativeSession } from '../client-device/client-device-constants';
import { ClientDeviceProofService } from '../client-device/client-device-proof-service';
import { AppError } from '../common/app-errors';
import { AuthenticatedRequest } from './auth-principal';
import { SessionService, bearerTokenFrom } from './session-service';

/**
 * Authenticates the Authorization: Bearer header and attaches the principal to the request. A NATIVE session (ANDROID Food /
 * Ship) is additionally authenticated by the device proof of the request, signed by the key the session was issued to
 * (contract11 section 8): the token alone, stolen, opens nothing. The business transaction rechecks the binding under its locks.
 */
@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(
    private readonly sessions: SessionService,
    // Optional so that a module without the native device binding (a unit test) keeps the plain Bearer guard.
    @Optional() private readonly deviceProof?: ClientDeviceProofService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const principal = await this.sessions.authenticate(request.headers['authorization']);
    if (isNativeSession(principal.platform, principal.app)) {
      const token = bearerTokenFrom(request.headers['authorization']);
      if (this.deviceProof === undefined || token === undefined) {
        throw new AppError('SESSION_INVALID');
      }
      await this.deviceProof.verifyBearerRequest(
        {
          method: request.method ?? 'GET',
          url: request.originalUrl ?? '',
          rawBody: request.rawBody ?? Buffer.alloc(0),
          headers: request.headers,
        },
        token,
        { sessionId: principal.sessionId, platform: principal.platform, app: principal.app },
      );
    }
    request.auth = principal;
    return true;
  }
}
