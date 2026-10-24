import { readdirSync } from 'node:fs';
import { describe, expect, it } from '@jest/globals';
import { codeOf, sourcePath } from '../shared/source-scan.fixture';

// Structural facts of Menu (M02): who may touch which tables, proven on the code with comments removed.

function productionFiles(): string[] {
  return readdirSync(sourcePath('.'), { recursive: true, encoding: 'utf8' })
    .map((name) => name.replace(/\\/g, '/'))
    .filter((name) => name.endsWith('.ts') && !name.endsWith('.spec.ts') && !name.endsWith('.fixture.ts'));
}

describe('Menu module boundary', () => {
  it('only the Menu module issues SQL against its tables (menu_categories, menu_images, menu_items) and the fold function', () => {
    const outside = productionFiles()
      .filter((name) => !name.startsWith('menu/'))
      // M03: the Shipper search compares names the same way (accent-insensitive); it only CALLS the function, it reads none of the menu tables.
      .filter((name) => name !== 'driver/driver-admin-query-repository.ts')
      // M02 shop management: the administration's read-only projection of a shop's dishes (list, menu tab, customer preview); it writes nothing.
      .filter((name) => name !== 'admin-shops/admin-shop-read-repository.ts')
      .filter((name) => /app\.(menu_categories|menu_images|menu_items|fold_vi)\b/.test(codeOf(name)));
    expect(outside).toEqual([]);
  });

  it('the Menu module never reads a Shop table: shops, areas and schedules come from the Shop module ports', () => {
    const inside = productionFiles()
      .filter((name) => name.startsWith('menu/'))
      .filter((name) => /app\.(shops|shop_members|service_areas|shop_business_hours)\b/.test(codeOf(name)));
    expect(inside).toEqual([]);
  });

  it('no dish or picture statement interpolates a value into SQL', () => {
    for (const file of ['menu/menu-repository.ts', 'menu/discovery-service.ts']) {
      const interpolations = codeOf(file).match(/\$\{[^}]*\}/g) ?? [];
      // The only fragment is the fixed column list and the fixed assignment list chosen by code, never client input.
      expect([file, interpolations.filter((i) => i !== '${ITEM_COLUMNS}' && i !== '${assignments}' && i !== '${extraWhere}')]).toEqual([file, []]);
    }
  });

  it('no route of the Menu module accepts a shop id or user id from the client for a write', () => {
    const controller = codeOf('menu/menu.controller.ts');
    const writes = controller.match(/@(Post|Put)\([^)]*\)/g) ?? [];
    expect(writes.filter((w) => /shop|user/i.test(w))).toEqual([]);
  });

  it('the public discovery routes never use a session guard or a device proof', () => {
    const controller = codeOf('menu/menu.controller.ts');
    const publicPart = controller.slice(controller.indexOf('export class MenuPublicController'));
    expect(publicPart).not.toMatch(/UseGuards|SessionAuthGuard|request\.auth/);
  });
});
