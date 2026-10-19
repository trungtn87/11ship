import { NotificationApp, PUSH_TTL_MS } from './notification-constants';

// M11 -> M08. Pure: a complaint change becomes zero or more notification drafts. The wording is safe for a lock screen: the complaint CODE is the only
// identifier shown, never the text of a complaint, a conclusion, a name, a phone, an address or a picture. Only the Administration's steps tell someone
// (the person who acted is never told about their own action).

export interface ComplaintChangePayload {
  readonly complaintId: string;
  readonly code: string;
  readonly change: string;
  readonly status: string;
  readonly version: number;
  readonly shopId: string;
  readonly driverId: string | null;
  readonly submitterUserId: string;
  readonly submitterRole: 'CUSTOMER' | 'SHOP' | 'SHIPPER';
  readonly awaitingFrom: 'SUBMITTER' | 'SHOP' | 'SHIPPER' | null;
}

export type ComplaintAudience = 'SUBMITTER' | 'SHOP' | 'SHIPPER';

export interface ComplaintDraft {
  readonly audience: ComplaintAudience;
  readonly title: string;
  readonly body: string;
  readonly dedupeKey: string;
  readonly pushTtlMs: number;
}

/** The app a recipient reads the notification in: the Shipper in 11Ship, everyone else in 11Food. */
export const appOfAudience = (audience: ComplaintAudience, submitterRole: ComplaintChangePayload['submitterRole']): NotificationApp =>
  audience === 'SHIPPER' || (audience === 'SUBMITTER' && submitterRole === 'SHIPPER') ? 'SHIP' : 'FOOD';

export function composeComplaintChange(p: ComplaintChangePayload): ComplaintDraft[] {
  const draft = (audience: ComplaintAudience, title: string, body: string): ComplaintDraft => ({
    audience,
    title,
    body,
    dedupeKey: `complaint:${p.complaintId}:${p.change}:${String(p.version)}:${audience}`,
    pushTtlMs: PUSH_TTL_MS.result,
  });
  const code = p.code;
  switch (p.change) {
    case 'received':
      return [draft('SUBMITTER', 'Phản ánh đã được tiếp nhận', `Phản ánh ${code} đã được tiếp nhận và đang được xử lý.`)];
    case 'info_requested': {
      if (p.awaitingFrom === 'SUBMITTER') {
        return [draft('SUBMITTER', 'Cần bổ sung thông tin', `Phản ánh ${code}: bộ phận hỗ trợ cần bạn bổ sung thông tin.`)];
      }
      if (p.awaitingFrom === 'SHOP' || p.awaitingFrom === 'SHIPPER') {
        return [draft(p.awaitingFrom, 'Cần bạn giải trình', `Phản ánh ${code} liên quan đến bạn cần được giải trình. Mở ứng dụng để xem.`)];
      }
      return [];
    }
    case 'concluded': {
      const out = [draft('SUBMITTER', 'Phản ánh đã có kết quả', `Phản ánh ${code} đã có kết luận. Mở ứng dụng để xem.`)];
      // The related parties are told too (they may read the conclusion): never the one who is the submitter.
      if (p.submitterRole !== 'SHOP') {
        out.push(draft('SHOP', 'Phản ánh liên quan đã có kết luận', `Phản ánh ${code} liên quan đến quán của bạn đã có kết luận.`));
      }
      if (p.submitterRole !== 'SHIPPER' && p.driverId !== null) {
        out.push(draft('SHIPPER', 'Phản ánh liên quan đã có kết luận', `Phản ánh ${code} liên quan đến bạn đã có kết luận.`));
      }
      return out;
    }
    case 'closed':
      return [draft('SUBMITTER', 'Phản ánh đã đóng', `Phản ánh ${code} đã được đóng. Mở ứng dụng để xem lý do.`)];
    case 'reopened':
      return [draft('SUBMITTER', 'Phản ánh được mở lại', `Phản ánh ${code} đã được mở lại để xem xét.`)];
    case 'reconsideration_rejected':
      return [draft('SUBMITTER', 'Kết quả xem xét lại', `Phản ánh ${code}: yêu cầu xem xét lại đã được trả lời.`)];
    default:
      return [];
  }
}
