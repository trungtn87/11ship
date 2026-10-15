import 'package:flutter/material.dart';
import 'package:n11_shared/n11_shared.dart';

// 11Food screens of the app (catalog F01-F04). Same layout, wording and rules as apps/food-web/src/screens.ts: nobody is
// signed in and every business action is unavailable with a visible reason. No screen invents shops, dishes, orders, balances or
// activity: an empty screen says "no data yet".


List<TabSpec> buildFoodTabs(SessionController session, {AppFlows? flows}) {
  return <TabSpec>[
    TabSpec(id: 'home', label: 'Trang chủ', icon: Icons.home_outlined, title: 'Trang chủ', showLogo: true, body: (BuildContext context, ShellActions actions) => _home(session, actions, flows)),
    TabSpec(id: 'orders', label: 'Đơn hàng', icon: Icons.receipt_long_outlined, title: 'Đơn hàng', body: (BuildContext context, ShellActions actions) => _orders(session, flows)),
    if (session.status == SessionStatus.signedIn && (session.identity?.availableRoles.contains('SHOP_OWNER') == true || session.identity?.shopOnboarding == 'INCOMPLETE' || session.identity?.shopOnboarding == 'COMPLETED'))
      TabSpec(id: 'shop', label: 'Quán', icon: Icons.storefront_outlined, title: 'Quán', body: (BuildContext context, ShellActions actions) => const EmptyState(icon: Icons.storefront_outlined, title: 'Quán của bạn', text: 'Tính năng quản lý quán sẽ có trong đợt tiếp theo. Hồ sơ và quyền bán hàng vẫn theo trạng thái xét duyệt hiện tại.')),
    TabSpec(id: 'account', label: 'Tài khoản', icon: Icons.person_outline, title: 'Tài khoản', body: (BuildContext context, ShellActions actions) => _account(session, actions, flows)),
  ];
}

Widget _guestPrompt(SessionController session, String text, [AppFlows? flows]) => GuestPrompt(session: session, brand: foodBrand, text: text, reset: flows?.reset, shop: flows?.shop);

Widget _soonChip() => const Center(child: N11Chip('Sắp có', kind: ChipKind.soon));

// ---- F01: home -------------------------------------------------------------------------------------------------------

Widget _home(SessionController session, ShellActions actions, AppFlows? flows) {
  return vstack(<Widget>[
    // Keep search accessible from Home after removing its bottom tab.
    Builder(builder: (BuildContext context) => _SearchEntry(onTap: () {
      Navigator.of(context).push(n11Route(N11FormScaffold(
        title: 'Tìm kiếm', session: session,
        children: <Widget>[SearchBody(actions: ShellActions(
          goTab: (String id) => Navigator.of(context).pop(),
          openDiagnostics: actions.openDiagnostics,
        ))],
      )));
    })),
    _guestPrompt(session, 'Đăng nhập hoặc đăng ký để đặt món khi tính năng sẵn sàng.', flows),
    const EmptyState(icon: Icons.restaurant, title: 'Chưa có quán để hiển thị', text: 'Danh sách quán và món sẽ xuất hiện khi tính năng đặt món sẵn sàng.'),
    _soonChip(),
  ]);
}

class _SearchEntry extends StatelessWidget {
  const _SearchEntry({required this.onTap});

  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      label: 'Tìm món, quán',
      excludeSemantics: true,
      onTap: onTap,
      child: InkWell(
        key: const Key('home-search'),
        onTap: onTap,
        borderRadius: BorderRadius.circular(kRadiusControl),
        child: Container(
          height: 46,
          padding: const EdgeInsets.symmetric(horizontal: 14),
          decoration: BoxDecoration(color: N11Colors.white, border: Border.all(color: N11Colors.line), borderRadius: BorderRadius.circular(kRadiusControl)),
          child: const Row(
            children: <Widget>[
              Icon(Icons.search, size: 20, color: N11Colors.ink2),
              SizedBox(width: 10),
              Text('Tìm món, quán…', style: TextStyle(fontSize: 14, fontWeight: FontWeight.w500, color: N11Colors.placeholder)),
            ],
          ),
        ),
      ),
    );
  }
}

// ---- F03: orders -----------------------------------------------------------------------------------------------------

