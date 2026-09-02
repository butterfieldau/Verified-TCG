---
name: Expo file reading
description: Runtime-safe document reading with Expo File System v19.
---

Use the `File` object API for files returned by Expo Document Picker; read text with `File.text()`. Do not call `readAsStringAsync` from the default `expo-file-system` module.

**Why:** Expo File System v19 leaves legacy method names in the default module for compatibility, but those methods deliberately throw at runtime. This made valid CSV selections look unreadable on native devices.

**How to apply:** Keep `copyToCacheDirectory` enabled for picked documents, construct a `File` from the returned URI on iOS and Android, and use the browser `File.text()` object on web when available.