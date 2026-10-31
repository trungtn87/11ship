import 'dart:convert';

import 'package:flutter/services.dart' show rootBundle;

import '../m02/m02_format.dart' show foldVietnamese;
import 'place_search.dart';

// Offline place search for the 11Food address pickers (issue #283). The index is built once, at build time, from the same OpenStreetMap extract as the
// offline map (ops/m14/search-index/build-search-index.mjs) and shipped as an asset. Typing never touches the network or scans map data: it filters a
// few hundred prepared rows in memory. Every row is a real OpenStreetMap place with a real point; a house number or an address OSM does not know is
// never given a coordinate. A road/place/river is ONE point on it, so such a result is flagged `approximate` and the person is asked to adjust the pin.

/// The shared Vietnamese folding (marks removed, đ -> d, lower case) with punctuation turned into spaces: "Bệnh viện, Cao Bằng" -> "benh vien cao bang".
String _fold(String input) => foldVietnamese(input).replaceAll(RegExp(r'[,.;:()_/\-]'), ' ').replaceAll(RegExp(r'\s+'), ' ').trim();

class _Row {
  _Row(this.index, this.name, this.latitude, this.longitude, this.category, this.address, this.folded, this.words, this.categoryWords);
  final int index;
  final String name;
  final double latitude;
  final double longitude;
  final String category;
  final String? address;
  final String folded;
  final List<String> words;
  final List<String> categoryWords;
}

class OfflinePlaceIndex {
  OfflinePlaceIndex._(this.mapVersion, this._rows, this._labels);

  /// Parses the asset text. Throws [FormatException] for a file that is not the documented index (then nothing is searched).
  factory OfflinePlaceIndex.parse(String text) {
    final Object? doc = jsonDecode(text);
    if (doc is! Map<String, Object?> || doc['version'] != 1 || doc['places'] is! List || doc['categories'] is! Map) {
      throw const FormatException('place index');
    }
    final Map<String, String> labels = <String, String>{
      for (final MapEntry<String, Object?> e in (doc['categories']! as Map<String, Object?>).entries)
        if (e.value is String) e.key: e.value! as String,
    };
    final List<_Row> rows = <_Row>[];
    for (final Object? raw in doc['places']! as List<Object?>) {
      if (raw is! List || raw.length < 4 || raw[0] is! String || raw[1] is! num || raw[2] is! num || raw[3] is! String) {
        continue; // a damaged row is skipped, never guessed
      }
      final double lat = (raw[1]! as num).toDouble();
      final double lng = (raw[2]! as num).toDouble();
      if (!lat.isFinite || !lng.isFinite || lat.abs() > 90 || lng.abs() > 180) {
        continue;
      }
      final String name = raw[0]! as String;
      final String category = raw[3]! as String;
      final String folded = _fold(name);
      rows.add(_Row(
        rows.length,
        name,
        lat,
        lng,
        category,
        raw.length > 4 && raw[4] is String ? raw[4]! as String : null,
        folded,
        folded.split(' '),
        _fold(labels[category] ?? '').split(' '),
      ));
    }
    return OfflinePlaceIndex._(doc['mapVersion'] is String ? doc['mapVersion']! as String : '', rows, labels);
  }

  final String mapVersion;
  final List<_Row> _rows;
  final Map<String, String> _labels;

  int get length => _rows.length;

  /// Categories whose single point is only somewhere on the thing (a road, a village, a river), not where a house is.
  static const Set<String> approximateCategories = <String>{'road', 'place', 'nature'};