Widget _orders(SessionController session, AppFlows? flows) {
  return vstack(<Widget>[
    _guestPrompt(session, 'Đăng nhập để xem đơn hàng của bạn.', flows),
    const EmptyState(icon: Icons.receipt_long_outlined, title: 'Chưa có đơn hàng', text: 'Đơn hàng của bạn sẽ hiện ở đây khi tính năng đặt món sẵn sàng.'),
    _soonChip(),
  ]);
}

// ---- F04: account (guest) --------------------------------------------------------------------------------------------

Widget _account(SessionController session, ShellActions actions, AppFlows? flows) {
  final ShopController? shop = flows?.shop;
  return Builder(builder: (BuildContext context) => AccountTab(
    session: session,
    brand: foodBrand,
    actions: actions,
    reset: flows?.reset,
    shop: shop,
    entries: const <Widget>[
      N11ListItem(icon: Icons.help_outline, title: 'Trợ giúp', soon: true),
    ],
  ));
}

// ---- F02: search -----------------------------------------------------------------------------------------------------

enum SearchScope { dish, shop }

/// Keeps what the person typed (and the Món/Quán choice) while they move between tabs and screens. It lives only in memory of
/// this screen: not stored, never sent anywhere. There is no search API yet (M09), so nothing here ever produces a result: no
/// shop, dish or offer is invented.
class SearchBody extends StatefulWidget {
  const SearchBody({super.key, required this.actions});

  final ShellActions actions;

  @override
  State<SearchBody> createState() => _SearchBodyState();
}

class _SearchBodyState extends State<SearchBody> {
  static const int _maxLength = 100;
  final TextEditingController _controller = TextEditingController();
  SearchScope _scope = SearchScope.dish;

  @override
  void initState() {
    super.initState();
    _controller.addListener(() => setState(() {}));
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Widget _outcome(String query) {
    if (query.trim().isEmpty) {
      return const EmptyState(icon: Icons.search, title: 'Chưa có kết quả', text: FrameReasons.empty);
    }
    return const EmptyState(
      icon: Icons.search,
      title: 'Chưa tìm được kết quả',
      text: 'Chưa có dữ liệu quán và món để tìm. Từ khóa chỉ nằm trên màn hình này, chưa gửi tới máy chủ.',
    );
  }

  @override
  Widget build(BuildContext context) {
    final String query = _controller.text;
    return vstack(<Widget>[
      TextField(
        key: const Key('search-field'),
        controller: _controller,
        maxLength: _maxLength,
        textInputAction: TextInputAction.search,
        style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: N11Colors.black),
        decoration: InputDecoration(
          hintText: 'Tìm món hoặc quán',
          hintStyle: const TextStyle(fontSize: 14, fontWeight: FontWeight.w500, color: N11Colors.placeholder),
          counterText: '',
          filled: true,
          fillColor: N11Colors.white,
          prefixIcon: const Icon(Icons.search, color: N11Colors.ink2),
          suffixIcon: query.isEmpty
              ? null
              : IconButton(key: const Key('search-clear'), tooltip: 'Xóa nội dung tìm kiếm', icon: const Icon(Icons.close, size: 20), onPressed: _controller.clear),
          contentPadding: const EdgeInsets.symmetric(horizontal: N11Space.gap3, vertical: 14),
          enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(kRadiusControl), borderSide: const BorderSide(color: N11Colors.line)),
          focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(kRadiusControl), borderSide: const BorderSide(color: N11Colors.yellow, width: 2)),
        ),
      ),
      Row(
        children: <Widget>[
          N11Button(key: const Key('search-scope-dish'), label: 'Món', compact: true, kind: _scope == SearchScope.dish ? ButtonKind.primary : ButtonKind.secondary, onPressed: () => setState(() => _scope = SearchScope.dish)),
          const SizedBox(width: N11Space.gap3),
          N11Button(key: const Key('search-scope-shop'), label: 'Quán', compact: true, kind: _scope == SearchScope.shop ? ButtonKind.primary : ButtonKind.secondary, onPressed: () => setState(() => _scope = SearchScope.shop)),
        ],
      ),
      const ReasonNote('Tìm kiếm sẽ có khi dữ liệu quán và món sẵn sàng.'),
      _outcome(query),
      Center(
      child: N11Link('Về trang chủ', onPressed: () => widget.actions.goTab('home')),
      ),
    ]);
  }
}
