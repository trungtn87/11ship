import 'package:flutter_test/flutter_test.dart';
import 'package:n11_shared/n11_shared.dart';
import 'package:n11_shared/testing.dart';

FakeMenuApi seeded() => FakeMenuApi(items: <MenuItem>[
      FakeMenuApi.item('a', 'Ốc hương hấp', 120000, 'c1', image: 'p1'),
      FakeMenuApi.item('b', 'Ngao hấp', 60000, 'c2'),
      FakeMenuApi.item('c', 'Ốc móng tay xào tỏi', 135000, 'c1', hidden: true),
    ]);

Future<MenuListController> ready(FakeMenuApi api, {ImagePickerPort? picker}) async {
  final MenuListController c = MenuListController(api: api, picker: picker ?? FakeImagePicker());
  await c.load();
  return c;
}

void main() {
  test('lists the shop dishes; searching ignores case and marks; filters keep the whole set', () async {
    final MenuListController c = await ready(seeded());
    expect(c.visibleItems.map((MenuItem i) => i.id), <String>['a', 'b', 'c']);
    c.setQuery('OC HUONG');
    expect(c.visibleItems.single.id, 'a');
    c.clearFilters();
    c.setFilter('off');
    expect(c.visibleItems.single.id, 'c');
    c.setFilter('on');
    expect(c.visibleItems.map((MenuItem i) => i.id), <String>['a', 'b']);
    c.setCategoryFilter('c2');
    expect(c.visibleItems.single.id, 'b');
    expect(c.filtering, isTrue);
    expect(c.hiddenCount, 1);
  });

  test('not connected is its own state, never an empty menu', () async {
    final MenuListController c = MenuListController(api: const UnwiredMenuApi());
    await c.load();
    expect(c.loadState, MenuLoad.notConnected);
    expect(c.snapshot, isNull);
  });

  test('a load that fails is a load failure and Thử lại works', () async {
    final FakeMenuApi api = seeded()..failLoads = true;
    final MenuListController c = MenuListController(api: api);
    await c.load();
    expect(c.loadState, MenuLoad.failed);
    api.failLoads = false;
    await c.load();
    expect(c.loadState, MenuLoad.ready);
  });

  test('a new dish: one active group is chosen for the person; validation sends nothing; a good save adds it once', () async {
    final FakeMenuApi api = FakeMenuApi(categories: <MenuCategory>[const MenuCategory(id: 'c1', name: 'Ốc', active: true), const MenuCategory(id: 'c9', name: 'Cũ', active: false)]);
    final MenuListController c = await ready(api);
    final ItemForm f = c.startNew();
    expect(f.categoryId, 'c1');
    expect(await c.save(), isFalse);
    expect(f.errors.keys, containsAll(<String>['name', 'price']));
    expect(api.arrived, isEmpty);
    c.setName('  Ốc len xào dừa ');
    c.setPrice('90.000');
    expect(await c.save(), isTrue);
    expect(api.effects, hasLength(1));
    expect(c.snapshot!.items.single.name, 'Ốc len xào dừa');
    expect(c.snapshot!.items.single.priceVnd, 90000);
    expect(c.form, isNull);
    expect(c.notice, 'Đã thêm món.');
  });

  test('no active group: a new dish cannot choose anything; an inactive group is kept, never newly chosen', () async {
    final FakeMenuApi api = FakeMenuApi(
      categories: <MenuCategory>[const MenuCategory(id: 'c1', name: 'Ốc', active: true), const MenuCategory(id: 'c9', name: 'Đồ uống', active: false)],
      items: <MenuItem>[FakeMenuApi.item('x', 'Trà đá', 5000, 'c9')],
    );
    final MenuListController c = await ready(api);
    c.startEdit('x');
    expect(c.form!.categoryId, 'c9');
    c.setCategory('c1');
    expect(c.form!.categoryId, 'c1');
    c.setCategory('c9');
    expect(c.form!.categoryId, 'c9', reason: 'back to its own inactive group is allowed (it is the kept link)');
    c.closeForm();
    c.startNew();
    c.setCategory('c9');
    expect(c.form!.categoryId, 'c1'.isEmpty ? null : c.form!.categoryId, reason: 'unchanged');
    expect(c.form!.categoryId, 'c1', reason: 'the single active group was preselected and an inactive one cannot be chosen');
    expect(MenuListController(api: FakeMenuApi(categories: <MenuCategory>[])..items = <MenuItem>[]).snapshot, isNull);
  });

  test('picture: upload, replace failure keeps the old picture, remove only changes the draft, save sends the uploaded reference', () async {
    final FakeMenuApi api = seeded();
    final FakeImagePicker picker = FakeImagePicker();
    final MenuListController c = await ready(api, picker: picker);
    c.startEdit('a');
    expect(c.form!.imageStage, ImageStage.existing);
    api.failUploads = true;
    await c.pickImage();
    expect(c.form!.imageStage, ImageStage.failed);
    expect(c.form!.imageRef, 'p1', reason: 'the dish keeps its current picture when the upload fails');
    expect(c.form!.errors['image'], isNotNull);
    api.failUploads = false;
    await c.retryUpload();
    expect(c.form!.imageStage, ImageStage.ready);
    expect(c.form!.imageRef, 'img1');
    c.removeImage();
    expect(c.form!.imageRef, isNull);
    expect(api.items.first.imageRef, 'p1', reason: 'the server still holds the picture until a save succeeds');
    await c.pickImage();
    expect(await c.save(), isTrue);
    expect(api.items.firstWhere((MenuItem i) => i.id == 'a').imageRef, 'img2');
  });

  test('saving is refused while a picture uploads; an unreadable file is an error beside the picture', () async {
    final FakeMenuApi api = seeded();
    final FakeImagePicker picker = FakeImagePicker();
    final MenuListController c = await ready(api, picker: picker);
    c.startEdit('b');
    picker.unreadable = true;
    await c.pickImage();
    expect(c.form!.errors['image'], contains('Không đọc được'));
    expect(c.form!.imageStage, ImageStage.none);
  });

  test('UNKNOWN outcome: same operation and key on retry, form locked, other writes refused, one effect', () async {
    final FakeMenuApi api = seeded();
    final MenuListController c = await ready(api);
    c.startEdit('b');
    c.setPrice('65000');
    api.loseAnswerOnce = true;
    expect(await c.save(), isFalse);
    final String key = c.pending!.key;
    expect(c.locked, isTrue);
    expect(api.effects, hasLength(1));
    c.setPrice('1');
    expect(c.form!.priceDigits, '65000');
    expect(await c.setHidden('a', true), isFalse);
    expect(await c.deleteItem('a'), isFalse);
    expect(await c.save(), isFalse);
    expect(api.arrived, hasLength(1));
    expect(await c.retryPending(), isTrue);
    expect(api.effects, hasLength(1));
    expect(api.arrived.toSet(), <String>{'update:$key'});
    expect(c.snapshot!.item('b')!.priceVnd, 65000);
    expect(c.snapshot!.item('b')!.version, 2, reason: 'the version moved once');
    expect(c.pending, isNull);
  });

  test('hide and show are writes on saved data and a dirty form must be saved or reverted first; delete is final', () async {
    final FakeMenuApi api = seeded();
    final MenuListController c = await ready(api);
    c.startEdit('a');
    c.setName('Ốc đổi tên');
    expect(await c.setHidden('a', true), isFalse, reason: 'dirty form');
    expect(await c.deleteItem('a'), isFalse);
    c.revertForm();
    expect(c.form!.name, 'Ốc hương hấp');
    expect(await c.setHidden('a', true), isTrue);
    expect(c.snapshot!.item('a')!.hidden, isTrue);
    expect(c.form!.baseHidden, isTrue);
    expect(c.form!.baseVersion, 2, reason: 'the open form follows the new version, so a later save does not conflict with our own hide');
    expect(await c.setHidden('a', false), isTrue);
    expect(c.snapshot!.item('a')!.hidden, isFalse);
    expect(await c.deleteItem('a'), isTrue);
    expect(c.snapshot!.item('a'), isNull);
    expect(c.form, isNull);
  });

  test('conflict keeps the draft; loading the new dish replaces it only after the person confirms; a dish deleted elsewhere cannot be saved', () async {
    final FakeMenuApi api = seeded();
    final MenuListController c = await ready(api);
    c.startEdit('b');
    c.setPrice('70000');
    api.editElsewhere('b', name: 'Ngao hấp sả');
    expect(await c.save(), isFalse);
    expect(c.conflict, isTrue);
    expect(c.pending, isNull);
    expect(c.form!.priceDigits, '70000');
    expect(await c.loadNewReplacingDraft(), isTrue);
    expect(c.form!.name, 'Ngao hấp sả');
    expect(c.form!.priceDigits, '60000');
    expect(c.conflict, isFalse);

    c.setPrice('80000');
    api.deleteElsewhere('b');
    expect(await c.save(), isFalse);
    expect(c.gone, isTrue);
    expect(await c.save(), isFalse);
    expect(api.items.any((MenuItem i) => i.id == 'b'), isFalse, reason: 'a deleted dish is never silently recreated');
  });

  test('saved but the read-back failed is its own state; read-only shops write nothing', () async {
    final FakeMenuApi api = seeded();
    final MenuListController c = await ready(api);
    c.startEdit('b');
    c.setPrice('61000');
    api.failLoads = true;
    expect(await c.save(), isTrue);
    expect(c.savedNotReloaded, isTrue);
    api.failLoads = false;
    await c.reloadAfterSave();
    expect(c.savedNotReloaded, isFalse);
    expect(c.snapshot!.item('b')!.priceVnd, 61000);

    c.readOnly = true;
    c.startEdit('a');
    final int before = api.arrived.length;
    expect(await c.save(), isFalse);
    expect(await c.setHidden('a', true), isFalse);
    expect(api.arrived.length, before);
  });
}
