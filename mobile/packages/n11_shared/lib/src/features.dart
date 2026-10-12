// Which business actions of the phone apps are connected to a real backend. This is the single place the UI reads to decide
// "button enabled" vs "button disabled with its reason" (03-ui-catalog C10). Nothing here is fake: an action that is not wired is
// NOT simulated, it is disabled and says why. Same wording as apps/client-shared/src/features.ts.
//
// To connect an action later: implement its call, flip `wired` to true here and add the test. The screens do not change.

enum FeatureId { authRegister, authLogin }

class FeatureStatus {
  const FeatureStatus({required this.wired, required this.reason, required this.package});

  final bool wired;

  /// Visible reason shown next to the disabled control. Vietnamese, says what is missing, never "error".
  final String reason;

  /// Design-set work package that delivers the missing backend/contract piece.
  final String package;
}

const Map<FeatureId, FeatureStatus> kFeatures = <FeatureId, FeatureStatus>{
  FeatureId.authRegister: FeatureStatus(
    wired: false,
    reason: 'Chưa nối máy chủ: đăng ký tài khoản đang chờ backend (M01.03).',
    package: 'M01.03',
  ),
  FeatureId.authLogin: FeatureStatus(
    wired: false,
    reason: 'Chưa nối máy chủ: đăng nhập đang chờ backend (M01.04).',
    package: 'M01.04',
  ),
};

String featureReason(FeatureId id) => kFeatures[id]!.reason;

bool isWired(FeatureId id) => kFeatures[id]!.wired;

/// Reasons for the screens that are only frames in this test build (no data source exists for them yet).
abstract final class FrameReasons {
  static const String soon = 'Sắp có';
  static const String empty = 'Chưa có dữ liệu để hiển thị.';
}
