
# GTaxi FULL SYSTEM AUDIT REPORT

## Metadata
- Timestamp: 2026-05-14T15:39:13.837Z
- Branch: monorepo-recovery
- Node: v20.19.6
- npm: 10.8.2

---

## Workspace Overview
### Apps
- admin
- driver
- merchant
- rider

### Packages
- api
- bootstrap
- config
- design-system
- shared

---

## Dependency Snapshot
```
g-taxi-root@ /Users/kingtay/Desktop/g-taxi-rider
├─┬ @gtaxi/api@1.0.0 -> ./packages/api
│ ├── @gtaxi/bootstrap@1.0.0 deduped -> ./packages/bootstrap
│ ├── @gtaxi/config@1.0.0 deduped -> ./packages/config
│ └── typescript@5.9.3
├─┬ @gtaxi/bootstrap@1.0.0 -> ./packages/bootstrap
│ ├── @gtaxi/config@1.0.0 deduped -> ./packages/config
│ └── typescript@5.9.3 deduped
├─┬ @gtaxi/config@1.0.0 -> ./packages/config
│ ├── typescript@5.9.3 deduped
│ └── zod@3.25.76
├─┬ @gtaxi/design-system@1.0.0 -> ./packages/design-system
│ ├── expo-build-properties@0.13.3
│ ├── expo-camera@14.0.6
│ ├── expo-dev-client@5.0.20
│ ├── expo-location@18.0.10
│ ├── expo-router@4.0.22
│ ├── expo@52.0.49
│ ├── react-native@0.76.9
│ └── react@18.3.1
├─┬ @gtaxi/shared@1.0.0 -> ./packages/shared
│ ├── expo-build-properties@0.13.3 deduped
│ ├── expo-camera@14.0.6 deduped
│ ├── expo-dev-client@5.0.20 deduped
│ ├── expo-location@18.0.10 deduped
│ ├── expo-router@4.0.22 deduped
│ ├── expo@52.0.49 deduped
│ ├── react-native@0.76.9 deduped
│ └── react@18.3.1 deduped
├─┬ admin@0.0.0 -> ./apps/admin
│ ├── @eslint/js@9.39.4
│ ├── @gtaxi/design-system@1.0.0 deduped -> ./packages/design-system
│ ├── @gtaxi/shared@1.0.0 deduped -> ./packages/shared
│ ├── @types/node@24.12.4
│ ├── @types/react-dom@19.2.3
│ ├── @types/react@19.2.14
│ ├── @vitejs/plugin-react@5.2.0
│ ├── autoprefixer@10.5.0
│ ├── eslint-plugin-react-hooks@7.1.1
│ ├── eslint-plugin-react-refresh@0.4.26
│ ├── eslint@9.39.4 deduped
│ ├── globals@16.5.0
│ ├── lucide-react@0.577.0
│ ├── mapbox-gl@3.23.1
│ ├── postcss@8.5.14
│ ├── react-dom@18.2.0
│ ├── react-map-gl@8.1.1
│ ├── react@18.3.1 deduped
│ ├── tailwindcss@4.3.0
│ ├── typescript-eslint@8.59.3
│ ├── typescript@5.9.3 deduped
│ └── vite@7.3.3
├─┬ driver@ -> ./apps/driver
│ ├── @gtaxi/design-system@1.0.0 deduped -> ./packages/design-system
│ ├── @gtaxi/shared@1.0.0 deduped -> ./packages/shared
│ ├── expo-build-properties@0.13.3 deduped
│ ├── expo-camera@14.0.6 deduped
│ ├── expo-dev-client@5.0.20 deduped
│ ├── expo-location@18.0.10 deduped
│ ├── expo-notifications@0.18.1
│ ├── expo-router@4.0.22 deduped
│ ├── expo@52.0.49 deduped
│ ├── react-native-maps@1.18.0
│ ├── react-native-screens@4.4.0 overridden
│ ├── react-native@0.76.9 deduped
│ └── react@18.3.1 deduped
├── eslint-import-resolver-alias@1.1.2
├── eslint-plugin-import@2.32.0
├── eslint@9.39.4
├── madge@8.0.0
├─┬ merchant@0.0.0 -> ./apps/merchant
│ ├── @gtaxi/design-system@1.0.0 deduped -> ./packages/design-system
│ ├── @gtaxi/shared@1.0.0 deduped -> ./packages/shared
│ ├── @supabase/supabase-js@2.105.4
│ ├── @types/react-dom@19.2.3 deduped
│ ├── @types/react@19.2.14 deduped
│ ├── @vitejs/plugin-react@4.7.0
│ ├── autoprefixer@10.5.0 deduped
│ ├── expo-build-properties@0.13.3 deduped
│ ├── expo-camera@14.0.6 deduped
│ ├── expo-dev-client@5.0.20 deduped
│ ├── expo-location@18.0.10 deduped
│ ├── expo-router@4.0.22 deduped
│ ├── expo@52.0.49 deduped
│ ├── lucide-react@0.475.0
│ ├── postcss@8.5.14 deduped
│ ├── react-dom@18.2.0 deduped
│ ├── react-native@0.76.9 deduped
│ ├── react@18.3.1 deduped
│ ├── tailwindcss@3.4.19
│ ├── typescript@5.6.3
│ └── vite@6.4.2
└─┬ rider@1.0.0 -> ./apps/rider
  ├── expo-build-properties@0.13.3 deduped
  ├── expo-camera@14.0.6 deduped
  ├── expo-dev-client@5.0.20 deduped
  ├── expo-location@18.0.10 deduped
  ├── expo-router@4.0.22 deduped
  ├── expo@52.0.49 deduped
  ├── react-native-gesture-handler@2.20.2
  ├── react-native-reanimated@3.16.7
  ├── react-native-safe-area-context@4.12.0
  ├── react-native-screens@4.4.0 deduped
  ├── react-native@0.76.9 deduped
  └── react@18.3.1 deduped
```

