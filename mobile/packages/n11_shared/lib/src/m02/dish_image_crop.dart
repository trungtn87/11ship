import 'dart:math' as math;
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:image/image.dart' as img;

import '../tokens.dart';
import '../widgets/components.dart';
import 'menu_models.dart';

/// Standard aspect ratio for menu dish images (1:1 square, matching DishThumb).
const double kDishImageAspectRatio = 1.0;

/// Max byte limit for cropped menu images (1 MB / 1048576 bytes).
const int kDishImageMaxBytes = 1048576;

/// Port / callback for cropping dish images before uploading.
typedef DishImageCropperPort = Future<PickedImage?> Function(PickedImage raw);

/// Computes the exact crop rectangle on original image coordinates [imageWidth] x [imageHeight]
/// given [viewportSize], [zoom], and [panOffset].
Rect computeDishCropRect({
  required int imageWidth,
  required int imageHeight,
  required double viewportSize,
  required double zoom,
  required Offset panOffset,
}) {
  final double imgW = imageWidth.toDouble();
  final double imgH = imageHeight.toDouble();
  final double V = viewportSize;

  final double z = zoom.clamp(1.0, 4.0);
  final double baseScale = math.max(V / imgW, V / imgH);
  final double scale = baseScale * z;

  final double W = imgW * scale;
  final double H = imgH * scale;

  final double maxPanX = math.max(0.0, (W - V) / 2.0);
  final double maxPanY = math.max(0.0, (H - V) / 2.0);

  final double clampedDx = maxPanX == 0 ? 0.0 : panOffset.dx.clamp(-maxPanX, maxPanX);
  final double clampedDy = maxPanY == 0 ? 0.0 : panOffset.dy.clamp(-maxPanY, maxPanY);

  final double cropSize = (V / scale).clamp(1.0, math.min(imgW, imgH));
  final double cropLeft = ((imgW - cropSize) / 2.0 - clampedDx / scale).clamp(0.0, imgW - cropSize);
  final double cropTop = ((imgH - cropSize) / 2.0 - clampedDy / scale).clamp(0.0, imgH - cropSize);

  return Rect.fromLTWH(cropLeft, cropTop, cropSize, cropSize);
}

/// Bakes a 1:1 square cropped image from [rawBytes] based on the crop viewport parameters.
PickedImage bakeDishCrop({
  required Uint8List rawBytes,
  required double viewportSize,
  required double zoom,
  required Offset panOffset,
  int targetDimension = 512,
}) {
  final img.Image? decoded = img.decodeImage(rawBytes);
  if (decoded == null) {
    throw const FormatException('Cannot decode image bytes');
  }

  final Rect cropRect = computeDishCropRect(
    imageWidth: decoded.width,
    imageHeight: decoded.height,
    viewportSize: viewportSize,
    zoom: zoom,
    panOffset: panOffset,
  );

  final img.Image cropped = img.copyCrop(
    decoded,
    x: cropRect.left.round().clamp(0, decoded.width - 1),
    y: cropRect.top.round().clamp(0, decoded.height - 1),
    width: cropRect.width.round().clamp(1, decoded.width),
    height: cropRect.height.round().clamp(1, decoded.height),
  );

  final img.Image resized = img.copyResize(
    cropped,
    width: targetDimension,
    height: targetDimension,
    interpolation: img.Interpolation.linear,
  );

  // Encode as PNG first
  final Uint8List pngBytes = Uint8List.fromList(img.encodePng(resized));
  if (pngBytes.length <= kDishImageMaxBytes) {
    return PickedImage(bytes: pngBytes, contentType: 'image/png');
  }

  // Fallback to JPEG if PNG exceeds size limit
  for (final int quality in <int>[90, 80, 70, 50, 35]) {
    final Uint8List jpgBytes = Uint8List.fromList(img.encodeJpg(resized, quality: quality));
    if (jpgBytes.length <= kDishImageMaxBytes) {
      return PickedImage(bytes: jpgBytes, contentType: 'image/jpeg');
    }
  }

  throw const FormatException('Cropped image exceeds size limit');
}

/// Modal / screen for cropping and aligning a menu dish picture to 1:1 aspect ratio.
class DishImageCropScreen extends StatefulWidget {
  const DishImageCropScreen({
    super.key,
    required this.rawBytes,
    this.picker,
  });

  final Uint8List rawBytes;
  final ImagePickerPort? picker;

  @override
  State<DishImageCropScreen> createState() => _DishImageCropScreenState();
}

class _DishImageCropScreenState extends State<DishImageCropScreen> {
  late Uint8List _currentBytes;
  img.Image? _decoded;
  String? _error;
  bool _baking = false;

  double _zoom = 1.0;
  Offset _panOffset = Offset.zero;

  Offset _startPan = Offset.zero;
  double _startZoom = 1.0;

  double _lastViewportSize = 280.0;

  @override
  void initState() {
    super.initState();
    _currentBytes = widget.rawBytes;
    _decodeImage();
  }

