# Monorepo Stability Layer

**Purpose:** Prevent app-to-app dependency breakage and silent plugin failures.

**Last Updated:** 2026-05-14  
**Status:** Phase 0.5 — Foundation for Phase 1 Security

---

## 1. App Classification

### Native Apps (Expo + React Native)
```
apps/rider/
apps/driver/
apps/merchant/   (if using native platform)
```

**Dependency baseline:**
- Expo SDK: ~52.0.49
- React Native: ^0.76.9
- react-native-screens: ~4.4.0
- expo-router: ~4.0.22

**Allowed native modules:**
- expo-location, expo-camera, expo-notifications, expo-dev-client
- react-native-maps, react-native-gesture-handler, react-native-reanimated
- react-native-safe-area-context

**FORBIDDEN:**
- Expo/RN in admin (web app)
- Direct native deps in packages/

### Web Apps (Vite + React)
```
apps/admin/
```

**Dependency baseline:**
- React: ^18.2.0
- Vite: ^7.3.1
- TypeScript: ~5.9.3

**FORBIDDEN:**
- expo, expo-router, react-native, @react-navigation
- Native modules of any kind
- Monorepo workspace markers (must be clean web app)

### Shared Packages
```
packages/config/      → Shared environment + Zod validation
packages/shared/      → Common utilities (no native, no Expo)
packages/api/         → API client + interceptors (no native)
packages/bootstrap/   → Shared app initialization
packages/design-system/ → UI components (careful: separate native vs web)
```

**Allowed in shared:**
- TypeScript, Zod, utilities
- Shared types
- Non-platform-specific logic

**FORBIDDEN:**
- Native modules in shared packages
- Direct Expo deps (must be optional peer deps only)
- Platform-specific code without clear `/native` and `/web` splits

---

## 2. Compatibility Matrix

### Frozen Baseline (Expo 52)

| Dependency | Version | Source | Status |
|------------|---------|--------|--------|
| Expo SDK | ~52.0.49 | Native baseline | 🔴 PINNED |
| React Native | ^0.76.9 | Expo 52 compat | 🔴 PINNED |
| react-native-screens | ~4.4.0 | Root override | 🔴 PINNED |
| expo-router | ~4.0.22 | Expo 52 compat | 🔴 PINNED |
| @expo/config-plugins | 6.0.2 | Transitive (known mismatch) | 🟡 MONITOR |
| React | ^18.2.0 | All apps | 🟡 MONITOR |
| TypeScript | ~5.9.3 | Admin/shared | 🟡 MONITOR |

### Unsafe Upgrade Chains

**DO NOT TRIGGER:**

```
Expo 52.x → 55.x
  └─ requires React Native 0.85+
    └─ breaks all current native apps
    └─ requires full dependency audit

React Native 0.76.x → 0.85+
  └─ breaks Expo SDK 52
  └─ requires native rebuilds

react-native-screens 4.4.0 → 4.25.0+
  └─ requires React Native 0.82+
  └─ incompatible with current baseline
  └─ root override prevents transitive pull

@react-navigation/* 
  └─ MUST stay in sync with react-native-screens
  └─ upgrade together or not at all
```

---

## 3. Dependency Governance

### Rule 1: Shared Package Authority
- **Source of truth:** `packages/*/package.json`
- **Apps inherit:** Via `"*"` workspace dependency
- **Apps never:** Have direct versions of shared packages
- **Example:**
  ```json
  {
    "dependencies": {
      "@gtaxi/config": "*",
      "@gtaxi/bootstrap": "*"
    }
  }
  ```

### Rule 2: Native Baseline Enforcement
- **All native apps:** Must pin same Expo + RN versions
- **Overrides:** Only in `root/package.json`
- **Per-app tweaks:** NOT allowed
- **Sync check:** `npm ls react-native` must show identical version across rider/driver

### Rule 3: Web Isolation
- **Admin app:** ZERO Expo/RN deps
- **Check:** `grep -E "expo|react-native" apps/admin/package.json` must return nothing
- **Violation:** CI fails immediately

### Rule 4: Forbidden Patterns
```bash
# NEVER COMMIT:
npm update                    # Would drift versions
npm audit fix --force         # Cascades to incompatible upgrades
npm install <pkg> --save      # No direct app deps on external packages
npx expo-doctor --fix         # Auto-upgrades without validation
```

### Rule 5: Plugin Governance
- **Approved plugins:** See section 5 below
- **New plugins:** Require cross-app compatibility review
- **Plugin versions:** Pinned in app.json, NOT floating
- **Removal:** Clean from app.json AND all source files

