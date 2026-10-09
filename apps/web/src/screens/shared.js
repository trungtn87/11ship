import { describeFailure } from '../api/errors.js';
import { Alert } from '../ui/components.js';

/** A danger / warning alert for a failed api result, with the technical detail folded away. */
export function failureAlert(failure, { tone = 'danger', title, actions } = {}) {
  if (failure.kind === 'local') {
    return Alert({ tone: 'warning', title, message: 'Thao tác đang được xử lý. Đợi trong giây lát.' });
  }
  const { message, detail } = describeFailure(failure);
  return Alert({ tone, title, message, detail, actions });
}

/** Focus the first field that has an error so the person (and a screen reader) lands on what to fix. */
export function focusFirstInvalid(fields) {
  const first = fields.find((field) => field.input.getAttribute('aria-invalid') === 'true');
  if (first) {
    first.input.focus();
    first.input.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
}

export function replaceContent(host, ...nodes) {
  host.replaceChildren(...nodes.flat().filter(Boolean));
}
