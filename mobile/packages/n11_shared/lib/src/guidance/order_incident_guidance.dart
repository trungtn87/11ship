import 'package:flutter/material.dart';
import '../tokens.dart';
import '../widgets/components.dart';
import '../m07/m07_models.dart';

/// Hướng dẫn xử lý sự cố trong đơn theo trạng thái thực tế (#217).
class OrderIncidentGuidance extends StatefulWidget {
  const OrderIncidentGuidance({
    super.key,
    required this.role,
    this.orderStatus,
    this.deliveryState,
    this.hasShipper = false,
    this.customerPhone,
    this.shopPhone,
    this.shipperPhone,
    this.onCallCustomer,
    this.onCallShop,
    this.onCallShipper,
    this.onOpenChat,
    this.onRequestAddressChange,
    this.canRequestAddressChange = false,
    this.feePending = false,
    this.isAfterPickup = false,
    this.incident,
    this.initiallyExpanded = false,
  });

  /// 'CUSTOMER' | 'SHOP' | 'SHIPPER'
  final String role;
  final String? orderStatus;
  final String? deliveryState;
  final bool hasShipper;
  final String? customerPhone;
  final String? shopPhone;
  final String? shipperPhone;
  final VoidCallback? onCallCustomer;
  final VoidCallback? onCallShop;
  final VoidCallback? onCallShipper;
  final VoidCallback? onOpenChat;
  final VoidCallback? onRequestAddressChange;
  final bool canRequestAddressChange;
  final bool feePending;
  final bool isAfterPickup;
  final IncidentView? incident;
  final bool initiallyExpanded;

  @override
  State<OrderIncidentGuidance> createState() => _OrderIncidentGuidanceState();
}

class _OrderIncidentGuidanceState extends State<OrderIncidentGuidance> {
  late bool _expanded;

  @override
  void initState() {
    super.initState();
    _expanded = widget.initiallyExpanded;
  }

