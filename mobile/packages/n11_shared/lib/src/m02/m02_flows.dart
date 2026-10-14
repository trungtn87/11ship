import '../account/session_controller.dart';
import '../flows/location.dart';
import '../flows/shop_controller.dart';
import 'menu_controller.dart';
import 'menu_models.dart';
import 'shop_ops_controller.dart';

/// Everything the M02 screens of 11Food need, built once per app. The menu, picture and public-shop ports default to the "not
/// connected" ones until the server side exists; the shop profile and schedule are connected to the existing /v1/shop/me contract.
class M02Flows {
  M02Flows({required this.ops, required this.menu, required this.publicApi, this.onboarding});

  final ShopOpsController ops;
  final MenuListController menu;
  final PublicShopApi publicApi;

  /// The M01 profile flow, for "Hoàn tất hồ sơ" (an INCOMPLETE shop is finished there, not here).
  final ShopController? onboarding;

  void dispose() {
    ops.dispose();
    menu.dispose();
  }
}

M02Flows createM02Flows({
  required SessionController session,
  required LocationProvider location,
  ShopController? onboarding,
  MenuApi menuApi = const UnwiredMenuApi(),
  PublicShopApi publicApi = const UnwiredPublicShopApi(),
  ImagePickerPort picker = const NoImagePicker(),
  Duration pollEvery = const Duration(seconds: 30),
}) {
  return M02Flows(
    ops: ShopOpsController(session: session, location: location, pollEvery: pollEvery),
    menu: MenuListController(api: menuApi, session: session, picker: picker),
    publicApi: publicApi,
    onboarding: onboarding,
  );
}
