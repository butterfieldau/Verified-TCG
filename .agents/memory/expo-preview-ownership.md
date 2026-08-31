---
name: Expo preview ownership
description: Prevent standalone Expo prototypes from replacing the main Verified TCG preview.
---

Only the main Verified TCG Expo workflow should own the active workspace mobile preview. Standalone Expo prototypes must remain stopped or be removed after use rather than running beside it.

**Why:** Expo artifacts in this workspace contend for the same Expo development domain. The most recently started prototype can replace the visible main-app preview even though the production app code remains intact.

**How to apply:** Before presenting or verifying Verified TCG, stop other Expo artifact workflows, restart the Verified TCG workflow, and verify the workspace root shows the branded splash, welcome, or signed-in tabs rather than a prototype screen.