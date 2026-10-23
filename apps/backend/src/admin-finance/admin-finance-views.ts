import { JsonObject } from '../idempotency/idempotency-executor';
import { maskName, maskPhone } from '../wallet/finance-masking';

/** The Shipper as a finance screen may show them: the Shipper code and the status whole, the name and the phone masked. */
export function driverIdentityView(identity: { shipperCode: string; fullName: string; status: string; phone: string } | undefined): JsonObject {
  if (identity === undefined) {
    return { code: null, name_masked: null, phone_masked: null, status: null };
  }
  return { code: identity.shipperCode, name_masked: maskName(identity.fullName), phone_masked: maskPhone(identity.phone), status: identity.status };
}
