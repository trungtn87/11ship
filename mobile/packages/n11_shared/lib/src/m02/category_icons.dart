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

/// The chip icon for one group: its own icon by id, else the fallback. Never derived from the name or the order.
IconData categoryIconFor(String categoryId) => kCategoryIcons[categoryId] ?? kCategoryFallbackIcon;

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