  @override
  Widget build(BuildContext context) {
    return N11Card(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          InkWell(
            onTap: () => setState(() => _expanded = !_expanded),
            child: Row(
              children: <Widget>[
                const Icon(Icons.help_outline, size: 20, color: N11Colors.accentOrange),
                const SizedBox(width: N11Space.gap2),
                const Expanded(
                  child: Text(
                    'Hướng dẫn xử lý sự cố',
                    style: TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: N11Colors.black),
                  ),
                ),
                Icon(
                  _expanded ? Icons.expand_less : Icons.expand_more,
                  size: 22,
                  color: N11Colors.ink2,
                ),
              ],
            ),
          ),
          if (_expanded) ...<Widget>[
            const SizedBox(height: N11Space.gap3),
            const Divider(height: 1, thickness: 1, color: N11Colors.line),
            const SizedBox(height: N11Space.gap3),

            // 1. Không liên lạc được
            _buildContactSection(),

            const SizedBox(height: N11Space.gap3),

            // 2. Sai địa chỉ
            _buildAddressSection(),

            const SizedBox(height: N11Space.gap3),

            // 3. Không giao được hàng / Hàng đang giữ (Custody)
            _buildDeliveryIssueSection(),

            // 4. Chờ duyệt phí
            if (widget.feePending) ...<Widget>[
              const SizedBox(height: N11Space.gap3),
              _buildFeeSection(),
            ],
          ],
        ],
      ),
    );
  }

  Widget _buildContactSection() {
    String text;
    if (widget.role == 'CUSTOMER') {
      text = widget.hasShipper
          ? 'Nếu không liên lạc được shipper hoặc quán, hãy dùng nút Gọi hoặc Chat bên dưới. Nếu quá 10 phút không phản hồi, bạn có thể liên hệ hỗ trợ hoặc hủy đơn (khi shipper chưa lấy hàng).'
          : 'Nếu quán chưa xác nhận hoặc không gọi được quán qua điện thoại, bạn có thể hủy đơn khi còn trong thời gian chờ xác nhận.';
    } else if (widget.role == 'SHOP') {
      text = 'Khi không liên lạc được khách để chốt đơn hoặc giao hàng, hãy gọi qua số điện thoại đơn hàng hoặc nhắn tin chat trong đơn. Nếu không có phản hồi, quán có thể từ chối đơn trước khi làm món.';
    } else {
      // SHIPPER
      text = 'Khi đến điểm giao mà không gọi được khách: Gọi tối thiểu 3 cuộc cách nhau 2-3 phút và gửi tin nhắn chat. Nếu sau 10-15 phút vẫn không nhận hàng, chọn "Giao thất bại" và ghi nhận lý do.';
    }

    return _GuidanceBlock(
      title: 'Không liên lạc được đối tác/khách',
      icon: Icons.phone_disabled_outlined,
      content: text,
      actions: <Widget>[
        if (widget.onOpenChat != null)
          N11Button(
            label: 'Nhắn tin Chat',
            kind: ButtonKind.secondary,
            compact: true,
            icon: Icons.chat_bubble_outline,
            onPressed: widget.onOpenChat,
          ),
        if (widget.role == 'CUSTOMER' && widget.onCallShipper != null)
          N11Button(
            label: 'Gọi Shipper',
            kind: ButtonKind.secondary,
            compact: true,
            icon: Icons.phone,
            onPressed: widget.onCallShipper,
          ),
        if (widget.role == 'CUSTOMER' && widget.onCallShop != null)
          N11Button(
            label: 'Gọi Quán',
            kind: ButtonKind.secondary,
            compact: true,
            icon: Icons.phone,
            onPressed: widget.onCallShop,
          ),
        if (widget.role != 'CUSTOMER' && widget.onCallCustomer != null)
          N11Button(
            label: 'Gọi Khách',
            kind: ButtonKind.secondary,
            compact: true,
            icon: Icons.phone,
            onPressed: widget.onCallCustomer,
          ),
      ],
    );
  }

  Widget _buildAddressSection() {
    String text;
    if (widget.isAfterPickup) {
      text = 'Đơn hàng đã được lấy. Theo quy định, không thể sửa địa chỉ hoặc phí trực tiếp trên ứng dụng sau khi đã lấy hàng. Shipper và khách vui lòng liên hệ trực tiếp để thống nhất giao tận tay.';
    } else if (widget.canRequestAddressChange) {
      text = 'Nếu nhập sai địa chỉ hoặc muốn đổi người nhận, hãy bấm nút "Xin đổi địa chỉ" bên dưới. Yêu cầu sẽ được chuyển đến Quán/Shipper duyệt trước khi có hiệu lực.';
    } else {
      text = 'Địa chỉ giao hàng có thể xin thay đổi trước khi shipper lấy hàng. Sau khi shipper đã nhận đơn, việc đổi địa chỉ cần có sự chấp thuận của shipper.';
    }

    return _GuidanceBlock(
      title: 'Nhập sai hoặc cần đổi địa chỉ',
      icon: Icons.location_on_outlined,
      content: text,
      actions: <Widget>[
        if (widget.canRequestAddressChange && widget.onRequestAddressChange != null)
          N11Button(
            label: 'Xin đổi địa chỉ',
            kind: ButtonKind.primary,
            compact: true,
            icon: Icons.edit_location_alt_outlined,
            onPressed: widget.onRequestAddressChange,
          ),
      ],
    );
  }

  Widget _buildDeliveryIssueSection() {
    String text;
    if (widget.incident != null) {
      text = 'Đang xử lý biên bản sự cố. Nếu shipper đã hoàn trả hàng về lại quán, quán vui lòng bấm "Xác nhận nhận lại hàng" để kết thúc.';
    } else if (widget.role == 'SHIPPER') {
      text = 'Nếu gặp sự cố không thể giao (khách từ chối, sai địa chỉ không tìm thấy, hỏng xe), hãy bấm "Báo giao thất bại". Sau đó mang hàng trả lại quán hoặc liên hệ tổng đài hỗ trợ.';
    } else if (widget.role == 'SHOP') {
      text = 'Nếu shipper báo giao thất bại và mang trả hàng về quán, quán kiểm tra hàng và bấm "Xác nhận nhận lại hàng" để hoàn tất biên bản sự cố.';
    } else {
      text = 'Nếu đơn giao không thành công, hệ thống sẽ mở biên bản sự cố. Bạn có thể xem trạng thái hàng và liên hệ quán/shipper để được hỗ trợ giải quyết.';
    }

    return _GuidanceBlock(
      title: 'Không giao được / Xử lý hàng đang giữ',
      icon: Icons.inventory_2_outlined,
      content: text,
    );
  }

  Widget _buildFeeSection() {
    return const _GuidanceBlock(
      title: 'Chờ xác nhận phí thay đổi',
      icon: Icons.monetization_on_outlined,
      content: 'Mức phí giao hàng đang được đề xuất điều chỉnh. Người trả phí cần xác nhận đồng ý mức phí mới trước khi shipper thực hiện lấy hàng. Nếu từ chối, mức phí và tuyến đường ban đầu sẽ được giữ nguyên.',
    );
  }
}

