import { Module } from '@nestjs/common';
import { OutboxWriter } from './outbox-writer';

// Not imported by AppModule in M00-C1B: there is no production consumer yet. The writer needs nothing
// from the database layer (it receives a TransactionContext per call), so this module has no imports
// and cannot form a cycle with TransactionModule. The dispatcher belongs to M00-C1C.
@Module({
  providers: [
    {
      provide: OutboxWriter,
      useFactory: () => new OutboxWriter(),
    },
  ],
  exports: [OutboxWriter],
})
export class OutboxModule {}
