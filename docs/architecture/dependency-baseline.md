# Expo SDK 52 Dependency Baseline

**Recovery Date:** 2026-05-14  
**Tag:** `expo52-stable`  
**Status:** ✅ Both native apps (rider + driver) verified bootable  

## Critical Pinned Versions

These versions MUST NOT be upgraded without dependency analysis:

| Package | Version | Reason | Upper Bound |
|---------|---------|--------|------------|
| `expo` | `~52.0.49` | Base SDK baseline | `52.x.x` only |
| `react-native` | `^0.76.9` | Compatible with Expo SDK 52 | `0.76.x` only |
| `react-native-screens` | `~4.4.0` | **CRITICAL:** 4.25.0+ requires RN 0.82+ | `4.4.x` only |
| `expo-router` | `~4.0.22` | Compatible with Expo SDK 52 | `4.0.x` only |
| `expo-notifications` | `~0.18.1` | Used by driver app | `0.18.x` only |
| `@expo/config-plugins` | `6.0.2` | ⚠️ Lower than ideal (see issues below) | Match Expo SDK version |

### Root Package.json Overrides

```json
{
  "overrides": {
    "react-native-screens": "~4.4.0"
  }
}
```

This override prevents transitive dependencies (expo-router, @react-navigation) from pulling incompatible `react-native-screens@4.25.0+`.

## Known Issues & Workarounds

### 1. @expo/config-plugins Mismatch
- **Current:** `6.0.2`
- **Expected:** `~9.0.0` (per expo-doctor)
- **Impact:** expo-doctor warns but apps still build
- **Cause:** Transitive dependency from older Expo tooling
- **Action:** Do NOT force upgrade—breaks Expo SDK 52 compat

### 2. Security Vulnerabilities (Non-Breaking)
From `npm audit`:
- `@xmldom/xmldom`: 5 XML injection CVEs
- `tar`: 6 path traversal CVEs  
- `semver`: ReDoS vulnerability
- `postcss`: XSS via style tags

**All triggered only via `npm audit fix --force`**, which would upgrade Expo SDK to 55+. Safe to ignore until Phase 2 upgrades.

### 3. Sentry Metro Plugin (Removed)
- **File:** `apps/driver/metro.config.js`
- **Status:** Sentry integration disabled in source (`App.tsx` line 99)
- **Fix Applied:** Removed `getSentryExpoConfig()` import
- **Reason:** Dead code causing Metro to fail on startup

## Outdated Packages (Safe to Monitor)

These are available upgrades but NOT recommended for Expo SDK 52:

```
expo:                 55.0.24 (don't upgrade - breaks RN 0.76.9)
react-native:         0.85.3  (don't upgrade - breaks Expo 52)
expo-router:          55.0.14 (don't upgrade - breaks Expo 52)
react-native-screens: 4.25.0  (don't upgrade - requires RN 0.82+)
react:                19.2.6  (safe to monitor, not urgent)
```

## Workspace Structure

Both native apps must share the same dependency baseline:

```
apps/
  ├─ rider/
  │  └─ package.json (expo: ~52.0.49, react-native: ^0.76.9, react-native-screens: ~4.4.0)
  └─ driver/
     └─ package.json (same versions + expo-notifications: ~0.18.1)

packages/
  ├─ design-system/
  └─ shared/
```

**CRITICAL:** Admin app is web-only (Vite); remove all Expo/RN deps from `apps/admin/package.json`.

## Dependency Resolution Commands

### Install with Overrides
```bash
npm install --legacy-peer-deps
```

### Verify Correct Versions
```bash
npm ls react-native-screens
npm ls react-native
```

Expected output:
```
react-native-screens@4.4.0 (all apps deduped)
react-native@0.76.9 (all apps deduped)
```

### Health Check
```bash
npm audit --omit=dev          # Shows 21 vulns (safe, not blocking)
npx expo-doctor               # Shows 1 config-plugins warning (safe)
npm outdated                  # Shows available upgrades (don't use)
```

## Forbidden Upgrades

❌ **NEVER run these without Phase 2 planning:**

```bash
npm upgrade expo              # Would pull 55.x (RN 0.85+ incompatible)
npm upgrade react-native      # Would pull 0.85+ (Expo 52 incompatible)
npm upgrade react-native-screens  # Would pull 4.25+ (requires RN 0.82+)
npm audit fix --force         # Cascades to Expo 55+
npx expo-doctor --fix         # May auto-upgrade incompatibly
```

## Recovery Steps (If Dependency Hell Returns)

1. **Inspect the error:** Where does the incompatible version come from?
   ```bash
   npm why react-native-screens
   ```

2. **Check which package pulled it:**
   ```bash
   npm ls react-native-screens
   ```

3. **Add/update root override:**
   ```json
   {
     "overrides": {
       "react-native-screens": "~4.4.0",
       "PROBLEMATIC_PKG": "~EXACT.VERSION.X"
     }
   }
   ```

4. **Clean and reinstall:**
   ```bash
   rm -rf node_modules package-lock.json
   npm install --legacy-peer-deps
   ```

5. **Verify both apps boot:**
   ```bash
   npm run rider  # Should start Metro on 8081
   npm run driver # Should start Metro on 8082
   ```

## Timeline for Future Upgrades

**Phase 2 (Future):** Plan Expo SDK upgrade to 55+
- Will require react-native upgrade to 0.85+
- Will unlock react-native-screens 4.25+
- Requires full dependency audit and testing

**Phase 3:** React 19 upgrade (after Expo 55 stable)

## Last Updated

- **Date:** 2026-05-14
- **Author:** Dependency Recovery Task
- **Verified Apps:** rider, driver
- **Committed:** `expo52-stable` tag
