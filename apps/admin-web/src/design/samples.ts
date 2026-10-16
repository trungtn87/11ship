import { AdministratorRow, UserDetail, UserLifecycle, UserRow } from '../core/accounts.js';
import { PhoneVerificationSettings } from '../core/settings.js';
import { InvitationDetail, InvitationStatus, InvitationSummary, Permission } from '../core/provisioning-api.js';

// SAMPLE data of the design preview. Every person, phone and date here is invented to show how a screen looks; it is shown
// only under the banner "Dữ liệu minh họa", lives only in this folder (the real build removes it, and a test checks that)
// and is never mixed with real data. Phones are masked the way the server masks them.

export const SAMPLE_USERS: readonly UserRow[] = [
  { id: '3f1c2a10-0000-4000-8000-000000000001', fullName: 'Nguyễn Văn A', phoneMasked: '090••• ••123', roles: ['CUSTOMER'], status: 'ACTIVE', createdAt: '2026-09-12T02:15:00.000Z' },
  { id: '3f1c2a10-0000-4000-8000-000000000002', fullName: 'Trần Thị B', phoneMasked: '091••• ••456', roles: ['CUSTOMER', 'SHOP_OWNER'], status: 'ACTIVE', createdAt: '2026-09-18T07:40:00.000Z' },
  { id: '3f1c2a10-0000-4000-8000-000000000003', fullName: 'Lê Văn C', phoneMasked: '093••• ••789', roles: ['CUSTOMER', 'DRIVER'], status: 'LOCKED', createdAt: '2026-09-21T11:05:00.000Z' },
  { id: '3f1c2a10-0000-4000-8000-000000000004', fullName: null, phoneMasked: '094••• ••012', roles: ['CUSTOMER'], status: 'ACTIVE', createdAt: '2026-10-01T01:30:00.000Z' },
  { id: '3f1c2a10-0000-4000-8000-000000000005', fullName: 'Phạm Thị D', phoneMasked: '096••• ••345', roles: ['CUSTOMER', 'SHOP_OWNER'], status: 'LOCKED', createdAt: '2026-10-05T09:20:00.000Z' },
];

export const SAMPLE_LOCKED_USERS: readonly UserRow[] = SAMPLE_USERS.filter((user) => user.status === 'LOCKED');

const ACTIVE_LIFECYCLE: UserLifecycle = {
  lockReason: null,
  lockedAt: null,
  relatedData: ['SHOP'],
  activeWork: [],
  deleteEffect: 'LOCK',
  lockBlockedReason: null,
  deleteBlockedReason: null,
};

export const SAMPLE_USER_DETAIL: UserDetail = {
  ...SAMPLE_USERS[1]!,
  version: 4,
  profile: {
    customer: { fullName: 'Trần Thị B' },
    shop: { name: 'Quán Bún Chả Cô Hoa', state: 'Đã hoàn tất hồ sơ' },
  },
  events: [
    { at: '2026-10-08T03:12:00.000Z', label: 'Mở khóa tài khoản', actor: 'ADMIN', reason: 'Đã xác minh lại thông tin với chủ quán.' },
    { at: '2026-10-07T08:45:00.000Z', label: 'Khóa tài khoản', actor: 'ADMIN', reason: 'Nhiều phản ánh về đơn hàng trong ngày.' },
    { at: '2026-09-18T07:40:00.000Z', label: 'Tạo tài khoản' },
  ],
  allowedActions: ['LOCK', 'DELETE'],
  phoneVerified: true,
  lifecycle: ACTIVE_LIFECYCLE,
};

/** An account with no business data: a delete removes it for good. Registered while the registration OTP was off, so the phone is unverified. */
export const SAMPLE_EMPTY_DETAIL: UserDetail = {
  ...SAMPLE_USER_DETAIL,
  ...SAMPLE_USERS[3]!,
  version: 1,
  profile: { customer: { fullName: null } },
  events: [{ at: '2026-10-01T01:30:00.000Z', label: 'Tạo tài khoản' }],
  phoneVerified: false,
  lifecycle: { ...ACTIVE_LIFECYCLE, relatedData: [], deleteEffect: 'DELETE_PERMANENTLY' },
};

/** An account with orders still being processed: it cannot be locked, nor deleted into a lock. */
export const SAMPLE_BUSY_DETAIL: UserDetail = {
  ...SAMPLE_USER_DETAIL,
  lifecycle: { ...ACTIVE_LIFECYCLE, relatedData: ['SHOP', 'ORDERS'], activeWork: ['ORDERS'], lockBlockedReason: 'ACTIVE_WORK', deleteBlockedReason: 'ACTIVE_WORK' },
};

