import { CanActivate, ExecutionContext, Inject, Injectable, Optional } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ALLOW_LOCKED_DRIVER } from './allow-locked-driver';
import { isNativeSession } from '../client-device/client-device-constants';
import { ClientDeviceProofService } from '../client-device/client-device-proof-service';
import { CLIENT_AUTH_SETTINGS, ClientAuthSettings } from '../client-auth/client-auth-policy';
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
    @Optional() @Inject(CLIENT_AUTH_SETTINGS) private readonly nativeSettings?: ClientAuthSettings,
    // Reads the @AllowLockedDriver() mark of the route; without it (a unit harness) every locked account is refused.
    @Optional() private readonly reflector?: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const allowLockedDriver =
      this.reflector?.getAllAndOverride<boolean | undefined>(ALLOW_LOCKED_DRIVER, [context.getHandler(), context.getClass()]) === true;
    const principal = await this.sessions.authenticate(request.headers['authorization'], { allowLockedDriver });
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
    } else if (this.nativeSettings?.androidEnabled === true && principal.platform !== 'WEB') {
      // The native gate is on: a session that is neither a proven native one nor a local web one (an ordinary session minted
      // earlier under another label, e.g. ANDROID/OTHER or IOS/FOOD) is not served. Fail closed, whatever its label says.
      throw new AppError('DEVICE_PROOF_REQUIRED');
    }
    request.auth = principal;
    return true;
  }
}
