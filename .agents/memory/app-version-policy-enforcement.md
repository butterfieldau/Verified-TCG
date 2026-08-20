---
name: App-version policy enforcement
description: End-to-end invariant for minimum-version and forced-update owner controls.
---

When a minimum-version or forced-update policy is active, every protected consumer request without a valid app version must be rejected. Supported clients attach their build version in one central fetch layer that call sites cannot omit or override, and consume public runtime configuration to show a blocking update state.

**Why:** Optional version headers make the owner control cosmetic: an old or uninstrumented client can simply omit the header and bypass the policy while the Command Centre claims it is enforced.

**How to apply:** Keep recovery, health, admin, and public runtime-configuration routes reachable, but fail closed with an update-required response for unversioned protected routes whenever policy is active. Any new first-party client or networking stack must use the central versioned request path and include an end-to-end below-version and missing-version test.