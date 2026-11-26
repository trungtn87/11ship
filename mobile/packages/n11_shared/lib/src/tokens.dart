import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

// Design System V5 — production UI (2026-10-28).
// Retain existing public token names for both apps and all in-flight PRs.
// Brand art stays in BrandLogo assets; no backend or business logic is changed.

abstract final class N11Colors {
  // Brand
  /// V4 yellow; yellowHover is the pressed state, yellowStrong is readable link ink.
  static const Color yellow = Color(0xFFFFC400);
  static const Color yellowHover = Color(0xFFE9B000);
  static const Color yellowStrong = Color(0xFF805600);
  static const Color yellowSoft = Color(0xFFFFF5C2);
  static const Color yellowFaint = Color(0xFFFFF9E0);
  // V5 visual accents. These are semantic tokens, never delivery fee/status data.
  static const Color accentOrange = Color(0xFFED6A00);
  static const Color homeBannerStart = Color(0xFFFFF3B0);
  static const Color homeBannerEnd = Color(0xFFFFD84D);
  // Owner 14/11: #FFC400 stays the brand yellow with #191919 text on it (never white on yellow). #FF9900 is only the end of the warm gradient.
  static const Color brandWarm = Color(0xFFFF9900);
  static const LinearGradient brandWarmGradient = LinearGradient(
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
    colors: <Color>[yellow, brandWarm],
  );
  /// Owner 14/11 (S01): light yellow at the top fading to white in the content below. Covers a header band only, never the whole screen.
  static const LinearGradient headerFadeGradient = LinearGradient(
    begin: Alignment.topCenter,
    end: Alignment.bottomCenter,
    colors: <Color>[yellowSoft, white],
  );
  // Figma 11Food F01 (node 2:75, GPS pending), used by the Home only.
  static const Color homeCategorySelected = Color(0xFFFFF2DC);
  static const Color homeInk = Color(0xFF242424);
  static const Color homeLocateBorder = Color(0xFFE7B628);
  static const Color homeLocateInk = Color(0xFFA65300);
  static const Color black = Color(0xFF1C1917);
  static const Color white = Color(0xFFFFFFFF);
  static const Color bg = Color(0xFFF7F8FA);
  static const Color formBg = Color(0xFFF5F5F2);
  static const Color formDivider = Color(0xFFE6E3DC);
  static const Color fieldBorder = Color(0xFFC7C2B8);

  // Neutrals (warm stone palette, WCAG AA contrast)
  static const Color ink2 = Color(0xFF57534E);
  static const Color ink3 = Color(0xFF57534E);
  static const Color placeholder = Color(0xFF78716C);
  static const Color line = Color(0xFFE6E3DC);
  static const Color lineStrong = Color(0xFFC7C2B8);
  static const Color field = Color(0xFFFFFFFF);
  static const Color disabledBg = Color(0xFFECEAE4);
  static const Color disabledInk = Color(0xFF78716C);
  static const Color primaryDisabledBg = Color(0xFFF3E7BD);
  static const Color primaryDisabledInk = Color(0xFF8C7A4B);
  static const Color chipSoon = Color(0xFFF2F4F7);
  static const Color chipWarnInk = Color(0xFFB54708);

  // Status (always paired with text and an icon, never colour alone)
  static const Color success = Color(0xFF18794E);
  static const Color successSoft = Color(0xFFE7F5EC);
  static const Color error = Color(0xFFB42318);
  static const Color errorSoft = Color(0xFFFEE4E2);
  static const Color info = Color(0xFF175CD3);
  static const Color infoSoft = Color(0xFFEFF8FF);

  static const Color warning = Color(0xFFB54708);
  static const Color warningSoft = Color(0xFFFFF0D7);

  // Compatibility names for existing banners.
  static const Color errorInk = Color(0xFFB42318);
  static const Color errorBorder = Color(0xFFE9B5AF);
  static const Color successInk = Color(0xFF18794E);
  static const Color successBorder = Color(0xFFA9D4B8);
}

