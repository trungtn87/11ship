import 'package:flutter/material.dart';

import '../account/account_views.dart';
import '../account/session_controller.dart';
import '../account/models.dart';
import '../m02/m02_widgets.dart';
import '../tokens.dart';
import '../widgets/components.dart';
import '../widgets/form_feedback.dart';
import 'address_controller.dart';
import 'address_models.dart';
import 'address_location_picker.dart';

// M05-B screens (approved UI 11Ship-M05-UI-Approved-v1.0): Sổ địa chỉ, form thêm / sửa, and the reusable delivery-address picker
// that checkout (M10) will embed. Words are fixed here; nothing the server wrote is shown except the person's own address data.

/// The words of a refusal on the address screens.
String addressFailureText(AuthFailure failure) {
  switch (failure.code) {
    case 'CUSTOMER_ADDRESS_NOT_FOUND':
      return 'Địa chỉ này không còn trong sổ địa chỉ. Đã tải lại danh sách.';
    case 'INVALID_PHONE':
      return 'Số điện thoại chưa hợp lệ. Nhập số di động Việt Nam, ví dụ 0912 345 678.';
    case 'CUSTOMER_ROLE_REQUIRED':
      return 'Hãy chuyển sang chế độ khách hàng để dùng sổ địa chỉ.';
  }
  if (failure.status == 403 && failure.kind != AuthFailureKind.deviceProofRefused && failure.kind != AuthFailureKind.accountDisabled) {
    return 'Tài khoản này chưa dùng được sổ địa chỉ.';
  }
  switch (failure.kind) {
    case AuthFailureKind.versionConflict:
      return 'Địa chỉ đã được cập nhật ở nơi khác. Đã tải bản mới; kiểm tra rồi lưu lại nếu cần.';
    case AuthFailureKind.unknownOutcome:
    case AuthFailureKind.serverUnavailable:
      return failure.outcomeUnknown ? 'Chưa xác định được kết quả. Nhấn "Thử lại" để gửi lại đúng yêu cầu đó.' : 'Máy chủ chưa sẵn sàng. Vui lòng thử lại sau.';
    default:
      return m02FailureText(failure);
  }
}

// ---- Sổ địa chỉ ------------------------------------------------------------------------------------------------------

/// The entry of the account tab (signed-in only).
Widget addressBookEntry(BuildContext context, AddressBookController controller) => N11ListItem(
      key: const Key('account-address-book'),
      icon: Icons.location_on_outlined,
      title: 'Địa chỉ của tôi',
      sub: 'Địa chỉ nhận và giao hàng của bạn',
      onTap: () => Navigator.of(context).push(n11Route(AddressBookScreen(controller: controller))),
    );

class AddressBookScreen extends StatefulWidget {
  const AddressBookScreen({super.key, required this.controller});

  final AddressBookController controller;

  @override
  State<AddressBookScreen> createState() => _AddressBookScreenState();
}

class _AddressBookScreenState extends State<AddressBookScreen> {
  int _seenNotice = 0;
  final TextEditingController _search = TextEditingController();

  AddressBookController get c => widget.controller;

  @override
  void initState() {
    super.initState();
    _seenNotice = c.noticeSeq;
    c.addListener(_onChange);
    WidgetsBinding.instance.addPostFrameCallback((_) => c.load());
  }

  @override
  void dispose() {
    c.removeListener(_onChange);
    _search.dispose();
    super.dispose();
  }

  void _onChange() {
    if (!mounted) {
      return;
    }
    if (c.noticeSeq != _seenNotice) {
      _seenNotice = c.noticeSeq;
      final String? text = c.notice;
      if (text != null) {
        m02Toast(context, text);
      }
    }
  }

  Future<void> _open({DeliveryAddress? editing}) async {
    c.clearWriteState();
    await Navigator.of(context).push(n11Route(AddressFormScreen(controller: c, editing: editing)));
  }

