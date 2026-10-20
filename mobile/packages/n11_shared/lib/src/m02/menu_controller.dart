import 'dart:async';

import 'package:flutter/foundation.dart';

import '../account/api_client.dart';
import '../account/models.dart';
import '../account/session_controller.dart';
import 'm02_format.dart';
import 'menu_models.dart';

// Q05 / Q06: the owner's menu list, the dish form and the dish actions, over a [MenuApi].
//
// The same pending rule as the schedule (see shop_ops_controller.dart): a write whose outcome is unknown keeps the exact operation and
// its Idempotency-Key; nothing else may be written and the form is locked until [retryPending] decides it. The operation captures
// its inputs when it starts, so editing the form (which is locked anyway) can never change what a retry sends.

enum MenuLoad { idle, loading, ready, failed, notConnected }

enum ImageStage { none, existing, uploading, ready, failed }

enum MenuOpKind { save, hide, show, delete }

class MenuPending {
  const MenuPending({required this.kind, required this.key, required this.run});

  final MenuOpKind kind;
  final String key;

  /// Sends the operation with [key] exactly as it was first captured.
  final Future<MenuItem?> Function(String key) run;
}

class ItemForm {
  ItemForm({this.itemId, this.baseVersion, this.baseHidden = false});

  /// null = a new dish.
  final String? itemId;
  int? baseVersion;
  bool baseHidden;

  String name = '';
  String priceDigits = '';
  String? categoryId;
  String? imageRef;
  String? imageUrl;
  PickedImage? picked;
  ImageStage imageStage = ImageStage.none;
  Map<String, String> errors = <String, String>{};

  // What the form started from (for "dirty" and "Bỏ thay đổi").
  String name0 = '';
  String priceDigits0 = '';
  String? categoryId0;
  String? imageRef0;

  bool get isNew => itemId == null;
  bool get dirty => name.trim() != name0.trim() || priceDigits != priceDigits0 || categoryId != categoryId0 || imageRef != imageRef0;
}

class MenuListController extends ChangeNotifier {
  MenuListController({required this.api, this.session, ImagePickerPort picker = const NoImagePicker()}) : _picker = picker {
    session?.addListener(_onSession);
    _sessionEpoch = session?.sessionEpoch ?? 0;
  }

  final MenuApi api;
  final SessionController? session;
  final ImagePickerPort _picker;
  ImagePickerPort get picker => _picker;

  MenuLoad _load = MenuLoad.idle;
  MenuSnapshot? _snapshot;
  AuthFailure? _loadFailure;
  bool _stale = false;
  bool _reading = false;

  // List view state, kept across edits.
  String query = '';
  String filter = 'all'; // all | on | off
  String categoryFilter = 'all';

  ItemForm? _form;
  bool _busy = false;
  MenuPending? _pending;
  AuthFailure? _writeFailure;
  bool _conflict = false;
  bool _gone = false;
  bool _savedNotReloaded = false;
  bool _readOnly = false;
  String? _notice;
  int _noticeSeq = 0;
  int _epoch = 0;
  int _sessionEpoch = 0;
  bool _disposed = false;
  int _formRevision = 0;

  MenuLoad get loadState => _load;
  MenuSnapshot? get snapshot => _snapshot;
  AuthFailure? get loadFailure => _loadFailure;

  /// The last read failed but an earlier snapshot is still shown: the data may be out of date and "Thử lại" reads it again.
  bool get stale => _stale;
  ItemForm? get form => _form;
  bool get busy => _busy;
  MenuPending? get pending => _pending;
  AuthFailure? get writeFailure => _writeFailure;
  bool get conflict => _conflict;

  /// The dish was removed elsewhere: it can be neither saved nor changed.
  bool get gone => _gone;
  bool get savedNotReloaded => _savedNotReloaded;
  String? get notice => _notice;
  int get noticeSeq => _noticeSeq;
  int get formRevision => _formRevision;

  /// Nothing may be edited or written: a write runs, its outcome is unknown, or a picture is uploading.
  bool get locked => _busy || _pending != null;
  bool get uploading => _form?.imageStage == ImageStage.uploading;

