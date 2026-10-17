// Banks a Shipper may choose for payouts (M03). A closed list: the code is what is stored and verified, the name is what is shown.

export interface ShipperBank {
  readonly code: string;
  readonly name: string;
}

export const SHIPPER_BANKS: readonly ShipperBank[] = Object.freeze([
  { code: 'VCB', name: 'Vietcombank' },
  { code: 'CTG', name: 'VietinBank' },
  { code: 'BIDV', name: 'BIDV' },
  { code: 'AGR', name: 'Agribank' },
  { code: 'TCB', name: 'Techcombank' },
  { code: 'MB', name: 'MB Bank' },
  { code: 'ACB', name: 'ACB' },
  { code: 'VPB', name: 'VPBank' },
  { code: 'TPB', name: 'TPBank' },
  { code: 'STB', name: 'Sacombank' },
  { code: 'HDB', name: 'HDBank' },
  { code: 'VIB', name: 'VIB' },
  { code: 'SHB', name: 'SHB' },
  { code: 'MSB', name: 'MSB' },
  { code: 'OCB', name: 'OCB' },
  { code: 'EIB', name: 'Eximbank' },
  { code: 'LPB', name: 'LPBank' },
  { code: 'SEAB', name: 'SeABank' },
  { code: 'NAB', name: 'Nam A Bank' },
  { code: 'BAB', name: 'Bac A Bank' },
  { code: 'VAB', name: 'VietABank' },
  { code: 'ABB', name: 'ABBANK' },
  { code: 'BVB', name: 'BaoViet Bank' },
  { code: 'PGB', name: 'PGBank' },
  { code: 'NCB', name: 'NCB' },
  { code: 'SCB', name: 'SCB' },
  { code: 'KLB', name: 'Kienlongbank' },
]);

export function findBank(code: string): ShipperBank | undefined {
  return SHIPPER_BANKS.find((bank) => bank.code === code);
}

/**
 * The comparison form of a person's name: no diacritics (Vietnamese đ included), upper case, anything that is not a letter or a digit
 * collapsed to one space. Banks print holder names without diacritics in capitals, so "Nguyễn Văn A" and "NGUYEN VAN A" are the same.
 */
export function comparableName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toUpperCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** True when the bank account holder is the Shipper (same name once both are reduced to their comparison form). */
export function holderMatchesName(fullName: string, holder: string): boolean {
  const a = comparableName(fullName);
  return a.length > 0 && a === comparableName(holder);
}
