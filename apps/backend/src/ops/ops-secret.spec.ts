import { describe, expect, it } from '@jest/globals';
import { fixtureKeyring } from '../crypto/test-keys.fixture';

describe('M13 sealed operations secret (the Discord webhook)', () => {
  const v = fixtureKeyring().active();
  it('round-trips, is bound to its label and to the key id, and refuses a tampered envelope', () => {
    const sealed = v.sealOpsSecret('discord-webhook', Buffer.from('https://discord.com/api/webhooks/1/x'));
    expect(v.openOpsSecret('discord-webhook', sealed).toString()).toBe('https://discord.com/api/webhooks/1/x');
    expect(() => v.openOpsSecret('other-secret', sealed)).toThrow();
    const bad = { ...sealed, ciphertext: Buffer.from(sealed.ciphertext) };
    bad.ciphertext[0] = (bad.ciphertext[0] as number) ^ 1;
    expect(() => v.openOpsSecret('discord-webhook', bad)).toThrow();
    expect(sealed.ciphertext.toString('utf8')).not.toContain('discord');
  });
  it('cannot be opened with the SMS payload purpose (separate subkey)', () => {
    const sealed = v.sealOpsSecret('discord-webhook', Buffer.from('x'.repeat(20)));
    expect(() => v.openSmsPayload('discord-webhook', sealed)).toThrow();
  });
  it('rejects a bad label or an empty / oversize plaintext', () => {
    expect(() => v.sealOpsSecret('Bad Label', Buffer.from('x'))).toThrow();
    expect(() => v.sealOpsSecret('ok-label', Buffer.alloc(0))).toThrow();
    expect(() => v.sealOpsSecret('ok-label', Buffer.alloc(513))).toThrow();
  });
});
