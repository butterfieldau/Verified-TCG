---
name: Expo architecture compatibility
description: Native-module compatibility constraints when switching an Expo SDK 54 app between legacy and New Architecture.
---

Treat React Native architecture as a dependency-set decision, not an isolated app-config flag. For Expo SDK 54 legacy builds, use Reanimated 3.19.x without standalone Worklets or FlashList v2. For New Architecture builds, use the SDK-default Reanimated 4 plus Worklets; FlashList v2 is valid only in this configuration. Do not autolink `expo-glass-effect` into a legacy iOS archive.

**Why:** Reanimated 4 and FlashList v2 require New Architecture. Reanimated 4 rejects legacy pod installation, while FlashList v2 throws at runtime when Fabric is unavailable. Reanimated 3.19.x supports RN 0.81 legacy Paper. `expo-glass-effect` also fails a legacy archive because its Fabric child-mount methods do not override methods on the Paper superclass.

**How to apply:** Any `newArchEnabled` change must update and validate FlashList, Reanimated, Worklets, the lockfile, Expo Doctor, and a clean native prebuild together. Add a regression guard for incompatible architecture/dependency combinations.