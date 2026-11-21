// Which business actions of the phone apps are connected to a real backend. This is the single place the UI reads to decide
// "button enabled" vs "button disabled with its reason" (03-ui-catalog C10). Nothing here is fake: an action that is not wired is
// NOT simulated, it is disabled and says why. Same wording as apps/client-shared/src/features.ts.
//
// To connect an action later: implement its call, flip `wired` to true here and add the test. The screens do not change.

enum FeatureId { authRegister, authLogin, authProfile, shopManage, driverProfile, passwordReset, receiveOrders, wallet }

class FeatureStatus {
  const FeatureStatus({required this.wired, required this.reason, required this.package});

  final bool wired;

  /// Visible reason shown next to the disabled control. Vietnamese, says what is missing, never "error".
  final String reason;

  /// Design-set work package that delivers the missing backend/contract piece.
  final String package;
}

/// What an action says while it is not available in this build.
/// Wording stays neutral: no build, module or platform names.
const String kUnavailableReason = 'Chưa dùng được lúc này.';

const Map<FeatureId, FeatureStatus> kFeatures = <FeatureId, FeatureStatus>{
  // M01-ANDROID: register, login, own profile and logout are connected to the real server (device-bound session).
  FeatureId.authRegister: FeatureStatus(wired: true, reason: '', package: 'M01-ANDROID'),
  FeatureId.authLogin: FeatureStatus(wired: true, reason: '', package: 'M01-ANDROID'),
  FeatureId.authProfile: FeatureStatus(wired: true, reason: '', package: 'M01-ANDROID'),
  // M01-ANDROID remaining flows: shop profile + location + context, driver profile, test password reset.
  FeatureId.shopManage: FeatureStatus(wired: true, reason: '', package: 'M01-QUAN'),
  FeatureId.driverProfile: FeatureStatus(wired: true, reason: '', package: 'M01-XE'),
  FeatureId.passwordReset: FeatureStatus(wired: true, reason: '', package: 'M01-RESET'),
  FeatureId.receiveOrders: FeatureStatus(wired: false, reason: kUnavailableReason, package: 'M01-XE'),
  FeatureId.wallet: FeatureStatus(wired: false, reason: kUnavailableReason, package: 'M04'),
};

String featureReason(FeatureId id) => kFeatures[id]!.reason;

bool isWired(FeatureId id) => kFeatures[id]!.wired;

/// Reasons for the screens that are only frames in this test build (no data source exists for them yet).
abstract final class FrameReasons {
  static const String soon = 'Sắp có';
  static const String empty = 'Chưa có dữ liệu để hiển thị.';
}
