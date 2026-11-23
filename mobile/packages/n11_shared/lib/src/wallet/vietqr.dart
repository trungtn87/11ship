// VietQR (EMVCo merchant-presented QR, NAPAS 247 "transfer to account") for a top-up. The payload is built from the server's receiving account,
// the request's amount and its NAP transfer code; nothing here is invented. A bank app that scans it fills the same account, amount and content
// the person would type by hand, so the screen always shows those as text too.

import 'wallet_models.dart';

/// The NAPAS bank identifier (BIN) for each receiving bank code the server can return. Only banks listed here get a QR; any other bank shows text only.
const Map<String, String> kNapasBinByBankCode = <String, String>{
  'MB': '970422',
};

/// The NAPAS bin of [bankCode] (case-insensitive), or null when no QR can be made for that bank.
String? napasBinOf(String? bankCode) => bankCode == null ? null : kNapasBinByBankCode[bankCode.toUpperCase()];

/// CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF, no reflection, no final xor), as EMVCo requires for the trailing "63" field.
int crc16Ccitt(String data) {
  int crc = 0xFFFF;
  for (final int unit in data.codeUnits) {
    crc ^= (unit & 0xFF) << 8;
    for (int bit = 0; bit < 8; bit++) {
      crc = (crc & 0x8000) != 0 ? ((crc << 1) ^ 0x1021) & 0xFFFF : (crc << 1) & 0xFFFF;
    }
  }
  return crc;
}

String _tlv(String id, String value) => '$id${value.length.toString().padLeft(2, '0')}$value';

/// The VietQR payload for a transfer of [amount] VND to [accountNumber] at the bank with [napasBin], with [content] as the transfer text.
/// Returns null when any part is missing or malformed, so a broken value never reaches a QR image.
String? buildVietQrPayload({required String napasBin, required String accountNumber, required int amount, required String content}) {
  final String account = accountNumber.replaceAll(' ', '');
  if (!RegExp(r'^[0-9]{6}$').hasMatch(napasBin) || !RegExp(r'^[0-9]{4,19}$').hasMatch(account) || amount < 1 || !RegExp(r'^[A-Z0-9]{1,25}$').hasMatch(content)) {
    return null;
  }
  final String merchant = _tlv('00', 'A000000727') + _tlv('01', _tlv('00', napasBin) + _tlv('01', account)) + _tlv('02', 'QRIBFTTA');
  final String body = '000201' // payload format indicator
      '010212' // dynamic QR: the amount is part of it
      '${_tlv('38', merchant)}'
      '${_tlv('53', '704')}' // VND
      '${_tlv('54', amount.toString())}'
      '${_tlv('58', 'VN')}'
      '${_tlv('62', _tlv('08', content))}' // purpose of transaction = the NAP code
      '6304';
  final String crc = crc16Ccitt(body).toRadixString(16).toUpperCase().padLeft(4, '0');
  return '$body$crc';
}

/// The VietQR of one pending top-up: the server's receiving account and bank, the request's amount, and its transfer code (the NAP code, or the
/// bank content the source defines). Null when the bank has no QR or any part is missing, so the screen shows text only.
String? vietQrForTopup(BankTransferInfo info, TopupRequest request) {
  final String? content = request.transferCode ?? info.content;
  final String? bin = napasBinOf(info.bankCode);
  if (content == null || bin == null) {
    return null;
  }
  return buildVietQrPayload(napasBin: bin, accountNumber: info.accountNumber, amount: request.amount, content: content);
}
