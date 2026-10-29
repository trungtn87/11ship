import '../account/api_client.dart';
import '../account/models.dart';
import '../account/session_controller.dart';

class PlaceSearchResult {
  const PlaceSearchResult({required this.id, required this.name, required this.address, required this.latitude, required this.longitude, required this.inCaoBang});
  final String id;
  final String name;
  final String address;
  final double latitude;
  final double longitude;
  final bool inCaoBang;
}

abstract class PlaceSearchApi {
  Future<List<PlaceSearchResult>> search(String query);
}

class HttpPlaceSearchApi implements PlaceSearchApi {
  const HttpPlaceSearchApi(this.session);
  final SessionController session;

  @override
  Future<List<PlaceSearchResult>> search(String query) async {
    final ApiResponse response = await session.protectedCall('GET', '/v1/customers/me/places?query=${Uri.encodeQueryComponent(query)}');
    if (response.status != 200) throw failureOf(response);
    final Object? raw = response.data;
    if (raw is! Map<String, Object?> || raw['places'] is! List<Object?>) throw const AuthFailure(AuthFailureKind.badResponse);
    return <PlaceSearchResult>[
      for (final Object? item in raw['places']! as List<Object?>)
        if (item is Map<String, Object?>)
          PlaceSearchResult(
            id: item['id']! as String,
            name: item['name']! as String,
            address: item['address']! as String,
            latitude: (item['latitude']! as num).toDouble(),
            longitude: (item['longitude']! as num).toDouble(),
            inCaoBang: item['in_cao_bang']! as bool,
          ),
    ];
  }
}
