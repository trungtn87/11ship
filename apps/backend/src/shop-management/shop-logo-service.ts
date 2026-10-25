import { Injectable } from '@nestjs/common';
import { AppError } from '../common/app-errors';
import { isCanonicalUuid } from '../shared/identifiers';
import { ShopSetupGate } from '../shop-setup/shop-setup-gate';
import { ShopAvailabilityReader } from '../shop/shop-availability-reader';
import { TransactionManager } from '../transaction/transaction-manager';

/** Public read only; saving a logo still runs through the authenticated, versioned profile command. */
@Injectable()
export class ShopLogoService {
  constructor(
    private readonly transactions: TransactionManager,
    private readonly reader: ShopAvailabilityReader,
    private readonly gate: ShopSetupGate,
  ) {}

  /** The logo of a shop customers may see (issue #190: not of a shop that is not set up or is locked; the answer is the same "not found"). */
  async read(shopId: string) {
    if (!isCanonicalUuid(shopId)) throw new AppError('SHOP_NOT_FOUND');
    const logo = await this.transactions.withTransaction(async (context) => {
      const snapshot = await this.reader.snapshotOfShop(context, shopId);
      if (snapshot?.logo == null) return undefined;
      return (await this.gate.evaluate(context, snapshot)).publicVisible ? snapshot.logo : undefined;
    });
    if (logo === undefined) throw new AppError('SHOP_NOT_FOUND');
    return logo;
  }
}