abstract final class N11Space {
  static const double gap1 = 4;
  static const double gap2 = 8;
  static const double gap3 = 12;
  static const double gap4 = 16;
  static const double gap6 = 24;
  static const double gap8 = 32;
  static const double pad = 16;
  static const double labelGap = 6;
  static const double formFieldGap = 12;
  static const double sectionGap = 20;
}

const double kControlHeight = 48;
const double kTapMin = 48;
const double kFieldBorderWidth = 1.2;
const double kFieldFocusBorderWidth = 1.8;
// Existing application-wide geometry stays stable. V5 home geometry is scoped
// below so applying the new discovery/home treatment cannot silently reshape
// every form, dialog and operational screen in both apps.
const double kRadiusControl = 12;
const double kRadiusCard = 16;
const double kRadiusPill = 999;

const String kFontFamily = 'PlusJakartaSans';

/// Shared, centrally editable V5 presentation values for *live* Flutter apps.
/// These do not enable mock data or replace screen-specific layout widgets.
abstract final class N11V5 {
  static const double logoHeight = 54;
  static const double inputRadius = 16;
  static const double cardRadius = 17;
  static const double searchPanelRadius = 25;
  static const double categoryGap = 12;
  static const double categoryTileWidth = 92;
  static const double categoryTileMinHeight = 72;
  static const double shopImageSize = 88;
  static const double navIndicatorHeight = 35;
  static const double navIndicatorWidth = 54;
  static const double shipMapRadius = 18;
  static const double shipMapMinHeight = 180;
  static const double shipMapMaxHeight = 440;
  static const double homeTitleSize = 22;

  /// Light V5 wash for the 11Ship Home header band (#392): yellow at the top fading to the page background. Same stops as the 11Food home.
  static const LinearGradient shipHomeGradient = LinearGradient(
    begin: Alignment.topCenter,
    end: Alignment.bottomCenter,
    stops: <double>[0, .32, .70, 1],
    colors: <Color>[Color(0xFFFFEEA6), Color(0xFFFFF7D8), Color(0xFFFAFAF6), Color(0xFFF7F8FA)],
  );

  /// 180deg page background for 11Food: soft pale yellow fading quickly to
  /// ultra-pale yellow (#FFFDF7) across the bottom 1/3 (66%–100%).
  static const LinearGradient homeGradient = LinearGradient(
    begin: Alignment.topCenter,
    end: Alignment.bottomCenter,
    stops: <double>[0, 0.20, 0.44, 0.66, 1],
    colors: <Color>[
      Color(0xFFFFF4C4),
      Color(0xFFFFF9DF),
      Color(0xFFFFFCF0),
      Color(0xFFFFFDF7),
      Color(0xFFFFFDF7),
    ],
  );
  static const double homeCategoryGap = 10;
  static const List<BoxShadow> cardShadow = <BoxShadow>[
    BoxShadow(color: Color(0x13000000), blurRadius: 12, offset: Offset(0, 3)),
  ];
  static const List<BoxShadow> warmCardShadow = <BoxShadow>[
    BoxShadow(color: Color(0x14A65300), blurRadius: 12, offset: Offset(0, 3)),
  ];
  static const List<BoxShadow> warmSoftShadow = <BoxShadow>[
    BoxShadow(color: Color(0x10A65300), blurRadius: 8, offset: Offset(0, 2)),
  ];
}

