export function validateOrigin(value) {
  if (value === '') return null;
  if (typeof value !== 'string') throw new Error('CONFIG_INVALID');
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('CONFIG_INVALID');
  return url.origin;
}

export async function checkHealth(origin, fetchImpl = fetch) {
  const target = validateOrigin(origin);
  if (!target) return { ok: false, code: 'NOT_CONFIGURED' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    for (const [path, expected] of [['live', 'ok'], ['ready', 'ready']]) {
      const response = await fetchImpl(`${target}/v1/health/${path}`, {
        signal: controller.signal, cache: 'no-store', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer',
      });
      if (!response.ok) return { ok: false, code: path === 'ready' ? 'NOT_READY' : 'UNAVAILABLE' };
      const body = await response.json();
      if (body?.data?.status !== expected) return { ok: false, code: 'INVALID_RESPONSE' };
    }
    return { ok: true, code: 'READY' };
  } catch { return { ok: false, code: controller.signal.aborted ? 'TIMEOUT' : 'NETWORK_OR_CORS' }; }
  finally { clearTimeout(timer); }
}
