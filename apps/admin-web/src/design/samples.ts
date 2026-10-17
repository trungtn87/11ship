import { AdministratorRow, UserDetail, UserLifecycle, UserRow } from '../core/accounts.js';
import { CategoryRow } from '../core/catalog.js';
import {
  ChartDay,
  FinanceOverview,
  LedgerData,
  LedgerRow,
  LedgerStatus,
  LedgerType,
  TopupDetail,
  TopupRow,
  TopupStatus,
  WALLET_PARAM_DEFAULTS,
  WalletParamsData,
  WalletRow,
  WithdrawalDetail,
  WithdrawalRow,
  WithdrawalStatus,
} from '../core/finance.js';
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
    { at: '2026-10-09T04:00:00.000Z', label: 'Khóa tài khoản', actor: 'ADMIN', reason: 'Thông tin shipper không khớp giấy tờ.' },
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
  { id: 'a1000000-0000-4000-8000-000000000002', fullName: 'Lê Thu Hà', phoneMasked: '097••• ••202', scopes: ['Shipper: Xem, Duyệt hồ sơ'], status: 'ACTIVE', createdAt: '2026-09-15T05:30:00.000Z' },
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

// Dish groups (Danh mục › Nhóm món). Obviously sample names; the real page only ever shows what the server sent.
function category(index: number, name: string, sortOrder: number, status: 'ACTIVE' | 'INACTIVE', itemCount: number): CategoryRow {
  return { id: `d4000000-0000-4000-8000-0000000000${String(index).padStart(2, '0')}`, name, sortOrder, status, itemCount, version: 1, updatedAt: '2026-10-15T03:00:00.000Z' };
}

export const SAMPLE_CATEGORIES: readonly CategoryRow[] = [
  category(1, 'Ốc', 1, 'ACTIVE', 18),
  category(2, 'Hải sản', 2, 'ACTIVE', 12),
  category(3, 'Món nướng', 3, 'ACTIVE', 7),
  category(4, 'Ăn vặt', 4, 'ACTIVE', 5),
  category(5, 'Đồ uống', 5, 'ACTIVE', 9),
  category(6, 'Món theo mùa', 6, 'INACTIVE', 2),
];

// ---- M04 finance (sample only) ---------------------------------------------------------------------------------------------
// Invented shippers, codes, bank references and amounts: the screens of the preview are built from them under the banner "Dữ liệu minh họa".
// They never reach the real build and are never mixed with data from a server. Amounts follow the reference figures of the approved UI.

const fid = (group: string, index: number): string => `${group}0000000-0000-4000-8000-${String(index).padStart(12, '0')}`;

const SHIPPERS: readonly (readonly [string, string])[] = [
  ['Nguyễn Văn A', '0987 654 321'],
  ['Trần Thị B', '0912 345 678'],
  ['Lê Văn C', '0909 111 222'],
  ['Phạm Thị D', '0933 444 555'],
  ['Hoàng Văn E', '0905 678 901'],
  ['Vũ Thị F', '0968 222 333'],
  ['Đặng Văn G', '0977 888 999'],
  ['Bùi Thị H', '0931 515 252'],
];

const maskPhone = (phone: string): string => `${phone.slice(0, 3)}• •••• ${phone.slice(-3)}`;

export const SAMPLE_WALLETS: readonly WalletRow[] = [
  { id: fid('f1', 1), code: 'SHP001', name: 'Nguyễn Văn A', phoneMasked: maskPhone(SHIPPERS[0]![1]), total: 150_000, held: 2_000, status: 'ACTIVE' },
  { id: fid('f1', 2), code: 'SHP002', name: 'Trần Thị B', phoneMasked: maskPhone(SHIPPERS[1]![1]), total: 200_000, held: 0, status: 'ACTIVE' },
  { id: fid('f1', 3), code: 'SHP003', name: 'Lê Văn C', phoneMasked: maskPhone(SHIPPERS[2]![1]), total: 50_000, held: 1_000, status: 'LOCKED' },
  { id: fid('f1', 4), code: 'SHP004', name: 'Phạm Thị D', phoneMasked: maskPhone(SHIPPERS[3]![1]), total: 0, held: 0, status: 'CLOSED' },
  { id: fid('f1', 5), code: 'SHP005', name: 'Hoàng Văn E', phoneMasked: maskPhone(SHIPPERS[4]![1]), total: 200_000, held: 5_000, status: 'ACTIVE' },
  ...Array.from({ length: 7 }, (_, index): WalletRow => {
    const shipper = SHIPPERS[5 + (index % 3)]!;
    return { id: fid('f1', 6 + index), code: `SHP${String(6 + index).padStart(3, '0')}`, name: `${shipper[0]} ${String(index + 1)}`, phoneMasked: maskPhone(shipper[1]), total: 20_000 * (index + 1), held: index % 2 === 0 ? 1_000 : 0, status: 'ACTIVE' };
  }),
];

const BANKS: readonly string[] = ['Vietcombank', 'MB Bank', 'VietinBank', 'Techcombank', 'BIDV'];