export const SAMPLE_LOCKED_DETAIL: UserDetail = {
  ...SAMPLE_USER_DETAIL,
  ...SAMPLE_USERS[2]!,
  version: 6,
  profile: { customer: { fullName: 'Lê Văn C' }, driver: { state: 'Chờ duyệt' } },
  events: [
    { at: '2026-10-09T04:00:00.000Z', label: 'Khóa tài khoản', actor: 'ADMIN', reason: 'Thông tin xế không khớp giấy tờ.' },
    { at: '2026-09-21T11:05:00.000Z', label: 'Tạo tài khoản' },
  ],
  allowedActions: ['UNLOCK', 'DELETE'],
  phoneVerified: true,
  lifecycle: { ...ACTIVE_LIFECYCLE, lockReason: 'DELETE_REQUEST', lockedAt: '2026-10-09T04:00:00.000Z', relatedData: ['DRIVER_PROFILE'], deleteBlockedReason: 'ALREADY_LOCKED' },
};

export const SAMPLE_SETTINGS: PhoneVerificationSettings = {
  version: 2,
  otpRegistrationEnabled: true,
  otpPasswordResetEnabled: false,
  updatedAt: '2026-10-14T03:00:00.000Z',
  history: [
    { id: 'c3000000-0000-4000-8000-000000000002', key: 'otp_password_reset_enabled', oldValue: true, newValue: false, changedBy: 'a1000000-0000-4000-8000-0000000000aa', changedAt: '2026-10-14T03:00:00.000Z' },
    { id: 'c3000000-0000-4000-8000-000000000001', key: 'otp_registration_enabled', oldValue: true, newValue: false, changedBy: 'a1000000-0000-4000-8000-0000000000aa', changedAt: '2026-10-13T08:00:00.000Z' },
  ],
};

export const SAMPLE_ADMINISTRATORS: readonly AdministratorRow[] = [
  { id: 'a1000000-0000-4000-8000-000000000001', fullName: 'Nguyễn Anh', phoneMasked: '098••• ••101', scopes: ['Khách hàng: Xem, Khóa', 'Quán: Xem, Duyệt hồ sơ'], status: 'ACTIVE', createdAt: '2026-09-02T02:00:00.000Z' },
  { id: 'a1000000-0000-4000-8000-000000000002', fullName: 'Lê Thu Hà', phoneMasked: '097••• ••202', scopes: ['Xế: Xem, Duyệt hồ sơ'], status: 'ACTIVE', createdAt: '2026-09-15T05:30:00.000Z' },
  { id: 'a1000000-0000-4000-8000-000000000003', fullName: 'Vũ Minh Đức', phoneMasked: '096••• ••303', scopes: ['Khách hàng: Xem'], status: 'PENDING', createdAt: '2026-10-09T08:10:00.000Z' },
];

// ---- invitations (D04-D06) ---------------------------------------------------------------------------------------------

const PERMISSIONS: readonly Permission[] = [
  { app: 'CUSTOMER', canView: true, canReviewProfile: false, canLock: true },
  { app: 'SHOP', canView: true, canReviewProfile: true, canLock: false },
];

function invitation(index: number, status: InvitationStatus, fullName: string, phoneMasked: string, extra: Partial<InvitationSummary> = {}): InvitationSummary {
  return {
    invitationId: `b2000000-0000-4000-8000-00000000000${index}`,
    status,
    version: 1,
    fullName,
    phoneMasked,
    note: null,
    createdAt: '2026-10-09T02:00:00.000Z',
    expiresAt: '2026-10-12T02:00:00.000Z',
    terminalAt: null,
    successorId: null,
    expired: false,
    ...extra,
  };
}

export const SAMPLE_INVITATIONS: readonly InvitationSummary[] = [
  invitation(1, 'PENDING', 'Nguyễn Văn H', '0909 *** 456', { note: 'Hỗ trợ vận hành khu vực miền Nam' }),
  invitation(2, 'ACCEPTED', 'Lê Thu Hà', '097• ••• 202', { terminalAt: '2026-10-09T09:00:00.000Z' }),
  invitation(3, 'EXPIRED', 'Vũ Minh Đức', '096• ••• 303', { expired: true, expiresAt: '2026-10-08T02:00:00.000Z' }),
  invitation(4, 'REVOKED', 'Phạm Quang Huy', '095• ••• 404', { terminalAt: '2026-10-09T05:00:00.000Z' }),
];

export function sampleInvitationDetail(status: InvitationStatus): InvitationDetail {
  const base = SAMPLE_INVITATIONS.find((item) => item.status === status) ?? SAMPLE_INVITATIONS[0]!;
  return { ...base, permissions: PERMISSIONS };
}

/** An obviously fake activation link, shown on the "created" screen of the preview only. */
export const SAMPLE_ACTIVATION_LINK = 'https://admin.example.invalid/activate#t=MAU-LIEN-KET-MINH-HOA-KHONG-DUNG-DUOC-0000000';

/** A made-up otpauth URI (not a real secret) so the QR of the Authenticator screens can be drawn in the preview. */
export const SAMPLE_OTPAUTH = 'otpauth://totp/11Ship:minh-hoa?secret=MINHHOAXEMTHIETKEKHONGDUNG&issuer=11Ship';
export const SAMPLE_SECRET = 'MINHHOAXEMTHIETKEKHONGDUNG';
