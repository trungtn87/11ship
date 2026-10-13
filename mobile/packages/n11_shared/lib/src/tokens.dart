import 'package:flutter/material.dart';

// Design tokens of 11Food and 11Ship: Brand Board v1.1 and the approved M01 design (issue #98). Colours, 4 px grid, 48 px controls,
// 14 px control / 16 px card radius and Plus Jakarta Sans (bundled, no network font) are fixed by the Owner: change them only on a
// new Owner decision.

abstract final class N11Colors {
  // Brand
  /// UI yellow (Brand Board v1.1). The older #D8AD18 stays in the original logos and is the hover/loading shade.
  static const Color yellow = Color(0xFFE2B81F);
  static const Color yellowHover = Color(0xFFD8AD18);
  static const Color yellowStrong = Color(0xFFB88F0A);
  static const Color yellowSoft = Color(0xFFFBF1CF);
  static const Color yellowFaint = Color(0xFFFDF8E6);
  static const Color black = Color(0xFF2A2A2E);
  static const Color white = Color(0xFFFFFFFF);
  static const Color bg = Color(0xFFF2F1EE);

  // Neutrals
  static const Color ink2 = Color(0xFF55555B);
  static const Color ink3 = Color(0xFF6F6F75);
  static const Color placeholder = Color(0xFF8C8C92);
  static const Color line = Color(0xFFE3E1DB);
  static const Color lineStrong = Color(0xFFCFCCC3);
  static const Color field = Color(0xFFFFFFFF);
  static const Color disabledBg = Color(0xFFEDEBE5);
  static const Color disabledInk = Color(0xFF8A8A8F);
  static const Color chipSoon = Color(0xFFEFEDE8);
  static const Color chipWarnInk = Color(0xFF7A5B00);

  // Status (always paired with text and an icon, never colour alone)
  static const Color success = Color(0xFF2E7D4F);
  static const Color successSoft = Color(0xFFE4F3EA);
  static const Color error = Color(0xFFC23B32);
  static const Color errorSoft = Color(0xFFFBE9E7);
  static const Color info = Color(0xFF2563EB);
  static const Color infoSoft = Color(0xFFE8EFFD);

  // Tone inks and borders of banners and chips in the M01 design (Phone component).
  static const Color errorInk = Color(0xFF8E2A22);
  static const Color errorBorder = Color(0xFFE9B5AF);
  static const Color successInk = Color(0xFF1F5C38);
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
const double kTapMin = 44;
const double kRadiusControl = 14;
const double kRadiusCard = 16;
const double kRadiusPill = 999;

const String kFontFamily = 'PlusJakartaSans';

abstract final class N11Text {
  static const TextStyle body = TextStyle(fontSize: 15, height: 1.5, fontWeight: FontWeight.w500, color: N11Colors.black);
  static const TextStyle bodyStrong = TextStyle(fontSize: 15, height: 1.5, fontWeight: FontWeight.w700, color: N11Colors.black);
  static const TextStyle caption = TextStyle(fontSize: 13, height: 1.5, fontWeight: FontWeight.w500, color: N11Colors.ink2);
  static const TextStyle captionInk2 = TextStyle(fontSize: 13, height: 1.5, fontWeight: FontWeight.w500, color: N11Colors.ink2);
  static const TextStyle label = TextStyle(fontSize: 13, height: 1.4, fontWeight: FontWeight.w600, color: N11Colors.black);
  static const TextStyle display = TextStyle(fontSize: 32, height: 1.2, fontWeight: FontWeight.w800, letterSpacing: -0.64, color: N11Colors.black);
  static const TextStyle title = TextStyle(fontSize: 24, height: 1.2, fontWeight: FontWeight.w800, letterSpacing: -0.24, color: N11Colors.black);
  static const TextStyle barTitle = TextStyle(fontSize: 17, height: 1.3, fontWeight: FontWeight.w700, color: N11Colors.black);
  static const TextStyle h2 = TextStyle(fontSize: 18, height: 1.3, fontWeight: FontWeight.w700, color: N11Colors.black);
  static const TextStyle lead = TextStyle(fontSize: 14, height: 1.5, fontWeight: FontWeight.w500, color: N11Colors.ink2);
  static const TextStyle link = TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: N11Colors.yellowStrong, decoration: TextDecoration.underline, decorationColor: N11Colors.yellowStrong);
}

ThemeData buildN11Theme() {
  final ColorScheme base = ColorScheme.fromSeed(seedColor: N11Colors.yellow, brightness: Brightness.light);
  final ColorScheme scheme = base.copyWith(
    primary: N11Colors.yellow,
    onPrimary: N11Colors.black,
    secondary: N11Colors.black,
    onSecondary: N11Colors.white,
    surface: N11Colors.white,
    onSurface: N11Colors.black,
    error: N11Colors.error,
    outline: N11Colors.line,
  );
  return ThemeData(
    useMaterial3: true,
    colorScheme: scheme,
    fontFamily: kFontFamily,
    package: 'n11_shared',
    scaffoldBackgroundColor: N11Colors.bg,
    dividerColor: N11Colors.line,
    snackBarTheme: const SnackBarThemeData(
      behavior: SnackBarBehavior.floating,
      backgroundColor: N11Colors.black,
      contentTextStyle: TextStyle(color: N11Colors.white, fontSize: 14),
    ),
  );
}
