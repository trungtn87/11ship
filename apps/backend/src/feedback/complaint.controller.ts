import { randomUUID } from 'node:crypto';
import { Body, Controller, Get, Headers, HttpCode, Param, Post, Query, Req, Res, StreamableFile, UseGuards } from '@nestjs/common';
import { AuthenticatedRequest, AuthPrincipal } from '../auth/auth-principal';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { AppError } from '../common/app-errors';
import { rejectBodyAndQuery } from '../customer-profile/customer-profile-validation';
import { ComplaintService } from './complaint-service';
import { PartyRole } from './feedback-constants';
import { parseAttachmentUpload, parseComplaintListQuery, parseCreateComplaintBody, parseReconsiderBody, parseSupplementBody, parseUuid } from './feedback-validation';

type Key = string | string[] | undefined;
type Headers_ = { setHeader(name: string, value: string): unknown; status(code: number): unknown };

const requestIdOf = (request: { requestId?: string }): string => request.requestId ?? randomUUID();

function principalOf(request: AuthenticatedRequest): AuthPrincipal {
  if (request.auth === undefined) {
    throw new AppError('SESSION_INVALID');
  }
  return request.auth;
}

/**
 * The role of the route family. It is read from the PATH the request came in on (customers/me, shop/me, driver); it grants nothing by itself: the service
 * re-authorizes the caller as exactly that role under the locks, so a customer session on the shop routes is refused there.
 */
function roleOf(request: AuthenticatedRequest): PartyRole {
  const url = request.originalUrl ?? '';
  if (/\/customers\/me\/complaints(\/|\?|$)/.test(url)) {
    return 'CUSTOMER';
  }
  if (/\/shop\/me\/complaints(\/|\?|$)/.test(url)) {
    return 'SHOP';
  }
  if (/\/driver\/complaints(\/|\?|$)/.test(url)) {
    return 'SHIPPER';
  }
  throw new AppError('COMPLAINT_FORBIDDEN');
}

const FAMILIES = ['customers/me/complaints', 'shop/me/complaints', 'driver/complaints'];
const paths = (suffix: string): string[] => FAMILIES.map((family) => (suffix === '' ? family : `${family}/${suffix}`));

/**
 * Complaints for the three apps (M11.02): the same six routes under /customers/me/complaints, /shop/me/complaints and /driver/complaints. Identity is the
 * principal; the only identifiers in a path are the complaint and the picture, both resolved against what the caller may read. Every write takes an
 * Idempotency-Key (the picture upload is the one exception, like the menu pictures: a repeat only adds one unattached picture, bounded per account).
 */
@UseGuards(SessionAuthGuard)
@Controller()
export class ComplaintController {
  constructor(private readonly complaints: ComplaintService) {}

  @Post(paths('attachments'))
  @HttpCode(201)
  async upload(@Body() body: unknown, @Req() request: AuthenticatedRequest) {
    return { data: await this.complaints.upload(principalOf(request), roleOf(request), parseAttachmentUpload(body)) };
  }

  @Get(paths('attachments/:attachment_id'))
  async picture(@Param('attachment_id') id: string, @Req() request: AuthenticatedRequest, @Query() query: unknown, @Res({ passthrough: true }) response: Headers_) {
    rejectBodyAndQuery(request, query);
    const picture = await this.complaints.readAttachment(principalOf(request), roleOf(request), parseUuid(id));
    response.setHeader('Content-Type', picture.contentType);
    // Evidence is private: never shared by a cache, never sniffed, never run as a page.
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    return new StreamableFile(picture.data);
  }

  @Post(paths(''))
  async create(@Body() body: unknown, @Headers('idempotency-key') key: Key, @Req() request: AuthenticatedRequest, @Res({ passthrough: true }) response: Headers_) {
    const outcome = await this.complaints.create(principalOf(request), roleOf(request), parseCreateComplaintBody(body), key, requestIdOf(request));
    response.status(outcome.status);
    return { data: outcome.payload };
  }

  @Get(paths(''))
  async list(@Req() request: AuthenticatedRequest, @Query() query: unknown) {
    return { data: await this.complaints.list(principalOf(request), roleOf(request), parseComplaintListQuery(query)) };
  }

  @Get(paths(':complaint_id'))
  async read(@Param('complaint_id') id: string, @Req() request: AuthenticatedRequest, @Query() query: unknown) {
    rejectBodyAndQuery(request, query);
    return { data: await this.complaints.read(principalOf(request), roleOf(request), parseUuid(id)) };
  }

  @Post(paths(':complaint_id/supplement'))
  @HttpCode(200)
  async supplement(@Param('complaint_id') id: string, @Body() body: unknown, @Headers('idempotency-key') key: Key, @Req() request: AuthenticatedRequest) {
    const outcome = await this.complaints.supplement(principalOf(request), roleOf(request), parseUuid(id), parseSupplementBody(body), key, requestIdOf(request));
    return { data: outcome.payload };
  }

  @Post(paths(':complaint_id/reconsideration'))
  @HttpCode(200)
  async reconsider(@Param('complaint_id') id: string, @Body() body: unknown, @Headers('idempotency-key') key: Key, @Req() request: AuthenticatedRequest) {
    const outcome = await this.complaints.requestReconsideration(principalOf(request), roleOf(request), parseUuid(id), parseReconsiderBody(body), key, requestIdOf(request));
    return { data: outcome.payload };
  }
}
