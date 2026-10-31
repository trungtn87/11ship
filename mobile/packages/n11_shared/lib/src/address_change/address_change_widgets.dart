import 'package:flutter/material.dart';
import '../tokens.dart';
import '../widgets/components.dart';
import '../addresses/address_location_picker.dart';
import 'address_change_models.dart';

/// Hiển thị banner trạng thái yêu cầu đổi địa chỉ và các nút thao tác (#218).
class AddressChangeBanner extends StatelessWidget {
  const AddressChangeBanner({
    super.key,
    required this.request,
    this.canCancel = false,
    this.canDecide = false,
    this.onCancel,
    this.onAccept,
    this.onReject,
  });

  final AddressChangeView request;
  final bool canCancel;
  final bool canDecide;
  final VoidCallback? onCancel;
  final VoidCallback? onAccept;
  final void Function(String reason)? onReject;

  @override
  Widget build(BuildContext context) {
    if (request.isPending) {
      final String targetText = request.targetActor == 'SHOP' ? 'Quán' : 'Shipper';
      final int diff = request.feeDifferenceVnd ?? 0;
      final String feeText = diff > 0
          ? ' (+${_formatMoney(diff)})'
          : diff < 0
              ? ' (${_formatMoney(diff)})'
              : '';

      return N11Card(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Row(
              children: <Widget>[
                const Icon(Icons.edit_location_alt, size: 20, color: N11Colors.accentOrange),
                const SizedBox(width: N11Space.gap2),
                Expanded(
                  child: Text(
                    'Đang xin đổi địa chỉ (Chờ $targetText duyệt)',
                    style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: N11Colors.black),
                  ),
                ),
                if (request.timeRemainingSeconds > 0)
                  N11Chip('${request.timeRemainingSeconds}s', kind: ChipKind.warn),
              ],
            ),
            const SizedBox(height: N11Space.gap2),
            Text(
              'Người nhận mới: ${request.newRecipient.name} • ${request.newRecipient.phone}',
              style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: N11Colors.black),
            ),
            const SizedBox(height: 2),
            Text(
              'Địa chỉ mới: ${request.newRecipient.addressText}',
              style: const TextStyle(fontSize: 12, color: N11Colors.ink2),
            ),
            if (request.targetActor == 'SHIPPER') ...<Widget>[
              const SizedBox(height: 2),
              Text(
                request.originalFeeVnd != null
                    ? 'Phí giao hàng: ${_formatMoney(request.originalFeeVnd!)} (giữ nguyên cước hiện tại; nếu cần điều chỉnh phí sẽ qua đề xuất phí riêng)'
                    : 'Phí giao hàng: Giữ nguyên cước hiện tại; nếu cần điều chỉnh phí sẽ qua đề xuất phí riêng',
                style: const TextStyle(fontSize: 12, color: N11Colors.ink2),
              ),
            ] else if (request.newFeeVnd != null && request.originalFeeVnd != null) ...<Widget>[
              const SizedBox(height: 2),
              Text(
                'Phí giao hàng: ${_formatMoney(request.originalFeeVnd!)} ➔ ${_formatMoney(request.newFeeVnd!)}$feeText',
                style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: N11Colors.black),
              ),
            ] else if (request.originalFeeVnd != null) ...<Widget>[
              const SizedBox(height: 2),
              Text(
                'Phí giao hàng: ${_formatMoney(request.originalFeeVnd!)} (giữ nguyên cước)',
                style: const TextStyle(fontSize: 12, color: N11Colors.ink2),
              ),
            ],
            if (request.note != null && request.note!.isNotEmpty) ...<Widget>[
              const SizedBox(height: 2),
              Text(
                'Ghi chú: ${request.note}',
                style: const TextStyle(fontSize: 12, fontStyle: FontStyle.italic, color: N11Colors.ink3),
              ),
            ],
            if (canCancel && onCancel != null) ...<Widget>[
              const SizedBox(height: N11Space.gap3),
              SizedBox(
                width: double.infinity,
                child: N11Button(
                  label: 'Hủy yêu cầu đổi địa chỉ',
                  kind: ButtonKind.secondary,
                  compact: true,
                  onPressed: onCancel,
                ),
              ),
            ],
            if (canDecide && onAccept != null && onReject != null) ...<Widget>[
              const SizedBox(height: N11Space.gap3),
              Row(
                children: <Widget>[
                  Expanded(
                    child: N11Button(
                      label: 'Từ chối',
                      kind: ButtonKind.secondary,
                      compact: true,
                      onPressed: () => _showRejectDialog(context),
                    ),
                  ),
                  const SizedBox(width: N11Space.gap2),
                  Expanded(
                    child: N11Button(
                      label: 'Đồng ý',
                      kind: ButtonKind.primary,
                      compact: true,
                      onPressed: onAccept,
                    ),
                  ),
                ],
              ),
            ],
          ],
        ),
      );
    }

    if (request.isRejected) {
      return N11Banner(
        kind: BannerKind.error,
        title: 'Yêu cầu đổi địa chỉ bị từ chối',
        text: request.rejectReason ?? 'Không thể áp dụng địa chỉ mới. Đơn giữ nguyên địa chỉ ban đầu.',
      );
    }

    if (request.status == 'EXPIRED') {
      return const N11Banner(
        kind: BannerKind.warn,
        title: 'Yêu cầu đổi địa chỉ đã hết hạn',
        text: 'Đối tác chưa phản hồi kịp thời gian. Đơn tiếp tục giao theo địa chỉ ban đầu.',
      );
    }

    if (request.isAccepted) {
      return const N11Banner(
        kind: BannerKind.success,
        title: 'Đã đổi địa chỉ giao hàng',
        text: 'Địa chỉ giao hàng và thông tin người nhận đã được cập nhật thành công.',
      );
    }

    return const SizedBox.shrink();
  }

  void _showRejectDialog(BuildContext context) {
    final TextEditingController controller = TextEditingController();
    showDialog<void>(
      context: context,
      builder: (BuildContext ctx) => AlertDialog(
        title: const Text('Từ chối đổi địa chỉ', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            const Text(
              'Vui lòng nhập lý do từ chối để đối tác nắm thông tin:',
              style: TextStyle(fontSize: 13, color: N11Colors.ink2),
            ),
            const SizedBox(height: N11Space.gap2),
            TextField(
              controller: controller,
              decoration: const InputDecoration(
                hintText: 'VD: Tuyến đường quá xa hoặc không tiện giao',
                border: OutlineInputBorder(),
              ),
              maxLines: 2,
            ),
          ],
        ),
        actions: <Widget>[
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(),
            child: const Text('Đóng'),
          ),
          ElevatedButton(
            onPressed: () {
              Navigator.of(ctx).pop();
              onReject?.call(controller.text.trim());
            },
            child: const Text('Xác nhận từ chối'),
          ),
        ],
      ),
    );
  }

  static String _formatMoney(int amount) {
    return '${amount.toString().replaceAllMapped(RegExp(r'(\d{1,3})(?=(\d{3})+(?!\d))'), (Match m) => '${m[1]}.')} đ';
  }
}

