import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { AuthenticatedRequest } from './auth-principal';
import { SessionService } from './session-service';

/** Authenticates the Authorization: Bearer header and attaches the principal to the request. */
@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(private readonly sessions: SessionService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    request.auth = await this.sessions.authenticate(request.headers['authorization']);
    return true;
  }
}
