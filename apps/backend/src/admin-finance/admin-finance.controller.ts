import { randomUUID } from 'node:crypto';
import { Body, Controller, Get, Headers, HttpCode, Inject, Param, Post, Query, Req, Res } from '@nestjs/common';
import { ADMIN_AUTH_CONFIG } from '../admin-auth/admin-auth-config.provider';
import { AdminLimiter } from '../admin-auth/admin-limiter';
import { AdminRequest, AdminTransport, Csrf, StatusResponse } from '../admin-shippers/admin-shipper.controller';
import { AdminAuthConfig } from '../config/admin-auth-config';
import { parseFinanceId, parseNoFinanceQuery } from '../finance-access/finance-access-validation';
import { AdminFinanceReadService } from './admin-finance-read-service';
import { parseCommissionBody, parseLedgerQuery, parseWalletListQuery } from './admin-finance-read-validation';
import { AdminWithdrawalService } from './admin-withdrawal-service';
import { parseAdminWithdrawalListQuery, parseMarkPaidBody, parseReconcileBody, parseReportBody, parseVersionBody } from './admin-withdrawal-validation';

/**
 * /v1/admin/finance: the withdrawals, the wallets, the transactions, the reconciliation and the commission policy (M04-C, Administration web). The SESSION cookie is the
 * only credential (Origin, quota, CSRF as every administration write); the actor comes from the session and the target from the path, never from a body. Each route
 * names the finance right it needs (`wallet.read`, `wallet.withdrawal.process|confirm|reconcile`, SYSTEM for the commission); every one is asked again under the locks in the
 * service, and again on a replay. No-store comes from the module.
 */
@Controller('admin/finance')
export class AdminFinanceController {
  readonly #transport: AdminTransport;

  constructor(
    private readonly withdrawals: AdminWithdrawalService,
    private readonly reads: AdminFinanceReadService,
    limiter: AdminLimiter,
    @Inject(ADMIN_AUTH_CONFIG) config: AdminAuthConfig,
  ) {
    this.#transport = new AdminTransport(limiter, config);
  }

  // ---- reads ---------------------------------------------------------------------------------------------------------------------------------------------

  @Get('overview')
  async overview(@Query() query: unknown, @Req() request: AdminRequest) {
    const token = this.#transport.read(request);
    parseNoFinanceQuery(query);
    return { data: await this.reads.overview(token) };
  }

  @Get('wallets')
  async wallets(@Query() query: unknown, @Req() request: AdminRequest) {
    const token = this.#transport.read(request);
    return { data: await this.reads.wallets(token, parseWalletListQuery(query)) };
  }

  @Get('wallets/:driver_id')
  async wallet(@Param('driver_id') driverId: string, @Query() query: unknown, @Req() request: AdminRequest) {
    const token = this.#transport.read(request);
    parseNoFinanceQuery(query);
    return { data: await this.reads.walletOf(token, parseFinanceId(driverId)) };
  }

  @Get('transactions')
  async transactions(@Query() query: unknown, @Req() request: AdminRequest) {
    const token = this.#transport.read(request);
    return { data: await this.reads.ledger(token, parseLedgerQuery(query)) };
  }

  @Get('reconciliation')
  async reconciliation(@Query() query: unknown, @Req() request: AdminRequest) {
    const token = this.#transport.read(request);
    parseNoFinanceQuery(query);
    return { data: await this.reads.reconciliation(token) };
  }

  @Post('reconciliation/check')
  @HttpCode(200)
  async check(@Req() req: AdminRequest, @Res({ passthrough: true }) res: StatusResponse, @Headers('x-csrf-token') csrf: Csrf, @Headers('idempotency-key') key: Csrf) {
    const token = await this.#transport.write(req);
    const outcome = await this.reads.runCheck(token, csrf, key, { requestId: req.requestId ?? randomUUID() });
    res.status(outcome.status);
    return { data: outcome.payload };
  }

  @Get('commission-policy')
  async commission(@Query() query: unknown, @Req() request: AdminRequest) {
    const token = this.#transport.read(request);
    parseNoFinanceQuery(query);
    return { data: await this.reads.commissionPolicy(token) };
  }

