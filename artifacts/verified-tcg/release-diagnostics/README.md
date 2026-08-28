# iOS startup diagnostic artifacts

Generate a production iOS JavaScript bundle and matching source map from the
current source with:

```sh
pnpm --filter @workspace/verified-tcg exec expo export:embed \
  --entry-file artifacts/verified-tcg/index.ts \
  --platform ios --dev false --minify true \
  --bundle-output release-diagnostics/current/main.jsbundle \
  --sourcemap-output release-diagnostics/current/main.jsbundle.map \
  --assets-dest release-diagnostics/current/assets
```

Generated paths:

- Bundle: `artifacts/verified-tcg/release-diagnostics/current/main.jsbundle`
- Source map: `artifacts/verified-tcg/release-diagnostics/current/main.jsbundle.map`

The bundle and map must always be kept as a pair from the same build. The
current pair was generated after startup diagnostics were added; it is not the
missing Build 6 bundle/map and cannot symbolicate Build 6 without its matching
JavaScript stack and original artifacts.