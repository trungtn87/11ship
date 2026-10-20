'use strict';

// `npm run push:check [-- --token <fcm-registration-token>]` — operator check of the M08 push configuration on the server (Firebase Cloud Messaging).
// Reads PUSH_FCM_PROJECT_ID / PUSH_FCM_SERVICE_ACCOUNT_FILE from the environment, validates them, then asks Google to validate (validate_only, nothing is
// delivered) a message with that credential. With --token it also sends ONE real test notification to that device. Prints fixed codes only: never the key
// file, an access token, a registration token or a provider response. Needs `npm run build` first. Exit code 0 = ready, 1 = not ready.
const { existsSync } = require('node:fs');
const path = require('node:path');

const dist = path.join(__dirname, '..', 'apps', 'backend', 'dist');
if (!existsSync(path.join(dist, 'notifications', 'push-provider.js'))) {
  console.error('push:check: the compiled application is missing. Run "npm run build" first.');
  process.exit(1);
}
const { parsePushConfig } = require(path.join(dist, 'config', 'push-config.js'));
const { FcmPushProvider } = require(path.join(dist, 'notifications', 'push-provider.js'));

const argv = process.argv.slice(2);
const at = argv.indexOf('--token');
const token = at >= 0 ? argv[at + 1] : undefined;
if (at >= 0 && (token === undefined || token.length < 20)) {
  console.error('push:check: --token needs the device registration token.');
  process.exit(1);
}

(async () => {
  const parsed = parsePushConfig({ env: process.env, appEnv: process.env.APP_ENV ?? 'production' });
  if (!parsed.ok) {
    console.error(`push:check: INVALID_CONFIG ${parsed.invalid.join(', ')}`);
    return 1;
  }
  if (parsed.config === undefined) {
    console.error('push:check: NOT_CONFIGURED (PUSH_FCM_PROJECT_ID and PUSH_FCM_SERVICE_ACCOUNT_FILE are both unset; the server records every push as skipped).');
    return 1;
  }
  const provider = new FcmPushProvider(parsed.config);
  const checked = await provider.check(AbortSignal.timeout(20000));
  if (!checked.ok) {
    console.error(`push:check: ${checked.code} - ${checked.evidence}`);
    return 1;
  }
  console.log('push:check: OK - credential, project and FCM permission accepted by Google (validate_only; nothing delivered).');
  if (token !== undefined) {
    const result = await provider.send(
      {
        token,
        title: '11Ship - kiểm tra đẩy thông báo',
        body: 'Nếu bạn thấy thông báo này, máy chủ đã gửi được tới điện thoại.',
        notificationId: '00000000-0000-4000-8000-000000000000',
        kind: 'PUSH_CHECK',
        targetType: 'INBOX',
        targetId: null,
        sound: true,
        vibrate: true,
        ttlSeconds: 300,
        collapseKey: 'push_check',
        highPriority: true,
      },
      AbortSignal.timeout(20000),
    );
    console.log(`push:check: test send -> ${result.kind}${result.code ? ` ${result.code}` : ''}`);
    return result.kind === 'SENT' ? 0 : 1;
  }
  return 0;
})().then(
  (code) => {
    process.exitCode = code;
  },
  () => {
    console.error('push:check: unexpected failure.');
    process.exitCode = 1;
  },
);