---

## React / RN / Expo Matrix
```
g-taxi-root@ /Users/kingtay/Desktop/g-taxi-rider
├─┬ @gtaxi/design-system@1.0.0 -> ./packages/design-system
│ ├─┬ expo-build-properties@0.13.3
│ │ └── expo@52.0.49 deduped
│ ├─┬ expo-camera@14.0.6
│ │ └── expo@52.0.49 deduped
│ ├─┬ expo-dev-client@5.0.20
│ │ ├─┬ expo-dev-launcher@5.0.35
│ │ │ └── expo@52.0.49 deduped
│ │ ├─┬ expo-dev-menu-interface@1.9.3
│ │ │ └── expo@52.0.49 deduped
│ │ ├─┬ expo-dev-menu@6.0.25
│ │ │ └── expo@52.0.49 deduped
│ │ ├─┬ expo-manifests@0.15.8
│ │ │ └── expo@52.0.49 deduped
│ │ ├─┬ expo-updates-interface@1.0.0
│ │ │ └── expo@52.0.49 deduped
│ │ └── expo@52.0.49 deduped
│ ├─┬ expo-location@18.0.10
│ │ └── expo@52.0.49 deduped
│ ├─┬ expo-router@4.0.22
│ │ ├─┬ @expo/metro-runtime@4.0.1
│ │ │ └── react-native@0.76.9 deduped
│ │ ├─┬ @radix-ui/react-slot@1.0.1
│ │ │ ├─┬ @radix-ui/react-compose-refs@1.0.0
│ │ │ │ └── react@18.3.1 deduped
│ │ │ └── react@18.3.1 deduped
│ │ ├─┬ @react-navigation/bottom-tabs@7.16.1
│ │ │ ├─┬ @react-navigation/elements@2.9.18
│ │ │ │ ├── react-native@0.76.9 deduped
│ │ │ │ ├── react@18.3.1 deduped
│ │ │ │ └─┬ use-sync-external-store@1.6.0
│ │ │ │   └── react@18.3.1 deduped
│ │ │ ├── react-native-screens@4.4.0 deduped
│ │ │ ├── react-native@0.76.9 deduped
│ │ │ └── react@18.3.1 deduped
│ │ ├─┬ @react-navigation/native-stack@7.15.1
│ │ │ ├── react-native-screens@4.4.0 deduped
│ │ │ ├── react-native@0.76.9 deduped
│ │ │ └── react@18.3.1 deduped
│ │ ├─┬ @react-navigation/native@7.2.4
│ │ │ ├─┬ @react-navigation/core@7.17.4
│ │ │ │ └── react@18.3.1 deduped
│ │ │ ├── react-native@0.76.9 deduped
│ │ │ ├── react@18.3.1 deduped
│ │ │ └─┬ use-latest-callback@0.2.6
│ │ │   └── react@18.3.1 deduped
│ │ ├─┬ expo-constants@17.0.8
│ │ │ ├── expo@52.0.49 deduped
│ │ │ └── react-native@0.76.9 deduped
│ │ ├── expo@52.0.49 deduped
│ │ ├─┬ react-helmet-async@1.3.0
│ │ │ └── react@18.3.1 deduped
│ │ ├─┬ react-native-helmet-async@2.0.4
│ │ │ └── react@18.3.1 deduped
│ │ ├─┬ react-native-is-edge-to-edge@1.3.1
│ │ │ ├── react-native@0.76.9 deduped
│ │ │ └── react@18.3.1 deduped
│ │ └── react-native-screens@4.4.0 deduped
│ ├─┬ expo@52.0.49
│ │ ├─┬ expo-asset@11.0.5
│ │ │ ├── expo@52.0.49 deduped
│ │ │ ├── react-native@0.76.9 deduped
│ │ │ └── react@18.3.1 deduped
│ │ ├─┬ expo-file-system@18.0.12
│ │ │ ├── expo@52.0.49 deduped
│ │ │ └── react-native@0.76.9 deduped
│ │ ├─┬ expo-font@13.0.4
│ │ │ ├── expo@52.0.49 deduped
│ │ │ └── react@18.3.1 deduped
│ │ ├─┬ expo-keep-awake@14.0.3
│ │ │ ├── expo@52.0.49 deduped
│ │ │ └── react@18.3.1 deduped
│ │ ├── react-native@0.76.9 deduped
│ │ └── react@18.3.1 deduped
│ ├─┬ react-native@0.76.9
│ │ ├─┬ @react-native/virtualized-lists@0.76.9
│ │ │ ├── react-native@0.76.9 deduped
│ │ │ └── react@18.3.1 deduped
│ │ └── react@18.3.1 deduped
│ └── react@18.3.1
├─┬ @gtaxi/shared@1.0.0 -> ./packages/shared
│ ├── expo-router@4.0.22 deduped
│ ├── expo@52.0.49 deduped
│ ├── react-native@0.76.9 deduped
│ └── react@18.3.1 deduped
├─┬ admin@0.0.0 -> ./apps/admin
│ ├─┬ lucide-react@0.577.0
│ │ └── react@18.3.1 deduped
│ ├─┬ react-dom@18.2.0
│ │ └── react@18.3.1 deduped
│ ├─┬ react-map-gl@8.1.1
│ │ ├─┬ @vis.gl/react-mapbox@8.1.1
│ │ │ └── react@18.3.1 deduped
│ │ ├─┬ @vis.gl/react-maplibre@8.1.1
│ │ │ └── react@18.3.1 deduped
│ │ └── react@18.3.1 deduped
│ └── react@18.3.1 deduped
├─┬ driver@ -> ./apps/driver
│ ├─┬ expo-notifications@0.18.1
│ │ ├─┬ expo-application@5.1.1
│ │ │ └── expo@52.0.49 deduped
│ │ ├─┬ expo-constants@14.2.1
│ │ │ └── expo@52.0.49 deduped
│ │ └── expo@52.0.49 deduped
│ ├── expo-router@4.0.22 deduped
│ ├── expo@52.0.49 deduped
│ ├─┬ react-native-maps@1.18.0
│ │ ├── react-native@0.76.9 deduped
│ │ └── react@18.3.1 deduped
│ ├─┬ react-native-screens@4.4.0 overridden
│ │ ├─┬ react-freeze@1.0.4
│ │ │ └── react@18.3.1 deduped
│ │ ├── react-native@0.76.9 deduped
│ │ └── react@18.3.1 deduped
│ ├── react-native@0.76.9 deduped
│ └── react@18.3.1 deduped
├─┬ merchant@0.0.0 -> ./apps/merchant
│ ├── expo-router@4.0.22 deduped
│ ├── expo@52.0.49 deduped
│ ├─┬ lucide-react@0.475.0
│ │ └── react@18.3.1 deduped
│ ├── react-native@0.76.9 deduped
│ └── react@18.3.1 deduped
└─┬ rider@1.0.0 -> ./apps/rider
  ├── expo-router@4.0.22 deduped
  ├── expo@52.0.49 deduped
  ├─┬ react-native-gesture-handler@2.20.2
  │ ├── react-native@0.76.9 deduped
  │ └── react@18.3.1 deduped
  ├─┬ react-native-reanimated@3.16.7
  │ ├── react-native@0.76.9 deduped
  │ └── react@18.3.1 deduped
  ├─┬ react-native-safe-area-context@4.12.0
  │ ├── react-native@0.76.9 deduped
  │ └── react@18.3.1 deduped
  ├── react-native-screens@4.4.0 deduped
  ├── react-native@0.76.9 deduped
  └── react@18.3.1 deduped
```

