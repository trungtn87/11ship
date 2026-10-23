import { Inject, Injectable } from '@nestjs/common';
import { AppError, TechnicalError } from '../common/app-errors';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { DEFAULT_OPS_CONFIG, OpsConfig } from '../config/ops-config';
import { CryptoError } from '../crypto/crypto-error';
import { Keyring } from '../crypto/keyring';
import { TransactionContext } from '../transaction/transaction-context';
import { DISCORD_WEBHOOK_HOSTS } from './ops-constants';
import { OpsRepository, OpsConfigRow, SealedWebhook } from './ops-repository';
import { OpsSettings, resolveSettings } from './ops-settings';

const WEBHOOK_LABEL = 'discord-webhook';

/** The effective M13 configuration of one moment: thresholds, retention and the Discord switch. The webhook itself is NOT in here (see OpsSettingsService.webhookUrl). */
export interface OpsEffective {
  readonly row: OpsConfigRow;
  readonly settings: OpsSettings;
  readonly discordEnabled: boolean;
  readonly discordMinSeverity: 'WARNING' | 'CRITICAL';
  /** A webhook is stored (its value is never exposed). */
  readonly webhookConfigured: boolean;
}

/** `https://discord.com/api/webhooks/<id>/<token>` and nothing else (no other host, no query, no credentials, no redirect target). */
export function isValidDiscordWebhook(raw: unknown): raw is string {
  if (typeof raw !== 'string' || raw.length < 40 || raw.length > 220) {
    return false;
  }
  try {
    const url = new URL(raw);
    return (
      url.protocol === 'https:' &&
      DISCORD_WEBHOOK_HOSTS.includes(url.hostname) &&
      url.port === '' &&
      url.username === '' &&
      url.password === '' &&
      url.search === '' &&
      url.hash === '' &&
      /^\/api\/(?:v\d+\/)?webhooks\/\d{5,25}\/[A-Za-z0-9_-]{20,100}$/.test(url.pathname)
    );
  } catch {
    return false;
  }
}

/**
 * Reads the M13 settings and handles the one secret M13 keeps: the Discord webhook. It is sealed (AES-256-GCM, its own keyring purpose) and only the sender ever
 * opens it, in memory, for one request; the Administration sees "configured / not configured" and when it changed, never the value.
 */
@Injectable()
export class OpsSettingsService {
  readonly #keyring: Keyring | undefined;
  readonly #config: OpsConfig;

  constructor(
    private readonly repo: OpsRepository,
    @Inject(APP_CONFIG) appConfig: AppConfig,
  ) {
    this.#keyring = appConfig.crypto;
    this.#config = appConfig.ops ?? DEFAULT_OPS_CONFIG;
  }

  get config(): OpsConfig {
    return this.#config;
  }

  async load(context: TransactionContext, lock = false): Promise<OpsEffective> {
    const row = await this.repo.readConfig(context, lock);
    return {
      row,
      settings: resolveSettings(row.overrides),
      discordEnabled: row.discordEnabled,
      discordMinSeverity: row.discordMinSeverity,
      webhookConfigured: row.webhook !== null,
    };
  }

  /** Seals a webhook for storage. Throws OPS_WEBHOOK_INVALID for anything but a Discord webhook URL, OPS_SECRET_UNAVAILABLE when the server has no keyring. */
  seal(url: string): SealedWebhook {
    if (!isValidDiscordWebhook(url)) {
      throw new AppError('OPS_WEBHOOK_INVALID');
    }
    if (this.#keyring === undefined) {
      throw new AppError('OPS_SECRET_UNAVAILABLE');
    }
    const version = this.#keyring.active();
    const plaintext = Buffer.from(url, 'utf8');
    try {
      const sealed = version.sealOpsSecret(WEBHOOK_LABEL, plaintext);
      return { ...sealed, keyId: version.id };
    } catch (error) {
      throw error instanceof CryptoError ? new TechnicalError('internal', 'Webhook could not be sealed') : error;
    } finally {
      plaintext.fill(0);
    }
  }

  /** The webhook URL in clear, for one send; undefined when none is stored or it cannot be opened (key removed): the caller then reports "not configured". */
  webhookUrl(row: OpsConfigRow): string | undefined {
    if (row.webhook === null || this.#keyring === undefined) {
      return undefined;
    }
    const version = this.#keyring.version(row.webhook.keyId);
    if (version === undefined) {
      return undefined;
    }
    try {
      const url = version.openOpsSecret(WEBHOOK_LABEL, row.webhook).toString('utf8');
      return isValidDiscordWebhook(url) ? url : undefined;
    } catch {
      return undefined;
    }
  }
}
