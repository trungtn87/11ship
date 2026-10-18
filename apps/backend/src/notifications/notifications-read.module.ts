import { Module } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { NotificationRepository } from './notification-repository';
import { FcmPushProvider, PUSH_PROVIDER, UnconfiguredPushProvider } from './push-provider';

/**
 * M08's own SQL and the ONE push provider (the real FCM client when the operator configured it, an explicit "not configured"
 * provider otherwise: every push is then recorded as skipped, never as sent). It imports nothing, so the Administration uses the same instances as the
 * worker without a second worker or a second credential cache.
 */
@Module({
  providers: [
    NotificationRepository,
    { provide: PUSH_PROVIDER, inject: [APP_CONFIG], useFactory: (config: AppConfig) => (config.push === undefined ? new UnconfiguredPushProvider() : new FcmPushProvider(config.push)) },
  ],
  exports: [NotificationRepository, PUSH_PROVIDER],
})
export class NotificationsReadModule {}
