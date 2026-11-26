import 'package:flutter/material.dart';

// Issue #386: one icon per menu group on the 11Food home chips. The key is the stable category_id from GET /v1/menu-categories, never the
// displayed name and never the position in the list. Groups the map does not know yet use [kCategoryFallbackIcon] and are reported by
// [unmappedCategoryIds], so a new server group is visible in tests before it ships without its own icon.
//
// Inventory (VPS, 2026-11-18, GET /v1/menu-categories): 14 groups. The icons are Material rounded icons (one unified style), not Figma
// assets: Figma node 6:2 was not readable from this workspace (see the PR). Owner to confirm the set.

/// The chip icon of "Tất cả" (all groups) and of any group without its own icon.
const IconData kCategoryAllIcon = Icons.grid_view_rounded;
const IconData kCategoryFallbackIcon = Icons.restaurant_menu_rounded;

/// category_id -> icon. Keep ids exact; a rename on the server does not change the id, so the icon survives it.
const Map<String, IconData> kCategoryIcons = <String, IconData>{
  '97d3dfad-cff8-44fd-93c1-ead32f32a4ee': Icons.local_drink_rounded, // Nước giải khát
  'bd3093f5-73a3-4c9f-99c8-3982fe871be6': Icons.local_cafe_rounded, // Trà – Cà phê – Trà sữa
  'a49b2dbc-034c-4e6c-9e99-5040c32574ca': Icons.fastfood_rounded, // Đồ ăn nhanh
  '52a8e959-0129-492e-8e43-1c16ebd6dfec': Icons.set_meal_rounded, // Ốc – Hải sản
  '6efe4dba-9dba-4a37-a4ac-6eca8ba2b40e': Icons.ramen_dining_rounded, // Phở – Bún – Mì – Miến
  '0ef4e7ec-78c0-4c0b-9366-69493be4e992': Icons.outdoor_grill_rounded, // Lẩu – Nướng
  'd931263d-f2c2-48f2-99a8-077914ab3d88': Icons.cookie_rounded, // Ăn vặt
  'da8da449-066d-4c47-9e87-0d9d31dceec6': Icons.cake_rounded, // Bánh ngọt – Tráng miệng
  'ff83e30f-4b63-439a-b10f-392fcfd66b49': Icons.sports_bar_rounded, // Món ăn – Đồ nhậu
  '216ec5ac-6901-4de7-bdfe-3b2d9b3b6c86': Icons.eco_rounded, // Healthy
  'e48bc7e3-5413-4cb6-8a44-4a2034a5b5b3': Icons.bakery_dining_rounded, // Bánh cuốn – Bánh mì – Xôi
  '0adeb166-595e-4de8-a094-74897d0e2042': Icons.soup_kitchen_rounded, // Cháo – Súp
  '0513fb86-e6dc-4e9b-9307-684e8b24fcbd': Icons.rice_bowl_rounded, // Cơm
  '3e0f2d3c-1d91-492e-b626-d6ce994a413f': Icons.liquor_rounded, // Bia – Đồ uống có cồn
};

/// The chip icon for one group: its own icon by id, else by normalized [name] if supplied, else the fallback.
IconData categoryIconFor(String categoryId, {String? name}) {
  final IconData? byId = kCategoryIcons[categoryId];
  if (byId != null) return byId;
  if (name == null || name.trim().isEmpty) return kCategoryFallbackIcon;
  final String lower = name.toLowerCase();
  if (lower.contains('ốc') || lower.contains('oc') || lower.contains('hải sản') || lower.contains('hai san')) {
    return Icons.set_meal_rounded;
  }
  if (lower.contains('trà') || lower.contains('tra') || lower.contains('cà phê') || lower.contains('ca phe')) {
    return Icons.local_cafe_rounded;
  }
  if (lower.contains('đồ uống') || lower.contains('do uong') || lower.contains('nước') || lower.contains('nuoc') || lower.contains('giải khát')) {
    return Icons.local_drink_rounded;
  }
  if (lower.contains('đồ ăn nhanh') || lower.contains('do an nhanh') || lower.contains('fast') || lower.contains('burger') || lower.contains('gà rán')) {
    return Icons.fastfood_rounded;
  }
  if (lower.contains('phở') || lower.contains('pho') || lower.contains('bún') || lower.contains('bun') || lower.contains('mì') || lower.contains('miến')) {
    return Icons.ramen_dining_rounded;
  }
  if (lower.contains('cơm') || lower.contains('com')) {
    return Icons.rice_bowl_rounded;
  }
  if (lower.contains('lẩu') || lower.contains('lau') || lower.contains('nướng') || lower.contains('nuong')) {
    return Icons.outdoor_grill_rounded;
  }
  if (lower.contains('ăn vặt') || lower.contains('an vat')) {
    return Icons.cookie_rounded;
  }
  if (lower.contains('bánh ngọt') || lower.contains('tráng miệng') || lower.contains('kem')) {
    return Icons.cake_rounded;
  }
  if (lower.contains('bánh') || lower.contains('banh') || lower.contains('xôi') || lower.contains('xoi')) {
    return Icons.bakery_dining_rounded;
  }
  if (lower.contains('cháo') || lower.contains('chao') || lower.contains('súp') || lower.contains('sup')) {
    return Icons.soup_kitchen_rounded;
  }
  if (lower.contains('healthy') || lower.contains('salad')) {
    return Icons.eco_rounded;
  }
  return kCategoryFallbackIcon;
}

