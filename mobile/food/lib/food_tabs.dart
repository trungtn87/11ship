import 'package:flutter/material.dart';
import 'package:n11_shared/n11_shared.dart';

// 11Food screens of the test build (catalog F01-F04). Same layout, wording and rules as apps/food-web/src/screens.ts: nobody is
// signed in and every business action is unavailable with a visible reason. No screen invents shops, dishes, orders, balances or
// activity: an empty screen says "no data yet".

const String kTestNoticeTitle = 'Bản chạy thử';
const String kTestNoticeText = 'Bản thử nghiệm: đăng ký, đăng nhập và hồ sơ cá nhân đã nối máy chủ. Các nghiệp vụ khác chưa nối.';

List<TabSpec> buildFoodTabs(SessionController session) {
  return <TabSpec>[
    TabSpec(id: 'home', label: 'Trang chủ', icon: Icons.home_outlined, title: 'Trang chủ', showLogo: true, body: (BuildContext context, ShellActions actions) => _home(session)),
    TabSpec(id: 'search', label: 'Tìm kiếm', icon: Icons.search, title: 'Tìm kiếm', body: (BuildContext context, ShellActions actions) => SearchBody(actions: actions)),
    TabSpec(id: 'orders', label: 'Đơn hàng', icon: Icons.receipt_long_outlined, title: 'Đơn hàng', body: (BuildContext context, ShellActions actions) => _orders(session)),
    TabSpec(id: 'account', label: 'Tài khoản', icon: Icons.person_outline, title: 'Tài khoản', body: (BuildContext context, ShellActions actions) => _account(session, actions)),
  ];
}

Widget _guestPrompt(SessionController session, String text) => GuestPrompt(session: session, brand: foodBrand, text: text);

Widget _soonChip() => const Center(child: N11Chip('Sắp có', kind: ChipKind.soon));

// ---- F01: home -------------------------------------------------------------------------------------------------------

Widget _home(SessionController session) {
  return vstack(<Widget>[
    const N11Banner(kind: BannerKind.warn, title: kTestNoticeTitle, text: kTestNoticeText),
    _guestPrompt(session, 'Đăng nhập hoặc đăng ký để đặt món khi tính năng sẵn sàng.'),
    const EmptyState(icon: Icons.restaurant, title: 'Chưa có quán để hiển thị', text: 'Danh sách quán và món sẽ xuất hiện khi tính năng đặt món sẵn sàng.'),
    _soonChip(),
  ]);
}

// ---- F03: orders -----------------------------------------------------------------------------------------------------

Widget _orders(SessionController session) {
  return vstack(<Widget>[
    _guestPrompt(session, 'Đăng nhập để xem đơn hàng của bạn.'),
    const EmptyState(icon: Icons.receipt_long_outlined, title: 'Chưa có đơn hàng', text: 'Đơn hàng của bạn sẽ hiện ở đây khi tính năng đặt món sẵn sàng.'),
    _soonChip(),
  ]);
}

// ---- F04: account (guest) --------------------------------------------------------------------------------------------

Widget _account(SessionController session, ShellActions actions) {
  return AccountTab(
    session: session,
    brand: foodBrand,
    actions: actions,
    entries: <Widget>[
      // F07: the shop entry. Shop onboarding is not connected on Android: locked, with the reason, and it grants nothing.
      N11ListItem(
        icon: Icons.storefront_outlined,
        title: 'Quản lý cửa hàng',
        sub: featureReason(FeatureId.shopManage),
        soon: true,
        trailing: const N11Chip('Chưa nối', kind: ChipKind.soon),
      ),
      const N11ListItem(icon: Icons.help_outline, title: 'Trợ giúp', soon: true),
      const N11ListItem(icon: Icons.shield_outlined, title: 'Chính sách và điều khoản', soon: true),
    ],
  );
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
        decoration: InputDecoration(
          hintText: 'Tìm món hoặc quán',
          counterText: '',
          filled: true,
          fillColor: N11Colors.field,
          prefixIcon: const Icon(Icons.search, color: N11Colors.ink3),
          suffixIcon: query.isEmpty
              ? null
              : IconButton(key: const Key('search-clear'), tooltip: 'Xóa nội dung tìm kiếm', icon: const Icon(Icons.close, size: 20), onPressed: _controller.clear),
          contentPadding: const EdgeInsets.symmetric(horizontal: N11Space.gap3, vertical: 14),
          enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(kRadiusControl), borderSide: const BorderSide(color: N11Colors.line, width: 1.5)),
          focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(kRadiusControl), borderSide: const BorderSide(color: N11Colors.yellow, width: 1.5)),
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
        child: TextButton(
          onPressed: () => widget.actions.goTab('home'),
          child: const Text('Về trang chủ', style: TextStyle(fontWeight: FontWeight.w700, color: N11Colors.yellowStrong)),
        ),
      ),
    ]);
  }
}