  /// The shop is not ACTIVE (DISABLED): everything is read-only. Set by the screen from the shop's status.
  bool get readOnly => _readOnly;
  set readOnly(bool value) {
    if (_readOnly != value) {
      _readOnly = value;
      _notify();
    }
  }

  bool get formDirty => _form?.dirty ?? false;

  void _onSession() {
    final SessionController s = session!;
    if (s.sessionEpoch != _sessionEpoch || s.status != SessionStatus.signedIn) {
      _sessionEpoch = s.sessionEpoch;
      clear();
    }
  }

  void clear() {
    _epoch++;
    _load = MenuLoad.idle;
    _snapshot = null;
    _loadFailure = null;
    _stale = false;
    _reading = false;
    query = '';
    filter = 'all';
    categoryFilter = 'all';
    _form = null;
    _busy = false;
    _pending = null;
    _writeFailure = null;
    _conflict = false;
    _gone = false;
    _savedNotReloaded = false;
    _notice = null;
    _formRevision++;
    _notify();
  }

  @override
  void dispose() {
    _disposed = true;
    session?.removeListener(_onSession);
    super.dispose();
  }

  void _notify() {
    if (!_disposed) {
      notifyListeners();
    }
  }

  void _say(String text) {
    _notice = text;
    _noticeSeq++;
  }

  // ---- reading --------------------------------------------------------------------------------------------------

  Future<void> load() async {
    if (_reading) {
      return;
    }
    final int epoch = _epoch;
    // With a snapshot the data stays on screen while it is read again; only a first read shows the skeleton.
    if (_snapshot == null) {
      _load = MenuLoad.loading;
    }
    _loadFailure = null;
    _notify();
    await _read(epoch);
  }

  Future<bool> _read(int epoch) async {
    _reading = true;
    try {
      final MenuSnapshot snapshot = await api.load();
      if (epoch != _epoch) {
        return false;
      }
      _snapshot = snapshot;
      _load = MenuLoad.ready;
      _loadFailure = null;
      _stale = false;
      _notify();
      return true;
    } on FeatureNotConnected {
      if (epoch == _epoch) {
        _load = MenuLoad.notConnected;
        _notify();
      }
      return false;
    } on AuthFailure catch (failure) {
      if (epoch == _epoch) {
        _loadFailure = failure;
        if (_snapshot == null) {
          _load = MenuLoad.failed;
        } else {
          _load = MenuLoad.ready;
          _stale = true;
        }
        _notify();
      }
      return false;
    } finally {
      if (epoch == _epoch) {
        _reading = false;
      }
    }
  }

  // ---- list -----------------------------------------------------------------------------------------------------

  List<MenuItem> get visibleItems {
    final MenuSnapshot? s = _snapshot;
    if (s == null) {
      return const <MenuItem>[];
    }
    final String needle = foldVietnamese(query.trim());
    return <MenuItem>[
      for (final MenuItem i in s.items)
        if ((filter == 'all' || (filter == 'on' ? !i.hidden : i.hidden)) && (categoryFilter == 'all' || i.categoryId == categoryFilter) && (needle.isEmpty || foldVietnamese(i.name).contains(needle))) i,
    ];
  }

  int get hiddenCount => _snapshot?.items.where((MenuItem i) => i.hidden).length ?? 0;

  bool get filtering => query.trim().isNotEmpty || filter != 'all' || categoryFilter != 'all';

  void setQuery(String value) {
    query = value;
    _notify();
  }

  void setFilter(String value) {
    filter = value;
    _notify();
  }

  void setCategoryFilter(String value) {
    categoryFilter = value;
    _notify();
  }

  void clearFilters() {
    query = '';
    filter = 'all';
    categoryFilter = 'all';
    _notify();
  }

  // ---- form -----------------------------------------------------------------------------------------------------

