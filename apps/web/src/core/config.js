// Validates the public runtime configuration. Pure: takes the raw object, returns a frozen, checked copy.

const DEFAULTS = Object.freeze({
  apiBaseUrl: '',
  requestTimeoutMs: 15000,
  environmentLabel: 'Môi trường thử nghiệm',
  registrationEnabled: false,
});

// An origin only: no userinfo, no path, no query, no fragment. A wildcard or a relative path is refused.
const ORIGIN = /^https?:\/\/[A-Za-z0-9.-]+(?::[0-9]{1,5})?$/;

export function readConfig(raw) {
  const source = raw !== null && typeof raw === 'object' ? raw : {};
  let apiBaseUrl = DEFAULTS.apiBaseUrl;
  if (typeof source.apiBaseUrl === 'string' && source.apiBaseUrl !== '') {
    const candidate = source.apiBaseUrl.replace(/\/+$/, '');
    if (!ORIGIN.test(candidate)) {
      throw new Error('CONFIG_INVALID:apiBaseUrl');
    }
    apiBaseUrl = candidate;
  }
  let requestTimeoutMs = DEFAULTS.requestTimeoutMs;
  if (source.requestTimeoutMs !== undefined) {
    if (!Number.isInteger(source.requestTimeoutMs) || source.requestTimeoutMs < 1000 || source.requestTimeoutMs > 60000) {
      throw new Error('CONFIG_INVALID:requestTimeoutMs');
    }
    requestTimeoutMs = source.requestTimeoutMs;
  }
  const environmentLabel =
    typeof source.environmentLabel === 'string' && source.environmentLabel.trim() !== ''
      ? source.environmentLabel.trim().slice(0, 80)
      : DEFAULTS.environmentLabel;
  if (source.registrationEnabled === true) {
    // There is no registration / OTP screen in this build, and there will be no SMS bypass. Refuse rather than ignore.
    throw new Error('CONFIG_INVALID:registrationEnabled');
  }
  return Object.freeze({
    apiBaseUrl,
    requestTimeoutMs,
    environmentLabel,
    registrationEnabled: false,
  });
}
