import 'dart:ui' as ui;

import 'package:flutter/material.dart';

import '../account/session_controller.dart';
import '../m02/menu_models.dart';
import '../tokens.dart';
import '../widgets/components.dart';
import 'shop_logo_data.dart';

class ShopLogoField extends StatefulWidget {
  const ShopLogoField({
    super.key,
    required this.value,
    required this.picker,
    required this.session,
    required this.onChanged,
    this.enabled = true,
  });
  final ShopLogoData? value;
  final ImagePickerPort picker;
  final SessionController session;
  final ValueChanged<ShopLogoData?> onChanged;
  final bool enabled;
  @override
  State<ShopLogoField> createState() => _ShopLogoFieldState();
}

class _ShopLogoFieldState extends State<ShopLogoField> {
  bool _picking = false;
  String? _error;

  Future<void> _pick() async {
    if (_picking || !widget.enabled) return;
    final int epoch = widget.session.sessionEpoch;
    setState(() {
      _picking = true;
      _error = null;
    });
    try {
      final ShopLogoData? cropped =
          await Navigator.of(context).push<ShopLogoData>(
        MaterialPageRoute<ShopLogoData>(
          builder: (_) => _LogoCropScreen(picker: widget.picker),
        ),
      );
      if (mounted &&
          cropped != null &&
          widget.enabled &&
          widget.session.sessionEpoch == epoch) {
        widget.onChanged(cropped);
      }
    } on ShopLogoException catch (error) {
      if (mounted) setState(() => _error = error.message);
    } catch (_) {
      if (mounted) {
        setState(
          () => _error = 'Không đọc được ảnh này. Vui lòng chọn ảnh khác.',
        );
      }
    } finally {
      if (mounted) setState(() => _picking = false);
    }
  }

  @override
  Widget build(BuildContext context) => Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          const Text('Logo quán · không bắt buộc', style: N11Text.label),
          const SizedBox(height: N11Space.gap2),
          Row(
            children: <Widget>[
              ClipRRect(
                borderRadius: BorderRadius.circular(14),
                child: SizedBox(
                  width: 80,
                  height: 80,
                  child: widget.value == null
                      ? const ColoredBox(
                          color: N11Colors.yellowSoft,
                          child: Icon(Icons.storefront_outlined, size: 36),
                        )
                      : Image.memory(
                          widget.value!.bytes,
                          fit: BoxFit.cover,
                          errorBuilder: (_, __, ___) =>
                              const Icon(Icons.broken_image_outlined),
                        ),
                ),
              ),
              const SizedBox(width: N11Space.gap3),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: <Widget>[
                    N11Button(
                      key: const Key('shop-logo-pick'),
                      label: _picking
                          ? 'Đang chọn ảnh…'
                          : widget.value == null
                              ? 'Chọn logo'
                              : 'Thay logo',
                      kind: ButtonKind.secondary,
                      compact: true,
                      onPressed: !widget.enabled || _picking ? null : _pick,
                    ),
                    if (widget.value != null)
                      TextButton(
                        key: const Key('shop-logo-remove'),
                        onPressed: !widget.enabled || _picking
                            ? null
                            : () => widget.onChanged(null),
                        child: const Text('Gỡ logo'),
                      ),
                  ],
                ),
              ),
            ],
          ),
          if (_error != null)
            Text(
              _error!,
              key: const Key('shop-logo-error'),
              style: const TextStyle(color: N11Colors.errorInk),
            ),
        ],
      );
}

class _LogoCropScreen extends StatefulWidget {
  const _LogoCropScreen({required this.picker});
  final ImagePickerPort picker;
  @override
  State<_LogoCropScreen> createState() => _LogoCropScreenState();
}

