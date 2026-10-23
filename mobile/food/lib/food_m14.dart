import 'package:flutter/material.dart';
import 'package:n11_m14_map/n11_m14_map.dart';
import 'package:n11_shared/n11_shared.dart';

// 11Food side of M14: the offline Cao Bằng map to pin a drop-off point and to see the pickup, the drop-off and the Shipper's LATEST position. It uses the
// map-only package: no GPS recorder, no foreground service, no routing, no permission. The checkout's "Dùng vị trí hiện tại" is a separate one-shot fix
// the customer asks for. The build sets M14_OFFLINE_MAP only when the Cao Bằng package is inside the APK, so a screen never opens a map that cannot load;
// without the flag these builders are null and the screens say the points in words (nothing is faked).

Map<String, dynamic> _pin(double lat, double lng, String label, int color) => <String, dynamic>{'lat': lat, 'lon': lng, 'label': label, 'color': color};

/// Pickup, drop-off and the latest Shipper position (only what the screen was given, so an ended order draws no live position).
M07MapBuilder? foodMapBuilder() => kM14MapEnabled
    ? (BuildContext context, List<M07MapPin> pins) => M14OfflineMap(pins: <Map<String, dynamic>>[for (final M07MapPin p in pins) _pin(p.lat, p.lng, p.label, p.color)])
    : null;

/// Lets a person pin or move the drop-off point; a tap outside the covered area is ignored (the map says so).
M07PinPickerBuilder? foodPinPicker() => kM14MapEnabled
    ? (BuildContext context, {required void Function(double lat, double lng) onPick, double? lat, double? lng}) => M14OfflineMap(
          focusPin: true,
          pins: <Map<String, dynamic>>[if (lat != null && lng != null) _pin(lat, lng, 'Điểm giao', 0xFFC0392B)],
          onPoint: (double la, double lo, bool inside) {
            if (inside) {
              onPick(la, lo);
            }
          },
        )
    : null;
