# Build 6 startup investigation

Date: 2026-08-28 (Australia/Sydney)

## Release decision

# ROOT STARTUP EXCEPTION IDENTIFIED

Build 7 was not created or uploaded. The Build 6 root cause is now known and
the source dependency correction must pass release validation before another
build can be considered.

The complete Build 6 `.crash` report confirms Version 1.0.0 (6), bundle
`co.verifiedtcg.app`, app binary UUID `45e5ea0c-eb35-3bce-a598-6db1c67739a3`,
Hermes, and a launch-to-crash interval of approximately 0.695 seconds. It
contains only the native terminal path
`RCTExceptionsManager reportFatal → reportException → RCTFatal → abort`. It
does not contain the JavaScript exception message or matching Build 6
production bundle/source map. The subsequently supplied live Console.app
capture provides the missing JavaScript evidence:

`Unhandled JS Exception: Error: Cannot find native module 'ExpoNetwork'`

The Console stack shows Expo Router route discovery loading `NetworkContext`,
then `useNetworkState`, then `expo-network`. The source import is
`hooks/useNetworkState.ts`. This is a module-load failure before normal app
startup effects can run. The later
`TypeError: Cannot read property 'ErrorBoundary' of undefined` is secondary to
the failed route-module load.

The workspace is Linux and cannot execute an iOS release archive or simulator.
The successful Expo Launch record has no retained device-runtime logs.

## Requested diagnostic results

- **Actual JS fatal exception:** `Error: Cannot find native module
  'ExpoNetwork'`
- **JS stack/module chain:** Expo Router route discovery → `NetworkContext` →
  `useNetworkState` → `expo-network`
- **Source location:** the `expo-network` import in `hooks/useNetworkState.ts`;
  the original Build 6 generated line cannot be source-mapped without its
  matching Build 6 bundle/map
- **Last Build 6 startup breadcrumb:** unavailable; Build 6 did not contain the
  new breadcrumb instrumentation
- **Startup phase:** route discovery/module evaluation, before the affected
  route tree could mount
- **Inside an effect:** no; the failure occurs while importing the module
- **Unhandled promise rejection:** no; the primary failure is a synchronous
  native-module resolution exception
- **Notification startup result:** current browser-accessible runtime reports
  `notification-setup:success`; Build 6 result unknown
- **AsyncStorage/bootstrap result:** current browser-accessible runtime reports
  success for watchlist, prices, scan state, alerts, and processing; Build 6
  result unknown
- **SecureStore/session result:** current web runtime uses the web storage path
  and reports `session-restore:success`; native Build 6 SecureStore result
  unknown
- **Runtime-config result:** current web preview reports the expected nonfatal
  error `Runtime configuration unavailable: API origin is not configured`
  because the development preview does not have the native build origin;
  Build 6 result unknown
- **Expo Doctor after correction:** 17/18 checks passed; `expo-network` is no
  longer reported. Compatibility still reports the five pre-existing,
  out-of-scope mismatches listed below.
- **Dependency mismatches before correction:** major: `expo-network` 57.0.1 vs expected ~8.0.8,
  `jest-expo` 57.0.4 vs expected ~54.0.18; minor:
  `@shopify/flash-list` 2.3.2 vs 2.0.2; patch: `expo-file-system` 19.0.23 vs
  ~19.0.24, `expo` 54.0.36 vs ~54.0.37, `expo-constants` 18.0.13 vs ~18.0.14.
  The remaining mismatches are separate findings and are not claimed as the
  Build 6 root cause.
- **Exact root cause:** Build 6 bundled `expo-network` 57.0.1 while its Expo SDK
  54 native binary expected the SDK-compatible `expo-network` 8.x native
  module. JavaScript attempted to resolve `ExpoNetwork`, but that native module
  was absent from the binary.
- **Dependency correction:** `expo-network` is pinned to `~8.0.8`; no other
  dependency or native architecture setting was changed as part of this fix
- **Regression tests:** startup diagnostic redaction, fatal-handler delegation,
  stack retention, recoverable startup-task degradation, and an explicit
  SDK-compatible `expo-network` version assertion
- **TypeScript:** passed
- **Mobile tests:** 20 suites and 162 tests passed
- **Production iOS bundle:** regenerated successfully from the corrected
  source; the matching bundle/map pair is nonempty and contains the expected
  `ExpoNetwork` JavaScript reference
- **Closest release-mode launch:** production iOS JavaScript bundling passed;
  after the dependency correction, the Expo workflow restarted cleanly and the
  real-browser Expo web startup rendered the instrumented splash with no
  `fatal-js-error`. This is not an iOS native release test.
- **Next build number:** not assigned; source configuration remains 1.0.0 (3)
- **Another TestFlight upload justified:** only after the corrected source and
  lockfile pass the required validation; none was uploaded during this work

## Confirmed startup defects hardened

These were real rejection hazards, but were not the Build 6 root:

1. The startup `Promise.all` for local stores had no rejection handler;
   `.finally()` preserved the rejection as an unhandled promise.
2. Splash-screen setup/hide promises had no rejection handlers.
3. A detached update-requirement notification chain had no terminal catch.
4. Startup phases had no persisted, sanitized breadcrumb or early global fatal
   wrapper.

Local cache failures now degrade per store. The global wrapper records a
sanitized message/stack and then calls React Native's original handler, so
fatal behavior is preserved.

## Current symbolication artifacts

These are a matching pair generated from the instrumented current source, not
from Build 6:

- `artifacts/verified-tcg/release-diagnostics/current/main.jsbundle`
- `artifacts/verified-tcg/release-diagnostics/current/main.jsbundle.map`

They cannot symbolicate Build 6 without Build 6's original matching artifacts.

## Files changed

- `artifacts/verified-tcg/index.ts`
- `artifacts/verified-tcg/package.json`
- `artifacts/verified-tcg/services/startupDiagnostics.ts`
- `artifacts/verified-tcg/services/platformRuntime.ts`
- `artifacts/verified-tcg/app/_layout.tsx`
- `artifacts/verified-tcg/components/RuntimeConfigGate.tsx`
- `artifacts/verified-tcg/context/SettingsContext.tsx`
- `artifacts/verified-tcg/context/AppContext.tsx`
- `artifacts/verified-tcg/__tests__/startup-diagnostics.test.ts`
- `artifacts/verified-tcg/release-diagnostics/README.md`

## Final conclusion

The Build 6 crash was not caused by Hermes itself, an app effect, or an
unhandled startup promise. It was a deterministic native-module compatibility
failure: SDK 54 JavaScript loaded an incompatible `expo-network` 57 package and
could not find its `ExpoNetwork` native module in the Build 6 binary. The
correct surgical source fix is the SDK 54-compatible `~8.0.8` dependency.

The original Build 6 source map is still unavailable, so generated coordinate
`185165:58` cannot be authoritatively mapped to an original source line. That
does not prevent root-cause identification because the live Console exception
and module chain identify the failing package and source import directly.