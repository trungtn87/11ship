import type { ConnectionState } from '../connection.js';
import type { HealthSnapshot } from '../health.js';
import type { SampleData } from '../screen.js';

// The only place sample people and shops live. Design preview only (the real build deletes this folder).
export const SAMPLE: SampleData = {
  person: { fullName: 'Nguyễn Văn A', phoneMasked: '098 •••• 123' },
  shop: { name: 'Quán Cơm Nhà', phone: '0981234123', address: '12 đường Kim Đồng, phường Hợp Giang' },
  location: { accuracy: '± 8 m (mẫu)', measured: 'vừa xong (mẫu)' },
};

// Fixed examples of the connection states for the preview (F05/F06/S06). They are NOT measurements: the preview calls no
// server. The time, commit and fingerprint below are obviously sample values.
const SAMPLE_CHECKED_AT = Date.UTC(2026, 9, 12, 1, 30, 0);
const SAMPLE_SHA = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
const SAMPLE_FINGERPRINT = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

export type ConnectionVariant = 'default' | 'ready' | 'checking' | 'backend-not-ready' | 'offline' | 'timeout' | 'bad-response';

export function connectionFixture(variant: string, appId: string): ConnectionState {
  const snapshot = (health: Omit<HealthSnapshot, 'generation' | 'lastCheckedAt'>): HealthSnapshot => ({ ...health, generation: 1, lastCheckedAt: SAMPLE_CHECKED_AT });
  let health: HealthSnapshot;
  switch (variant as ConnectionVariant) {
    case 'checking':
      health = snapshot({ phase: 'checking', live: { state: 'pending' }, ready: { state: 'pending' } });
      break;
    case 'backend-not-ready':
      health = snapshot({ phase: 'backend_not_ready', live: { state: 'ok', httpStatus: 200, elapsedMs: 12 }, ready: { state: 'failed', reason: 'NOT_READY', httpStatus: 503, elapsedMs: 41 } });
      break;
    case 'offline':
      health = snapshot({ phase: 'offline', live: { state: 'failed', reason: 'OFFLINE', elapsedMs: 3 }, ready: { state: 'skipped' } });
      break;
    case 'timeout':
      health = snapshot({ phase: 'timeout', live: { state: 'failed', reason: 'TIMEOUT', elapsedMs: 5000 }, ready: { state: 'skipped' } });
      break;
    case 'bad-response':
      health = snapshot({ phase: 'bad_response', live: { state: 'failed', reason: 'BAD_RESPONSE', httpStatus: 200, elapsedMs: 15 }, ready: { state: 'skipped' } });
      break;
    default:
      health = snapshot({ phase: 'ready', live: { state: 'ok', httpStatus: 200, elapsedMs: 12 }, ready: { state: 'ok', httpStatus: 200, elapsedMs: 18 } });
  }
  return { health, build: { kind: 'ok', info: { appId, mode: 'design', sourceSha: SAMPLE_SHA, fingerprint: SAMPLE_FINGERPRINT } }, origin: 'https://localhost:8444' };
}