  /// Up to [limit] rows ranked: every typed word must match (whole word > start of a word > inside a word > category name > one typo).
  List<PlaceSearchResult> search(String query, {int limit = 8}) {
    final List<String> tokens = _fold(query).split(' ').where((String t) => t.isNotEmpty).toList();
    if (tokens.isEmpty) {
      return const <PlaceSearchResult>[];
    }
    final String whole = tokens.join(' ');
    final List<(_Row, int)> scored = <(_Row, int)>[];
    for (final _Row row in _rows) {
      int total = 0;
      bool all = true;
      for (final String token in tokens) {
        final int s = _tokenScore(row, token);
        if (s == 0) {
          all = false;
          break;
        }
        total += s;
      }
      if (!all) {
        continue;
      }
      if (row.folded.startsWith(whole)) {
        total += 30;
      }
      total += switch (row.category) { 'place' || 'road' || 'office' || 'school' || 'health' || 'market' || 'station' => 4, _ => 0 };
      scored.add((row, total));
    }
    scored.sort(((_Row, int) a, (_Row, int) b) {
      final int byScore = b.$2.compareTo(a.$2);
      return byScore != 0 ? byScore : a.$1.name.compareTo(b.$1.name);
    });
    return <PlaceSearchResult>[
      for (final (_Row, int) hit in scored.take(limit))
        PlaceSearchResult(
          id: 'offline-${hit.$1.index}',
          name: hit.$1.name,
          address: hit.$1.address ?? '${hit.$1.name}, Cao Bằng',
          latitude: hit.$1.latitude,
          longitude: hit.$1.longitude,
          inCaoBang: true,
          kind: _labels[hit.$1.category],
          approximate: approximateCategories.contains(hit.$1.category),
        ),
    ];
  }

  static int _tokenScore(_Row row, String token) {
    int best = 0;
    for (final String word in row.words) {
      if (word == token) {
        return 100;
      }
      if (word.startsWith(token)) {
        best = best < 80 ? 80 : best;
      }
    }
    if (best > 0) {
      return best;
    }
    if (token.length >= 3 && row.folded.contains(token)) {
      return 40;
    }
    if (token.length >= 3) {
      for (final String word in row.categoryWords) {
        if (word.startsWith(token)) {
          return 20;
        }
      }
    }
    if (token.length >= 4) {
      for (final String word in row.words) {
        if (_withinOneEdit(word.length > token.length ? word.substring(0, token.length) : word, token)) {
          return 12;
        }
      }
    }
    return 0;
  }

  /// True for equal strings or strings one insertion, deletion or substitution apart.
  static bool _withinOneEdit(String a, String b) {
    if ((a.length - b.length).abs() > 1) {
      return false;
    }
    if (a.length == b.length) {
      // Two neighbouring letters swapped ("bnag" for "bang") counts as one slip.
      for (int k = 0; k + 1 < a.length; k++) {
        if (a[k] != b[k]) {
          if (a[k] == b[k + 1] && a[k + 1] == b[k] && a.substring(k + 2) == b.substring(k + 2)) {
            return true;
          }
          break;
        }
      }
    }
    int i = 0;
    int j = 0;
    int edits = 0;
    while (i < a.length && j < b.length) {
      if (a[i] == b[j]) {
        i++;
        j++;
        continue;
      }
      edits++;
      if (edits > 1) {
        return false;
      }
      if (a.length > b.length) {
        i++;
      } else if (a.length < b.length) {
        j++;
      } else {
        i++;
        j++;
      }
    }
    return edits + (a.length - i) + (b.length - j) <= 1;
  }
}

/// The picker's default search: the offline index, loaded once from the app's assets. Works with no Internet and no sign-in.
class OfflinePlaceSearchApi implements PlaceSearchApi {
  OfflinePlaceSearchApi({Future<String> Function()? loader}) : _loader = loader ?? _bundleLoader;

  /// One shared instance: the asset is read and parsed once for the whole app.
  static final OfflinePlaceSearchApi shared = OfflinePlaceSearchApi();

  static const String assetPath = 'packages/n11_shared/assets/places/caobang-places.json';
  static Future<String> _bundleLoader() => rootBundle.loadString(assetPath);

  final Future<String> Function() _loader;
  Future<OfflinePlaceIndex>? _index;

  @override
  Future<List<PlaceSearchResult>> search(String query) async {
    final Future<OfflinePlaceIndex> loading = _index ??= _loader().then(OfflinePlaceIndex.parse);
    try {
      return (await loading).search(query);
    } on Object {
      _index = null; // a failed load may be retried
      rethrow;
    }
  }
}