  @Post('commission-policy')
  @HttpCode(200)
  async changeCommission(@Body() body: unknown, @Req() req: AdminRequest, @Res({ passthrough: true }) res: StatusResponse, @Headers('x-csrf-token') csrf: Csrf, @Headers('idempotency-key') key: Csrf) {
    const token = await this.#transport.write(req);
    const input = parseCommissionBody(body);
    const outcome = await this.reads.changeCommission(token, csrf, input, key, { requestId: req.requestId ?? randomUUID() });
    res.status(outcome.status);
    return { data: outcome.payload };
  }

  // ---- withdrawals ---------------------------------------------------------------------------------------------------------------------------------------

  @Get('withdrawal-source-accounts')
  async sourceAccounts(@Query() query: unknown, @Req() request: AdminRequest) {
    const token = this.#transport.read(request);
    parseNoFinanceQuery(query);
    return { data: await this.withdrawals.sourceAccounts(token) };
  }

  @Get('withdrawals')
  async list(@Query() query: unknown, @Req() request: AdminRequest) {
    const token = this.#transport.read(request);
    return { data: await this.withdrawals.list(token, parseAdminWithdrawalListQuery(query)) };
  }

  @Get('withdrawals/:withdrawal_id')
  async detail(@Param('withdrawal_id') id: string, @Query() query: unknown, @Req() request: AdminRequest) {
    const token = this.#transport.read(request);
    parseNoFinanceQuery(query);
    return { data: await this.withdrawals.detail(token, parseFinanceId(id)) };
  }

  @Post('withdrawals/:withdrawal_id/start-processing')
  @HttpCode(200)
  async start(@Param('withdrawal_id') id: string, @Body() body: unknown, @Req() req: AdminRequest, @Res({ passthrough: true }) res: StatusResponse, @Headers('x-csrf-token') csrf: Csrf, @Headers('idempotency-key') key: Csrf) {
    const token = await this.#transport.write(req);
    const target = parseFinanceId(id);
    const outcome = await this.withdrawals.startProcessing(token, csrf, target, parseVersionBody(body), key, { requestId: req.requestId ?? randomUUID() });
    res.status(outcome.status);
    return { data: outcome.payload };
  }

  @Post('withdrawals/:withdrawal_id/mark-paid')
  @HttpCode(200)
  async paid(@Param('withdrawal_id') id: string, @Body() body: unknown, @Req() req: AdminRequest, @Res({ passthrough: true }) res: StatusResponse, @Headers('x-csrf-token') csrf: Csrf, @Headers('idempotency-key') key: Csrf) {
    const token = await this.#transport.write(req);
    const target = parseFinanceId(id);
    const outcome = await this.withdrawals.markPaid(token, csrf, target, parseMarkPaidBody(body), key, { requestId: req.requestId ?? randomUUID() });
    res.status(outcome.status);
    return { data: outcome.payload };
  }

  @Post('withdrawals/:withdrawal_id/report-reconciliation')
  @HttpCode(200)
  async report(@Param('withdrawal_id') id: string, @Body() body: unknown, @Req() req: AdminRequest, @Res({ passthrough: true }) res: StatusResponse, @Headers('x-csrf-token') csrf: Csrf, @Headers('idempotency-key') key: Csrf) {
    const token = await this.#transport.write(req);
    const target = parseFinanceId(id);
    const outcome = await this.withdrawals.reportReconciliation(token, csrf, target, parseReportBody(body), key, { requestId: req.requestId ?? randomUUID() });
    res.status(outcome.status);
    return { data: outcome.payload };
  }

  @Post('withdrawals/:withdrawal_id/reconcile')
  @HttpCode(200)
  async reconcile(@Param('withdrawal_id') id: string, @Body() body: unknown, @Req() req: AdminRequest, @Res({ passthrough: true }) res: StatusResponse, @Headers('x-csrf-token') csrf: Csrf, @Headers('idempotency-key') key: Csrf) {
    const token = await this.#transport.write(req);
    const target = parseFinanceId(id);
    const outcome = await this.withdrawals.reconcile(token, csrf, target, parseReconcileBody(body), key, { requestId: req.requestId ?? randomUUID() });
    res.status(outcome.status);
    return { data: outcome.payload };
  }
}
