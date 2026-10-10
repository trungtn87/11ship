import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { bindOtpProvider } from './auth/otp-provider-binding';
import { formatInvalidConfigMessage, loadConfig } from './config/app-config';
import { describeStartupFailure } from './config/startup-failure';
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

  // Fixed event name only: the logger's metadata whitelist deliberately has no TLS, host or path fields, so
  // nothing about the CA can reach a log line. Emitted only when strict TLS is active (always in staging).
  if (config.database.tls !== undefined) {
    logger.log('info', 'db_tls_verify_full');
  }

  // Auth Core needs an explicit OTP provider. bindOtpProvider refuses production, and staging unless the fixture
  // mode is on (then the explicit DisabledOtpProvider, never a fake), before anything is opened, naming only
  // OTP_PROVIDER.
  const otpProvider = bindOtpProvider(config.appEnv, { stagingFixtureMode: config.stagingFixtures !== undefined });

  // The database is NOT contacted here and migrations are NOT run on startup.
  // abortOnError: false lets a startup failure (for example a module that needs a missing keyring)
  // reach the catch below, which prints only variable names, instead of Nest exiting silently.
  const app = await NestFactory.create(AppModule.register({ config, logger, auth: { otpProvider } }), {
    logger: false,
    abortOnError: false,
  });

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
  process.stderr.write(`${describeStartupFailure(error)}\n`);
  process.exitCode = 1;
});
