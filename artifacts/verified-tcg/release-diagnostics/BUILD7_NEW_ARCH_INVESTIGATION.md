# Build 7 FlashList / New Architecture investigation

Date: 2026-08-29 (Australia/Sydney)

# NEW ARCHITECTURE RELEASE CONFIG VERIFIED

## Confirmed Build 7 failure

- **Version/build:** Verified TCG 1.0.0 (7)
- **Bundle ID:** `co.verifiedtcg.app`
- **Physical-device exception:** `Error: FlashList v2 is only supported on new
  architecture`
- **Startup diagnostic phase:** `fatal-js-error`
- **Root cause:** FlashList v2 was bundled while `newArchEnabled` was false.
  FlashList v2 performs an explicit runtime architecture check and rejects the
  legacy React Native architecture.

## Correction

- **Current FlashList version:** 2.0.2
- **Previous `newArchEnabled`:** false
- **Corrected `newArchEnabled`:** true
- **Why legacy architecture was present:** the diagnostic Build 6 investigation
  intentionally disabled New Architecture while isolating an earlier Hermes
  startup crash. That temporary diagnostic setting remained after FlashList v2
  was retained.
- **Reanimated before correction:** 3.19.5
- **Reanimated after correction:** 4.1.7, resolved from `~4.1.1`
- **Worklets configuration:** `react-native-worklets` 0.5.1 restored as a direct
  development dependency; the legacy Reanimated install-check exclusion was
  removed.
- **React Native:** 0.81.5
- **Expo:** 54.0.37 / SDK 54
- **Keyboard Controller:** 1.18.5
- **Screens:** 4.16.0

## Validation evidence

- **Expo dependency check:** dependencies are up to date.
- **Expo Doctor:** 18/18 checks passed with no issues.
- **Expo config:** version 1.0.0, `newArchEnabled: true`, bundle ID
  `co.verifiedtcg.app`, iOS build number 8, SDK 54.0.0.
- **Generated iOS New Architecture evidence:** a clean iOS prebuild generated
  `ios/Podfile.properties.json` with `"newArchEnabled": "true"`. Its Podfile
  only forces `RCT_NEW_ARCH_ENABLED=0` when that property is false, so the
  generated Build 8 configuration leaves New Architecture enabled.
- **Hermes evidence:** the generated Podfile sets `hermes_enabled` true when
  `expo.jsEngine` is absent or equals `hermes`; the generated properties do not
  override the engine, so Hermes remains enabled.
- **FlashList production-bundle load test:** a minified production iOS bundle
  and matching source map were generated successfully from the custom early
  entrypoint. The bundle contains the FlashList v2 route module and its
  architecture guard, and bundling completed without throwing.
- **Public API origin:** Expo's versioned release config contains
  `extra.apiBaseUrl: https://app.verifiedtcg.co`. An explicit
  `EXPO_PUBLIC_API_BASE_URL` can override it, while an empty override fails
  closed instead of falling back to an editor domain. The client also carries
  the same versioned release fallback, so a production bundle generated
  without an environment override contains the approved origin.
- **Hermes RegExp fix:** yes. `resolveApiOrigin()` still normalizes the URL path
  with `pathname.endsWith('/')` and `pathname.slice(0, -1)`. The removed
  `url.pathname.replace(/\/$/, '')` code was not restored.
- **Mobile tests:** 20 suites and 166 tests passed.
- **TypeScript:** passed.
- **Release/config regression guard:** verifies FlashList major version 2
  requires `newArchEnabled: true`, Reanimated uses the SDK 54 New Architecture
  release line, Worklets is present, and no legacy install exclusion remains.
- **Closest available startup test:** a fresh mobile-sized browser session
  reached the responsive `/welcome` screen. Its logs contained neither
  `FlashList v2 is only supported on new architecture` nor `fatal-js-error`.
  The request reached the approved public API origin but browser CORS blocked
  the response. Native TestFlight networking is not subject to browser CORS,
  so this does not invalidate the native release proof and no API architecture
  change was made. The production bundle embeds the approved API origin.

## Release identity

- **Bundle ID:** remains `co.verifiedtcg.app`
- **API origin:** remains `https://app.verifiedtcg.co`
- **Next TestFlight build number:** 8, based on the supplied evidence that
  Build 7 is the current TestFlight build. App Store Connect will reject 8 if it
  was independently consumed after that evidence; confirm availability in Expo
  Launch immediately before starting the upload.
- **Base Git SHA:** `3929e1126f234bc53b74a5ae033d2243f796f15a`
- **Validated release change SHA:** assigned by the task completion
  commit/checkpoint. Use that completion SHA—not the base SHA—when identifying
  the Build 8 upload source.

## Upload decision

No upload was initiated automatically. Expo Launch is user-triggered. The code,
dependency, bundle, and generated-native checks required before opening Expo
Launch have passed; confirm Build 8 remains available, then use Expo Launch for
the TestFlight submission.