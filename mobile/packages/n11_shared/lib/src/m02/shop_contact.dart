import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

// Issue #190, B: the quick contact on the shop page. The SERVER already sends only validated values (phone, Zalo link, Messenger link, Facebook
// link); this file checks them AGAIN before anything is shown or opened, so a wrong or hostile value from any source can only ever mean "no button".
// Nothing is inferred from a string that is not exactly a recognised shape, and nothing here makes a call: dialing only opens the phone app.

final RegExp _phone = RegExp(r'^\+84[0-9]{9}$');
const Set<String> _zaloHosts = <String>{'zalo.me'};
const Set<String> _messengerHosts = <String>{'m.me'};
const Set<String> _facebookHosts = <String>{'www.facebook.com'};
final RegExp _pathPart = RegExp(r'^[A-Za-z0-9._-]{1,64}$');

/// An https link on exactly one of [hosts] with one clean path part (and, for Facebook profiles, nothing but `profile.php?id=<digits>`), or null.
String? safeContactLink(Object? raw, Set<String> hosts) {
  if (raw is! String || raw.isEmpty || raw.length > 200 || raw.trim() != raw) return null;
  final Uri? uri = Uri.tryParse(raw);
  if (uri == null || uri.scheme != 'https' || uri.userInfo.isNotEmpty || uri.hasPort || uri.fragment.isNotEmpty || !hosts.contains(uri.host)) return null;
  if (uri.pathSegments.length != 1 || !_pathPart.hasMatch(uri.pathSegments.single)) return null;
  if (uri.hasQuery) {
    final bool profile = uri.host == 'www.facebook.com' && uri.pathSegments.single == 'profile.php' && uri.queryParameters.length == 1 && RegExp(r'^[0-9]{5,20}$').hasMatch(uri.queryParameters['id'] ?? '');
    if (!profile) return null;
  }
  return raw;
}

@immutable
class ShopContact {
  const ShopContact({this.phone, this.zaloUrl, this.messengerUrl, this.facebookUrl});

  static const ShopContact none = ShopContact();

  /// +84XXXXXXXXX, the shop's OWN contact phone (never the login phone).
  final String? phone;
  final String? zaloUrl;
  final String? messengerUrl;
  final String? facebookUrl;

  bool get isEmpty => phone == null && zaloUrl == null && messengerUrl == null;

  /// Never throws: a missing or malformed object is [none]; a wrong member is dropped on its own.
  factory ShopContact.fromWire(Object? raw) {
    if (raw is! Map<String, Object?>) return none;
    final Object? phone = raw['phone'];
    return ShopContact(
      phone: phone is String && _phone.hasMatch(phone) ? phone : null,
      zaloUrl: safeContactLink(raw['zalo_url'], _zaloHosts),
      messengerUrl: safeContactLink(raw['messenger_url'], _messengerHosts),
      facebookUrl: safeContactLink(raw['facebook_url'], _facebookHosts),
    );
  }

  /// 0912 345 678 for reading.
  String? get phoneText {
    final String? p = phone;
    if (p == null) return null;
    final String local = '0${p.substring(3)}';
    return '${local.substring(0, 4)} ${local.substring(4, 7)} ${local.substring(7)}';
  }
}

/// What only the phone can do. Both methods answer `false` (never throw) when nothing can handle the request, so the caller falls back to copying.
abstract class ContactLauncher {
  /// Opens the dialer with the number filled in. It does NOT place the call.
  Future<bool> dial(String phone);

  /// Opens an https link in the app that owns it (Zalo, Messenger) or the browser.
  Future<bool> openUrl(String url);
}

class MethodChannelContactLauncher implements ContactLauncher {
  const MethodChannelContactLauncher({MethodChannel? channel}) : _channel = channel;

  final MethodChannel? _channel;

  MethodChannel get _c => _channel ?? const MethodChannel('vn.eleven.n11/launch');

  @override
  Future<bool> dial(String phone) async {
    if (!_phone.hasMatch(phone)) return false;
    return _invoke('dial', <String, Object?>{'phone': phone});
  }

  @override
  Future<bool> openUrl(String url) async {
    if (safeContactLink(url, <String>{..._zaloHosts, ..._messengerHosts, ..._facebookHosts}) == null) return false;
    return _invoke('open', <String, Object?>{'url': url});
  }

  Future<bool> _invoke(String method, Map<String, Object?> arguments) async {
    try {
      return await _c.invokeMethod<bool>(method, arguments) ?? false;
    } on PlatformException {
      return false;
    } on MissingPluginException {
      return false;
    }
  }
}
