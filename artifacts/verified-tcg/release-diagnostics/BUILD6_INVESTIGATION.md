# Build 6 startup investigation

Date: 2026-08-28 (Australia/Sydney)

## Release decision

# ROOT STARTUP EXCEPTION NOT YET IDENTIFIED

Build 7 is not justified and was not created or uploaded.

The supplied Build 6 evidence contains only the native terminal path
`RCTExceptionsManager reportFatal → reportException → RCTFatal → abort`. It
does not contain the JavaScript exception message, JavaScript stack, last
startup phase, or matching Build 6 production bundle/source map. That native
tail cannot distinguish a module-initialization throw, render/effect error,
unhandled promise rejection, or native-module compatibility error.

The workspace is Linux and cannot execute an iOS release archive or simulator.
The successful Expo Launch record has no retained device-runtime logs.

## Requested diagnostic results

- **Actual JS fatal exception:** unavailable in the supplied Build 6 evidence
- **JS stack:** unavailable in the supplied Build 6 evidence
- **Source file and line:** cannot be symbolicated without the Build 6 JS stack
  and its matching bundle/source map
- **Last Build 6 startup breadcrumb:** unavailable; Build 6 did not contain the
  new breadcrumb instrumentation
- **Before React root:** unknown
- **Inside an effect:** unknown
- **Unhandled promise rejection:** unknown for Build 6
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
- **Expo Doctor:** 17/18 checks passed; dependency-version compatibility failed
- **Dependency mismatches:** major: `expo-network` 57.0.1 vs expected ~8.0.8,
  `jest-expo` 57.0.4 vs expected ~54.0.18; minor:
  `@shopify/flash-list` 2.3.2 vs 2.0.2; patch: `expo-file-system` 19.0.23 vs
  ~19.0.24, `expo` 54.0.36 vs ~54.0.37, `expo-constants` 18.0.13 vs ~18.0.14.
  These are findings, not proven Build 6 root causes.
- **Exact root cause:** not established from existing evidence
- **Regression tests:** startup diagnostic redaction, fatal-handler delegation,
  stack retention, and recoverable startup-task degradation
- **TypeScript:** passed
- **Mobile tests:** 19 suites and 161 tests passed
- **Production iOS bundle:** generated successfully from the current source
- **Closest release-mode launch:** production iOS JavaScript bundling passed;
  the real-browser Expo web startup remained rendered and responsive for about
  70 seconds with no `fatal-js-error`. This is not an iOS native release test.
- **Next build number:** not assigned; source configuration remains 1.0.0 (3)
- **Another TestFlight upload justified:** no

## Confirmed startup defects hardened

These were real rejection hazards, but are not claimed as the Build 6 root:

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

## Evidence needed to identify Build 6

Provide either:

1. The complete Build 6 device crash/console log including the React Native
   JavaScript exception message and stack immediately before `RCTFatal`; or
2. The matching Build 6 `main.jsbundle` and source map plus its JavaScript
   stack.

Without one of those, naming a source line would be another guess.