---

## Duplicate / Drift Check
```
add @types/react 19.2.14
add @types/react 19.2.14
add @types/prop-types 15.7.15
add expo-linking 7.0.5
add @babel/preset-modules 0.1.6-no-external-plugins
add @babel/plugin-transform-unicode-sets-regex 7.28.6
add @babel/plugin-transform-unicode-property-regex 7.28.6
add @babel/plugin-transform-unicode-escapes 7.27.1
add @babel/plugin-transform-typeof-symbol 7.27.1
add @babel/plugin-transform-reserved-words 7.27.1
add @babel/plugin-transform-regexp-modifiers 7.28.6
add @babel/plugin-transform-property-literals 7.27.1
add @babel/plugin-transform-object-super 7.27.1
add @babel/plugin-transform-new-target 7.27.1
add @babel/plugin-transform-modules-umd 7.27.1
add @babel/plugin-transform-modules-systemjs 7.29.4
add @babel/plugin-transform-modules-amd 7.27.1
add @babel/plugin-transform-member-expression-literals 7.27.1
add @babel/plugin-transform-json-strings 7.28.6
add @babel/plugin-transform-exponentiation-operator 7.28.6
add @babel/plugin-transform-explicit-resource-management 7.28.6
add @babel/plugin-transform-dynamic-import 7.27.1
add @babel/plugin-transform-duplicate-named-capturing-groups-regex 7.29.0
add @babel/plugin-transform-duplicate-keys 7.27.1
add @babel/plugin-transform-dotall-regex 7.28.6
add @babel/plugin-transform-class-static-block 7.28.6
add @babel/plugin-transform-block-scoped-functions 7.27.1
add @babel/plugin-syntax-unicode-sets-regex 7.18.6
add @babel/plugin-syntax-import-assertions 7.28.6
add @babel/plugin-proposal-private-property-in-object 7.21.0-placeholder-for-preset-env.2
add @babel/plugin-bugfix-v8-static-class-fields-redefine-readonly 7.28.6
add @babel/plugin-bugfix-v8-spread-parameters-in-optional-chaining 7.27.1
add @babel/plugin-bugfix-safari-rest-destructuring-rhs-array 7.29.3
add @babel/plugin-bugfix-safari-id-destructuring-collision-in-function-expression 7.27.1
add @babel/plugin-bugfix-safari-class-field-initializer-scope 7.27.1
add @babel/plugin-bugfix-firefox-class-in-computed-class-key 7.28.5
add @babel/preset-env 7.29.5
add babel-plugin-polyfill-corejs3 0.14.2
add lightningcss-win32-x64-msvc 1.27.0
add lightningcss-win32-arm64-msvc 1.27.0
add lightningcss-linux-x64-musl 1.27.0
add lightningcss-linux-x64-gnu 1.27.0
add lightningcss-linux-arm64-musl 1.27.0
add lightningcss-linux-arm64-gnu 1.27.0
add lightningcss-linux-arm-gnueabihf 1.27.0
add lightningcss-freebsd-x64 1.27.0
add lightningcss-darwin-arm64 1.27.0
add @rollup/rollup-win32-x64-msvc 4.60.3
add @rollup/rollup-win32-x64-gnu 4.60.3
add @rollup/rollup-win32-ia32-msvc 4.60.3
add @rollup/rollup-win32-arm64-msvc 4.60.3
add @rollup/rollup-openharmony-arm64 4.60.3
add @rollup/rollup-openbsd-x64 4.60.3
add @rollup/rollup-linux-x64-musl 4.60.3
add @rollup/rollup-linux-x64-gnu 4.60.3
add @rollup/rollup-linux-s390x-gnu 4.60.3
add @rollup/rollup-linux-riscv64-musl 4.60.3
add @rollup/rollup-linux-riscv64-gnu 4.60.3
add @rollup/rollup-linux-ppc64-musl 4.60.3
add @rollup/rollup-linux-ppc64-gnu 4.60.3
add @rollup/rollup-linux-loong64-musl 4.60.3
add @rollup/rollup-linux-loong64-gnu 4.60.3
add @rollup/rollup-linux-arm64-musl 4.60.3
add @rollup/rollup-linux-arm64-gnu 4.60.3
add @rollup/rollup-linux-arm-musleabihf 4.60.3
add @rollup/rollup-linux-arm-gnueabihf 4.60.3
add @rollup/rollup-freebsd-x64 4.60.3
add @rollup/rollup-freebsd-arm64 4.60.3
add @rollup/rollup-darwin-arm64 4.60.3
add @rollup/rollup-android-arm64 4.60.3
add @rollup/rollup-android-arm-eabi 4.60.3
add @esbuild/win32-x64 0.25.12
add @esbuild/win32-ia32 0.25.12
add @esbuild/win32-arm64 0.25.12
add @esbuild/sunos-x64 0.25.12
add @esbuild/openharmony-arm64 0.25.12
add @esbuild/openbsd-x64 0.25.12
add @esbuild/openbsd-arm64 0.25.12
add @esbuild/netbsd-x64 0.25.12
add @esbuild/netbsd-arm64 0.25.12
add @esbuild/linux-x64 0.25.12
add @esbuild/linux-s390x 0.25.12
add @esbuild/linux-riscv64 0.25.12
add @esbuild/linux-ppc64 0.25.12
add @esbuild/linux-mips64el 0.25.12
add @esbuild/linux-loong64 0.25.12
add @esbuild/linux-ia32 0.25.12
add @esbuild/linux-arm64 0.25.12
add @esbuild/linux-arm 0.25.12
add @esbuild/freebsd-x64 0.25.12
add @esbuild/freebsd-arm64 0.25.12
add @esbuild/darwin-arm64 0.25.12
add @esbuild/android-x64 0.25.12
add @esbuild/android-arm64 0.25.12
add @esbuild/android-arm 0.25.12
add @esbuild/aix-ppc64 0.25.12
change @types/react 19.2.14 => 18.3.28
change @types/estree 1.0.9 => 1.0.8
remove @babel/code-frame 7.10.4
remove @expo/json-file 9.0.2
change @expo/json-file 9.1.5 => 9.0.2
remove @expo/json-file 9.0.2
remove @babel/code-frame 7.10.4
remove sucrase 3.35.0
remove commander 4.1.1
add json-schema-traverse 0.4.1
add ajv 6.15.0
add @esbuild/win32-x64 0.27.7
add @esbuild/win32-ia32 0.27.7
add @esbuild/win32-arm64 0.27.7
add @esbuild/sunos-x64 0.27.7
add @esbuild/openharmony-arm64 0.27.7
add @esbuild/openbsd-x64 0.27.7
add @esbuild/openbsd-arm64 0.27.7
add @esbuild/netbsd-x64 0.27.7
add @esbuild/netbsd-arm64 0.27.7
add @esbuild/linux-x64 0.27.7
add @esbuild/linux-s390x 0.27.7
add @esbuild/linux-riscv64 0.27.7
add @esbuild/linux-ppc64 0.27.7
add @esbuild/linux-mips64el 0.27.7
add @esbuild/linux-loong64 0.27.7
add @esbuild/linux-ia32 0.27.7
add @esbuild/linux-arm64 0.27.7
add @esbuild/linux-arm 0.27.7
add @esbuild/freebsd-x64 0.27.7
add @esbuild/freebsd-arm64 0.27.7
add @esbuild/darwin-arm64 0.27.7
add @esbuild/android-x64 0.27.7
add @esbuild/android-arm64 0.27.7
add @esbuild/android-arm 0.27.7
add @esbuild/aix-ppc64 0.27.7
change sucrase 3.35.1 => 3.35.0
remove bplist-parser 0.3.1
remove json-schema-traverse 1.0.0
remove ajv 8.20.0
remove @types/estree 1.0.8
remove mime-db 1.52.0
change mime-db 1.54.0 => 1.52.0
change json-schema-traverse 0.4.1 => 1.0.0
remove fast-uri 3.1.2
change @expo/json-file 8.3.3 => 8.2.37
remove @expo/json-file 8.2.37
remove json-schema-traverse 1.0.0
remove ajv 8.11.0
remove ajv 8.20.0
remove json-schema-traverse 1.0.0
add json-schema-traverse 0.4.1
add ajv 6.15.0
change bplist-parser 0.3.2 => 0.3.1
remove ajv 8.20.0
remove json-schema-traverse 1.0.0
change ajv 6.15.0 => 8.11.0

added 125 packages, removed 19 packages, and changed 9 packages in 30s

222 packages are looking for funding
  run `npm fund` for details
```

---

## CI / Build Signals
- lint: present
- CI: present

---

## Environment Files
```
./apps/rider/.env
./apps/driver/.env
./apps/admin/.env.local
./apps/admin/.env
./apps/merchant/.env
```

---

## HEALTH SUMMARY

### Critical Issues
- manual review required

### Warnings
- version drift across web apps
- mixed Vite versions (admin vs merchant)

### Architecture Risks
- Expo + Vite hybrid ecosystem

### Runtime Risks
- react-native-screens override may cause navigation edge cases

### Security Risks
- npm audit not included

### Production Blockers
- none detected

---

## Recommendation Order
1. unify react-dom versions
2. align vite versions
3. align TypeScript versions
4. remove react-native-screens override if unnecessary
5. add CI matrix (lint + typecheck + build)