abstract final class N11Text {
  static const TextStyle body = TextStyle(
    fontFamily: kFontFamily,
    package: 'n11_shared',
    fontSize: 15,
    height: 1.45,
    fontWeight: FontWeight.w500,
    color: N11Colors.black,
  );
  static const TextStyle bodyStrong = TextStyle(
    fontFamily: kFontFamily,
    package: 'n11_shared',
    fontSize: 15,
    height: 1.45,
    fontWeight: FontWeight.w700,
    color: N11Colors.black,
  );
  static const TextStyle caption = TextStyle(
    fontFamily: kFontFamily,
    package: 'n11_shared',
    fontSize: 13,
    height: 18 / 13,
    fontWeight: FontWeight.w400,
    color: N11Colors.ink2,
  );
  static const TextStyle captionInk2 = TextStyle(
    fontFamily: kFontFamily,
    package: 'n11_shared',
    fontSize: 13,
    height: 18 / 13,
    fontWeight: FontWeight.w400,
    color: N11Colors.ink2,
  );
  static const TextStyle label = TextStyle(
    fontFamily: kFontFamily,
    package: 'n11_shared',
    fontSize: 13.5,
    height: 18 / 13.5,
    fontWeight: FontWeight.w600,
    color: N11Colors.black,
  );
  static const TextStyle section = TextStyle(
    fontFamily: kFontFamily,
    package: 'n11_shared',
    fontSize: 15,
    height: 20 / 15,
    fontWeight: FontWeight.w700,
    color: N11Colors.black,
  );
  static const TextStyle input = TextStyle(
    fontFamily: kFontFamily,
    package: 'n11_shared',
    fontSize: 15,
    height: 20 / 15,
    fontWeight: FontWeight.w500,
    color: N11Colors.black,
  );
  static const TextStyle inputHint = TextStyle(
    fontFamily: kFontFamily,
    package: 'n11_shared',
    fontSize: 15,
    height: 20 / 15,
    fontWeight: FontWeight.w400,
    color: N11Colors.placeholder,
  );
  static const TextStyle button = TextStyle(
    fontFamily: kFontFamily,
    package: 'n11_shared',
    fontSize: 15,
    height: 20 / 15,
    fontWeight: FontWeight.w700,
    color: N11Colors.black,
  );
  static const TextStyle display = TextStyle(
    fontFamily: kFontFamily,
    package: 'n11_shared',
    fontSize: 28,
    height: 36 / 28,
    fontWeight: FontWeight.w800,
    letterSpacing: -0.64,
    color: N11Colors.black,
  );
  static const TextStyle title = TextStyle(
    fontFamily: kFontFamily,
    package: 'n11_shared',
    fontSize: 22,
    height: 28 / 22,
    fontWeight: FontWeight.w700,
    letterSpacing: -0.2,
    color: N11Colors.black,
  );
  static const TextStyle barTitle = TextStyle(
    fontFamily: kFontFamily,
    package: 'n11_shared',
    fontSize: 18,
    height: 24 / 18,
    fontWeight: FontWeight.w700,
    color: N11Colors.black,
  );
  static const TextStyle h2 = TextStyle(
    fontFamily: kFontFamily,
    package: 'n11_shared',
    fontSize: 18,
    height: 1.3,
    fontWeight: FontWeight.w700,
    color: N11Colors.black,
  );
  static const TextStyle lead = TextStyle(
    fontFamily: kFontFamily,
    package: 'n11_shared',
    fontSize: 13,
    height: 19 / 13,
    fontWeight: FontWeight.w400,
    color: N11Colors.ink2,
  );
  static const TextStyle link = TextStyle(
    fontFamily: kFontFamily,
    package: 'n11_shared',
    fontSize: 13,
    height: 18 / 13,
    fontWeight: FontWeight.w600,
    color: N11Colors.yellowStrong,
    decoration: TextDecoration.none,
  );
}

/// Optional page-level background gradient inherited through [ThemeData.extensions].
/// 11Food applies [N11V5.homeGradient] across tabs and pushed screens while 11Ship leaves it null.
class N11PageBackground extends ThemeExtension<N11PageBackground> {
  const N11PageBackground({this.gradient});

  final Gradient? gradient;

  static Gradient? maybeOf(BuildContext context) =>
      Theme.of(context).extension<N11PageBackground>()?.gradient;

