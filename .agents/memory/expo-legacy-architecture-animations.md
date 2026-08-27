---
name: Expo legacy architecture native modules
description: Native-module compatibility constraints for Expo SDK 54 builds that intentionally disable React Native New Architecture.
---

When an Expo SDK 54 diagnostic or release build uses the legacy React Native architecture, keep React Native Reanimated on the latest 3.19.x patch and do not install the standalone React Native Worklets package. Add Expo's install-check exclusion for the SDK-default Reanimated 4 range. Do not autolink `expo-glass-effect`; use a platform/version guard when native iOS 26 tabs only need an availability decision.

**Why:** Reanimated 4 supports only New Architecture and its iOS podspec aborts installation when `RCT_NEW_ARCH_ENABLED=0`; Reanimated 3.19.x supports React Native 0.81 on the legacy Paper architecture. `expo-glass-effect` also fails a legacy iOS archive because its Fabric child-mount methods do not override methods on the Paper superclass.

**How to apply:** Before changing `newArchEnabled` to false, reconcile native dependencies and the lockfile together. Restore the SDK-default Reanimated 4 plus Worklets and reconsider `expo-glass-effect` only when New Architecture is intentionally re-enabled.