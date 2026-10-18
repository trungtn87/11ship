import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { TransactionContext } from '../transaction/transaction-context';
import { NotificationApp, NotificationCategory } from './notification-constants';
import { NotificationConfig, NotificationRepository, SettingsRow } from './notification-repository';

export const settingFor = (settings: SettingsRow, category: NotificationCategory): boolean =>
  category === 'ORDERS' ? settings.orders : category === 'REMINDERS' ? settings.reminders : category === 'WALLET_PROFILE' ? settings.walletProfile : settings.available;

@Injectable()
export class NotificationPushQueue {
  constructor(private readonly repo: NotificationRepository) {}

  /** Always leaves ONE push row, so the Administration can see why nothing was sent (switched off, no device, not configured) instead of guessing. */
  async queue(context: TransactionContext, p: { config: NotificationConfig; notificationId: string; userId: string; app: NotificationApp; category: NotificationCategory; pushKey: string; ttlMs: number }): Promise<void> {
    const config = p.config;
    const base = { pushId: randomUUID(), notificationId: p.notificationId, recipientUserId: p.userId, app: p.app, pushKey: p.pushKey, expiresInMs: p.ttlMs };
    if (!config.pushEnabled) {
      await this.repo.insertPush(context, { ...base, tokenId: null, status: 'SKIPPED', skipReason: 'CHANNEL_OFF' });
      return;
    }
    const settings = await this.repo.readSettings(context, p.userId, p.app, config.defaultSound);
    if (!settingFor(settings, p.category)) {
      await this.repo.insertPush(context, { ...base, tokenId: null, status: 'SKIPPED', skipReason: 'SETTING_OFF' });
      return;
    }
    const token = (await this.repo.liveTokens(context, p.userId, p.app))[0];
    if (token === undefined) {
      await this.repo.insertPush(context, { ...base, tokenId: null, status: 'SKIPPED', skipReason: 'NO_TOKEN' });
      return;
    }
    await this.repo.insertPush(context, { ...base, tokenId: token.tokenId, status: 'PENDING', skipReason: null });
  }
}