/// Bottom Sheet nhập thông tin xin đổi địa chỉ (#218).
class AddressChangeRequestSheet extends StatefulWidget {
  const AddressChangeRequestSheet({
    super.key,
    required this.initialName,
    required this.initialPhone,
    required this.initialAddress,
    this.initialLat,
    this.initialLng,
    required this.onSubmit,
  });

  final String initialName;
  final String initialPhone;
  final String initialAddress;
  final double? initialLat;
  final double? initialLng;
  final Future<void> Function({
    required String name,
    required String phone,
    required String address,
    double? lat,
    double? lng,
    String? note,
  }) onSubmit;

  static Future<void> show(
    BuildContext context, {
    required String initialName,
    required String initialPhone,
    required String initialAddress,
    double? initialLat,
    double? initialLng,
    required Future<void> Function({
      required String name,
      required String phone,
      required String address,
      double? lat,
      double? lng,
      String? note,
    }) onSubmit,
  }) {
    return showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: N11Colors.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (_) => Padding(
        padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
        child: AddressChangeRequestSheet(
          initialName: initialName,
          initialPhone: initialPhone,
          initialAddress: initialAddress,
          initialLat: initialLat,
          initialLng: initialLng,
          onSubmit: onSubmit,
        ),
      ),
    );
  }

  @override
  State<AddressChangeRequestSheet> createState() => _AddressChangeRequestSheetState();
}

class _AddressChangeRequestSheetState extends State<AddressChangeRequestSheet> {
  late final TextEditingController _nameCtrl;
  late final TextEditingController _phoneCtrl;
  late final TextEditingController _addressCtrl;
  late final TextEditingController _noteCtrl;
  double? _lat;
  double? _lng;