  @override
  N11PageBackground copyWith({Gradient? gradient}) =>
      N11PageBackground(gradient: gradient ?? this.gradient);

  @override
  N11PageBackground lerp(ThemeExtension<N11PageBackground>? other, double t) {
    if (other is! N11PageBackground) return this;
    return N11PageBackground(
      gradient: Gradient.lerp(gradient, other.gradient, t),
    );
  }
}

/// Paints [N11PageBackground] behind [child] when configured in the active theme,
/// otherwise falling back to [fallbackColor].
class N11PageBackdrop extends StatelessWidget {
  const N11PageBackdrop({
    super.key,
    required this.child,
    this.fallbackColor = N11Colors.bg,
  });

  final Widget child;
  final Color fallbackColor;

  @override
  Widget build(BuildContext context) {
    final Gradient? gradient = N11PageBackground.maybeOf(context);
    if (gradient == null) {
      return ColoredBox(color: fallbackColor, child: child);
    }
    return DecoratedBox(
      key: const Key('n11-page-gradient'),
      decoration: BoxDecoration(gradient: gradient),
      child: child,
    );
  }
}

ThemeData buildN11Theme({Gradient? pageGradient}) {
  final ColorScheme base = ColorScheme.fromSeed(
    seedColor: N11Colors.yellow,
    brightness: Brightness.light,
  );
  final ColorScheme scheme = base.copyWith(
    primary: N11Colors.yellow,
    onPrimary: N11Colors.black,
    primaryContainer: N11Colors.yellowSoft,
    onPrimaryContainer: N11Colors.black,
    secondary: N11Colors.black,
    onSecondary: N11Colors.white,
    surface: N11Colors.white,
    onSurface: N11Colors.black,
    error: N11Colors.error,
    outline: N11Colors.line,
    outlineVariant: N11Colors.line,
    onSurfaceVariant: N11Colors.ink2,
    surfaceTint: Colors.transparent,
    surfaceContainerHighest: N11Colors.bg,
    errorContainer: N11Colors.errorSoft,
    onErrorContainer: N11Colors.error,
  );
  return ThemeData(
    useMaterial3: true,
    colorScheme: scheme,
    fontFamily: kFontFamily,
    package: 'n11_shared',
    extensions: <ThemeExtension<dynamic>>[
      if (pageGradient != null) N11PageBackground(gradient: pageGradient),
    ],
    materialTapTargetSize: MaterialTapTargetSize.padded,
    visualDensity: VisualDensity.standard,
    textTheme: const TextTheme(
      displaySmall: N11Text.display,
      headlineSmall: N11Text.title,
      titleLarge: N11Text.barTitle,
      titleMedium: N11Text.h2,
      bodyLarge: N11Text.body,
      bodyMedium: N11Text.lead,
      bodySmall: N11Text.caption,
      labelLarge: N11Text.label,
    ),
    actionIconTheme: ActionIconThemeData(
      backButtonIconBuilder: (BuildContext context) =>
          const Icon(Icons.chevron_left, size: 28, color: N11Colors.black),
    ),
    appBarTheme: AppBarTheme(
      backgroundColor: pageGradient != null ? Colors.transparent : N11Colors.white,
      foregroundColor: N11Colors.black,
      surfaceTintColor: Colors.transparent,
      scrolledUnderElevation: 0,
      elevation: 0,
      systemOverlayStyle: pageGradient != null
          ? const SystemUiOverlayStyle(
              statusBarColor: Colors.transparent,
              statusBarIconBrightness: Brightness.dark,
              statusBarBrightness: Brightness.light,
              systemStatusBarContrastEnforced: false,
            )
          : null,
      titleTextStyle: N11Text.barTitle,
      shape: Border(
        bottom: BorderSide(
          color: pageGradient != null ? const Color(0x14191919) : N11Colors.line,
        ),
      ),
    ),
    filledButtonTheme: FilledButtonThemeData(style: _buttonStyle()),
    elevatedButtonTheme: ElevatedButtonThemeData(style: _buttonStyle()),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        backgroundColor: N11Colors.white,
        foregroundColor: N11Colors.black,
        minimumSize: const Size(kTapMin, kControlHeight),
        side: const BorderSide(
          color: N11Colors.fieldBorder,
          width: kFieldBorderWidth,
        ),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(kRadiusControl),
        ),
        textStyle: N11Text.button,
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(
        foregroundColor: N11Colors.black,
        minimumSize: const Size(kTapMin, kControlHeight),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(kRadiusControl),
        ),
        textStyle: N11Text.label,
      ),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: N11Colors.white,
      isDense: true,
      contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(kRadiusControl),
        borderSide: const BorderSide(
          color: N11Colors.fieldBorder,
          width: kFieldBorderWidth,
        ),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(kRadiusControl),
        borderSide: const BorderSide(
          color: N11Colors.fieldBorder,
          width: kFieldBorderWidth,
        ),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(kRadiusControl),
        borderSide: const BorderSide(
          color: N11Colors.yellow,
          width: kFieldFocusBorderWidth,
        ),
      ),
      errorBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(kRadiusControl),
        borderSide: const BorderSide(
          color: N11Colors.error,
          width: kFieldFocusBorderWidth,
        ),
      ),
      focusedErrorBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(kRadiusControl),
        borderSide: const BorderSide(
          color: N11Colors.error,
          width: kFieldFocusBorderWidth,
        ),
      ),
      labelStyle: N11Text.label,
      hintStyle: N11Text.inputHint,
    ),
    cardTheme: CardThemeData(
      color: N11Colors.white,
      surfaceTintColor: Colors.transparent,
      elevation: 1,
      shadowColor: const Color(0x14191919),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(kRadiusCard),
      ),
      margin: EdgeInsets.zero,
    ),
    dialogTheme: DialogThemeData(
      backgroundColor: N11Colors.white,
      surfaceTintColor: Colors.transparent,
      titleTextStyle: N11Text.barTitle,
      contentTextStyle: N11Text.body,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(kRadiusCard),
      ),
    ),
    bottomSheetTheme: const BottomSheetThemeData(
      backgroundColor: N11Colors.white,
      surfaceTintColor: Colors.transparent,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(kRadiusCard)),
      ),
    ),
    scaffoldBackgroundColor: N11Colors.bg,
    dividerColor: N11Colors.line,
    snackBarTheme: const SnackBarThemeData(
      behavior: SnackBarBehavior.floating,
      backgroundColor: N11Colors.black,
      contentTextStyle: TextStyle(color: N11Colors.white, fontSize: 14),
    ),
  );
}

ButtonStyle _buttonStyle() =>
    FilledButton.styleFrom(
      backgroundColor: N11Colors.yellow,
      foregroundColor: N11Colors.black,
      disabledBackgroundColor: N11Colors.primaryDisabledBg,
      disabledForegroundColor: N11Colors.primaryDisabledInk,
      minimumSize: const Size(kTapMin, kControlHeight),
      elevation: 0,
      padding: const EdgeInsets.symmetric(
        horizontal: N11Space.gap4,
        vertical: N11Space.gap3,
      ),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(kRadiusControl),
      ),
      textStyle: const TextStyle(
        fontFamily: kFontFamily,
        package: 'n11_shared',
        fontSize: 15,
        height: 20 / 15,
        fontWeight: FontWeight.w700,
      ),
    ).copyWith(
      overlayColor: WidgetStateProperty.resolveWith<Color?>((
        Set<WidgetState> states,
      ) {
        if (states.contains(WidgetState.pressed)) return N11Colors.yellowHover;
        if (states.contains(WidgetState.focused) ||
            states.contains(WidgetState.hovered)) {
          return N11Colors.yellowSoft;
        }
        return null;
      }),
    );
