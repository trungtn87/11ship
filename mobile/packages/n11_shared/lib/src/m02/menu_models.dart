import 'package:flutter/foundation.dart';

import 'schedule.dart';
import 'shop_contact.dart';

// M02-MON / M02-XEM: what the menu and customer screens show, and the PORTS they read and write through.
//
// The menu / catalog / picture / public-shop endpoints do not exist on the server yet (they are a separate functional task), so the
// screens are built against these ports and the production build binds [UnwiredMenuApi] / [UnwiredPublicShopApi], which say so
// honestly. Nothing here fabricates a dish, a group or a picture: a screen shows only what a port returned. When the endpoints exist,
// one class implementing each port connects every screen without changing them.

/// Thrown by the unwired ports: the server side of this feature is not connected in this build.
class FeatureNotConnected implements Exception {
  const FeatureNotConnected();
}

@immutable
class MenuCategory {
  const MenuCategory({required this.id, required this.name, required this.active});

  final String id;
  final String name;

  /// ACTIVE groups can be chosen; an inactive one only keeps the link of dishes that already have it.
  final bool active;
}

@immutable
class MenuItem {
  const MenuItem({required this.id, required this.name, this.description, required this.priceVnd, required this.categoryId, required this.imageRef, required this.imageUrl, required this.hidden, required this.version});

  final String id;
  final String name;
  final String? description;
  final int priceVnd;
  final String categoryId;

  /// The opaque reference of the picture (what a save sends back to keep it), or null.
  final String? imageRef;

  /// Where the picture can be loaded from (an https URL the port resolved), or null: no picture.
  final String? imageUrl;
  final bool hidden;
  final int version;
}

@immutable
class MenuSnapshot {
  const MenuSnapshot({required this.categories, required this.items, this.visibleLimit, this.expanded = false});

  final int? visibleLimit;
  final bool expanded;

  final List<MenuCategory> categories;

  /// The shop's dishes that are not deleted.
  final List<MenuItem> items;

  MenuCategory? category(String id) {
    for (final MenuCategory c in categories) {
      if (c.id == id) {
        return c;
      }
    }
    return null;
  }

  MenuItem? item(String id) {
    for (final MenuItem i in items) {
      if (i.id == id) {
        return i;
      }
    }
    return null;
  }

  List<MenuCategory> get activeCategories => <MenuCategory>[for (final MenuCategory c in categories) if (c.active) c];
}

/// A picture chosen on the phone and its upload result.
@immutable
class PickedImage {
  const PickedImage({required this.bytes, required this.contentType});

  final Uint8List bytes;
  final String contentType;
}

/// The fields of a dish as they are sent. [imageRef] is what an earlier upload returned (null = no picture).
@immutable
class MenuItemInput {
  const MenuItemInput({required this.name, this.description, required this.priceVnd, required this.categoryId, required this.imageRef});

  final String name;
  final String? description;
  final int priceVnd;
  final String categoryId;
  final String? imageRef;
}

/// The owner's menu. Every method throws [AuthFailure] for a server refusal / no answer (with the codes MENU_ITEM_NOT_FOUND,
/// VERSION_CONFLICT, ...) or [FeatureNotConnected]. A write takes the Idempotency-Key the controller keeps for it.
abstract class MenuApi {
  Future<MenuSnapshot> load();

  /// Uploads a picture; returns the reference to put in a dish and the URL it can be shown from.
  Future<({String ref, String url})> uploadImage(PickedImage image);

  Future<MenuItem> create(MenuItemInput input, {required String key});
  Future<MenuItem> update(String id, MenuItemInput input, {required int expectedVersion, required String key});
  Future<MenuItem> setHidden(String id, bool hidden, {required int expectedVersion, required String key});
  Future<void> delete(String id, {required int expectedVersion, required String key});
}

class UnwiredMenuApi implements MenuApi {
  const UnwiredMenuApi();

  @override
  Future<MenuSnapshot> load() => Future<MenuSnapshot>.error(const FeatureNotConnected());

  @override
  Future<({String ref, String url})> uploadImage(PickedImage image) => Future<({String ref, String url})>.error(const FeatureNotConnected());