  /// A blank form for a new dish. With exactly one ACTIVE group it is chosen for the person; with none the form cannot be used.
  ItemForm startNew() {
    final ItemForm f = ItemForm();
    final List<MenuCategory> active = _snapshot?.activeCategories ?? const <MenuCategory>[];
    f.categoryId = active.length == 1 ? active.single.id : null;
    f.categoryId0 = f.categoryId;
    _open(f);
    return f;
  }

  ItemForm? startEdit(String itemId) {
    final MenuItem? item = _snapshot?.item(itemId);
    if (item == null) {
      return null;
    }
    final ItemForm f = ItemForm(itemId: item.id, baseVersion: item.version, baseHidden: item.hidden);
    _fillFrom(f, item);
    _open(f);
    return f;
  }

  void _fillFrom(ItemForm f, MenuItem item) {
    f.baseVersion = item.version;
    f.baseHidden = item.hidden;
    f.name = f.name0 = item.name;
    f.priceDigits = f.priceDigits0 = item.priceVnd.toString();
    f.categoryId = f.categoryId0 = item.categoryId;
    f.imageUrl = item.imageUrl;
    f.imageRef = f.imageRef0 = item.imageRef;
    f.picked = null;
    f.imageStage = item.imageUrl == null ? ImageStage.none : ImageStage.existing;
    f.errors = <String, String>{};
  }

  void _open(ItemForm f) {
    _form = f;
    _writeFailure = null;
    _conflict = false;
    _gone = false;
    _savedNotReloaded = false;
    _formRevision++;
    _notify();
  }

  void closeForm() {
    if (locked) {
      return;
    }
    _form = null;
    _writeFailure = null;
    _conflict = false;
    _gone = false;
    _notify();
  }

  void edited() {
    final ItemForm? f = _form;
    if (f != null) {
      f.errors = <String, String>{};
      _notify();
    }
  }

  void setName(String value) {
    if (_form != null && !locked && !_readOnly) {
      _form!.name = value;
      edited();
    }
  }

  void setPrice(String value) {
    if (_form != null && !locked && !_readOnly) {
      _form!.priceDigits = value.replaceAll(RegExp(r'\D'), '');
      edited();
    }
  }

  void setCategory(String id) {
    final ItemForm? f = _form;
    final MenuCategory? c = _snapshot?.category(id);
    if (f == null || c == null || locked || _readOnly) {
      return;
    }
    // An inactive group is only kept, never newly chosen.
    if (!c.active && f.categoryId0 != id) {
      return;
    }
    f.categoryId = id;
    f.errors = Map<String, String>.of(f.errors)..remove('category');
    _notify();
  }

  void revertForm() {
    final ItemForm? f = _form;
    if (f == null || locked) {
      return;
    }
    final MenuItem? item = f.itemId == null ? null : _snapshot?.item(f.itemId!);
    if (item != null) {
      _fillFrom(f, item);
    } else {
      f
        ..name = ''
        ..priceDigits = ''
        ..categoryId = f.categoryId0
        ..imageRef = null
        ..imageUrl = null
        ..picked = null
        ..imageStage = ImageStage.none
        ..errors = <String, String>{};
    }
    _formRevision++;
    _notify();
  }

  // ---- picture --------------------------------------------------------------------------------------------------

  /// Choose a picture, then upload it at once (a local path is never saved). A failed upload keeps the dish's current picture.
  Future<void> pickImage() async {
    final ItemForm? f = _form;
    if (f == null || locked || _readOnly) {
      return;
    }
    final PickedImage? picked;
    try {
      picked = await _picker.pick();
    } on ImagePickException {
      f.errors = <String, String>{...f.errors, 'image': 'Không đọc được ảnh này. Hãy chọn ảnh khác.'};
      _notify();
      return;
    }
    if (picked == null || _form != f) {
      return;
    }
    f.picked = picked;
    await _upload(f);
  }

  Future<void> retryUpload() async {
    final ItemForm? f = _form;
    if (f == null || f.picked == null || locked) {
      return;
    }
    await _upload(f);
  }

