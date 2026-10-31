import '../account/session_controller.dart';
import '../flows/location.dart';
import '../flows/shop_controller.dart';
import 'discovery_controller.dart';
import 'discovery_models.dart';
import 'dish_image_crop.dart';
import 'menu_controller.dart';
import 'menu_models.dart';
import 'shop_ops_controller.dart';
import 'shop_setup_controller.dart';

/// Everything the M02 screens of 11Food need, built once per app. The menu, picture and public-shop ports default to the "not
/// connected" ones until the server side exists; the shop profile and schedule are connected to the existing /v1/shop/me contract.
class M02Flows {
  M02Flows({required this.ops, required this.menu, required this.publicApi, required this.discovery, required this.setup, this.onboarding, this.cropper});

  final ShopOpsController ops;

  /// Issue #190: the setup checklist (x/4) the server computes.
  final ShopSetupController setup;
  final MenuListController menu;
  final PublicShopApi publicApi;

  /// Home discovery (areas, groups, shops, filters) of the customer side.
  final DiscoveryController discovery;

  /// The M01 profile flow, for "Hoàn tất hồ sơ" (an INCOMPLETE shop is finished there, not here).
  final ShopController? onboarding;
  final DishImageCropperPort? cropper;

  void dispose() {
    ops.dispose();
    setup.dispose();
    menu.dispose();
    discovery.dispose();
  }
}

M02Flows createM02Flows({
  required SessionController session,
  required LocationProvider location,
  ShopController? onboarding,
  MenuApi menuApi = const UnwiredMenuApi(),
  PublicShopApi publicApi = const UnwiredPublicShopApi(),
  DiscoveryApi discoveryApi = const UnwiredDiscoveryApi(),
  ImagePickerPort picker = const NoImagePicker(),
  DishImageCropperPort? cropper,
  Duration pollEvery = const Duration(seconds: 30),
}) {
  return M02Flows(
    ops: ShopOpsController(session: session, location: location, pollEvery: pollEvery),
    setup: ShopSetupController(session: session, pollEvery: pollEvery),
    menu: MenuListController(api: menuApi, session: session, picker: picker, cropper: cropper),
    publicApi: publicApi,
    discovery: DiscoveryController(api: discoveryApi),
    onboarding: onboarding,
    cropper: cropper,
  );
}