class _LogoCropScreenState extends State<_LogoCropScreen> {
  ui.Image? _decoded;
  Alignment _alignment = Alignment.center;
  String? _error;
  bool _saving = false;
  bool _reading = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _choose(initial: true);
    });
  }

  Future<void> _choose({bool initial = false}) async {
    if (_reading || _saving) return;
    setState(() {
      _reading = true;
      _error = null;
    });
    ui.ImmutableBuffer? buffer;
    ui.ImageDescriptor? descriptor;
    ui.Codec? codec;
    try {
      final ImagePickerPort picker = widget.picker;
      final PickedImage? picked = picker is ShopLogoPickerPort
          ? await (picker as ShopLogoPickerPort).pickLogo()
          : await picker.pick();
      if (!mounted) return;
      if (picked == null) {
        if (initial) {
          Navigator.of(context).pop();
        }
        return;
      }
      _decoded?.dispose();
      setState(() {
        _decoded = null;
        _alignment = Alignment.center;
      });
      if (!<String>[
        'image/png',
        'image/jpeg',
        'image/webp',
      ].contains(picked.contentType)) {
        throw const ShopLogoException(
          'Ảnh không đúng định dạng. Vui lòng chọn JPG, PNG hoặc WebP.',
        );
      }
      buffer = await ui.ImmutableBuffer.fromUint8List(picked.bytes);
      descriptor = await ui.ImageDescriptor.encoded(buffer);
      // Read dimensions first and decode only a sampled image, never the full camera bitmap.
      final int longest = descriptor.width > descriptor.height
          ? descriptor.width
          : descriptor.height;
      final double scale = longest > 1536 ? 1536 / longest : 1;
      codec = await descriptor.instantiateCodec(
        targetWidth: (descriptor.width * scale).round().clamp(1, 1536),
        targetHeight: (descriptor.height * scale).round().clamp(1, 1536),
      );
      final ui.FrameInfo frame = await codec.getNextFrame();
      if (!mounted) {
        frame.image.dispose();
        return;
      }
      setState(() => _decoded = frame.image);
    } on ShopLogoException catch (error) {
      if (mounted) setState(() => _error = error.message);
    } catch (_) {
      if (mounted) {
        setState(
          () => _error = 'Không đọc được ảnh này. Vui lòng chọn ảnh khác.',
        );
      }
    } finally {
      codec?.dispose();
      descriptor?.dispose();
      buffer?.dispose();
      if (mounted) setState(() => _reading = false);
    }
  }

  @override
  void dispose() {
    _decoded?.dispose();
    super.dispose();
  }

  Future<void> _done() async {
    final ui.Image? image = _decoded;
    if (image == null || _saving || _reading || _error != null) return;
    setState(() {
      _saving = true;
      _error = null;
    });
    ui.Picture? picture;
    ui.Image? cropped;
    try {
      final double edge = image.width < image.height
          ? image.width.toDouble()
          : image.height.toDouble();
      final Rect source = Rect.fromLTWH(
        (image.width - edge) * (_alignment.x + 1) / 2,
        (image.height - edge) * (_alignment.y + 1) / 2,
        edge,
        edge,
      );
      final ui.PictureRecorder recorder = ui.PictureRecorder();
      Canvas(recorder).drawImageRect(
        image,
        source,
        const Rect.fromLTWH(0, 0, 384, 384),
        Paint()..filterQuality = FilterQuality.high,
      );
      picture = recorder.endRecording();
      cropped = await picture.toImage(384, 384);
      final data = await cropped.toByteData(format: ui.ImageByteFormat.png);
      if (data == null) throw const FormatException();
      final ShopLogoData logo = await encodeShopLogo(
        data.buffer.asUint8List(data.offsetInBytes, data.lengthInBytes),
      );
      if (mounted) Navigator.of(context).pop(logo);
    } on ShopLogoException catch (error) {
      if (mounted) setState(() => _error = error.message);
    } catch (_) {
      if (mounted) {
        setState(
          () =>
              _error = 'Không thể xử lý ảnh dưới 1 MB. Vui lòng chọn ảnh khác.',
        );
      }
    } finally {
      cropped?.dispose();
      picture?.dispose();
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const Text('Cắt logo quán')),
        body: SafeArea(
          child: Padding(
            padding: const EdgeInsets.all(N11Space.pad),
            child: Column(
              children: <Widget>[
                const Text(
                  'Kéo ảnh để chọn phần logo trong khung vuông.',
                  style: N11Text.lead,
                ),
                const SizedBox(height: N11Space.gap4),
                Expanded(
                  child: Center(
                    child: AspectRatio(
                      aspectRatio: 1,
                      child: LayoutBuilder(
                        builder:
                            (BuildContext context, BoxConstraints bounds) =>
                                GestureDetector(
                          onPanUpdate: _saving || _reading
                              ? null
                              : (DragUpdateDetails d) => setState(
                                    () => _alignment = Alignment(
                                      (_alignment.x -
                                              d.delta.dx * 2 / bounds.maxWidth)
                                          .clamp(-1.0, 1.0),
                                      (_alignment.y -
                                              d.delta.dy * 2 / bounds.maxHeight)
                                          .clamp(-1.0, 1.0),
                                    ),
                                  ),
                          child: ClipRect(
                            child: _reading
                                ? const Center(child: Text('Đang đọc ảnh…'))
                                : _decoded == null
                                    ? const Center(
                                        child:
                                            Icon(Icons.broken_image_outlined),
                                      )
                                    : RawImage(
                                        image: _decoded,
                                        fit: BoxFit.cover,
                                        alignment: _alignment,
                                      ),
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
                if (_error != null)
                  Text(
                    _error!,
                    key: const Key('shop-logo-crop-error'),
                    style: const TextStyle(color: N11Colors.errorInk),
                  ),
                const SizedBox(height: N11Space.gap3),
                N11Button(
                  key: const Key('shop-logo-choose-other'),
                  label: 'Chọn ảnh khác',
                  kind: ButtonKind.secondary,
                  compact: true,
                  onPressed: _reading || _saving ? null : _choose,
                ),
                TextButton(
                  key: const Key('shop-logo-cancel'),
                  onPressed: () => Navigator.of(context).pop(),
                  child: const Text('Hủy'),
                ),
                N11Button(
                  key: const Key('shop-logo-crop-done'),
                  label: _saving ? 'Đang xử lý…' : 'Dùng ảnh này',
                  onPressed:
                      _decoded == null || _reading || _saving || _error != null
                          ? null
                          : _done,
                ),
              ],
            ),
          ),
        ),
      );
}
