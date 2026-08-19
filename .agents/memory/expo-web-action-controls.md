---
name: Expo web confirmations
description: Durable cross-platform rule for confirmations that must work in react-native-web previews.
---

For actions that must also work in the Expo browser preview, use visible in-app confirmation state instead of relying on action callbacks from `Alert.alert`.

**Why:** System alert action callbacks can render in react-native-web yet fail to dispatch the intended operation.

**How to apply:** For critical cross-platform confirmations, show the confirmation inside the app so browser and native users follow the same explicit state transition.