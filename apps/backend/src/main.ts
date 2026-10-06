import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { safeErrorCode } from './common/safe-error';
import { formatInvalidConfigMessage, loadConfig } from './config/app-config';
import { JsonLogger } from './logging/json-logger';

async function bootstrap(): Promise<void> {
  const result = loadConfig(process.env);
  if (!result.ok) {
    // Names of the bad variables only; values are never printed. Nothing has been opened yet,
    // so setting the exit code lets the process end by itself with a nonzero status.
    process.stderr.write(`${formatInvalidConfigMessage(result.invalid)}\n`);
    process.exitCode = 1;
    return;
  }

  const { config } = result;
  const logger = new JsonLogger();

  // The database is NOT contacted here and migrations are NOT run on startup.
  const app = await NestFactory.create(AppModule.register({ config, logger }), { logger: false });

  try {
    configureApp(app);
    // SIGTERM/SIGINT close the HTTP server first, then the database pool.
    app.enableShutdownHooks();
    await app.listen(config.port, config.host);
    logger.log('info', 'server_listening', { port: config.port });
  } catch (error) {
    await app.close().catch(() => undefined);
    throw error;
  }
}

bootstrap().catch((error: unknown) => {
  process.stderr.write(`Startup failed (${safeErrorCode(error)}).\n`);
  process.exitCode = 1;
});