  Future<void> _delete(DeliveryAddress a) async {
    final String? choice = await showDecision(
      context,
      title: 'Xóa địa chỉ này?',
      text: 'Địa chỉ sẽ bị xóa khỏi sổ địa chỉ. Các đơn đã đặt không bị ảnh hưởng.',
      actions: const <DialogAction>[DialogAction('Giữ lại', 'keep'), DialogAction('Xóa địa chỉ', 'delete', kind: ButtonKind.dark, key: Key('address-confirm-delete'))],
    );
    if (choice == 'delete') {
      await c.delete(a.id);
    }
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: c,
      builder: (BuildContext context, Widget? _) {
        final bool showList = c.addresses.isNotEmpty;
        final String query = _search.text.trim().toLowerCase();
        final List<DeliveryAddress> visible = c.addresses.where((DeliveryAddress a) => query.isEmpty || <String?>[a.displayName, a.recipientName, a.contactPhone, a.addressText].any((String? value) => (value ?? '').toLowerCase().contains(query))).toList();
        final List<Widget> content = <Widget>[];
        if (c.pending != null) {
          content.add(_PendingBanner(controller: c));
        } else if (c.writeFailure != null) {
          content.add(N11Banner(key: const Key('address-write-error'), kind: BannerKind.error, title: 'Chưa thực hiện được', text: addressFailureText(c.writeFailure!)));
        }
        if (c.loadState == AddressLoad.idle || (c.loadState == AddressLoad.loading && !showList)) {
          content.add(const M02Skeleton(rows: 3, height: 96));
        } else if (c.loadState == AddressLoad.failed && !showList) {
          content.add(M02LoadFailed(onRetry: c.load, text: 'Chưa nhận được sổ địa chỉ từ máy chủ. ${addressFailureText(c.loadFailure!)}'));
        } else if (!showList) {
          content.add(const EmptyState(icon: Icons.location_off_outlined, title: 'Chưa có địa chỉ', text: 'Thêm địa chỉ để nhận hoặc giao hàng nhanh hơn. Bạn có thể tự chọn từng loại mặc định.'));
        } else {
          content.add(N11Field(fieldKey: const Key('address-search'), label: 'Tìm địa chỉ', controller: _search, maxLength: 120, placeholder: 'Tên gợi nhớ, địa chỉ hoặc số điện thoại', onChanged: () => setState(() {})));
          if (c.loadState == AddressLoad.failed) {
            content.add(N11Banner(
              key: const Key('address-stale'),
              kind: BannerKind.warn,
              title: 'Danh sách có thể chưa mới nhất',
              text: 'Chưa tải lại được từ máy chủ.',
              trailing: N11Button(key: const Key('address-reload'), label: 'Thử lại', compact: true, kind: ButtonKind.secondary, onPressed: c.load),
            ));
          }
          for (final DeliveryAddress a in visible) {
            content.add(AddressCard(
              address: a,
              locked: c.locked,
              onEdit: () => _open(editing: a),
              onDelete: () => _delete(a),
              onPickupDefault: () => c.setDefault(a.id, AddressDefaultKind.pickup, !a.isPickupDefault),
              onDeliveryDefault: () => c.setDefault(a.id, AddressDefaultKind.delivery, !a.isDeliveryDefault),
            ));
          }
        }
        return M02Scaffold(
          title: 'Địa chỉ của tôi',
          content: content,
          footer: <Widget>[
            N11Button(key: const Key('address-add'), label: '+ Thêm địa chỉ mới', loading: c.busy, onPressed: c.locked || c.loadState == AddressLoad.idle ? null : () => _open()),
          ],
        );
      },
    );
  }
}

class _PendingBanner extends StatelessWidget {
  const _PendingBanner({required this.controller});

  final AddressBookController controller;

  @override
  Widget build(BuildContext context) {
    return N11Banner(
      key: const Key('address-pending'),
      kind: BannerKind.warn,
      title: 'Chưa xác định được kết quả',
      text: addressFailureText(controller.writeFailure!),
      trailing: N11Button(key: const Key('address-retry'), label: 'Thử lại', compact: true, loading: controller.busy, onPressed: controller.busy ? null : controller.retryPending),
    );
  }
}