---

## 4. Workspace Integrity

### Required Structure
```
g-taxi-rider/
├─ package.json (root with workspaces config + overrides)
├─ packages/
│  ├─ config/
│  │  ├─ package.json (name: @gtaxi/config)
│  │  └─ src/
│  ├─ bootstrap/
│  │  ├─ package.json (name: @gtaxi/bootstrap)
│  │  └─ src/
│  ├─ api/
│  │  ├─ package.json (name: @gtaxi/api)
│  │  └─ src/
│  ├─ shared/
│  │  ├─ package.json (name: @gtaxi/shared)
│  │  └─ src/
│  └─ design-system/
│     ├─ package.json (name: @gtaxi/design-system)
│     └─ src/
├─ apps/
│  ├─ rider/
│  │  ├─ package.json (depends on @gtaxi/*)
│  │  └─ App.tsx
│  ├─ driver/
│  │  ├─ package.json (depends on @gtaxi/*)
│  │  └─ App.tsx
│  ├─ admin/
│  │  ├─ package.json (NO Expo/RN)
│  │  └─ src/App.tsx
│  └─ merchant/
│     ├─ package.json
│     └─ App.tsx
└─ scripts/
   └─ verify-all.js
```

### Validation Rules
- All packages/ must have `"name": "@gtaxi/..."` format
- All apps/ must reference `@gtaxi/*` packages via `"*"` (not pinned versions)
- No nested workspaces
- No duplicate package names
- No circular dependencies

---

## 5. Plugin Governance

### Approved & Pinned Plugins

#### Native Apps (rider/driver/merchant)
| Plugin | Version | Purpose | Status |
|--------|---------|---------|--------|
| expo-build-properties | ^0.13.3 | SDK configuration | ✅ APPROVED |
| expo-location | ~18.0.10 | GPS + permissions | ✅ APPROVED |
| expo-camera | ~14.0.6 | Camera scanning | ✅ APPROVED |
| expo-notifications | ~0.18.1 | Push notifications | ✅ APPROVED |
| expo-dev-client | ~5.0.20 | Dev builds | ✅ APPROVED |

#### Unapproved (Do Not Add)
- @sentry/react-native/metro (broken, removed from driver)
- stripe-react-native (incomplete integration)
- Any plugin requiring native code without approval

### Plugin Addition Checklist
Before adding a new plugin:
1. ✅ Check Expo SDK 52 compatibility
2. ✅ Check RN 0.76.9 compatibility
3. ✅ Test on all 3+ native apps (not just one)
4. ✅ Update this table
5. ✅ Add to ALL native apps or NONE
6. ✅ Document in app.json why it's needed
7. ✅ Add entry to approved list above

### Plugin Removal Checklist
1. ✅ Remove from app.json
2. ✅ Remove all imports from source
3. ✅ Search for dead code references
4. ✅ Update this table (move to deprecated section)
5. ✅ Commit with message: `fix(plugins): remove X (deprecated/broken)`

---

## 6. CI/Pre-commit Validation

### Before Every Commit
```bash
npm run verify:all
```

Validates:
- ✅ All apps typecheck
- ✅ All apps lint clean
- ✅ No forbidden versions present
- ✅ Workspace integrity OK
- ✅ Admin has no Expo/RN deps
- ✅ Native apps match baseline
- ✅ Metro configs valid
- ✅ app.json valid (all apps)
- ✅ No duplicate node_modules

### Before Every PR
- ✅ verify:all passes
- ✅ expo-doctor passes
- ✅ npm ls shows no conflicts
- ✅ All apps boot (quick test)
- ✅ No new external deps without approval

### Forbidden in CI
- `npm update`
- `npm audit fix --force`
- `npx expo-doctor --fix`
- Direct version changes to native baseline

---

## 7. Dependency Freeze Policy

### Freeze Window: Expo SDK 52 Lifecycle
- **Current:** Stable, all apps building
- **Duration:** Until Phase 2 (TBD)
- **What's frozen:** Expo, RN, react-native-screens, expo-router

### Approved Change Categories

#### ✅ SAFE (No freeze)
- Point releases (0.76.9 → 0.76.10)
- Patch updates in dev deps (eslint, typescript)
- New packages in shared/ (new feature)
- App-specific logic (no native changes)

#### 🟡 REVIEW REQUIRED (Freeze)
- Minor updates to Expo packages (52.0.x → 52.1.x)
- New native plugins
- Changes to app.json
- Metro config updates

