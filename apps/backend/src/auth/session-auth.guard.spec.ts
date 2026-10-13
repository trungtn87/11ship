import { describe, expect, it } from '@jest/globals';
import { ExecutionContext } from '@nestjs/common';
import { ClientAuthSettings } from '../client-auth/client-auth-policy';
import { ClientDeviceProofService } from '../client-device/client-device-proof-service';
import { SessionAuthGuard } from './session-auth.guard';
import { SessionService } from './session-service';

const BASE = { userId: 'u', sessionId: 's', activeRole: null, phoneNormalized: '+84987654321' };

function run(platform: string, app: string, androidEnabled: boolean | undefined) {
  const proofs: string[] = [];
  const sessions = { authenticate: async () => ({ ...BASE, platform, app }) } as unknown as SessionService;
  const proof = {
    verifyBearerRequest: async () => {
      proofs.push('verified');
    },
  } as unknown as ClientDeviceProofService;
  const settings = androidEnabled === undefined ? undefined : ({ androidEnabled } as ClientAuthSettings);
  const guard = new SessionAuthGuard(sessions, proof, settings);
  const request = { headers: { authorization: `Bearer ${'A'.repeat(43)}` }, method: 'GET', originalUrl: '/x' };
  const context = { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;
  return { result: guard.canActivate(context), proofs };
}

describe('SessionAuthGuard with the native gate (F1: legacy sessions under another label)', () => {
  it('gate on: a session labelled ANDROID/OTHER or IOS/FOOD is not served and no proof is needed to decide', async () => {
    for (const [platform, app] of [['ANDROID', 'OTHER'], ['IOS', 'FOOD']]) {
      await expect(run(platform, app, true).result).rejects.toMatchObject({ code: 'DEVICE_PROOF_REQUIRED' });
    }
  });

  it('gate on: a local web session is still served; a native session still needs its proof', async () => {
    await expect(run('WEB', 'FOOD', true).result).resolves.toBe(true);
    const native = run('ANDROID', 'FOOD', true);
    await expect(native.result).resolves.toBe(true);
    expect(native.proofs).toEqual(['verified']);
  });

  it('gate off: unchanged (web local compatibility)', async () => {
    await expect(run('WEB', 'FOOD', false).result).resolves.toBe(true);
    await expect(run('IOS', 'FOOD', undefined).result).resolves.toBe(true);
  });
});
