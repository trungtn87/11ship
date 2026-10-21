import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { bindActivationOtpProvider } from './admin-activation/activation-otp-providers';
import { bindOtpProvider } from './auth/otp-provider-binding';
import { formatInvalidConfigMessage, loadConfig } from './config/app-config';
import { describeStartupFailure } from './config/startup-failure';
import { installAdminWebHosting } from './http/admin-web-hosting';
import { JsonLogger } from './logging/json-logger';
import { createTestSmsRuntime } from './test-sms/test-sms-runtime';

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
  const logger = new JsonLogger(undefined, process.env.M13_ERROR_LOG_PATH);

  // Fixed event name only: the logger's metadata whitelist deliberately has no TLS, host or path fields, so
  // nothing about the CA can reach a log line. Emitted only when strict TLS is active (always in staging).
  if (config.database.tls !== undefined) {
    logger.log('info', 'db_tls_verify_full');
  }

  // The test SMS inbox (M01.22) exists ONLY when TEST_INBOX was selected explicitly and loadConfig accepted it
  // (development/test, loopback API host and database). Creating the runtime opens nothing yet: the private listener
  // and its discovery state start below, after the application graph is built and before the API listens.
  const testSms =
    config.testInbox === undefined
      ? undefined
      : createTestSmsRuntime({
          config: config.testInbox,
          appEnv: config.appEnv,
          host: config.host,
          databaseUrl: config.database.url,
        });

  // Auth Core needs an explicit OTP provider. bindOtpProvider refuses production, and staging unless the fixture
  // mode is on (then the explicit DisabledOtpProvider, never a fake), before anything is opened, naming only
  // OTP_PROVIDER.
  const otpProvider = bindOtpProvider(config.appEnv, {
    // Issue #102: the real SMS adapter, only when SMS_GATEWAY_ENABLED=true was validated (off by default).
    smsGatewayEnabled: config.smsGateway !== undefined,
    stagingFixtureMode: config.stagingFixtures !== undefined,
    ...(testSms?.registerProvider === undefined ? {} : { testInboxProvider: testSms.registerProvider }),
  });

  // The activation OTP provider is bound the same way: explicitly, from ADMIN_ACTIVATION_OTP_MODE, with no fallback. SMS has
  // no adapter yet, so that mode refuses startup (naming only the variable) before anything is opened. With the local test
  // contract ADMIN_ACTIVATION_PHONE_VERIFICATION_MODE=DISABLED_TEST the activation has no OTP step: no provider is bound.
  const activationOtpProvider =
    config.adminActivation === undefined || config.adminActivation.phoneVerificationMode === 'DISABLED_TEST'
      ? undefined
      : bindActivationOtpProvider(config.adminActivation, {
          smsGatewayEnabled: config.smsGateway !== undefined,
          ...(testSms?.activationProvider === undefined ? {} : { testInboxProvider: testSms.activationProvider }),
        });

  // The database is NOT contacted here and migrations are NOT run on startup.
  // abortOnError: false lets a startup failure (for example a module that needs a missing keyring)
  // reach the catch below, which prints only variable names, instead of Nest exiting silently.
  const app = await NestFactory.create(
    AppModule.register({
      config,
      logger,
      auth: { otpProvider },
      ...(activationOtpProvider === undefined ? {} : { activationOtpProvider }),
      ...(testSms === undefined ? {} : { testSms }),
    }),
    {
      logger: false,
      abortOnError: false,
    },
  );

  try {
    configureApp(app);
    // Same-origin hosting of the administration web (ADMIN_WEB_STAGING_ENABLED=true on staging, validated by
    // loadConfig). Installed BEFORE the application initializes (app.listen), so it sits in front of the body parser.
    if (config.adminWebHosting !== undefined) {
      installAdminWebHosting(app, { appEnv: config.appEnv });
    }
    // The private test SMS listener and its discovery state (M01.22) open BEFORE the API listens, so "listening" is
    // never reported with the test inbox half-started. A failure there stops startup with a fixed code.
    await testSms?.start();
    // SIGTERM/SIGINT close the HTTP server first, then the database pool.
    app.enableShutdownHooks();
    await app.listen(config.port, config.host);
    logger.log('info', 'server_listening', { port: config.port });
  } catch (error) {
    await testSms?.stop();
    await app.close().catch(() => undefined);
    throw error;
  }
}

bootstrap().catch((error: unknown) => {
  process.stderr.write(`${describeStartupFailure(error)}\n`);
  process.exitCode = 1;
});