function topupRow(index: number, status: TopupStatus): TopupRow {
  const shipper = SHIPPERS[index % SHIPPERS.length]!;
  return {
    id: fid('f2', index),
    code: `NP2026101${String(index).padStart(4, '0')}`,
    createdAt: `2026-10-${String(15 - (index % 4)).padStart(2, '0')}T0${String(2 + (index % 6))}:${String((index * 7) % 60).padStart(2, '0')}:00.000Z`,
    shipperName: shipper[0],
    phoneMasked: maskPhone(shipper[1]),
    amount: [100_000, 200_000, 300_000, 150_000][index % 4]!,
    bank: BANKS[index % BANKS.length]!,
    status,
  };
}

/** 12 waiting (the tab shows "Chờ xác nhận (12)"), then decided ones. */
export const SAMPLE_TOPUPS: readonly TopupRow[] = [
  ...Array.from({ length: 12 }, (_, index) => topupRow(index + 1, 'PENDING')),
  topupRow(13, 'CONFIRMED'),
  topupRow(14, 'CONFIRMED'),
  topupRow(15, 'REJECTED'),
  topupRow(16, 'CANCELLED'),
];

const TOPUP_BASE = SAMPLE_TOPUPS[0]!;

export const SAMPLE_TOPUP_DETAIL: TopupDetail = {
  ...TOPUP_BASE,
  transferContent: 'NAP 0987654321',
  proofName: 'anh-chuyen-khoan-minh-hoa.jpg',
  decidedBy: null,
  decidedAt: null,
  actualAmount: null,
  bankReference: null,
  note: null,
};

export const SAMPLE_TOPUP_DONE: TopupDetail = {
  ...SAMPLE_TOPUPS[12]!,
  transferContent: 'NAP 0912345678',
  proofName: null,
  decidedBy: 'a1000000',
  decidedAt: '2026-10-15T04:20:00.000Z',
  actualAmount: SAMPLE_TOPUPS[12]!.amount,
  bankReference: 'FT26288MINHHOA01',
  note: 'Đã đối chiếu sao kê.',
};

export const SAMPLE_TOPUP_REJECTED: TopupDetail = {
  ...SAMPLE_TOPUPS[14]!,
  transferContent: 'NAP 0909111222',
  proofName: 'anh-minh-hoa.jpg',
  decidedBy: 'a1000000',
  decidedAt: '2026-10-15T05:05:00.000Z',
  actualAmount: null,
  bankReference: null,
  note: 'Không thấy giao dịch trên sao kê ngân hàng.',
};

function withdrawalRow(index: number, status: WithdrawalStatus): WithdrawalRow {
  const shipper = SHIPPERS[index % SHIPPERS.length]!;
  return {
    id: fid('f3', index),
    code: `RT2026101${String(index).padStart(4, '0')}`,
    createdAt: `2026-10-${String(15 - (index % 5)).padStart(2, '0')}T0${String(1 + (index % 7))}:${String((index * 11) % 60).padStart(2, '0')}:00.000Z`,
    shipperName: shipper[0],
    phoneMasked: maskPhone(shipper[1]),
    amount: [100_000, 200_000, 50_000, 120_000][index % 4]!,
    status,
  };
}

export const SAMPLE_WITHDRAWALS: readonly WithdrawalRow[] = [
  ...Array.from({ length: 8 }, (_, index) => withdrawalRow(index + 1, 'PENDING')),
  ...Array.from({ length: 3 }, (_, index) => withdrawalRow(index + 9, 'PROCESSING')),
  ...Array.from({ length: 2 }, (_, index) => withdrawalRow(index + 12, 'NEEDS_RECONCILE')),
  ...Array.from({ length: 4 }, (_, index) => withdrawalRow(index + 14, 'COMPLETED')),
  withdrawalRow(18, 'CANCELLED'),
];

function withdrawalDetail(row: WithdrawalRow, steps: WithdrawalDetail['steps']): WithdrawalDetail {
  const shipper = SHIPPERS.find(([name]) => name === row.shipperName) ?? SHIPPERS[0]!;
  return {
    ...row,
    bank: { bank: 'Vietcombank', accountMasked: `•••• ${shipper[1].replace(/\D/g, '').slice(-4)}`, holder: row.shipperName.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/Đ/g, 'D') },
    held: row.status === 'COMPLETED' || row.status === 'CANCELLED' ? 0 : row.amount,
    steps,
    note: null,
  };
}

const T = (hour: number, minute: number): string => `2026-10-15T0${String(hour)}:${String(minute).padStart(2, '0')}:00.000Z`;