  Future<void> _upload(ItemForm f) async {
    final int epoch = _epoch;
    f.imageStage = ImageStage.uploading;
    f.errors = Map<String, String>.of(f.errors)..remove('image');
    _notify();
    try {
      final ({String ref, String url}) uploaded = await api.uploadImage(f.picked!);
      if (epoch != _epoch || _form != f) {
        return;
      }
      f.imageRef = uploaded.ref;
      f.imageUrl = uploaded.url;
      f.imageStage = ImageStage.ready;
    } on FeatureNotConnected {
      if (epoch == _epoch && _form == f) {
        f.imageStage = ImageStage.failed;
        f.errors = <String, String>{...f.errors, 'image': 'Chưa nối máy chủ ảnh nên chưa tải ảnh lên được.'};
      }
    } on AuthFailure {
      if (epoch == _epoch && _form == f) {
        f.imageStage = ImageStage.failed;
        f.errors = <String, String>{...f.errors, 'image': 'Không tải được ảnh. Ảnh hiện tại của món vẫn được giữ.'};
      }
    }
    if (epoch == _epoch) {
      _notify();
    }
  }

  /// "Xóa ảnh" / "Bỏ ảnh": only the draft changes; the server's picture is untouched until a save succeeds.
  void removeImage() {
    final ItemForm? f = _form;
    if (f == null || locked || _readOnly) {
      return;
    }
    f
      ..imageRef = null
      ..imageUrl = null
      ..picked = null
      ..imageStage = ImageStage.none
      ..errors = (Map<String, String>.of(f.errors)..remove('image'));
    _notify();
  }

  // ---- writes ---------------------------------------------------------------------------------------------------

  Map<String, String> validate(ItemForm f) {
    final Map<String, String> errors = <String, String>{};
    if (f.name.trim().isEmpty) {
      errors['name'] = 'Nhập tên món.';
    }
    final int? price = int.tryParse(f.priceDigits);
    if (price == null || price <= 0) {
      errors['price'] = 'Nhập giá lớn hơn 0.';
    }
    if (f.categoryId == null) {
      errors['category'] = 'Chọn một nhóm món.';
    }
    return errors;
  }

  /// Saves the form (create or update). Returns true when the server stored it.
  Future<bool> save() async {
    final ItemForm? f = _form;
    if (f == null || locked || _readOnly || uploading || _gone) {
      return false;
    }
    final Map<String, String> errors = validate(f);
    f.errors = errors;
    if (errors.isNotEmpty) {
      _notify();
      return false;
    }
    final MenuItemInput input = MenuItemInput(
      name: f.name.trim(),
      priceVnd: int.parse(f.priceDigits),
      categoryId: f.categoryId!,
      imageRef: f.imageRef,
    );
    final String? id = f.itemId;
    final int? version = f.baseVersion;
    return _begin(
      MenuOpKind.save,
      (String key) => id == null ? api.create(input, key: key) : api.update(id, input, expectedVersion: version!, key: key),
      id == null ? 'Đã thêm món.' : 'Đã lưu thay đổi.',
    );
  }

  /// Hide / show / delete are separate writes on saved data: a dirty form must be saved or reverted first (the screen asks).
  Future<bool> setHidden(String itemId, bool hidden) async {
    final MenuItem? item = _snapshot?.item(itemId);
    if (item == null || locked || _readOnly || formDirty || _gone) {
      return false;
    }
    return _begin(
      hidden ? MenuOpKind.hide : MenuOpKind.show,
      (String key) => api.setHidden(itemId, hidden, expectedVersion: item.version, key: key),
      hidden ? 'Đã ẩn món.' : 'Đã hiện món.',
    );
  }

  Future<bool> deleteItem(String itemId) async {
    final MenuItem? item = _snapshot?.item(itemId);
    if (item == null || locked || _readOnly || formDirty || _gone) {
      return false;
    }
    return _begin(
      MenuOpKind.delete,
      (String key) async {
        await api.delete(itemId, expectedVersion: item.version, key: key);
        return null;
      },
      'Đã xóa món.',
    );
  }

  Future<bool> _begin(MenuOpKind kind, Future<MenuItem?> Function(String key) run, String done) {
    _writeFailure = null;
    _conflict = false;
    _savedNotReloaded = false;
    return _send(MenuPending(kind: kind, key: newIdempotencyKey(), run: run), done);
  }