  bool _submitting = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _nameCtrl = TextEditingController(text: widget.initialName);
    _phoneCtrl = TextEditingController(text: widget.initialPhone);
    _addressCtrl = TextEditingController(text: widget.initialAddress);
    _noteCtrl = TextEditingController();
    _lat = widget.initialLat;
    _lng = widget.initialLng;
  }

  @override
  void dispose() {
    _nameCtrl.dispose();
    _phoneCtrl.dispose();
    _addressCtrl.dispose();
    _noteCtrl.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final String name = _nameCtrl.text.trim();
    final String phone = _phoneCtrl.text.trim();
    final String address = _addressCtrl.text.trim();
    final String note = _noteCtrl.text.trim();

    if (name.isEmpty) {
      setState(() => _error = 'Vui lòng nhập tên người nhận');
      return;
    }
    final String digits = phone.replaceAll(RegExp(r'\D'), '');
    if (digits.length < 9 || digits.length > 15) {
      setState(() => _error = 'Số điện thoại không hợp lệ');
      return;
    }
    if (address.isEmpty) {
      setState(() => _error = 'Vui lòng nhập địa chỉ nhận hàng mới');
      return;
    }

    setState(() {
      _submitting = true;
      _error = null;
    });

    try {
      await widget.onSubmit(
        name: name,
        phone: phone,
        address: address,
        lat: _lat,
        lng: _lng,
        note: note.isNotEmpty ? note : null,
      );
      if (mounted) {
        Navigator.of(context).pop();
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _submitting = false;
          _error = e.toString().replaceFirst('Exception: ', '');
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.all(N11Space.gap4),
        child: SingleChildScrollView(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: <Widget>[
                  const Text(
                    'Xin đổi địa chỉ giao hàng',
                    style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800, color: N11Colors.black),
                  ),
                  IconButton(
                    icon: const Icon(Icons.close),
                    onPressed: () => Navigator.of(context).pop(),
                  ),
                ],
              ),
              const Text(
                'Yêu cầu sẽ cần Quán hoặc Shipper duyệt trước khi có hiệu lực.',
                style: TextStyle(fontSize: 13, color: N11Colors.ink2),
              ),
              const SizedBox(height: N11Space.gap3),

              if (_error != null) ...<Widget>[
                N11Banner(kind: BannerKind.error, title: 'Lỗi', text: _error!),
                const SizedBox(height: N11Space.gap3),
              ],

              TextField(
                controller: _nameCtrl,
                decoration: const InputDecoration(
                  labelText: 'Tên người nhận *',
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: N11Space.gap3),

              TextField(
                controller: _phoneCtrl,
                keyboardType: TextInputType.phone,
                decoration: const InputDecoration(
                  labelText: 'Số điện thoại người nhận *',
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: N11Space.gap3),

              TextField(
                controller: _addressCtrl,
                maxLines: 2,
                decoration: const InputDecoration(
                  labelText: 'Địa chỉ nhận hàng mới *',
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: N11Space.gap1),
              Row(
                children: <Widget>[
                  Expanded(
                    child: Text(
                      _lat != null && _lng != null
                          ? 'Tọa độ: ${_lat!.toStringAsFixed(4)}, ${_lng!.toStringAsFixed(4)}'
                          : 'Địa chỉ chữ (chưa ghim tọa độ, giữ nguyên cước phí hiện tại)',
                      style: const TextStyle(fontSize: 12, color: N11Colors.ink2),
                    ),
                  ),
                  if (_lat != null && _lng != null)
                    IconButton(
                      icon: const Icon(Icons.clear, size: 16, color: N11Colors.ink3),
                      tooltip: 'Bỏ ghim tọa độ',
                      onPressed: () {
                        setState(() {
                          _lat = null;
                          _lng = null;
                        });
                      },
                    ),
                  TextButton.icon(
                    icon: const Icon(Icons.place_outlined, size: 16),
                    label: Text(_lat != null && _lng != null ? 'Sửa vị trí' : 'Chọn vị trí trên bản đồ'),
                    onPressed: () async {
                      final AddressLocation? selected = await Navigator.of(context).push<AddressLocation>(
                        MaterialPageRoute<AddressLocation>(
                          builder: (_) => AddressLocationPicker(
                            initial: AddressLocation(_addressCtrl.text, latitude: _lat, longitude: _lng),
                            requirePoint: false,
                          ),
                        ),
                      );
                      if (selected != null && mounted) {
                        setState(() {
                          _addressCtrl.text = selected.text;
                          _lat = selected.latitude;
                          _lng = selected.longitude;
                        });
                      }
                    },
                  ),
                ],
              ),
              const SizedBox(height: N11Space.gap3),

              TextField(
                controller: _noteCtrl,
                decoration: const InputDecoration(
                  labelText: 'Lý do / Ghi chú thêm',
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: N11Space.gap4),

              SizedBox(
                width: double.infinity,
                child: N11Button(
                  label: _submitting ? 'Đang gửi yêu cầu...' : 'Gửi yêu cầu đổi địa chỉ',
                  kind: ButtonKind.primary,
                  loading: _submitting,
                  onPressed: _submitting ? null : _submit,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
