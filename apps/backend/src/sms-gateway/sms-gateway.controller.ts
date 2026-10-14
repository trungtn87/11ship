import { Body, Controller, HttpCode, Param, Post, Req, UseGuards } from '@nestjs/common';
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
  constructor(private readonly queue: SmsQueueService) {}

  @Post('heartbeat')
  @HttpCode(200)
  async heartbeat(@Body() body: unknown, @Req() request: GatewayRequest) {
    const result = await this.queue.heartbeat(deviceOf(request), parseHeartbeatBody(body));
    return { data: { sending_enabled: result.sendingEnabled, poll_seconds: result.pollSeconds } };
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
}
