import { Injectable } from '@nestjs/common';
import { AppError } from '../common/app-errors';
import { isCanonicalUuid } from '../shared/identifiers';
import { ShopRepository } from '../shop/shop-repository';
import { TransactionManager } from '../transaction/transaction-manager';

/** Public read only; saving a logo still runs through the authenticated, versioned profile command. */
@Injectable()
export class ShopLogoService {
  constructor(private readonly transactions: TransactionManager, private readonly shops: ShopRepository) {}

  async read(shopId: string) {
    if (!isCanonicalUuid(shopId)) throw new AppError('SHOP_NOT_FOUND');
    const logo = await this.transactions.withTransaction((context) => this.shops.publicLogo(context, shopId));
    if (logo === undefined) throw new AppError('SHOP_NOT_FOUND');
    return logo;
  }
}