  String _doneText(MenuOpKind kind, bool isNew) => switch (kind) {
        MenuOpKind.save => isNew ? 'Đã thêm món.' : 'Đã lưu thay đổi.',
        MenuOpKind.hide => 'Đã ẩn món.',
        MenuOpKind.show => 'Đã hiện món.',
        MenuOpKind.delete => 'Đã xóa món.',
      };

  /// "Thử lại" for an unknown outcome: the same operation and key.
  Future<bool> retryPending() async {
    final MenuPending? p = _pending;
    if (p == null || _busy) {
      return false;
    }
    _writeFailure = null;
    return _send(p, _doneText(p.kind, _form?.isNew ?? false));
  }

  Future<bool> _send(MenuPending op, String done) async {
    final int epoch = _epoch;
    _busy = true;
    _pending = op;
    _notify();
    try {
      await op.run(op.key);
      if (epoch != _epoch) {
        return false;
      }
      _pending = null;
      _busy = false;
      _say(done);
      // A saved or deleted dish leaves its form; hide/show leave the form open on the new state.
      final ItemForm? f = _form;
      if (op.kind == MenuOpKind.save || op.kind == MenuOpKind.delete) {
        _form = null;
      }
      _notify();
      final bool reloaded = await _read(epoch);
      if (epoch == _epoch && !reloaded) {
        _savedNotReloaded = true;
        _notify();
      }
      if (epoch == _epoch && reloaded && f != null && (op.kind == MenuOpKind.hide || op.kind == MenuOpKind.show)) {
        final MenuItem? fresh = _snapshot?.item(f.itemId!);
        if (fresh != null && _form == f) {
          _fillFrom(_form!, fresh);
          _formRevision++;
          _notify();
        }
      }
      return epoch == _epoch;
    } on FeatureNotConnected {
      if (epoch != _epoch) {
        return false;
      }
      _pending = null;
      _busy = false;
      _writeFailure = const AuthFailure(AuthFailureKind.serverUnavailable);
      _notify();
      return false;
    } on AuthFailure catch (failure) {
      if (epoch != _epoch) {
        return false;
      }
      _busy = false;
      _writeFailure = failure;
      if (!failure.outcomeUnknown) {
        _pending = null;
        if (failure.code == 'MENU_ITEM_NOT_FOUND') {
          _gone = true;
        } else if (failure.kind == AuthFailureKind.versionConflict) {
          _conflict = true;
        } else if (failure.kind == AuthFailureKind.stateConflict) {
          // The shop moved to DISABLED / INCOMPLETE meanwhile: the screen reads the shop again and turns read-only.
        }
      }
      _notify();
      return false;
    }
  }

  /// "Đã lưu, chưa tải lại được dữ liệu" -> "Tải lại".
  Future<void> reloadAfterSave() async {
    final int epoch = _epoch;
    if (await _read(epoch) && epoch == _epoch) {
      _savedNotReloaded = false;
      _notify();
    }
  }

  /// Conflict, confirmed by the person: the form takes the server's current dish (or the dish is gone).
  Future<bool> loadNewReplacingDraft() async {
    final ItemForm? f = _form;
    if (f == null || _busy) {
      return false;
    }
    final int epoch = _epoch;
    if (!await _read(epoch) || epoch != _epoch) {
      return false;
    }
    final MenuItem? fresh = f.itemId == null ? null : _snapshot?.item(f.itemId!);
    if (fresh == null) {
      _gone = true;
    } else {
      final ItemForm next = ItemForm(itemId: fresh.id, baseVersion: fresh.version, baseHidden: fresh.hidden);
      _fillFrom(next, fresh);
      _form = next;
      _formRevision++;
    }
    _conflict = false;
    _writeFailure = null;
    _notify();
    return true;
  }

  void keepDraftAfterConflict() {
    _writeFailure = null;
    _notify();
  }

  void dismissWriteFailure() {
    if (_pending == null) {
      _writeFailure = null;
      _notify();
    }
  }
}
