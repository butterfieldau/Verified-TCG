---
name: Community artifact boundary
description: Defines where the Verified TCG Community experience belongs and prevents competing app builds.
---

Community is a tab within the main Verified TCG mobile artifact. Never create, restore, publish, or route a separate Community mobile artifact, package, workflow, Expo project, or `/community-mobile/` URL.

**Why:** A standalone Community build competes with the main Expo app and can cause previews and published routing to open Community instead of Verified TCG.

**How to apply:** Implement all Community UI and behavior inside the main Verified TCG artifact. Treat any standalone Community artifact or workflow as stale and remove it without deleting the in-app Community tab.