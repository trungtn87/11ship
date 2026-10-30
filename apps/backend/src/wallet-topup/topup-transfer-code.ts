/**
 * The bank-transfer content that ties a payment to ONE top-up request (Nhóm 15, #256 P2): `NAP` + the first ten hex digits of the request id, upper-case.
 * Derived, never stored and never a secret: it holds no phone number, name or account data, it is the same on every read (so the screen restores it after a lost
 * connection or a reopen), and requests created before this existed have a code too without any data change. The request id stays the real key; the code is
 * what a person copies into the transfer and what an administrator searches by. A bank statement matching the code is evidence for the administrator, never a
 * credit by itself.
 */
export function topupTransferCodeOf(requestId: string): string {
  return `NAP${requestId.replace(/-/g, '').slice(0, 10).toUpperCase()}`;
}