#### 🔴 FORBIDDEN (Freeze)
- Expo SDK upgrade (52.x → 53.x or higher)
- React Native upgrade (0.76.x → 0.77.x or higher)
- Major dependency changes

### Upgrade Playbook (When Freeze Ends)
1. Create Phase 2 branch
2. Run full compatibility audit
3. Test on real devices (not just Metro)
4. Update dependency-baseline.md
5. Create new tag (e.g., `expo55-stable`)
6. Merge with full team review

---

## 8. Health Verification Scripts

### Command
```bash
npm run verify:all
```

### Output Example
```
✅ workspace-integrity: OK (5 packages, 4 apps)
✅ no-native-in-admin: PASS (admin has 0 Expo deps)
✅ baseline-versions: PASS (all native apps on 0.76.9)
✅ forbidden-packages: PASS (no @sentry/*, no stripe)
✅ app-json-valid: PASS (4 apps)
✅ metro-config-valid: PASS (2 apps)
✅ typecheck: PASS (rider, driver, admin)
✅ lint: PASS
✅ duplicate-deps: PASS
✅ expo-doctor: WARNING (1 issue) - config-plugins mismatch (safe, known)

Overall: ✅ PASS (ready to commit)
```

---

## 9. Shared Bootstrap Architecture

### Initialization Pattern

All apps (rider, driver, admin) must follow:

```typescript
// App.tsx or main entry
import { bootstrapApp } from '@gtaxi/bootstrap';
import { loadEnv } from '@gtaxi/config';

// 1. Load & validate env
const env = loadEnv();

// 2. Initialize shared services
bootstrapApp({
  env,
  telemetry: true,
  logging: 'structured',
  errorBoundaries: true,
});

// 3. Then render app
export default function App() {
  // App is safe to use shared services
}
```

### Bootstrap Components
- ✅ Environment validation (fail-fast)
- ✅ Telemetry initialization (Sentry, custom)
- ✅ Logger setup (structured logs)
- ✅ Error boundaries (top-level)
- ✅ Auth initialization (tokens, refresh)
- ✅ API client setup (interceptors)

---

## 10. Cross-App Change Impact

### Decision Tree

**"I want to update a dependency..."**

1. Is it in `packages/*`?
   - YES → All apps inherit (document in PR)
   - NO → Proceed to step 2

2. Is it in `apps/*/package.json`?
   - YES → Other apps unaffected
   - NO → Proceed to step 3

3. Is it a native module (Expo, RN)?
   - YES → FREEZE (requires Phase 2 planning)
   - NO → Proceed to step 4

4. Does it change `package.json`, `app.json`, or `metro.config.js`?
   - YES → Run `npm run verify:all`
   - NO → Just commit

---

## Rollout Schedule

### Week 1: Establish Governance
- ✅ Document this STABILITY.md
- ✅ Create verify:all script
- ✅ Run verify:all on current state
- ✅ Tag monorepo-recovery branch

### Week 2: Formalize Shared Packages
- ✅ Create `packages/config` (Zod validation)
- ✅ Create `packages/bootstrap` (shared init)
- ✅ Create `packages/api` (HTTP client)
- ✅ Wire into all 3 apps

### Week 3: Lock Admin
- ✅ Remove all Expo/RN from admin
- ✅ Add web-specific CI checks
- ✅ Tag `admin-isolated`

### Week 4: Phase 1 Security
- ✅ Hardened env validation (Zod)
- ✅ Admin auth gates
- ✅ API key isolation
- ✅ Start Phase 1 tasks

---

## Decision Authority

### Who can change what?

| Change | Authority | Review |
|--------|-----------|--------|
| App-specific code | App owner | Code review |
| Shared package logic | Team | Code review |
| Dependencies (freeze) | Tech lead | Full team |
| Plugin changes | Tech lead | All native apps tested |
| CI rules | Tech lead | Documented |
| Native baseline | Tech lead | Phase planning |

---

## Escalation Path

**If a change breaks multiple apps:**

1. Revert immediately
2. Create issue with full stack trace
3. Analyze root cause
4. Update STABILITY.md to prevent recurrence
5. Plan fix in next phase

**If freeze is violated:**

1. Stop the change
2. Ensure verify:all passes
3. Document why freeze needs to break
4. Get team approval
5. Update this document

---

## References

- [Dependency Baseline](../architecture/dependency-baseline.md)
- [CLAUDE.md - Production Status & Repair Phases](../../CLAUDE.md)
- [Root package.json - Workspaces + Overrides](../../package.json)

