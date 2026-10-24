import { Body, Controller, Get, HttpCode, Param, Post, Query, Req, Res, StreamableFile, UseGuards } from '@nestjs/common';
import { OpsGatewayUpdate } from '../ops/ops-gateway-update';
import { SmsGatewayAuthGuard, GatewayRequest } from './sms-gateway-auth.guard';
import { parseAckBody, parseClaimBody, parseHeartbeatBody, parseJobId } from './sms-gateway-validation';
import { SmsQueueService } from './sms-queue-service';
import { AppError } from '../common/app-errors';

function deviceOf(request: GatewayRequest): string {
  if (request.gatewayDeviceId === undefined) {
    // Unreachable behind the guard; fail closed.
    throw new AppError('GATEWAY_UNAUTHORIZED');
  }
  return request.gatewayDeviceId;
}

/**
 * The gateway API (issue #102): /v1/sms-gateway/*. Every route needs the device credential. There is NO route that creates a
 * job or accepts a recipient or a text: jobs are born only inside the backend from a committed OTP challenge. Responses are
 * no-store (the claim carries the message).
 */
@Controller('sms-gateway')
@UseGuards(SmsGatewayAuthGuard)
export class SmsGatewayController {
  constructor(
    private readonly queue: SmsQueueService,
    private readonly updates: OpsGatewayUpdate,
  ) {}

  @Post('heartbeat')
  @HttpCode(200)
  async heartbeat(@Body() body: unknown, @Req() request: GatewayRequest) {
    const result = await this.queue.heartbeat(deviceOf(request), parseHeartbeatBody(body));
    return { data: { sending_enabled: result.sendingEnabled, poll_seconds: result.pollSeconds, ...(result.update === null ? {} : { update: result.update }) } };
  }

  @Post('jobs/claim')
  @HttpCode(200)
  async claim(@Body() body: unknown, @Req() request: GatewayRequest) {
    const result = await this.queue.claim(deviceOf(request), parseClaimBody(body));
    return {
      data: {
        sending_enabled: result.sendingEnabled,
        job:
          result.message === undefined
            ? null
            : {
                job_id: result.message.jobId,
                attempt_id: result.message.attemptId,
                to: result.message.to,
                text: result.message.text,
                lease_seconds: result.message.leaseSeconds,
                expires_at: result.message.expiresAt,
              },
      },
    };
  }

  @Post('jobs/:jobId/ack')
  @HttpCode(200)
  async acknowledge(@Param('jobId') jobId: string, @Body() body: unknown, @Req() request: GatewayRequest) {
    const input = parseAckBody(body);
    const result = await this.queue.acknowledge(deviceOf(request), parseJobId(jobId), input);
    return { data: { status: result.status } };
  }

  /**
   * The gateway's own update file (M13). Only the device credential opens it, only a PUBLISHED GATEWAY release by its id, and only while the server itself reads the
   * phone as idle with nothing unreported (`paused=true` is sent by the phone that stopped taking work): never while a message is being sent.
   */
  @Get('update/:releaseId')
  async update(@Param('releaseId') releaseId: string, @Query('paused') paused: string | undefined, @Req() request: GatewayRequest, @Res({ passthrough: true }) response: { setHeader(name: string, value: string | number): unknown }): Promise<StreamableFile> {
    const file = await this.updates.open(deviceOf(request), parseJobId(releaseId), paused === 'true' ? true : null);
    response.setHeader('Content-Type', 'application/vnd.android.package-archive');
    response.setHeader('Content-Length', file.sizeBytes);
    response.setHeader('X-Checksum-SHA256', file.sha256);
    response.setHeader('Cache-Control', 'no-store');
    return new StreamableFile(file.stream);
  }
}
