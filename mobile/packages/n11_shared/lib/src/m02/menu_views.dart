import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../account/account_views.dart';
import '../account/models.dart';
import '../account/session_controller.dart';
import '../tokens.dart';
import '../widgets/components.dart';
import 'm02_flows.dart';
import 'm02_format.dart';
import 'm02_widgets.dart';
import 'menu_controller.dart';
import 'shop_ops_controller.dart';
import 'menu_models.dart';

// Q05 (Thực đơn) and Q06 (Thêm / Sửa món). The dish list, the dish form, the picture and hide / show / delete over [MenuApi]. In a build
// where the menu is not connected to the server these screens say so; they never show a dish the server did not return.

mixin _LeaveWhenSignedOut<T extends StatefulWidget> on State<T> {
  SessionController get _session;

  void _watchSession() => _session.addListener(_gone);

  void _unwatchSession() => _session.removeListener(_gone);

  void _gone() {
    if (_session.status != SessionStatus.signedIn && mounted) {
      Navigator.of(context).popUntil((Route<dynamic> route) => route.isFirst);
    }
  }
}

class MenuListScreen extends StatefulWidget {
  const MenuListScreen({super.key, required this.flows});

  final M02Flows flows;

  @override
  State<MenuListScreen> createState() => _MenuListScreenState();
}

class _MenuListScreenState extends State<MenuListScreen> with _LeaveWhenSignedOut<MenuListScreen> {
  final TextEditingController _search = TextEditingController();
  int _seenNotice = 0;

  MenuListController get menu => widget.flows.menu;

  @override
  SessionController get _session => widget.flows.ops.session;

  @override
  void initState() {
    super.initState();
    _search.text = menu.query;
    _syncReadOnly();
    _seenNotice = menu.noticeSeq;
    menu.addListener(_onMenu);
    widget.flows.ops.addListener(_syncReadOnly);
    _watchSession();
    if (widget.flows.ops.loadState == OpsLoad.idle) {
      widget.flows.ops.load();
    }
    menu.load();
  }

  /// The menu follows the shop's status: nothing is writable until the shop is known to be ACTIVE.
  void _syncReadOnly() => menu.readOnly = widget.flows.ops.readOnly;

  @override
  void dispose() {
    menu.removeListener(_onMenu);
    widget.flows.ops.removeListener(_syncReadOnly);
    _unwatchSession();
    _search.dispose();
    super.dispose();
  }

  void _onMenu() {
    if (menu.noticeSeq != _seenNotice) {
      _seenNotice = menu.noticeSeq;
      if (menu.notice != null && mounted && menu.form == null) {
        m02Toast(context, menu.notice!);
      }
    }
  }

