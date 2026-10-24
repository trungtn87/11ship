import { FAIL_REASON_CODES } from './delivery-constants';

// Plain Vietnamese for the reasons the apps of the shop and the customer show. The stored reason of a delivery may be an internal code ("RECIPIENT_UNREACHABLE:
// note") or a system phrase written for the logs ("QUÁ HẠN SHIPPER LẤY HÀNG"): the audit and the SYSTEM/ADMIN views keep them as they are; what the shop and the
// customer read is translated here. A reason a person typed is shown as typed.

const FAIL_LABELS: Readonly<Record<(typeof FAIL_REASON_CODES)[number], string>> = {
  RECIPIENT_UNREACHABLE: 'Không liên lạc được người nhận',
  RECIPIENT_REFUSED: 'Người nhận từ chối nhận hàng',
  ADDRESS_NOT_FOUND: 'Không tìm thấy địa chỉ giao hàng',
  GOODS_PROBLEM: 'Hàng có vấn đề',
  VEHICLE_PROBLEM: 'Xe của shipper gặp sự cố',
  OTHER: 'Lý do khác',
};

const SEARCH_EXPIRED = 'Hết thời gian tìm shipper';
const PICKUP_TIMEOUT = 'Shipper chưa lấy hàng quá thời gian quy định';
const ACCEPT_TIMEOUT = 'Chưa có shipper nhận trong thời gian quy định';
const ORDER_CANCEL_PREFIX = 'Hủy đơn món: ';

/** The label of a failure code, or null when the text is not one. */
export function failReasonLabel(code: string): string | null {
  return (FAIL_REASON_CODES as readonly string[]).includes(code) ? FAIL_LABELS[code as (typeof FAIL_REASON_CODES)[number]] : null;
}

/** "CODE" or "CODE: note" of a failed delivery, written as a sentence; a free text is returned unchanged. */
export function failReasonText(code: string, note: string | null): string {
  const label = failReasonLabel(code) ?? 'Lý do khác';
  const detail = note?.trim() ?? '';
  return detail === '' ? label : `${label}: ${detail}`;
}

/** The reason of an ended delivery as the shop and the customer read it; null when there is nothing to say. */
export function humanDeliveryReason(raw: string | null | undefined): string | null {
  const text = (raw ?? '').trim();
  if (text === '') {
    return null;
  }
  const coded = /^([A-Z_]+)(?::\s*([\s\S]*))?$/.exec(text);
  if (coded !== null && failReasonLabel(coded[1] ?? '') !== null) {
    return failReasonText(coded[1] ?? '', coded[2] ?? null);
  }
  if (text.startsWith(ORDER_CANCEL_PREFIX)) {
    return text.slice(ORDER_CANCEL_PREFIX.length).trim() || null;
  }
  if (/QUÁ HẠN SHIPPER LẤY HÀNG/i.test(text)) {
    return PICKUP_TIMEOUT;
  }
  if (/QUÁ HẠN CHỜ SHIPPER/i.test(text)) {
    return ACCEPT_TIMEOUT;
  }
  if (text.startsWith(SEARCH_EXPIRED)) {
    return SEARCH_EXPIRED;
  }
  // Anything else in capitals with underscores is a code nobody wrote for a reader: say nothing rather than show it.
  if (/^[A-Z0-9]+(?:[_.][A-Z0-9]+)+$/.test(text)) {
    return null;
  }
  return text;
}
