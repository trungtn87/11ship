import { TechnicalError, AppError } from '../common/app-errors';
import { ShopRow } from './shop-repository';

/** ACTIVE passes; DISABLED and INCOMPLETE are refused with their own codes; anything else is a broken invariant. */
export function requireActiveShop(shop: ShopRow): void {
  switch (shop.status) {
    case 'ACTIVE':
      return;
    case 'DISABLED':
      throw new AppError('SHOP_DISABLED');
    case 'INCOMPLETE':
      throw new AppError('SHOP_PROFILE_INCOMPLETE');
    default:
      throw new TechnicalError('internal', 'Unexpected shop status');
  }
}