/// One address of the book. Reused by the picker (selectable) and the list (actions).
class AddressCard extends StatelessWidget {
  const AddressCard({super.key, required this.address, this.locked = false, this.onEdit, this.onDelete, this.onPickupDefault, this.onDeliveryDefault});

  final DeliveryAddress address;
  final bool locked;
  final VoidCallback? onEdit;
  final VoidCallback? onDelete;
  final VoidCallback? onPickupDefault;
  final VoidCallback? onDeliveryDefault;

  @override
  Widget build(BuildContext context) {
    final String who = <String>[if ((address.recipientName ?? '').isNotEmpty) address.recipientName!, address.phoneText].join(' · ');
    return N11Card(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(children: <Widget>[
            N11Chip(address.displayName ?? address.label.text, kind: ChipKind.neutral),
            if (address.isPickupDefault) ...<Widget>[const SizedBox(width: N11Space.gap2), const N11Chip('Nhận mặc định', kind: ChipKind.yellow)],
            if (address.isDeliveryDefault) ...<Widget>[const SizedBox(width: N11Space.gap2), const N11Chip('Giao mặc định', kind: ChipKind.yellow)],
          ]),
          const SizedBox(height: N11Space.gap2),
          Text(who, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: N11Colors.black)),
          const SizedBox(height: 2),
          Text(address.addressText, style: N11Text.lead),
          if ((address.deliveryNote ?? '').isNotEmpty) ...<Widget>[
            const SizedBox(height: 2),
            Text('Ghi chú: ${address.deliveryNote}', style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w500, color: N11Colors.ink2)),
          ],
          if (onEdit != null || onDelete != null || onPickupDefault != null || onDeliveryDefault != null) ...<Widget>[
            const SizedBox(height: N11Space.gap3),
            Wrap(spacing: N11Space.gap2, runSpacing: N11Space.gap2, children: <Widget>[
              if (onEdit != null) N11Button(key: Key('address-edit-${address.id}'), label: 'Sửa', compact: true, kind: ButtonKind.secondary, onPressed: locked ? null : onEdit),
              if (onDelete != null) N11Button(key: Key('address-delete-${address.id}'), label: 'Xóa', compact: true, kind: ButtonKind.secondary, onPressed: locked ? null : onDelete),
              if (onPickupDefault != null) N11Button(key: Key('address-pickup-default-${address.id}'), label: address.isPickupDefault ? 'Bỏ mặc định nhận' : 'Mặc định nhận', compact: true, kind: ButtonKind.secondary, onPressed: locked ? null : onPickupDefault),
              if (onDeliveryDefault != null) N11Button(key: Key('address-delivery-default-${address.id}'), label: address.isDeliveryDefault ? 'Bỏ mặc định giao' : 'Mặc định giao', compact: true, kind: ButtonKind.secondary, onPressed: locked ? null : onDeliveryDefault),
            ]),
          ],
        ],
      ),
    );
  }
}

// ---- Thêm / sửa địa chỉ -----------------------------------------------------------------------------------------------

final RegExp _vnPhone = RegExp(r'^(?:\+84|84|0)[0-9]{9}$');

class AddressFormScreen extends StatefulWidget {
  const AddressFormScreen({super.key, required this.controller, this.editing});

  final AddressBookController controller;

  /// null = a new address.
  final DeliveryAddress? editing;

  @override
  State<AddressFormScreen> createState() => _AddressFormScreenState();
}

class _AddressFormScreenState extends State<AddressFormScreen> {
  late final TextEditingController _displayName;
  late final TextEditingController _name;
  late final TextEditingController _phone;
  late final TextEditingController _address;
  late final TextEditingController _note;
  late AddressLabel _label;
  late bool _pickupDefault;
  late bool _deliveryDefault;
  bool _submitted = false;
  final FormFeedback _feedback = FormFeedback();
  double? _latitude;
  double? _longitude;
  String _initialPhone = '';

  AddressBookController get c => widget.controller;
  DeliveryAddress? get e => widget.editing;

