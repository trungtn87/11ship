import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { OutboxModule } from '../outbox/outbox.module';
import { ComplaintRepository } from './complaint-repository';
import { FeedbackRecorder } from './feedback-recorder';
import { ReviewRepository } from './review-repository';

/**
 * M11's own SQL (ratings, replies, moderations, complaints, thread, pictures, reconsiderations, adjustments) and the recorder that leaves the audit row and
 * the outbox event of every change. The apps' services and the Administration's services both build on it, so the SQL of the eleven tables lives in ONE
 * place. It imports only the audit and outbox participants: nothing imports it back, so the graph is acyclic.
 */
@Module({
  imports: [AuditModule, OutboxModule],
  providers: [ReviewRepository, ComplaintRepository, FeedbackRecorder],
  exports: [ReviewRepository, ComplaintRepository, FeedbackRecorder],
})
export class FeedbackReadModule {}
