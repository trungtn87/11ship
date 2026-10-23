import { randomUUID } from 'node:crypto';
import { Body, Controller, Get, Headers, HttpCode, Inject, Param, Post, Query, Req, Res, StreamableFile } from '@nestjs/common';
import { ADMIN_AUTH_CONFIG } from '../admin-auth/admin-auth-config.provider';
import { AdminLimiter } from '../admin-auth/admin-limiter';
import { AdminRequest, AdminTransport, Csrf, StatusResponse } from '../admin-shippers/admin-shipper.controller';
import { AdminAuthConfig } from '../config/admin-auth-config';
import { AdminFeedbackService } from './admin-feedback-service';
import { parseComplaintAction, parseComplaintActionBody, parseComplaintQuery, parseId, parseModerationBody, parseNoQuery, parseReviewAction, parseReviewQuery } from './admin-feedback-validation';

type Headers_ = { setHeader(name: string, value: string): unknown };

/**
 * /v1/admin/reviews and /v1/admin/complaints (M11.03, Administration web): GET list with counters, GET detail and one POST per action. The SESSION cookie is the
 * only credential; the actor comes from the session and the target from the path, never from a body. Same order as every administration write: transport,
 * quota, strict parser, cookie/CSRF precheck, then the service authorizes again under locks. There is NO route that edits a rating's stars or text, that sets
 * a status, or that deletes anything: an action has its own conditions and a mandatory reason. No-store comes from the module.
 */
@Controller('admin')
export class AdminFeedbackController {
  readonly #transport: AdminTransport;

  constructor(
    private readonly feedback: AdminFeedbackService,
    limiter: AdminLimiter,
    @Inject(ADMIN_AUTH_CONFIG) config: AdminAuthConfig,
  ) {
    this.#transport = new AdminTransport(limiter, config);
  }

  // ---- reviews -----------------------------------------------------------------------------------------------------------------

  @Get('reviews')
  async reviews(@Query() query: unknown, @Req() request: AdminRequest) {
    const token = this.#transport.read(request);
    return { data: await this.feedback.listReviews(token, parseReviewQuery(query)) };
  }

  @Get('reviews/:review_id')
  async review(@Param('review_id') id: string, @Query() query: unknown, @Req() request: AdminRequest) {
    const token = this.#transport.read(request);
    parseNoQuery(query);
    return { data: await this.feedback.reviewDetail(token, parseId(id)) };
  }

  @Post('reviews/:review_id/actions/:action')
  @HttpCode(200)
  async reviewAction(
    @Param('review_id') id: string,
    @Param('action') action: string,
    @Body() body: unknown,
    @Req() request: AdminRequest,
    @Res({ passthrough: true }) response: StatusResponse,
    @Headers('x-csrf-token') csrf: Csrf,
    @Headers('idempotency-key') key: Csrf,
  ) {
    const token = await this.#transport.write(request);
    const name = parseReviewAction(action);
    const reviewId = parseId(id);
    const input = parseModerationBody(body);
    const outcome = await this.feedback.reviewAction(name, token, csrf, reviewId, input, key, { requestId: request.requestId ?? randomUUID() });
    response.status(outcome.status);
    return { data: outcome.payload };
  }

  // ---- complaints --------------------------------------------------------------------------------------------------------------

  @Get('complaints')
  async complaints(@Query() query: unknown, @Req() request: AdminRequest) {
    const token = this.#transport.read(request);
    return { data: await this.feedback.listComplaints(token, parseComplaintQuery(query)) };
  }

  @Get('complaint-handlers')
  async handlers(@Query() query: unknown, @Req() request: AdminRequest) {
    const token = this.#transport.read(request);
    parseNoQuery(query);
    return { data: await this.feedback.handlers(token) };
  }

  @Get('complaints/:complaint_id')
  async complaint(@Param('complaint_id') id: string, @Query() query: unknown, @Req() request: AdminRequest) {
    const token = this.#transport.read(request);
    parseNoQuery(query);
    return { data: await this.feedback.complaintDetail(token, parseId(id)) };
  }

  @Get('complaints/:complaint_id/attachments/:attachment_id')
  async picture(@Param('complaint_id') id: string, @Param('attachment_id') attachmentId: string, @Query() query: unknown, @Req() request: AdminRequest, @Res({ passthrough: true }) response: Headers_) {
    const token = this.#transport.read(request);
    parseNoQuery(query);
    const picture = await this.feedback.complaintPicture(token, parseId(id), parseId(attachmentId));
    response.setHeader('Content-Type', picture.contentType);
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    return new StreamableFile(picture.data);
  }

  @Post('complaints/:complaint_id/actions/:action')
  @HttpCode(200)
  async complaintAction(
    @Param('complaint_id') id: string,
    @Param('action') action: string,
    @Body() body: unknown,
    @Req() request: AdminRequest,
    @Res({ passthrough: true }) response: StatusResponse,
    @Headers('x-csrf-token') csrf: Csrf,
    @Headers('idempotency-key') key: Csrf,
  ) {
    const token = await this.#transport.write(request);
    const name = parseComplaintAction(action);
    const complaintId = parseId(id);
    const input = parseComplaintActionBody(name, body);
    const outcome = await this.feedback.complaintAction(name, token, csrf, complaintId, input, key, { requestId: request.requestId ?? randomUUID() });
    response.status(outcome.status);
    return { data: outcome.payload };
  }
}