export const SAMPLE_WITHDRAWAL_PENDING: WithdrawalDetail = withdrawalDetail(SAMPLE_WITHDRAWALS[0]!, [{ status: 'PENDING', at: T(3, 25), by: null }, { status: 'PROCESSING', at: null, by: null }, { status: 'COMPLETED', at: null, by: null }]);
export const SAMPLE_WITHDRAWAL_PROCESSING: WithdrawalDetail = withdrawalDetail(SAMPLE_WITHDRAWALS[8]!, [{ status: 'PENDING', at: T(2, 10), by: null }, { status: 'PROCESSING', at: T(3, 0), by: 'a1000000' }, { status: 'COMPLETED', at: null, by: null }]);
export const SAMPLE_WITHDRAWAL_RECONCILE: WithdrawalDetail = withdrawalDetail(SAMPLE_WITHDRAWALS[11]!, [
  { status: 'PENDING', at: T(1, 40), by: null },
  { status: 'PROCESSING', at: T(2, 5), by: 'a1000000' },
  { status: 'NEEDS_RECONCILE', at: T(2, 50), by: 'a1000000' },
  { status: 'COMPLETED', at: null, by: null },
]);
export const SAMPLE_WITHDRAWAL_DONE: WithdrawalDetail = withdrawalDetail(SAMPLE_WITHDRAWALS[13]!, [{ status: 'PENDING', at: T(1, 5), by: null }, { status: 'PROCESSING', at: T(1, 30), by: 'a1000000' }, { status: 'COMPLETED', at: T(2, 15), by: 'a1000000' }]);
export const SAMPLE_WITHDRAWAL_CANCELLED: WithdrawalDetail = withdrawalDetail(SAMPLE_WITHDRAWALS[17]!, [{ status: 'PENDING', at: T(1, 5), by: null }, { status: 'PROCESSING', at: null, by: null }, { status: 'COMPLETED', at: null, by: null }]);

const LEDGER_PLAN: readonly (readonly [LedgerType, number, LedgerStatus])[] = [
  ['TOPUP', 150_000, 'SUCCESS'],
  ['COMMISSION', -1_000, 'SUCCESS'],
  ['HOLD', 2_000, 'SUCCESS'],
  ['WITHDRAW', -100_000, 'PENDING'],
  ['RELEASE', 1_000, 'SUCCESS'],
  ['COMMISSION', -1_000, 'SUCCESS'],
  ['TOPUP', 200_000, 'SUCCESS'],
  ['WITHDRAW', -50_000, 'SUCCESS'],
  ['COMMISSION', -1_000, 'FAILED'],
  ['HOLD', 1_000, 'SUCCESS'],
];

export const SAMPLE_LEDGER_ROWS: readonly LedgerRow[] = Array.from({ length: 24 }, (_, index): LedgerRow => {
  const [type, amount, status] = LEDGER_PLAN[index % LEDGER_PLAN.length]!;
  const shipper = SHIPPERS[index % SHIPPERS.length]!;
  return {
    id: fid('f4', index + 1),
    at: `2026-10-${String(15 - Math.floor(index / 5)).padStart(2, '0')}T0${String(1 + (index % 8))}:${String((index * 13) % 60).padStart(2, '0')}:00.000Z`,
    type,
    shipperName: shipper[0],
    reference: type === 'TOPUP' ? `NP2026101${String(index).padStart(4, '0')}` : type === 'WITHDRAW' ? `RT2026101${String(index).padStart(4, '0')}` : `Đơn DH${String(250_000 + index)}`,
    amount,
    balanceAfter: type === 'HOLD' || type === 'RELEASE' ? null : 100_000 + index * 5_000,
    status,
  };
});

export const SAMPLE_LEDGER: LedgerData = { rows: SAMPLE_LEDGER_ROWS, summary: { ledgerTotal: 1_250_000, walletTotal: 1_250_000, heldTotal: 9_000, pendingWithdrawals: 920_000 } };
export const SAMPLE_LEDGER_MISMATCH: LedgerData = { rows: SAMPLE_LEDGER_ROWS, summary: { ledgerTotal: 1_250_000, walletTotal: 1_252_000, heldTotal: 9_000, pendingWithdrawals: 920_000 } };

const CHART: readonly ChartDay[] = Array.from({ length: 15 }, (_, index): ChartDay => ({
  label: `${String(index + 1).padStart(2, '0')}/10`,
  topup: [30, 60, 20, 90, 50, 70, 40, 110, 60, 30, 80, 45, 95, 55, 75][index]! * 1_000_000,
  withdraw: [20, 35, 10, 50, 30, 40, 25, 60, 35, 20, 45, 25, 55, 30, 40][index]! * 1_000_000,
  commission: [4, 6, 3, 9, 5, 7, 4, 11, 6, 3, 8, 5, 9, 6, 7][index]! * 1_000_000,
}));

export const SAMPLE_OVERVIEW: FinanceOverview = {
  totalBalance: 125_430_000,
  totalHeld: 3_250_000,
  pendingTopups: 12,
  pendingWithdrawals: 8,
  commissionCollected: 21_000_000,
  transactionsToday: 1_245,
  chart: CHART,
};

export const SAMPLE_WALLET_PARAMS: WalletParamsData = {
  params: WALLET_PARAM_DEFAULTS,
  history: [{ id: fid('f5', 1), key: 'commissionPerOrder', oldValue: 2_000, newValue: 1_000, changedBy: 'a1000000-0000-4000-8000-0000000000aa', changedAt: '2026-10-14T03:00:00.000Z' }],
};