class _GuidanceBlock extends StatelessWidget {
  const _GuidanceBlock({
    required this.title,
    required this.icon,
    required this.content,
    this.actions = const <Widget>[],
  });

  final String title;
  final IconData icon;
  final String content;
  final List<Widget> actions;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Row(
          children: <Widget>[
            Icon(icon, size: 16, color: N11Colors.ink2),
            const SizedBox(width: N11Space.gap2),
            Expanded(
              child: Text(
                title,
                style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: N11Colors.black),
              ),
            ),
          ],
        ),
        const SizedBox(height: 4),
        Text(
          content,
          style: const TextStyle(fontSize: 12, height: 1.4, color: N11Colors.ink2),
        ),
        if (actions.isNotEmpty) ...<Widget>[
          const SizedBox(height: N11Space.gap2),
          Wrap(
            spacing: N11Space.gap2,
            runSpacing: N11Space.gap2,
            children: actions,
          ),
        ],
      ],
    );
  }
}

/// Hướng dẫn cho Shipper khi gặp trở ngại Online, Rút tiền hoặc Đóng hoạt động (#217).
class ShipperOperationalGuidanceSheet extends StatelessWidget {
  const ShipperOperationalGuidanceSheet({super.key});

  static Future<void> show(BuildContext context) {
    return showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: N11Colors.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (_) => const ShipperOperationalGuidanceSheet(),
    );
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
                    'Hướng dẫn hoạt động Shipper',
                    style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800, color: N11Colors.black),
                  ),
                  IconButton(
                    icon: const Icon(Icons.close),
                    onPressed: () => Navigator.of(context).pop(),
                  ),
                ],
              ),
              const Divider(color: N11Colors.line),
              const SizedBox(height: N11Space.gap2),

              const _GuidanceBlock(
                title: 'Không thể Bật Online nhận đơn',
                icon: Icons.wifi_tethering_off,
                content: '1. Bật GPS trên máy và cấp quyền vị trí chính xác ("Luôn cho phép" hoặc "Khi dùng ứng dụng").\n'
                    '2. Đảm bảo số dư ví ký quỹ đủ mức tối thiểu quy định.\n'
                    '3. Kiểm tra trạng thái tài khoản tài xế đã được kích hoạt và không bị khóa tạm thời.',
              ),
              const SizedBox(height: N11Space.gap4),

              const _GuidanceBlock(
                title: 'Không thể Rút tiền từ ví',
                icon: Icons.account_balance_wallet_outlined,
                content: '1. Cần liên kết tài khoản ngân hàng chính chủ và đã được phê duyệt.\n'
                    '2. Số dư khả dụng phải lớn hơn số tiền muốn rút cộng hạn mức giữ lại tối thiểu.\n'
                    '3. Không có đơn đang thực hiện hoặc đang xử lý tranh chấp giữ cọc.',
              ),
              const SizedBox(height: N11Space.gap4),

              const _GuidanceBlock(
                title: 'Không thể Đóng hoạt động / Nghỉ ca',
                icon: Icons.power_settings_new_outlined,
                content: '1. Cần hoàn tất tất cả các đơn hàng đang nhận trước khi tắt ứng dụng.\n'
                    '2. Nếu có đơn chưa lấy hàng muốn hủy, cần trả chuyến đúng quy định.\n'
                    '3. Nếu có hàng đang giữ (custody) do giao thất bại, cần hoàn trả về quán trước khi kết thúc ca.',
              ),
              const SizedBox(height: N11Space.gap4),

              SizedBox(
                width: double.infinity,
                child: N11Button(
                  label: 'Đã hiểu',
                  kind: ButtonKind.primary,
                  onPressed: () => Navigator.of(context).pop(),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