  @override
  void initState() {
    super.initState();
    final DeliveryAddress? a = e;
    _displayName = TextEditingController(text: a?.displayName ?? '');
    _name = TextEditingController(text: a?.recipientName ?? '');
    // A new address starts from the phone of the signed-in M01 account (the person may change it to order for somebody else); an
    // existing address shows its own phone. The account phone itself is never touched.
    final String? account = c.session?.identity?.phoneNormalized;
    _phone = TextEditingController(text: a?.phoneText ?? (account == null ? '' : formatVnPhone(account)));
    _address = TextEditingController(text: a?.addressText ?? '');
    _latitude = a?.latitude;
    _longitude = a?.longitude;
    _note = TextEditingController(text: a?.deliveryNote ?? '');
    _initialPhone = _phone.text.replaceAll(' ', '');
    _label = a?.label ?? AddressLabel.home;
    _pickupDefault = a?.isPickupDefault ?? false;
    _deliveryDefault = a?.isDeliveryDefault ?? false;
  }

  @override
  void dispose() {
    _displayName.dispose();
    _name.dispose();
    _phone.dispose();
    _address.dispose();
    _note.dispose();
    super.dispose();
  }

  String? get _phoneError {
    final String p = _phone.text.replaceAll(' ', '').trim();
    if (p.isEmpty) {
      return 'Nhập số điện thoại người nhận.';
    }
    return _vnPhone.hasMatch(p) ? null : 'Số điện thoại chưa hợp lệ.';
  }

  String? get _addressError => _address.text.trim().isEmpty ? 'Nhập địa chỉ giao hàng chi tiết.' : null;
  String? get _nameError => _name.text.trim().isEmpty ? 'Nhập tên người liên hệ.' : null;

  bool get _dirty =>
      e == null
          ? (_displayName.text.trim().isNotEmpty || _name.text.trim().isNotEmpty || _phone.text.replaceAll(' ', '') != _initialPhone || _address.text.trim().isNotEmpty || _note.text.trim().isNotEmpty || _pickupDefault || _deliveryDefault)
          : (_displayName.text.trim() != (e!.displayName ?? '') || _name.text.trim() != (e!.recipientName ?? '') || _phone.text.replaceAll(' ', '') != e!.phoneText || _address.text.trim() != e!.addressText || _note.text.trim() != (e!.deliveryNote ?? '') || _label != e!.label || _latitude != e!.latitude || _longitude != e!.longitude || _pickupDefault != e!.isPickupDefault || _deliveryDefault != e!.isDeliveryDefault);

  Future<void> _save() async {
    setState(() => _submitted = true);
    if (!_feedback.validate(<String, String?>{'name': _nameError, 'phone': _phoneError, 'address': _addressError}) || c.locked) {
      return;
    }
    final NavigatorState navigator = Navigator.of(context);
    final bool ok = await c.save(
      AddressInput(label: _label, displayName: _displayName.text, recipientName: _name.text, phone: _phone.text.replaceAll(' ', ''), addressText: _address.text, note: _note.text, pickupDefault: _pickupDefault, deliveryDefault: _deliveryDefault, latitude: _latitude, longitude: _longitude),
      editing: e,
    );
    if (ok && mounted) {
      navigator.pop();
    }
  }

