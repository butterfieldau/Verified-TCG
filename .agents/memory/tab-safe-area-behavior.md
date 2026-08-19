---
name: Tab safe-area behavior
description: Safe-area rule for the custom tab screen content on iOS 26 NativeTabs.
---

All custom tab-screen root content must apply the native `insets.top`, including when Liquid Glass NativeTabs are enabled.

**Why:** NativeTabs provides the bottom tab interface but does not add top safe-area padding to custom scroll or view content. Treating Liquid Glass as an automatic top inset caused the first header row, logo, and action controls to render beneath the status area.

**How to apply:** For every tab-root screen, derive top padding from `useSafeAreaInsets()` on iOS and Android. Preserve the separate browser-only top inset convention for the Expo web preview. Do not use Liquid Glass availability to set the tab screen's top padding to zero.