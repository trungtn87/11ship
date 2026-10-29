import 'package:flutter/material.dart';

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
  static const Color black = Color(0xFF191919);
  static const Color white = Color(0xFFFFFFFF);
  static const Color bg = Color(0xFFF7F8FA);

  // Neutrals
  static const Color ink2 = Color(0xFF667085);
  static const Color ink3 = Color(0xFF667085);
  static const Color placeholder = Color(0xFF98A2B3);
  static const Color line = Color(0xFFEAECF0);
  static const Color lineStrong = Color(0xFFD0D5DD);
  static const Color field = Color(0xFFFFFFFF);
  static const Color disabledBg = Color(0xFFF2F4F7);
  static const Color disabledInk = Color(0xFF667085);
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
}

const double kControlHeight = 48;
const double kTapMin = 48;
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
  static const List<BoxShadow> cardShadow = <BoxShadow>[
    BoxShadow(color: Color(0x13000000), blurRadius: 12, offset: Offset(0, 3)),
  ];
}

abstract final class N11Text {
  static const TextStyle body = TextStyle(
    fontFamily: kFontFamily,
    package: 'n11_shared',
    fontSize: 16,
    height: 1.5,
    fontWeight: FontWeight.w500,
    color: N11Colors.black,
  );
  static const TextStyle bodyStrong = TextStyle(
    fontFamily: kFontFamily,
    package: 'n11_shared',
    fontSize: 16,
    height: 1.5,
    fontWeight: FontWeight.w700,
    color: N11Colors.black,
  );
  static const TextStyle caption = TextStyle(
    fontFamily: kFontFamily,
    package: 'n11_shared',
    fontSize: 14,
    height: 20 / 14,
    fontWeight: FontWeight.w500,
    color: N11Colors.ink2,
  );
  static const TextStyle captionInk2 = TextStyle(
    fontFamily: kFontFamily,
    package: 'n11_shared',
    fontSize: 14,
    height: 20 / 14,
    fontWeight: FontWeight.w500,
    color: N11Colors.ink2,
  );
  static const TextStyle label = TextStyle(
    fontFamily: kFontFamily,
    package: 'n11_shared',
    fontSize: 14,
    height: 20 / 14,
    fontWeight: FontWeight.w600,
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
    fontSize: 24,
    height: 32 / 24,
    fontWeight: FontWeight.w800,
    letterSpacing: -0.24,
    color: N11Colors.black,
  );
  static const TextStyle barTitle = TextStyle(
    fontFamily: kFontFamily,
    package: 'n11_shared',
    fontSize: 20,
    height: 1.4,
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
    fontSize: 14,
    height: 1.5,
    fontWeight: FontWeight.w500,
    color: N11Colors.ink2,
  );
  static const TextStyle link = TextStyle(
    fontFamily: kFontFamily,
    package: 'n11_shared',
    fontSize: 14,
    fontWeight: FontWeight.w700,
    color: N11Colors.yellowStrong,
    decoration: TextDecoration.underline,
    decorationColor: N11Colors.yellowStrong,
  );
}

ThemeData buildN11Theme() {
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
    appBarTheme: const AppBarTheme(
      backgroundColor: N11Colors.white,
      foregroundColor: N11Colors.black,
      surfaceTintColor: Colors.transparent,
      elevation: 0,
      titleTextStyle: N11Text.barTitle,
    ),
    filledButtonTheme: FilledButtonThemeData(style: _buttonStyle()),
    elevatedButtonTheme: ElevatedButtonThemeData(style: _buttonStyle()),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        foregroundColor: N11Colors.black,
        minimumSize: const Size(kTapMin, kControlHeight),
        side: const BorderSide(color: N11Colors.lineStrong),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(kRadiusControl),
        ),
        textStyle: N11Text.label,
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
      contentPadding: const EdgeInsets.all(N11Space.gap4),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(kRadiusControl),
        borderSide: const BorderSide(color: N11Colors.line),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(kRadiusControl),
        borderSide: const BorderSide(color: N11Colors.line),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(kRadiusControl),
        borderSide: const BorderSide(color: N11Colors.yellow, width: 2),
      ),
      errorBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(kRadiusControl),
        borderSide: const BorderSide(color: N11Colors.error),
      ),
      focusedErrorBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(kRadiusControl),
        borderSide: const BorderSide(color: N11Colors.error, width: 2),
      ),
      labelStyle: N11Text.lead,
      hintStyle: N11Text.lead,
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
      disabledBackgroundColor: N11Colors.disabledBg,
      disabledForegroundColor: N11Colors.disabledInk,
      minimumSize: const Size(kTapMin, kControlHeight),
      elevation: 0,
      padding: const EdgeInsets.symmetric(
        horizontal: N11Space.gap4,
        vertical: N11Space.gap3,
      ),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(kRadiusControl),
      ),
      textStyle: N11Text.label,
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
