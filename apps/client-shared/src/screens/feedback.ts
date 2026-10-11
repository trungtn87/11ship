import { banner } from '../components.js';
import { failureMessage, FailureCode } from '../states.js';

// Banner for a failed call. Wording comes from states.ts, so every screen says the same thing for the same failure.
// NOT_WIRED is shown as information (the action does not exist yet), never as a red error and never as success.

export function failureBanner(code: FailureCode, options: { readonly retryAfterSeconds?: number; readonly onRetry?: () => void } = {}): HTMLElement {
  const message = failureMessage(code, options.retryAfterSeconds);
  const kind = code === 'NOT_WIRED' ? 'info' : code === 'RATE_LIMITED' || code === 'OUTCOME_UNKNOWN' ? 'warn' : 'error';
  return banner({
    kind,
    title: message.title,
    text: message.text,
    action: options.onRetry === undefined ? undefined : { label: code === 'OUTCOME_UNKNOWN' ? 'Kiểm tra lại' : 'Thử lại', onClick: options.onRetry },
  });
}
