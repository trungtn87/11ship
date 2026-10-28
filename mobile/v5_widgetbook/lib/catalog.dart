import 'package:flutter/material.dart';
import 'package:n11_shared/n11_shared.dart';
import 'package:n11_shared/v5_preview.dart';
import 'package:widgetbook/widgetbook.dart';

const _foodFigma =
    'https://www.figma.com/design/CUtFPESpJpgrZAaS9GM3XO?node-id=6-2';
const _shipFigma =
    'https://www.figma.com/design/CUtFPESpJpgrZAaS9GM3XO?node-id=7-2';

/// The catalog uses the actual 11Food/11Ship V5 preview widgets, not
/// screenshots or a separate HTML clone. No login, GPS, orders or finance.
List<WidgetbookNode> buildV5Catalog() => [
  WidgetbookFolder(name: '11Food V5', children: [
    WidgetbookComponent(name: 'Trang chủ + điều hướng', useCases: [
      WidgetbookUseCase(
        name: 'Chủ quán · 4 tab',
        designLink: _foodFigma,
        builder: (context) => V5PhonePreview(
          isFood: true,
          shopOwner: true,
          showFoodBanner: context.knobs.boolean(label: 'Hiện banner', initialValue: true),
          cardRadius: context.knobs.double.slider(
            label: 'Bo góc thẻ quán (dp)', min: 8, max: 30, divisions: 22, initialValue: 17,
          ),
          accentColor: context.knobs.color(
            label: 'Màu nền tìm kiếm', initialValue: N11Colors.yellow,
          ),
        ),
      ),
      WidgetbookUseCase(
        name: 'Khách hàng · 3 tab',
        designLink: _foodFigma,
        builder: (context) => V5PhonePreview(
          isFood: true,
          shopOwner: false,
          showFoodBanner: context.knobs.boolean(label: 'Hiện banner', initialValue: true),
        ),
      ),
    ]),
  ]),
  WidgetbookFolder(name: '11Ship V5', children: [
    WidgetbookComponent(name: 'Trang chủ + điều hướng', useCases: [
      WidgetbookUseCase(
        name: 'Online · 5 tab',
        designLink: _shipFigma,
        builder: (context) => V5PhonePreview(
          isFood: false,
          initiallyOnline: context.knobs.boolean(label: 'Online lúc mở', initialValue: true),
          showThirdOrder: context.knobs.boolean(label: 'Hiện đơn thứ 3', initialValue: true),
          mapHeight: context.knobs.double.slider(
            label: 'Chiều cao bản đồ (dp)', min: 130, max: 260,
            divisions: 26, initialValue: 168,
          ),
          cardRadius: context.knobs.double.slider(
            label: 'Bo góc thẻ đơn (dp)', min: 8, max: 30,
            divisions: 22, initialValue: 17,
          ),
        ),
      ),
    ]),
  ]),
  WidgetbookFolder(name: 'Shared Design System', children: [
    WidgetbookComponent(name: 'Logo PNG chính thức', useCases: [
      WidgetbookUseCase(
        name: '11Food',
        builder: (_) => const V5PreviewSurface(
          child: BrandLogo(brand: foodBrand, height: 58),
        ),
      ),
      WidgetbookUseCase(
        name: '11Ship',
        builder: (_) => const V5PreviewSurface(
          child: BrandLogo(brand: shipBrand, height: 58),
        ),
      ),
    ]),
    WidgetbookComponent(name: 'N11Button', useCases: [
      WidgetbookUseCase(
        name: 'Primary',
        builder: (context) => V5PreviewSurface(child: N11Button(
          label: context.knobs.string(label: 'Nhãn nút', initialValue: 'Xem đơn'),
          icon: context.knobs.boolean(label: 'Hiện icon', initialValue: true)
              ? Icons.arrow_forward_rounded : null,
          onPressed: context.knobs.boolean(label: 'Cho phép nhấn', initialValue: true)
              ? () {} : null,
        )),
      ),
      WidgetbookUseCase(
        name: 'Secondary',
        builder: (_) => V5PreviewSurface(child: N11Button(
          label: 'Quay lại',
          kind: ButtonKind.secondary,
          onPressed: () {},
        )),
      ),
      WidgetbookUseCase(
        name: 'Disabled',
        builder: (_) => const V5PreviewSurface(child: N11Button(
          label: 'Chưa đủ điều kiện',
        )),
      ),
      WidgetbookUseCase(
        name: 'Loading',
        builder: (_) => const V5PreviewSurface(child: N11Button(
          label: 'Đang xử lý',
          loading: true,
        )),
      ),
    ]),
    WidgetbookComponent(name: 'N11Card', useCases: [
      WidgetbookUseCase(
        name: 'Basic',
        builder: (context) => V5PreviewSurface(
          child: N11Card(child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                context.knobs.string(label: 'Tiêu đề', initialValue: 'Quán gần bạn'),
                style: N11Text.bodyStrong.copyWith(
                  fontSize: context.knobs.double.slider(
                    label: 'Cỡ chữ tiêu đề (dp)',
                    min: 14, max: 24, divisions: 10, initialValue: 16,
                  ),
                ),
              ),
              const SizedBox(height: 8),
              const Text('Nội dung mẫu để xem kiểu thẻ', style: N11Text.caption),
            ],
          )),
        ),
      ),
      WidgetbookUseCase(
        name: 'Information',
        builder: (_) => const V5PreviewSurface(
          child: N11InfoCard(
            title: 'Thông tin mẫu',
            text: 'Thẻ dùng lại từ n11_shared',
            rows: [('Trạng thái', 'Minh họa'), ('Đơn vị', 'VND')],
          ),
        ),
      ),
    ]),
    WidgetbookComponent(name: 'Tokens', useCases: [
      WidgetbookUseCase(
        name: 'Màu và Typography',
        builder: (context) => V5TokenPalette(
          previewColor: context.knobs.color(label: 'Màu thử nghiệm', initialValue: N11Colors.yellow),
        ),
      ),
    ]),
  ]),
];

