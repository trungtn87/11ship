import 'dart:convert';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';

import '../account/session_controller.dart';
import '../m02/menu_models.dart';
import '../tokens.dart';
import '../widgets/components.dart';
import 'shop_logo_data.dart';

class ShopLogoField extends StatefulWidget {
  const ShopLogoField({super.key, required this.value, required this.picker, required this.session, required this.onChanged, this.enabled = true});
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
    final int epoch = widget.session.sessionEpoch;
    setState(() { _picking = true; _error = null; });
    try {
      final PickedImage? picked = await widget.picker.pick();
      if (!mounted || picked == null || !widget.enabled || widget.session.sessionEpoch != epoch) return;
      final ShopLogoData? cropped = await Navigator.of(context).push<ShopLogoData>(MaterialPageRoute<ShopLogoData>(builder: (_) => _LogoCropScreen(image: picked)));
      if (mounted && cropped != null && widget.enabled && widget.session.sessionEpoch == epoch) widget.onChanged(cropped);
    } catch (_) {
      if (mounted) setState(() => _error = 'Không đọc được ảnh. Chọn ảnh JPG, PNG hoặc WebP khác.');
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
      Row(children: <Widget>[
        ClipRRect(borderRadius: BorderRadius.circular(14), child: SizedBox(width: 80, height: 80, child: widget.value == null
          ? const ColoredBox(color: N11Colors.yellowSoft, child: Icon(Icons.storefront_outlined, size: 36))
          : Image.memory(widget.value!.bytes, fit: BoxFit.cover, errorBuilder: (_, __, ___) => const Icon(Icons.broken_image_outlined)))),
        const SizedBox(width: N11Space.gap3),
        Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: <Widget>[
          N11Button(key: const Key('shop-logo-pick'), label: _picking ? 'Đang chọn ảnh…' : widget.value == null ? 'Chọn logo' : 'Thay logo', kind: ButtonKind.secondary, compact: true, onPressed: !widget.enabled || _picking ? null : _pick),
          if (widget.value != null) TextButton(key: const Key('shop-logo-remove'), onPressed: !widget.enabled || _picking ? null : () => widget.onChanged(null), child: const Text('Gỡ logo')),
        ])),
      ]),
      if (_error != null) Text(_error!, key: const Key('shop-logo-error'), style: const TextStyle(color: N11Colors.errorInk)),
    ],
  );
}

class _LogoCropScreen extends StatefulWidget {
  const _LogoCropScreen({required this.image});
  final PickedImage image;
  @override
  State<_LogoCropScreen> createState() => _LogoCropScreenState();
}

class _LogoCropScreenState extends State<_LogoCropScreen> {
  ui.Image? _decoded;
  Alignment _alignment = Alignment.center;
  String? _error;
  bool _saving = false;

  @override
  void initState() { super.initState(); _decode(); }

  Future<void> _decode() async {
    try {
      final ui.Codec codec = await ui.instantiateImageCodec(widget.image.bytes);
      final ui.FrameInfo frame = await codec.getNextFrame();
      codec.dispose();
      if (!mounted) { frame.image.dispose(); return; }
      setState(() => _decoded = frame.image);
    } catch (_) { if (mounted) setState(() => _error = 'Ảnh không hợp lệ. Quay lại và chọn ảnh khác.'); }
  }

  @override
  void dispose() { _decoded?.dispose(); super.dispose(); }

  Future<void> _done() async {
    final ui.Image? image = _decoded;
    if (image == null || _saving) return;
    setState(() => _saving = true);
    try {
      final double edge = image.width < image.height ? image.width.toDouble() : image.height.toDouble();
      final Rect source = Rect.fromLTWH((image.width - edge) * (_alignment.x + 1) / 2, (image.height - edge) * (_alignment.y + 1) / 2, edge, edge);
      final ui.PictureRecorder recorder = ui.PictureRecorder();
      Canvas(recorder).drawImageRect(image, source, const Rect.fromLTWH(0, 0, 384, 384), Paint()..filterQuality = FilterQuality.high);
      final ui.Picture picture = recorder.endRecording();
      final ui.Image cropped = await picture.toImage(384, 384);
      picture.dispose();
      final data = await cropped.toByteData(format: ui.ImageByteFormat.png);
      cropped.dispose();
      if (data == null) throw const FormatException();
      final ShopLogoData logo = ShopLogoData(contentType: 'image/png', encoded: base64Encode(data.buffer.asUint8List(data.offsetInBytes, data.lengthInBytes)));
      if (mounted) Navigator.of(context).pop(logo);
    } catch (_) { if (mounted) setState(() { _saving = false; _error = 'Chưa cắt được ảnh. Thử lại.'; }); }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('Cắt logo quán')),
    body: SafeArea(child: Padding(padding: const EdgeInsets.all(N11Space.pad), child: Column(children: <Widget>[
      const Text('Kéo ảnh để chọn phần logo trong khung vuông.', style: N11Text.lead),
      const SizedBox(height: N11Space.gap4),
      Expanded(child: Center(child: AspectRatio(aspectRatio: 1, child: LayoutBuilder(builder: (BuildContext context, BoxConstraints bounds) => GestureDetector(
        onPanUpdate: _saving ? null : (DragUpdateDetails d) => setState(() => _alignment = Alignment((_alignment.x - d.delta.dx * 2 / bounds.maxWidth).clamp(-1.0, 1.0), (_alignment.y - d.delta.dy * 2 / bounds.maxHeight).clamp(-1.0, 1.0))),
        child: ClipRect(child: Image.memory(widget.image.bytes, fit: BoxFit.cover, alignment: _alignment, errorBuilder: (_, __, ___) => const Icon(Icons.broken_image_outlined))),
      ))))),
      if (_error != null) Text(_error!, style: const TextStyle(color: N11Colors.errorInk)),
      const SizedBox(height: N11Space.gap4),
      N11Button(key: const Key('shop-logo-crop-done'), label: _saving ? 'Đang cắt…' : 'Dùng ảnh này', onPressed: _decoded == null || _saving ? null : _done),
    ]))),
  );
}
