import 'package:flutter/material.dart';

// Issue #412: the icon of one home category chip. The picture the Administration web set for the group is shown when there is one; in every
// other case (no picture, loading, a failed or offline load) the fallback icon of category_icons.dart is shown, so the chip never looks empty
// or broken. The picture is drawn in a square box with BoxFit.contain: it is never stretched or cropped.

class CategoryChipIcon extends StatelessWidget {
  const CategoryChipIcon({
    super.key,
    required this.icon,
    required this.color,
    this.imageUrl,
    this.provider,
    this.size = 25,
  });

  /// The fallback icon (the group's own icon from category_icons.dart, or the "Tất cả" grid).
  final IconData icon;
  final Color color;

  /// The absolute URL of the group's picture, or null when it has none.
  final String? imageUrl;

  /// Overrides the network source (tests only). When given, [imageUrl] is not used.
  final ImageProvider? provider;

  final double size;

  @override
  Widget build(BuildContext context) {
    final Widget fallback = SizedBox(
      width: size,
      height: size,
      child: Center(child: Icon(icon, size: size, color: color)),
    );
    final ImageProvider? image = provider ?? (imageUrl == null ? null : NetworkImage(imageUrl!));
    if (image == null) {
      return fallback;
    }
    return SizedBox(
      key: const Key('category-chip-image'),
      width: size,
      height: size,
      child: Image(
        image: image,
        width: size,
        height: size,
        fit: BoxFit.contain,
        filterQuality: FilterQuality.medium,
        excludeFromSemantics: true,
        frameBuilder: (BuildContext context, Widget child, int? frame, bool wasSynchronouslyLoaded) =>
            frame == null && !wasSynchronouslyLoaded ? fallback : child,
        errorBuilder: (BuildContext context, Object error, StackTrace? stackTrace) => fallback,
      ),
    );
  }
}