  Future<void> _openForm(String? itemId) async {
    if (itemId == null) {
      menu.startNew();
    } else if (menu.startEdit(itemId) == null) {
      return;
    }
    await Navigator.of(context).push(n11Route(DishFormScreen(flows: widget.flows)));
    if (mounted) {
      menu.closeForm();
    }
  }

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: Listenable.merge(<Listenable>[menu, widget.flows.ops]),
      builder: (BuildContext context, Widget? child) {
        final ShopOpsController ops = widget.flows.ops;
        final bool readOnly = ops.readOnly;
        final MenuSnapshot? snapshot = menu.snapshot;
        final List<Widget> body = <Widget>[];
        List<Widget> footer = const <Widget>[];
        if (ops.overview == null && menu.loadState != MenuLoad.notConnected) {
          return M02Scaffold(title: 'Thực đơn', content: <Widget>[ops.loadState == OpsLoad.failed ? M02LoadFailed(onRetry: () { ops.load(); menu.load(); }) : const M02Skeleton(rows: 5, height: 76)]);
        }
        if (readOnly && ops.overview != null) {
          body.add(const N11Banner(key: Key('menu-readonly'), kind: BannerKind.info, title: 'Chỉ đọc', text: 'Quán đã bị vô hiệu hóa. Bạn chỉ xem được thực đơn.'));
        }
        switch (menu.loadState) {
          case MenuLoad.idle:
          case MenuLoad.loading:
            body.addAll(const <Widget>[M02Skeleton(rows: 1, height: 46), M02Skeleton(rows: 5, height: 76)]);
          case MenuLoad.notConnected:
            body.add(const M02NotConnected(what: 'Thực đơn'));
          case MenuLoad.failed:
            body.add(M02LoadFailed(onRetry: menu.load));
          case MenuLoad.ready:
            if (menu.savedNotReloaded) {
              body.add(N11Banner(kind: BannerKind.warn, title: 'Đã lưu, chưa tải lại được dữ liệu', trailing: N11Button(key: const Key('menu-reload'), label: 'Tải lại', compact: true, onPressed: menu.reloadAfterSave)));
            }
            if (menu.stale && !menu.savedNotReloaded) {
              body.add(N11Banner(key: const Key('menu-stale'), kind: BannerKind.warn, title: 'Chưa cập nhật', text: 'Đang hiển thị thực đơn đã tải. Kiểm tra kết nối rồi thử lại.', trailing: N11Button(key: const Key('menu-stale-retry'), label: 'Thử lại', compact: true, onPressed: menu.load)));
            }
            if (menu.pending != null) {
              body.add(UnknownOutcomeBanner(onRetry: menu.retryPending, busy: menu.busy));
            } else if (menu.writeFailure != null && menu.form == null) {
              body.add(N11Banner(key: const Key('menu-error'), kind: BannerKind.error, title: 'Chưa thực hiện được', text: m02FailureText(menu.writeFailure!)));
            }
            if (snapshot!.items.isEmpty) {
              body.addAll(<Widget>[
                const N11StateBlock(kind: StateKind.warn, icon: Icons.restaurant_menu, title: 'Chưa có món trong thực đơn', text: 'Thêm món đầu tiên để khách xem được thực đơn của quán.'),
                if (!readOnly) N11Button(key: const Key('menu-add-empty'), label: 'Thêm món', onPressed: menu.locked ? null : () => _openForm(null)),
              ]);
            } else {
              body.addAll(_listBody(snapshot, readOnly));
              if (!readOnly) {
                footer = <Widget>[N11Button(key: const Key('menu-add'), label: '+ Thêm món', onPressed: menu.locked ? null : () => _openForm(null))];
              }
            }
        }
        return M02Scaffold(title: 'Thực đơn', content: body, footer: footer);
      },
    );
  }

  List<Widget> _listBody(MenuSnapshot snapshot, bool readOnly) {
    final List<MenuItem> shown = menu.visibleItems;
    return <Widget>[
      TextField(
        key: const Key('menu-search'),
        controller: _search,
        textInputAction: TextInputAction.search,
        onChanged: menu.setQuery,
        style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: N11Colors.black),
        decoration: InputDecoration(
          hintText: 'Tìm món trong thực đơn',
          hintStyle: const TextStyle(fontSize: 14, fontWeight: FontWeight.w500, color: N11Colors.placeholder),
          filled: true,
          fillColor: N11Colors.white,
          prefixIcon: const Icon(Icons.search, color: N11Colors.ink2),
          suffixIcon: menu.query.isEmpty ? null : IconButton(key: const Key('menu-search-clear'), tooltip: 'Xóa nội dung tìm kiếm', icon: const Icon(Icons.close, size: 20), onPressed: () { _search.clear(); menu.setQuery(''); }),
          contentPadding: const EdgeInsets.symmetric(horizontal: N11Space.gap3, vertical: 14),
          enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(kRadiusControl), borderSide: const BorderSide(color: N11Colors.line)),
          focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(kRadiusControl), borderSide: const BorderSide(color: N11Colors.yellow, width: 2)),
        ),
      ),
      _chips(<(String, String)>[('all', 'Tất cả'), ('on', 'Đang hiện'), ('off', 'Đang ẩn')], menu.filter, menu.setFilter, 'menu-filter'),
      if (snapshot.categories.length > 1)
        _chips(<(String, String)>[('all', 'Tất cả nhóm'), for (final MenuCategory c in snapshot.categories) (c.id, c.active ? c.name : '${c.name} (ngừng)')], menu.categoryFilter, menu.setCategoryFilter, 'menu-cat'),
      Text('${snapshot.items.length} món · ${menu.hiddenCount} đang ẩn', key: const Key('menu-count'), style: N11Text.caption),
      if (shown.isEmpty) ...<Widget>[
        const N11StateBlock(kind: StateKind.warn, icon: Icons.search_off, title: 'Không tìm thấy món phù hợp', text: 'Thử từ khóa hoặc bộ lọc khác.'),
        N11Button(key: const Key('menu-clear-filters'), label: 'Xóa bộ lọc', kind: ButtonKind.secondary, onPressed: () { _search.clear(); menu.clearFilters(); }),
      ] else
        N11List(children: <Widget>[
          for (final MenuItem i in shown)
            DishRow(
              key: Key('dish-${i.id}'),
              name: i.name,
              price: formatVnd(i.priceVnd),
              imageUrl: i.imageUrl,
              dim: i.hidden,
              sub: _groupText(snapshot, i),
              chip: i.hidden ? const N11Chip('Đang ẩn') : const N11Chip('Đang hiện', kind: ChipKind.ok),
              onTap: menu.locked ? null : () => _openForm(i.id),
            ),
        ]),
    ];
  }

  String _groupText(MenuSnapshot s, MenuItem i) {
    final MenuCategory? c = s.category(i.categoryId);
    return c == null ? '' : (c.active ? c.name : '${c.name} · Ngừng hoạt động');
  }

  Widget _chips(List<(String, String)> options, String current, void Function(String) onPick, String keyPrefix) {
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: Row(
        children: <Widget>[
          for (final (String value, String label) in options)
            Padding(
              padding: const EdgeInsets.only(right: N11Space.gap2),
              child: Semantics(
                button: true,
                selected: current == value,
                label: label,
                excludeSemantics: true,
                onTap: () => onPick(value),
                child: InkWell(
                  key: Key('$keyPrefix-$value'),
                  borderRadius: BorderRadius.circular(kRadiusPill),
                  onTap: () => onPick(value),
                  child: Container(
                    constraints: const BoxConstraints(minHeight: kTapMin),
                    alignment: Alignment.center,
                    padding: const EdgeInsets.symmetric(horizontal: 14),
                    decoration: BoxDecoration(color: current == value ? N11Colors.yellow : N11Colors.white, border: Border.all(color: current == value ? N11Colors.yellow : N11Colors.line), borderRadius: BorderRadius.circular(kRadiusPill)),
                    child: Text(label, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: N11Colors.black)),
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

/// Q06-A (new) and Q06-B (edit). The form lives in the controller; this screen only shows it.
class DishFormScreen extends StatefulWidget {
  const DishFormScreen({super.key, required this.flows});

  final M02Flows flows;

  @override
  State<DishFormScreen> createState() => _DishFormScreenState();
}

class _DishFormScreenState extends State<DishFormScreen> with _LeaveWhenSignedOut<DishFormScreen> {
  late final TextEditingController _name;
  late final TextEditingController _price;
  late final TextEditingController _description;
  int _seenRevision = -1;
  int _seenNotice = 0;
  bool _conflictOpen = false;
  final Map<String, GlobalKey> _keys = <String, GlobalKey>{};

  MenuListController get menu => widget.flows.menu;

  @override
  SessionController get _session => widget.flows.ops.session;

  @override
  void initState() {
    super.initState();
    _name = TextEditingController();
    _price = TextEditingController();
    _description = TextEditingController();
    _seenNotice = menu.noticeSeq;
    _sync();
    menu.addListener(_onMenu);
    _watchSession();
  }

  @override
  void dispose() {
    menu.removeListener(_onMenu);
    _unwatchSession();
    _name.dispose();
    _price.dispose();
    _description.dispose();
    super.dispose();
  }

  void _sync() {
    if (_seenRevision == menu.formRevision) {
      return;
    }
    _seenRevision = menu.formRevision;
    final ItemForm? f = menu.form;
    _name.text = f?.name ?? '';
    _description.text = f?.description ?? '';
    _price.text = groupDigits(f?.priceDigits ?? '');
  }

  void _onMenu() {
    _sync();
    if (menu.noticeSeq != _seenNotice) {
      _seenNotice = menu.noticeSeq;
      if (menu.notice != null && mounted) {
        m02Toast(context, menu.notice!);
        if (menu.form == null && mounted && Navigator.of(context).canPop()) {
          // Saved or deleted: back to the list.
          Navigator.of(context).pop();
        }
      }
    }
    if (menu.conflict && !_conflictOpen && mounted) {
      _conflictOpen = true;
      _askConflict();
    }
    final ItemForm? f = menu.form;
    if (f != null && f.errors.isNotEmpty && mounted) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        final String first = <String>['name', 'price', 'category', 'description', 'image'].firstWhere(f.errors.containsKey, orElse: () => '');
        final BuildContext? target = first.isEmpty ? null : _keys[first]?.currentContext;
        if (target != null) {
          Scrollable.ensureVisible(target, duration: const Duration(milliseconds: 150), alignment: 0.2);
        }
      });
    }
  }

  GlobalKey _key(String name) => _keys.putIfAbsent(name, GlobalKey.new);

  Future<void> _askConflict() async {
    final String? first = await showDecision(
      context,
      title: 'Dữ liệu đã được cập nhật ở nơi khác.',
      text: 'Nội dung bạn đang sửa vẫn được giữ. Tải bản mới sẽ thay thế bản nháp.',
      actions: const <DialogAction>[DialogAction('Giữ bản nháp', 'keep'), DialogAction('Tải bản mới', 'load', kind: ButtonKind.primary)],
    );
    if (!mounted) {
      return;
    }
    if (first == 'load') {
      final String? second = await showDecision(
        context,
        title: 'Thay bản nháp bằng bản mới?',
        text: 'Các chỉnh sửa chưa lưu của bạn sẽ mất.',
        actions: const <DialogAction>[DialogAction('Quay lại', 'back'), DialogAction('Tải bản mới', 'confirm', kind: ButtonKind.dark)],
      );
      if (second == 'confirm') {
        await menu.loadNewReplacingDraft();
      } else {
        menu.keepDraftAfterConflict();
      }
    } else {
      menu.keepDraftAfterConflict();
    }
    _conflictOpen = false;
  }

  Future<bool> _leave() async => (!menu.formDirty || menu.pending != null || menu.gone) ? true : confirmDiscard(context);

  Future<void> _hideDialog(ItemForm f) async {
    if (menu.formDirty) {
      await _needSave();
      return;
    }
    final String? choice = await showDecision(
      context,
      title: 'Ẩn món này?',
      text: 'Món sẽ không xuất hiện trong thực đơn của khách. Bạn có thể hiện lại.',
      actions: const <DialogAction>[DialogAction('Giữ món', 'keep'), DialogAction('Ẩn món', 'hide', kind: ButtonKind.dark, key: Key('hide-confirm'))],
    );
    if (choice == 'hide') {
      await menu.setHidden(f.itemId!, true);
    }
  }

  Future<void> _deleteDialog(ItemForm f) async {
    if (menu.formDirty) {
      await _needSave();
      return;
    }
    final String? choice = await showDecision(
      context,
      title: 'Xóa món khỏi thực đơn?',
      text: 'Món sẽ được đưa khỏi danh sách quản lý và thực đơn của khách.',
      actions: const <DialogAction>[DialogAction('Giữ món', 'keep'), DialogAction('Xóa món', 'delete', kind: ButtonKind.dark, key: Key('delete-confirm'))],
    );
    if (choice == 'delete') {
      await menu.deleteItem(f.itemId!);
    }
  }

  Future<void> _needSave() async {
    final String? choice = await showDecision(
      context,
      title: 'Lưu hoặc bỏ thay đổi trước',
      text: 'Món đang có chỉnh sửa chưa lưu. Hãy lưu hoặc bỏ thay đổi trước khi ẩn hoặc xóa.',
      actions: const <DialogAction>[DialogAction('Bỏ thay đổi', 'revert', kind: ButtonKind.dark, key: Key('needsave-revert')), DialogAction('Tiếp tục sửa', 'stay')],
    );
    if (choice == 'revert') {
      menu.revertForm();
    }
  }

  Future<void> _menuSheet(ItemForm f) async {
    final String? choice = await showModalBottomSheet<String>(
      context: context,
      backgroundColor: N11Colors.white,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(kRadiusCard))),
      builder: (BuildContext context) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(N11Space.gap4),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              Text(f.name, maxLines: 2, overflow: TextOverflow.ellipsis, style: N11Text.h2),
              const SizedBox(height: N11Space.gap3),
              N11Button(key: const Key('sheet-toggle'), label: f.baseHidden ? 'Hiện món' : 'Ẩn món', kind: ButtonKind.secondary, onPressed: () => Navigator.of(context).pop('toggle')),
              const SizedBox(height: N11Space.gap2),
              N11Button(key: const Key('sheet-delete'), label: 'Xóa món', kind: ButtonKind.secondary, onPressed: () => Navigator.of(context).pop('delete')),
              const SizedBox(height: N11Space.gap2),
              N11Button(key: const Key('sheet-close'), label: 'Đóng', onPressed: () => Navigator.of(context).pop()),
            ],
          ),
        ),
      ),
    );
    if (!mounted) {
      return;
    }
    if (choice == 'toggle') {
      f.baseHidden ? await menu.setHidden(f.itemId!, false) : await _hideDialog(f);
    } else if (choice == 'delete') {
      await _deleteDialog(f);
    }
  }

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: menu,
      builder: (BuildContext context, Widget? child) {
        final ItemForm? f = menu.form;
        final MenuSnapshot? snapshot = menu.snapshot;
        if (f == null || snapshot == null) {
          return const M02Scaffold(title: 'Món ăn', content: <Widget>[M02Skeleton()]);
        }
        final bool readOnly = widget.flows.ops.readOnly;
        final bool gone = menu.gone;
        final bool lock = menu.locked || readOnly || gone;
        final List<MenuCategory> choices = <MenuCategory>[
          ...snapshot.activeCategories,
          if (f.categoryId != null && snapshot.category(f.categoryId!) != null && !snapshot.category(f.categoryId!)!.active) snapshot.category(f.categoryId!)!,
        ];
        if (f.isNew && snapshot.activeCategories.isEmpty) {
          return M02Scaffold(
            title: 'Thêm món',
            content: <Widget>[
              const N11StateBlock(kind: StateKind.warn, icon: Icons.category_outlined, title: 'Chưa có nhóm món để lựa chọn', text: 'Chưa có nhóm món nào được bật nên chưa thể thêm món.'),
              N11Button(key: const Key('groups-retry'), label: 'Thử lại', onPressed: () => menu.load()),
            ],
          );
        }
        final AuthFailure? failure = menu.writeFailure;
        return M02Scaffold(
          title: f.isNew ? 'Thêm món' : 'Sửa món',
          onWillLeave: _leave,
          action: f.isNew || lock ? null : IconButton(key: const Key('dish-more'), tooltip: 'Thêm thao tác', constraints: const BoxConstraints(minWidth: kTapMin, minHeight: kTapMin), icon: const Icon(Icons.more_horiz, color: N11Colors.black), onPressed: () => _menuSheet(f)),
          content: <Widget>[
            if (menu.pending != null) UnknownOutcomeBanner(onRetry: menu.retryPending, busy: menu.busy),
            if (failure != null && menu.pending == null && !menu.conflict && !gone) N11Banner(key: const Key('dish-error'), kind: BannerKind.error, title: 'Chưa thực hiện được', text: m02FailureText(failure)),
            if (gone) N11Banner(key: const Key('dish-gone'), kind: BannerKind.error, title: 'Món không còn trong thực đơn', text: 'Món đã được xóa ở nơi khác. Không thể lưu lại món này.', trailing: N11Button(key: const Key('dish-to-list'), label: 'Về danh sách', compact: true, onPressed: () => Navigator.of(context).pop())),
            if (readOnly) const N11Banner(key: Key('dish-readonly'), kind: BannerKind.info, title: 'Chỉ đọc', text: 'Quán đã bị vô hiệu hóa nên không thể sửa món.'),
            if (menu.savedNotReloaded) N11Banner(kind: BannerKind.warn, title: 'Đã lưu, chưa tải lại được dữ liệu', trailing: N11Button(key: const Key('dish-reload'), label: 'Tải lại', compact: true, onPressed: menu.reloadAfterSave)),
            if (!f.isNew) Align(alignment: Alignment.centerLeft, child: N11Chip(f.baseHidden ? 'Đang ẩn' : 'Đang hiện', kind: f.baseHidden ? ChipKind.neutral : ChipKind.ok)),
            KeyedSubtree(
              key: _key('name'),
              child: N11Field(fieldKey: const Key('dish-name'), label: 'Tên món', placeholder: 'VD: Ốc hương hấp', controller: _name, maxLength: 120, enabled: !lock, tone: f.errors['name'] != null ? FieldTone.error : FieldTone.normal, hint: f.errors['name'], onChanged: () => menu.setName(_name.text)),
            ),
            KeyedSubtree(
              key: _key('price'),
              child: N11Field(
                fieldKey: const Key('dish-price'),
                label: 'Giá bán (đ)',
                placeholder: '120.000',
                controller: _price,
                keyboard: TextInputType.number,
                maxLength: 12,
                enabled: !lock,
                tone: f.errors['price'] != null ? FieldTone.error : FieldTone.normal,
                hint: f.errors['price'] ?? 'Nhập số nguyên, ví dụ 120.000 đ.',
                onChanged: () {
                  menu.setPrice(_price.text);
                  final String shaped = groupDigits(_price.text);
                  if (shaped != _price.text) {
                    _price.value = TextEditingValue(text: shaped, selection: TextSelection.collapsed(offset: shaped.length));
                  }
                },
              ),
            ),
            KeyedSubtree(key: _key('category'), child: _categories(f, snapshot, choices, lock)),
            TextField(
              key: const Key('dish-description'), controller: _description,
              enabled: !lock, minLines: 3, maxLines: 5, maxLength: 300,
              maxLengthEnforcement: MaxLengthEnforcement.enforced,
              onChanged: menu.setDescription,
              decoration: InputDecoration(labelText: 'Mô tả món (không bắt buộc)',
                hintText: 'Ví dụ: 1 đĩa khoảng 500g; hấp sả lá chanh; có thể làm không cay.',
                errorText: f.errors['description'], border: const OutlineInputBorder()),
            ),
            KeyedSubtree(key: _key('image'), child: _image(f, lock)),
            if (!f.isNew && !lock)
              N11InfoCard(title: 'Hiển thị với khách', text: f.baseHidden ? 'Món đang ẩn, khách không thấy.' : 'Món đang hiện trong thực đơn của khách.'),
            if (!f.isNew && !lock)
              N11Button(key: const Key('dish-toggle'), label: f.baseHidden ? 'Hiện món' : 'Ẩn món', kind: ButtonKind.secondary, onPressed: () => f.baseHidden ? menu.setHidden(f.itemId!, false) : _hideDialog(f)),
          ],
          footer: gone
              ? <Widget>[N11Button(key: const Key('dish-back-list'), label: 'Về danh sách', onPressed: () => Navigator.of(context).pop())]
              : readOnly
                  ? const <Widget>[]
                  : <Widget>[
                      if (f.isNew || menu.busy) N11Button(key: const Key('dish-cancel'), label: 'Hủy', kind: ButtonKind.secondary, onPressed: menu.busy ? null : () => Navigator.of(context).maybePop()),
                      N11Button(
                        key: const Key('dish-save'), validate: true,
                        label: menu.busy ? 'Đang lưu…' : (menu.uploading ? 'Chờ tải ảnh…' : (f.isNew ? 'Lưu món' : 'Lưu thay đổi')),
                        loading: menu.busy,
                        onPressed: menu.locked || menu.uploading ? null : () => menu.save(),
                      ),
                    ],
        );
      },
    );
  }

  Widget _categories(ItemForm f, MenuSnapshot snapshot, List<MenuCategory> choices, bool lock) {
    if (choices.isEmpty) return const SizedBox.shrink();
    return vstack(<Widget>[
      const Text('Nhóm món', style: N11Text.label),
      InputDecorator(
        decoration: InputDecoration(
          filled: true,
          fillColor: N11Colors.white,
          errorText: f.errors['category'],
          border: OutlineInputBorder(borderRadius: BorderRadius.circular(kRadiusControl)),
          enabledBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(kRadiusControl),
            borderSide: const BorderSide(color: N11Colors.line),
          ),
          contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 4),
        ),
        child: DropdownButtonHideUnderline(
          child: DropdownButton<String>(
            key: const Key('dish-category'),
            value: choices.any((MenuCategory c) => c.id == f.categoryId) ? f.categoryId : null,
            hint: const Text('Chọn nhóm món'),
            isExpanded: true,
            menuMaxHeight: 320,
            borderRadius: BorderRadius.circular(kRadiusControl),
            dropdownColor: N11Colors.white,
            icon: const Icon(Icons.keyboard_arrow_down),
            items: <DropdownMenuItem<String>>[
              for (final MenuCategory c in choices)
                DropdownMenuItem<String>(
                  value: c.id,
                  enabled: c.active || f.categoryId0 == c.id,
                  child: Text(c.active ? c.name : '${c.name} (ngừng hoạt động)', key: Key('dish-cat-${c.id}'), overflow: TextOverflow.ellipsis),
                ),
            ],
            onChanged: lock
                ? null
                : (String? id) {
                    if (id != null) menu.setCategory(id);
                  },
          ),
        ),
      ),
      if (choices.any((MenuCategory c) => c.id == f.categoryId && !c.active)) const Text('Ngừng hoạt động · chỉ giữ liên kết hiện có, không chọn lại sau khi đổi nhóm', style: N11Text.caption),
    ]);
  }

  Widget _image(ItemForm f, bool lock) {
    final ImageStage stage = f.imageStage;
    final bool hasPicture = f.imageUrl != null || f.picked != null;
    final String? error = f.errors['image'];
    final Widget preview = Container(
      key: const Key('dish-image'),
      height: 160,
      alignment: Alignment.center,
      decoration: BoxDecoration(color: N11Colors.yellowFaint, border: Border.all(color: error != null ? N11Colors.error : N11Colors.line, width: error != null ? 2 : 1), borderRadius: BorderRadius.circular(kRadiusCard)),
      clipBehavior: Clip.antiAlias,
      child: hasPicture
          ? Stack(
              fit: StackFit.expand,
              children: <Widget>[
                DishThumbFill(url: f.imageUrl, bytes: f.picked?.bytes),
                if (stage == ImageStage.uploading) Container(color: const Color(0x88FFFFFF), alignment: Alignment.center, child: const CircularProgressIndicator()),
              ],
            )
          : const Column(mainAxisAlignment: MainAxisAlignment.center, children: <Widget>[Icon(Icons.add_a_photo_outlined, size: 32, color: N11Colors.ink2), SizedBox(height: 6), Text('Thêm ảnh món (không bắt buộc)', style: N11Text.caption)]),
    );
    final List<(String, String, VoidCallback)> actions = <(String, String, VoidCallback)>[
      if (!lock && stage == ImageStage.failed) ...<(String, String, VoidCallback)>[
        ('image-other', 'Chọn ảnh khác', menu.pickImage),
        ('image-retry', 'Thử lại', menu.retryUpload),
        ('image-remove', 'Bỏ ảnh', menu.removeImage),
      ] else if (!lock && hasPicture && stage != ImageStage.uploading) ...<(String, String, VoidCallback)>[
        ('image-replace', 'Thay ảnh', menu.pickImage),
        ('image-remove', 'Xóa ảnh', menu.removeImage),
      ],
    ];
    return vstack(<Widget>[
      const Text('Ảnh món', style: N11Text.label),
      Semantics(button: !lock && !hasPicture, label: 'Chọn ảnh từ thiết bị', child: InkWell(key: const Key('image-pick'), borderRadius: BorderRadius.circular(kRadiusCard), onTap: lock || hasPicture || stage == ImageStage.uploading ? null : menu.pickImage, child: preview)),
      if (stage == ImageStage.uploading) const Text('Đang tải ảnh lên…', key: Key('image-uploading'), style: N11Text.caption),
      if (error != null) N11Banner(key: const Key('image-error'), kind: BannerKind.error, title: 'Ảnh chưa dùng được', text: error),
      if (actions.isNotEmpty)
        Wrap(spacing: N11Space.gap2, runSpacing: N11Space.gap2, children: <Widget>[for (final (String k, String label, VoidCallback go) in actions) N11Button(key: Key(k), label: label, compact: true, kind: ButtonKind.secondary, onPressed: go)]),
    ]);
  }
}

/// Fills its parent with a picture (preview of the form).
class DishThumbFill extends StatelessWidget {
  const DishThumbFill({super.key, required this.url, required this.bytes});

  final String? url;
  final Uint8List? bytes;

  @override
  Widget build(BuildContext context) {
    final Widget placeholder = const Center(child: Icon(Icons.restaurant, size: 40, color: N11Colors.placeholder));
    if (bytes != null) {
      return Image.memory(bytes!, fit: BoxFit.cover, errorBuilder: (BuildContext c, Object e, StackTrace? s) => placeholder);
    }
    if (url != null) {
      return Image.network(url!, fit: BoxFit.cover, errorBuilder: (BuildContext c, Object e, StackTrace? s) => placeholder);
    }
    return placeholder;
  }
}
