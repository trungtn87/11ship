// What the finance screens may show about a person or an account without the right to see it whole (M04-C). Masking happens on the server, before the response is built.

/** "Nguyễn Văn An" -> "N*** V*** A***" (the first letter of each word). */
export function maskName(fullName: string): string {
  return fullName
    .trim()
    .split(/\s+/u)
    .filter((word) => word !== '')
    .map((word) => `${[...word][0] ?? ''}***`)
    .join(' ');
}

/** "0912345678" -> "*******678". */
export function maskPhone(phone: string): string {
  return phone.length <= 3 ? '***' : `${'*'.repeat(Math.min(7, phone.length - 3))}${phone.slice(-3)}`;
}

/** "0123456789012" -> "****9012". */
export function maskAccountNumber(accountNumber: string): string {
  return `****${accountNumber.slice(-4)}`;
}