/// Warm flat icon color palette (yellow - orange - warm brown) per category.
const Map<String, Color> kCategoryIconColors = <String, Color>{
  '97d3dfad-cff8-44fd-93c1-ead32f32a4ee': Color(0xFFE07A00), // Nước giải khát
  'bd3093f5-73a3-4c9f-99c8-3982fe871be6': Color(0xFFA65300), // Trà – Cà phê – Trà sữa
  'a49b2dbc-034c-4e6c-9e99-5040c32574ca': Color(0xFFED6A00), // Đồ ăn nhanh
  '52a8e959-0129-492e-8e43-1c16ebd6dfec': Color(0xFFC2410C), // Ốc – Hải sản
  '6efe4dba-9dba-4a37-a4ac-6eca8ba2b40e': Color(0xFFD97706), // Phở – Bún – Mì – Miến
  '0ef4e7ec-78c0-4c0b-9366-69493be4e992': Color(0xFFB45309), // Lẩu – Nướng
  'd931263d-f2c2-48f2-99a8-077914ab3d88': Color(0xFFE07A00), // Ăn vặt
  'da8da449-066d-4c47-9e87-0d9d31dceec6': Color(0xFFED6A00), // Bánh ngọt – Tráng miệng
  'ff83e30f-4b63-439a-b10f-392fcfd66b49': Color(0xFFB45309), // Món ăn – Đồ nhậu
  '216ec5ac-6901-4de7-bdfe-3b2d9b3b6c86': Color(0xFFD97706), // Healthy
  'e48bc7e3-5413-4cb6-8a44-4a2034a5b5b3': Color(0xFFA65300), // Bánh cuốn – Bánh mì – Xôi
  '0adeb166-595e-4de8-a094-74897d0e2042': Color(0xFFC2410C), // Cháo – Súp
  '0513fb86-e6dc-4e9b-9307-684e8b24fcbd': Color(0xFFD97706), // Cơm
  '3e0f2d3c-1d91-492e-b626-d6ce994a413f': Color(0xFFA65300), // Bia – Đồ uống có cồn
};

/// Warm flat foreground tint for one category icon (defaults to warm orange).
Color categoryIconColorFor(String? categoryId, {String? name}) {
  if (categoryId == null) return const Color(0xFFED6A00);
  final Color? byId = kCategoryIconColors[categoryId];
  if (byId != null) return byId;
  if (name != null) {
    final String lower = name.toLowerCase();
    if (lower.contains('ốc') || lower.contains('hải sản')) return const Color(0xFFC2410C);
    if (lower.contains('trà') || lower.contains('cà phê')) return const Color(0xFFA65300);
    if (lower.contains('đồ uống') || lower.contains('nước')) return const Color(0xFFE07A00);
    if (lower.contains('cơm') || lower.contains('bún') || lower.contains('phở')) return const Color(0xFFD97706);
    if (lower.contains('lẩu') || lower.contains('nướng')) return const Color(0xFFB45309);
  }
  return const Color(0xFFED6A00);
}

/// Soft warm badge tint behind one category icon.
Color categoryIconBgFor(String? categoryId) =>
    categoryId == null ? const Color(0xFFFFF3CC) : const Color(0xFFFFF4DC);

/// The ids of the given groups that have no icon of their own (for tests and for the report of what still needs an icon).
List<String> unmappedCategoryIds(Iterable<String> categoryIds) =>
    <String>[for (final String id in categoryIds) if (!kCategoryIcons.containsKey(id)) id];

/// Default placeholder icon for dishes without a photo, matching drink categories.
IconData dishPlaceholderIconForCategory(String categoryName) {
  final String lower = categoryName.toLowerCase();
  if (lower.contains('cà phê') || lower.contains('ca phe') || lower.contains('trà') || lower.contains('tra')) {
    return Icons.local_cafe_rounded;
  }
  if (lower.contains('đồ uống') ||
      lower.contains('do uong') ||
      lower.contains('nước') ||
      lower.contains('nuoc') ||
      lower.contains('giải khát') ||
      lower.contains('sinh tố') ||
      lower.contains('bia')) {
    return Icons.local_drink_rounded;
  }
  return Icons.restaurant;
}