  Future<void> _delete() async {
    final NavigatorState navigator = Navigator.of(context);
    final String? choice = await showDecision(
      context,
      title: 'Xóa địa chỉ này?',
      text: 'Địa chỉ sẽ bị xóa khỏi sổ địa chỉ. Các đơn đã đặt không bị ảnh hưởng.',
      actions: const <DialogAction>[DialogAction('Giữ lại', 'keep'), DialogAction('Xóa địa chỉ', 'delete', kind: ButtonKind.dark, key: Key('address-confirm-delete'))],
    );
    if (choice != 'delete') {
      return;
    }
    final bool ok = await c.delete(e!.id);
    if (ok && mounted) {
      navigator.pop();
    }
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: c,
      builder: (BuildContext context, Widget? _) {
        final bool locked = c.locked;
        final bool gone = c.gone;
        final Widget? failure = c.pending != null
            ? _PendingBanner(controller: c)
            : (c.writeFailure != null ? N11Banner(key: const Key('address-form-error'), kind: BannerKind.error, title: 'Chưa lưu được', text: addressFailureText(c.writeFailure!)) : null);
        return M02Scaffold(
          title: e == null ? 'Thêm địa chỉ' : 'Sửa địa chỉ',
          onWillLeave: () async => locked || !_dirty || await confirmDiscard(context),
          content: <Widget>[
            if (failure != null) failure,
            Wrap(spacing: N11Space.gap2, runSpacing: N11Space.gap2, children: <Widget>[
              for (final AddressLabel l in AddressLabel.values)
                ChoiceChip(
                  key: Key('address-label-${l.code}'),
                  label: Text(l.text),
                  selected: _label == l,
                  selectedColor: N11Colors.yellow,
                  onSelected: locked ? null : (bool _) => setState(() => _label = l),
                ),
            ]),
            N11Field(fieldKey: const Key('address-display-name'), label: 'Tên gợi nhớ', optionalLabel: true, controller: _displayName, maxLength: 50, enabled: !locked, placeholder: 'Nhà riêng, Kho hàng…', onChanged: () => setState(() {})),
            KeyedSubtree(key: _feedback.key('name'), child: N11Field(fieldKey: const Key('address-name'), label: 'Tên người liên hệ *', controller: _name, maxLength: 120, enabled: !locked, placeholder: 'Người nhận hàng', tone: _submitted && _nameError != null ? FieldTone.error : FieldTone.normal, hint: _submitted ? _nameError : null, onChanged: () => setState(() {}))),
            N11Field(
              key: _feedback.key('phone'),
              fieldKey: const Key('address-phone'),
              label: 'Số điện thoại *',
              controller: _phone,
              keyboard: TextInputType.phone,
              maxLength: 20,
              enabled: !locked,
              placeholder: '0912 345 678',
              tone: _submitted && _phoneError != null ? FieldTone.error : FieldTone.normal,
              hint: _submitted ? _phoneError : 'Số shipper sẽ gọi khi giao hàng.',
              onChanged: () => setState(() {}),
            ),
            KeyedSubtree(key: _feedback.key('address'), child: AddressLocationField(key: const Key('address-text'), label: 'Địa chỉ', text: _address.text,
              error: _submitted ? _addressError : null,
              onTap: locked ? null : () async {
                final int? epoch = c.session?.sessionEpoch;
                final AddressLocation? selected = await Navigator.of(context).push<AddressLocation>(MaterialPageRoute<AddressLocation>(
                  builder: (_) => AddressLocationPicker(initial: AddressLocation(_address.text,
                    latitude: _latitude, longitude: _longitude), location: c.location, session: c.session, requirePoint: false)));
                if (selected == null || !context.mounted || c.locked || c.session?.sessionEpoch != epoch || (c.session != null && c.session!.status != SessionStatus.signedIn)) return;
                setState(() { _address.text = selected.text; _latitude = selected.latitude; _longitude = selected.longitude; });
              })),
            N11Field(fieldKey: const Key('address-note'), label: 'Hướng dẫn tìm đường', optionalLabel: true, controller: _note, maxLength: 200, enabled: !locked, placeholder: 'Tòa nhà, tầng, cổng…', onChanged: () => setState(() {})),
            SwitchListTile(
              key: const Key('address-pickup-default-switch'),
              contentPadding: EdgeInsets.zero,
              title: const Text('Điểm nhận hàng mặc định', style: TextStyle(fontSize: 14, fontWeight: FontWeight.w600)),
              value: _pickupDefault,
              onChanged: locked ? null : (bool v) => setState(() => _pickupDefault = v),
            ),
            SwitchListTile(key: const Key('address-delivery-default-switch'), contentPadding: EdgeInsets.zero, title: const Text('Điểm giao hàng mặc định', style: TextStyle(fontSize: 14, fontWeight: FontWeight.w600)), value: _deliveryDefault, onChanged: locked ? null : (bool v) => setState(() => _deliveryDefault = v)),
            if (e != null)
              N11Button(key: const Key('address-form-delete'), label: 'Xóa địa chỉ', kind: ButtonKind.secondary, onPressed: locked ? null : _delete),
          ],
          footer: <Widget>[
            N11Button(
              key: const Key('address-save'), validate: true,
              label: e == null ? 'Lưu địa chỉ' : 'Cập nhật',
              loading: c.busy,
              onPressed: locked || gone ? null : _save,
            ),
          ],
        );
      },
    );
  }
}

