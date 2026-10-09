# Plus Jakarta Sans (brand font)

The brand guideline (section 4) fixes **Plus Jakarta Sans** for all app UI. It is licensed under the SIL Open Font
License 1.1, so it can be self-hosted.

**The font file is not in this folder yet.** The environment that built this client could not download it (outbound
access was limited to the package registry and GitHub API), and the font must not be hot-linked from a third-party CDN.

To activate it:

1. Download the variable font from the official Google Fonts repository (`ofl/plusjakartasans`) or the
   `@fontsource-variable/plus-jakarta-sans` npm package, together with its `OFL.txt` licence.
2. Convert/keep it as `PlusJakartaSans-Variable.woff2` in this folder and add `OFL.txt` next to it.
3. In `styles/fonts.css`, uncomment the `url(...)` line.
4. Open the page: `<html data-font="plus-jakarta-sans">` means it loaded; `data-font="fallback"` means it did not.

Until then the page uses the system UI font and flags `html[data-font="fallback"]`, so the fallback is visible to a
tester and never silent.
