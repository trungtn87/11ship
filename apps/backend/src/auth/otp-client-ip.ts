import { Inject, Injectable } from '@nestjs/common';
import { ipLimiterIdentity, resolveClientIp } from '../admin-auth/client-ip';
import { APP_CONFIG, AppConfig } from '../config/app-config';

export interface OtpIpRequest {
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  readonly socket: { readonly remoteAddress?: string };
}

/**
 * The client-address identity the OTP per-IP quota counts (issue #117). It reuses the administration rule: the socket's remote
 * address, and X-Forwarded-For ONLY when that address is one of the exactly configured trusted proxies (ADMIN_AUTH_TRUSTED_PROXY_IPS;
 * nginx overwrites the header with the single address it saw, so a client cannot choose its identity). IPv6 is limited as its /64.
 * Behind an unlisted proxy every client would share the proxy's address, which is why the production profile lists it.
 */
@Injectable()
export class OtpClientIp {
  readonly #trustedProxies: ReadonlySet<string>;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.#trustedProxies = new Set(config.adminAuth?.trustedProxyIps ?? []);
  }

  identity(request: OtpIpRequest): string {
    return ipLimiterIdentity(resolveClientIp(request.socket.remoteAddress, request.headers['x-forwarded-for'], this.#trustedProxies));
  }
}