// ---- Chọn địa chỉ giao hàng (reused by checkout, M10) ----------------------------------------------------------------

/// Radio list of the book, default first, with "+ Thêm địa chỉ mới" and "Xác nhận địa chỉ". It only picks: placing an order is not
/// part of M05. [onConfirm] receives the chosen address.
class DeliveryAddressPicker extends StatefulWidget {
  const DeliveryAddressPicker({super.key, required this.controller, required this.onConfirm, this.initialId, this.defaultKind = AddressDefaultKind.delivery});

  final AddressBookController controller;
  final void Function(DeliveryAddress address) onConfirm;
  final String? initialId;
  final AddressDefaultKind defaultKind;

  @override
  State<DeliveryAddressPicker> createState() => _DeliveryAddressPickerState();
}

class _DeliveryAddressPickerState extends State<DeliveryAddressPicker> {
  String? _selected;

  AddressBookController get c => widget.controller;

  @override
  void initState() {
    super.initState();
    _selected = widget.initialId;
    WidgetsBinding.instance.addPostFrameCallback((_) => c.load());
  }

  /// The selection if it still exists, otherwise the default, otherwise the first.
  DeliveryAddress? get _current {
    if (c.addresses.isEmpty) {
      return null;
    }
    return c.byId(_selected ?? '') ?? c.defaultFor(widget.defaultKind) ?? c.addresses.first;
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: c,
      builder: (BuildContext context, Widget? _) {
        final DeliveryAddress? current = _current;
        final List<Widget> content = <Widget>[];
        if (c.loadState == AddressLoad.idle || (c.loadState == AddressLoad.loading && c.addresses.isEmpty)) {
          content.add(const M02Skeleton(rows: 3, height: 96));
        } else if (c.loadState == AddressLoad.failed && c.addresses.isEmpty) {
          content.add(M02LoadFailed(onRetry: c.load, text: 'Chưa nhận được sổ địa chỉ từ máy chủ. ${addressFailureText(c.loadFailure!)}'));
        } else if (c.addresses.isEmpty) {
          content.add(const EmptyState(icon: Icons.location_off_outlined, title: 'Chưa có địa chỉ', text: 'Thêm địa chỉ để tiếp tục.'));
        } else {
          for (final DeliveryAddress a in c.addresses) {
            content.add(InkWell(
              key: Key('picker-${a.id}'),
              borderRadius: BorderRadius.circular(kRadiusCard),
              onTap: () => setState(() => _selected = a.id),
              child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: <Widget>[
                Padding(
                  padding: const EdgeInsets.only(top: 18, right: N11Space.gap2),
                  child: Icon(current?.id == a.id ? Icons.radio_button_checked : Icons.radio_button_unchecked, color: N11Colors.black, semanticLabel: current?.id == a.id ? 'Đã chọn' : 'Chưa chọn'),
                ),
                Expanded(child: AddressCard(address: a)),
              ]),
            ));
          }
        }
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            vstack(content),
            const SizedBox(height: N11Space.gap3),
            N11Button(
              key: const Key('picker-add'),
              label: '+ Thêm địa chỉ mới',
              kind: ButtonKind.secondary,
              onPressed: c.locked ? null : () => Navigator.of(context).push(n11Route(AddressFormScreen(controller: c))),
            ),
            const SizedBox(height: N11Space.gap2),
            N11Button(key: const Key('picker-confirm'), label: 'Xác nhận địa chỉ', onPressed: current == null ? null : () => widget.onConfirm(current)),
          ],
        );
      },
    );
  }
}
