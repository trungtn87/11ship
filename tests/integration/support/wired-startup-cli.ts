import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../../apps/backend/src/app.module';
import { formatInvalidConfigMessage, loadConfig } from '../../../apps/backend/src/config/app-config';
import { describeStartupFailure } from '../../../apps/backend/src/config/startup-failure';
import { IdempotencyModule } from '../../../apps/backend/src/idempotency/idempotency.module';
import { JsonLogger } from '../../../apps/backend/src/logging/json-logger';

// Stand-in for the module graph M01 will have: the real AppModule plus a module that imports
// IdempotencyModule. It runs the same startup path as main.ts (config parsed first, abortOnError
// false, only variable names printed) but never listens and never contacts the database.
async function bootstrap(): Promise<void> {
  const result = loadConfig(process.env);
  if (!result.ok) {
    process.stderr.write(`${formatInvalidConfigMessage(result.invalid)}\n`);
    process.exitCode = 1;
    return;
  }

  @Module({ imports: [AppModule.register({ config: result.config, logger: new JsonLogger(() => undefined) }), IdempotencyModule] })
  class WiredModule {}

  const context = await NestFactory.createApplicationContext(WiredModule, {
    logger: false,
    abortOnError: false,
  });
  process.stdout.write('WIRED_STARTUP_OK\n');
  await context.close();
}

bootstrap().catch((error: unknown) => {
  process.stderr.write(`${describeStartupFailure(error)}\n`);
  process.exitCode = 1;
});
