import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:n11_shared/src/m02/category_icons.dart';

// Issue #386: each 11Food category has its own icon, keyed by category_id. The 14 ids are the live inventory (GET /v1/menu-categories).

const Map<String, String> kInventory = <String, String>{
  '97d3dfad-cff8-44fd-93c1-ead32f32a4ee': 'Nước giải khát',
  'bd3093f5-73a3-4c9f-99c8-3982fe871be6': 'Trà – Cà phê – Trà sữa',
  'a49b2dbc-034c-4e6c-9e99-5040c32574ca': 'Đồ ăn nhanh',
  '52a8e959-0129-492e-8e43-1c16ebd6dfec': 'Ốc – Hải sản',
  '6efe4dba-9dba-4a37-a4ac-6eca8ba2b40e': 'Phở – Bún – Mì – Miến',
  '0ef4e7ec-78c0-4c0b-9366-69493be4e992': 'Lẩu – Nướng',
  'd931263d-f2c2-48f2-99a8-077914ab3d88': 'Ăn vặt',
  'da8da449-066d-4c47-9e87-0d9d31dceec6': 'Bánh ngọt – Tráng miệng',
  'ff83e30f-4b63-439a-b10f-392fcfd66b49': 'Món ăn – Đồ nhậu',
  '216ec5ac-6901-4de7-bdfe-3b2d9b3b6c86': 'Healthy',
  'e48bc7e3-5413-4cb6-8a44-4a2034a5b5b3': 'Bánh cuốn – Bánh mì – Xôi',
  '0adeb166-595e-4de8-a094-74897d0e2042': 'Cháo – Súp',
  '0513fb86-e6dc-4e9b-9307-684e8b24fcbd': 'Cơm',
  '3e0f2d3c-1d91-492e-b626-d6ce994a413f': 'Bia – Đồ uống có cồn',
};

void main() {
  test('every live category has its own icon (no group falls back)', () {
    expect(unmappedCategoryIds(kInventory.keys), isEmpty);
    for (final String id in kInventory.keys) {
      expect(kCategoryIcons[id], isNotNull, reason: kInventory[id]);
    }
  });

  test('the groups the issue names are told apart: drinks, coffee/milk tea, food', () {
    IconData icon(String name) => categoryIconFor(kInventory.entries.firstWhere((MapEntry<String, String> e) => e.value == name).key);
    final IconData soft = icon('Nước giải khát');
    final IconData coffee = icon('Trà – Cà phê – Trà sữa');
    final IconData fastFood = icon('Đồ ăn nhanh');
    expect(soft, isNot(coffee));
    expect(soft, isNot(fastFood));
    expect(coffee, isNot(fastFood));
  });

  test('no two groups share one icon, and none is the generic restaurant icon', () {
    final List<IconData> icons = <IconData>[for (final String id in kInventory.keys) categoryIconFor(id)];
    expect(icons.toSet().length, icons.length, reason: 'two groups share an icon');
    expect(icons, isNot(contains(kCategoryFallbackIcon)));
    expect(icons, isNot(contains(kCategoryAllIcon)));
  });

  test('an unknown or new group gets the safe fallback and is reported as unmapped', () {
    const String newGroup = '11111111-2222-4333-8444-555555555555';
    expect(categoryIconFor(newGroup), kCategoryFallbackIcon);
    expect(unmappedCategoryIds(<String>[...kInventory.keys, newGroup]), <String>[newGroup]);
  });

  test('the mapping is by id, not by display name or position', () {
    // The same name under a different id (a re-created group) must not inherit the old icon.
    expect(categoryIconFor('not-an-inventory-id'), kCategoryFallbackIcon);
    expect(kCategoryIcons.containsKey('Nước giải khát'), isFalse);
  });

  test('"Tất cả" keeps the grid icon', () {
    expect(kCategoryAllIcon, Icons.grid_view_rounded);
  });
}