  void _decodeImage() {
    try {
      final img.Image? decoded = img.decodeImage(_currentBytes);
      if (decoded == null) {
        _error = 'Không đọc được ảnh này. Vui lòng chọn ảnh khác.';
      } else {
        _decoded = decoded;
        _zoom = 1.0;
        _panOffset = Offset.zero;
        _error = null;
      }
    } catch (_) {
      _error = 'Không đọc được ảnh này. Vui lòng chọn ảnh khác.';
    }
  }

  void _clampOffset(double V) {
    if (_decoded == null) return;
    final double imgW = _decoded!.width.toDouble();
    final double imgH = _decoded!.height.toDouble();
    final double baseScale = math.max(V / imgW, V / imgH);
    final double scale = baseScale * _zoom;
    final double W = imgW * scale;
    final double H = imgH * scale;
    final double maxPanX = math.max(0.0, (W - V) / 2.0);
    final double maxPanY = math.max(0.0, (H - V) / 2.0);
    _panOffset = Offset(
      maxPanX == 0 ? 0.0 : _panOffset.dx.clamp(-maxPanX, maxPanX),
      maxPanY == 0 ? 0.0 : _panOffset.dy.clamp(-maxPanY, maxPanY),
    );
  }

  void _setZoom(double value) {
    setState(() {
      _zoom = value.clamp(1.0, 4.0);
      _clampOffset(_lastViewportSize);
    });
  }

  void _reset() {
    setState(() {
      _zoom = 1.0;
      _panOffset = Offset.zero;
    });
  }

  Future<void> _pickOther() async {
    if (_baking || widget.picker == null) return;
    try {
      final PickedImage? other = await widget.picker!.pick();
      if (other != null && mounted) {
        setState(() {
          _currentBytes = other.bytes;
          _decodeImage();
        });
      }
    } catch (_) {
      if (mounted) {
        setState(() => _error = 'Không đọc được ảnh này. Vui lòng chọn ảnh khác.');
      }
    }
  }