/// A real Flutter viewport, fixed to the approved 390x844 dp reference.
/// Scrolling exists only in the catalog host; the preview's own tab taps work.
class V5PhonePreview extends StatelessWidget {
  const V5PhonePreview({
    super.key,
    required this.isFood,
    this.shopOwner = true,
    this.showFoodBanner = true,
    this.initiallyOnline = true,
    this.showThirdOrder = true,
    this.cardRadius = 17,
    this.mapHeight = 168,
    this.accentColor = N11Colors.yellow,
  });

  final bool isFood;
  final bool shopOwner;
  final bool showFoodBanner;
  final bool initiallyOnline;
  final bool showThirdOrder;
  final double cardRadius;
  final double mapHeight;
  final Color accentColor;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: SingleChildScrollView(
        child: SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          child: SizedBox(
            width: 390,
            height: 844,
            child: V5PreviewApp(
              isFood: isFood,
              shopOwner: shopOwner,
              showFoodBanner: showFoodBanner,
              initiallyOnline: initiallyOnline,
              showThirdOrder: showThirdOrder,
              cardRadius: cardRadius,
              mapHeight: mapHeight,
              accentColor: accentColor,
            ),
          ),
        ),
      ),
    );
  }
}

class V5PreviewSurface extends StatelessWidget {
  const V5PreviewSurface({super.key, required this.child});
  final Widget child;

  @override
  Widget build(BuildContext context) => Center(
        child: Container(
          width: 390,
          constraints: const BoxConstraints(maxWidth: 390),
          padding: const EdgeInsets.all(24),
          color: N11Colors.bg,
          child: child,
        ),
      );
}

class V5TokenPalette extends StatelessWidget {
  const V5TokenPalette({super.key, this.previewColor = N11Colors.yellow});
  final Color previewColor;

  @override
  Widget build(BuildContext context) {
    final tokens = <(String, Color)>[
      ('Màu thử (Knob, chưa ghi tokens.dart)', previewColor),
      ('Primary #FFC400', N11Colors.yellow),
      ('Yellow soft #FFF5C2', N11Colors.yellowSoft),
      ('Background #F7F8FA', N11Colors.bg),
      ('Text #191919', N11Colors.black),
      ('Secondary #667085', N11Colors.ink2),
      ('Success #18794E', N11Colors.success),
    ];
    return V5PreviewSurface(child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        const Text('11Ship · Design Tokens', style: N11Text.title),
        const SizedBox(height: 16),
        for (final (name, color) in tokens)
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: Row(children: [
              Container(
                width: 38, height: 38,
                decoration: BoxDecoration(
                  color: color,
                  border: Border.all(color: N11Colors.line),
                  borderRadius: BorderRadius.circular(kRadiusControl),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(child: Text(name, style: N11Text.label)),
            ]),
          ),
        const SizedBox(height: 12),
        const Text('Plus Jakarta Sans', style: N11Text.h2),
        const Text('Quán gần bạn · Tiếng Việt có dấu', style: N11Text.body),
        const Text('Đơn hàng · Thu nhập · Tài khoản', style: N11Text.caption),
      ],
    ));
  }
}