  @override
  Future<MenuItem> create(MenuItemInput input, {required String key}) => Future<MenuItem>.error(const FeatureNotConnected());

  @override
  Future<MenuItem> update(String id, MenuItemInput input, {required int expectedVersion, required String key}) => Future<MenuItem>.error(const FeatureNotConnected());

  @override
  Future<MenuItem> setHidden(String id, bool hidden, {required int expectedVersion, required String key}) => Future<MenuItem>.error(const FeatureNotConnected());

  @override
  Future<void> delete(String id, {required int expectedVersion, required String key}) => Future<void>.error(const FeatureNotConnected());
}

/// Picks one picture from the device (the OS picker; no camera, no extra permission). null = the person cancelled.
abstract class ImagePickerPort {
  Future<PickedImage?> pick();
}

/// Thrown by a picker when the file cannot be used at all (unreadable, not a picture).
class ImagePickException implements Exception {
  const ImagePickException();
}

class NoImagePicker implements ImagePickerPort {
  const NoImagePicker();

  @override
  Future<PickedImage?> pick() => Future<PickedImage?>.error(const ImagePickException());
}

@immutable
class PublicItem {
  const PublicItem({required this.id, required this.name, this.description, required this.priceVnd, required this.imageUrl, this.soldCount});

  final String id;
  final String name;
  final String? description;
  final int priceVnd;
  final int? soldCount;
  final String? imageUrl;
}

@immutable
class PublicCategory {
  const PublicCategory({required this.name, required this.items});

  final String name;
  final List<PublicItem> items;
}

/// What a customer (or the owner's preview) sees of a shop. Only public fields.
@immutable
class ShopMenuView {
  const ShopMenuView({required this.name, required this.address, required this.availabilityReason, required this.serverNow, required this.hours, required this.categories, this.logoUrl, this.logoBytes, this.contact = ShopContact.none, this.nextRefreshMs});

  final String name;
  final String address;
  final String? logoUrl;
  final Uint8List? logoBytes;

  /// The shop's own quick contact (phone, Zalo, Messenger), already validated; empty for the owner's preview and for an older server.
  final ShopContact contact;

  /// ONLINE / OUTSIDE_BUSINESS_HOURS (the server shows a shop only when it is set up; anything else is not shown to customers).
  final String availabilityReason;

  /// The server's instant (UTC), used only to mark today in the schedule; never to decide open/closed.
  final DateTime? serverNow;
  final int? nextRefreshMs;
  final WeekSchedule hours;
  final List<PublicCategory> categories;

  bool get hasHours => hours.any((List<HourRange> d) => d.isNotEmpty);
  bool get hasItems => categories.any((PublicCategory c) => c.items.isNotEmpty);
}

/// The public view of one shop by its id. Throws [AuthFailure] with the code SHOP_NOT_FOUND / SHOP_UNAVAILABLE for those answers, or
/// a network failure, or [FeatureNotConnected].
abstract class PublicShopApi {
  Future<ShopMenuView> load(String shopId);
}

class UnwiredPublicShopApi implements PublicShopApi {
  const UnwiredPublicShopApi();

  @override
  Future<ShopMenuView> load(String shopId) => Future<ShopMenuView>.error(const FeatureNotConnected());
}

/// Builds the owner's preview from saved data: hidden dishes are left out, groups without a visible dish are left out.
ShopMenuView previewOf({
  required String name,
  required String address,
  required String reason,
  required DateTime? serverNow,
  required WeekSchedule hours,
  required MenuSnapshot menu,
  Uint8List? logoBytes,
}) {
  final List<PublicCategory> categories = <PublicCategory>[];
  for (final MenuCategory category in menu.categories) {
    final List<PublicItem> items = <PublicItem>[
      for (final MenuItem i in menu.items)
        if (i.categoryId == category.id && !i.hidden) PublicItem(id: i.id, name: i.name, priceVnd: i.priceVnd, description: i.description, imageUrl: i.imageUrl),
    ];
    if (items.isNotEmpty) {
      categories.add(PublicCategory(name: category.name, items: items));
    }
  }
  return ShopMenuView(logoBytes: logoBytes, name: name, address: address, availabilityReason: reason, serverNow: serverNow, hours: hours, categories: categories);
}
