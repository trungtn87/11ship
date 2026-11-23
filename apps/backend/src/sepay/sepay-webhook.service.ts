import { Injectable } from '@nestjs/common';
import { TransactionManager } from '../transaction/transaction-manager';
import { readSepayConfig } from './sepay-config';
import { parseSepayEvent } from './sepay-event';
import { SepaySettlementService } from './sepay-settlement-service';
import { verifySepaySignature } from './sepay-signature';

export interface WebhookResponse {
  readonly status: number;
  readonly body: Record<string, unknown>;
}

/**
 * SePay transaction webhook (M04 step 1). Order of work, all decided on the server:
 *   1. configuration (fail closed: no secret or a wrong prefix -> 503, nothing stored);
 *   2. HMAC-SHA256 over the raw body and the timestamp, constant-time, five-minute window (401 / 400, nothing stored);
 *   3. strict payload validation (400, nothing stored);
 *   4. ONE database transaction, the shared settlement (SepaySettlementService): record, decide, and credit only when every rule holds;
 *   5. 200 {"success": true} only after that transaction commits. An error in step 4 rolls the whole thing back and SePay retries.
 */
@Injectable()
export class SepayWebhookService {
  constructor(
    private readonly transactions: TransactionManager,
    private readonly settlement: SepaySettlementService,
  ) {}

  async receive(input: { readonly rawBody: Buffer; readonly timestampHeader: unknown; readonly signatureHeader: unknown; readonly nowSeconds: number; readonly env: NodeJS.ProcessEnv }): Promise<WebhookResponse> {
    const config = readSepayConfig(input.env);
    if (config.webhookSecret === null || config.misconfiguration !== null) {
      return { status: 503, body: { success: false, error: 'SEPAY_NOT_CONFIGURED' } };
    }
    const verdict = verifySepaySignature({ secret: config.webhookSecret, timestampHeader: input.timestampHeader, signatureHeader: input.signatureHeader, rawBody: input.rawBody, nowSeconds: input.nowSeconds });
    if (verdict === 'MISSING_HEADERS' || verdict === 'BAD_SIGNATURE') {
      return { status: 401, body: { success: false, error: 'SIGNATURE_INVALID' } };
    }
    if (verdict === 'BAD_TIMESTAMP' || verdict === 'EXPIRED') {
      return { status: 400, body: { success: false, error: 'TIMESTAMP_OUT_OF_WINDOW' } };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(input.rawBody.toString('utf8')) as unknown;
    } catch {
      return { status: 400, body: { success: false, error: 'BODY_INVALID' } };
    }
    const event = parseSepayEvent(parsed);
    if (event === undefined) {
      return { status: 400, body: { success: false, error: 'PAYLOAD_INVALID' } };
    }
    // A repeat (SePay retries, or the same transfer already seen by the reconciliation job) changes nothing and still answers success.
    await this.transactions.withTransaction((context) => this.settlement.settle(context, event, config));
    return { status: 200, body: { success: true } };
  }
}