  Future<void> _applyCrop() async {
    if (_decoded == null || _baking) return;
    setState(() => _baking = true);
    try {
      final PickedImage cropped = bakeDishCrop(
        rawBytes: _currentBytes,
        viewportSize: _lastViewportSize,
        zoom: _zoom,
        panOffset: _panOffset,
      );
      if (mounted) {
        Navigator.of(context).pop(cropped);
      }
    } catch (_) {
      if (mounted) {
        setState(() {
          _baking = false;
          _error = 'Không thể xử lý ảnh này. Vui lòng chọn ảnh khác.';
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: N11Colors.bg,
      appBar: AppBar(
        title: const Text('Căn chỉnh ảnh món'),
        backgroundColor: N11Colors.white,
        foregroundColor: N11Colors.black,
        elevation: 0,
        leading: IconButton(
          key: const Key('dish-image-crop-cancel'),
          icon: const Icon(Icons.arrow_back),
          onPressed: () => Navigator.of(context).pop(),
        ),
      ),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: N11Space.pad, vertical: N11Space.gap3),
          child: Column(
            children: <Widget>[
              const Text(
                'Kéo ảnh để căn chỉnh vị trí món ăn. Dùng hai ngón tay hoặc thanh trượt để phóng to/thu nhỏ vào đúng khung thực đơn.',
                style: N11Text.caption,
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: N11Space.gap3),
              Expanded(
                child: Center(
                  child: LayoutBuilder(
                    builder: (BuildContext context, BoxConstraints constraints) {
                      final double viewportSize = math.min(
                        constraints.maxWidth - 32,
                        constraints.maxHeight - 32,
                      ).clamp(180.0, 320.0);
                      _lastViewportSize = viewportSize;

                      if (_error != null) {
                        return Column(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: <Widget>[
                            const Icon(Icons.broken_image_outlined, size: 48, color: N11Colors.error),
                            const SizedBox(height: N11Space.gap2),
                            Text(_error!, key: const Key('dish-image-crop-error'), style: const TextStyle(color: N11Colors.errorInk)),
                            const SizedBox(height: N11Space.gap3),
                            if (widget.picker != null)
                              N11Button(
                                key: const Key('dish-image-choose-other'),
                                label: 'Chọn ảnh khác',
                                kind: ButtonKind.secondary,
                                compact: true,
                                onPressed: _pickOther,
                              ),
                          ],
                        );
                      }

                      if (_decoded == null) {
                        return const Center(child: CircularProgressIndicator());
                      }

                      final double imgW = _decoded!.width.toDouble();
                      final double imgH = _decoded!.height.toDouble();
                      final double baseScale = math.max(viewportSize / imgW, viewportSize / imgH);
                      final double scale = baseScale * _zoom;
                      final double W = imgW * scale;
                      final double H = imgH * scale;

                      final double maxPanX = math.max(0.0, (W - viewportSize) / 2.0);
                      final double maxPanY = math.max(0.0, (H - viewportSize) / 2.0);
                      final Offset clampedOffset = Offset(
                        maxPanX == 0 ? 0.0 : _panOffset.dx.clamp(-maxPanX, maxPanX),
                        maxPanY == 0 ? 0.0 : _panOffset.dy.clamp(-maxPanY, maxPanY),
                      );

                      return GestureDetector(
                        behavior: HitTestBehavior.opaque,
                        onScaleStart: (ScaleStartDetails d) {
                          _startPan = _panOffset;
                          _startZoom = _zoom;
                        },
                        onScaleUpdate: (ScaleUpdateDetails d) {
                          setState(() {
                            if (d.scale != 1.0) {
                              _zoom = (_startZoom * d.scale).clamp(1.0, 4.0);
                            }
                            _panOffset = _startPan + d.focalPointDelta;
                            _clampOffset(viewportSize);
                          });
                        },
                        child: Container(
                          width: viewportSize,
                          height: viewportSize,
                          decoration: BoxDecoration(
                            color: N11Colors.yellowFaint,
                            borderRadius: BorderRadius.circular(12),
                            border: Border.all(color: N11Colors.black, width: 2.5),
                            boxShadow: const <BoxShadow>[
                              BoxShadow(color: Color(0x33000000), blurRadius: 10, spreadRadius: 2),
                            ],
                          ),
                          child: ClipRRect(
                            key: const Key('dish-image-crop-box'),
                            borderRadius: BorderRadius.circular(10),
                            child: Stack(
                              clipBehavior: Clip.hardEdge,
                              children: <Widget>[
                                Positioned(
                                  left: (viewportSize - W) / 2.0 + clampedOffset.dx,
                                  top: (viewportSize - H) / 2.0 + clampedOffset.dy,
                                  width: W,
                                  height: H,
                                  child: Image.memory(
                                    _currentBytes,
                                    fit: BoxFit.fill,
                                    gaplessPlayback: true,
                                  ),
                                ),
                                // 3x3 Rule of thirds grid
                                IgnorePointer(
                                  child: CustomPaint(
                                    size: Size(viewportSize, viewportSize),
                                    painter: _CropGridPainter(),
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ),
                      );
                    },
                  ),
                ),
              ),
              const SizedBox(height: N11Space.gap2),
              // Zoom slider and +/- buttons
              if (_decoded != null) ...<Widget>[
                Row(
                  children: <Widget>[
                    IconButton(
                      key: const Key('dish-image-zoom-out'),
                      icon: const Icon(Icons.remove_circle_outline),
                      color: N11Colors.black,
                      onPressed: _zoom > 1.0 ? () => _setZoom(_zoom - 0.25) : null,
                    ),
                    Expanded(
                      child: Slider(
                        key: const Key('dish-image-zoom-slider'),
                        value: _zoom,
                        min: 1.0,
                        max: 4.0,
                        divisions: 30,
                        activeColor: N11Colors.black,
                        inactiveColor: N11Colors.line,
                        onChanged: _setZoom,
                      ),
                    ),
                    IconButton(
                      key: const Key('dish-image-zoom-in'),
                      icon: const Icon(Icons.add_circle_outline),
                      color: N11Colors.black,
                      onPressed: _zoom < 4.0 ? () => _setZoom(_zoom + 0.25) : null,
                    ),
                    SizedBox(
                      width: 42,
                      child: Text(
                        '${_zoom.toStringAsFixed(1)}x',
                        style: N11Text.bodyStrong,
                        textAlign: TextAlign.end,
                      ),
                    ),
                  ],
                ),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: <Widget>[
                    TextButton(
                      key: const Key('dish-image-reset'),
                      onPressed: _zoom == 1.0 && _panOffset == Offset.zero ? null : _reset,
                      child: const Text('Đặt lại'),
                    ),
                    if (widget.picker != null)
                      TextButton(
                        key: const Key('dish-image-choose-other'),
                        onPressed: _baking ? null : _pickOther,
                        child: const Text('Chọn ảnh khác'),
                      ),
                  ],
                ),
              ],
              const SizedBox(height: N11Space.gap3),
              // Footer action buttons
              Row(
                children: <Widget>[
                  Expanded(
                    child: N11Button(
                      key: const Key('dish-image-crop-cancel-btn'),
                      label: 'Hủy',
                      kind: ButtonKind.secondary,
                      onPressed: () => Navigator.of(context).pop(),
                    ),
                  ),
                  const SizedBox(width: N11Space.gap3),
                  Expanded(
                    child: N11Button(
                      key: const Key('dish-image-crop-done'),
                      label: _baking ? 'Đang xử lý…' : 'Xong',
                      loading: _baking,
                      onPressed: _decoded == null || _baking ? null : _applyCrop,
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _CropGridPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final Paint paint = Paint()
      ..color = const Color(0x66FFFFFF)
      ..strokeWidth = 1.0;

    final double w = size.width;
    final double h = size.height;

    // 2 vertical lines
    canvas.drawLine(Offset(w / 3, 0), Offset(w / 3, h), paint);
    canvas.drawLine(Offset(w * 2 / 3, 0), Offset(w * 2 / 3, h), paint);

    // 2 horizontal lines
    canvas.drawLine(Offset(0, h / 3), Offset(w, h / 3), paint);
    canvas.drawLine(Offset(0, h * 2 / 3), Offset(w, h * 2 / 3), paint);
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}
