# Comprehensive Monorepo Report — G-Taxi Rider

**Date:** 2026-06-04
**Author:** Automated monorepo audit
**Repository:** `g-taxi-rider` (private)
**Git:** `git@github.com:gtaxi868-kingtay/G-Taxi-868-R1-.git`

---

## 1. Monorepo Structure and Organization

### 1.1 Directory Layout

```
g-taxi-rider/
├── apps/                    # 7 deployable applications
│   ├── rider/               # Passenger mobile app (Expo 52 / React Native)
│   ├── driver/              # Driver mobile app (Expo 52 / React Native)
│   ├── admin/               # Web admin dashboard (Vite 7 / React / Tailwind)
│   ├── merchant/            # Web merchant dashboard (Vite 7 / React / Tailwind)
│   ├── merchant-mobile/     # Merchant mobile app (Expo 52 / React Native)
│   ├── admin-mobile/        # Mobile admin companion (Expo 52 / React Native)
│   └── qr-landing/          # Static HTML QR-code landing page
├── packages/                # 7 shared internal libraries
│   ├── core/                # @gtaxi/core — Supabase client, env, types, retry
│   ├── shared/              # @gtaxi/shared — ErrorBoundary, shadow wrappers
│   ├── design-system/       # @gtaxi/design-system — Web DS components
│   ├── design-system-native/# @gtaxi/design-system-native — RN DS + theme tokens
│   ├── api/                 # @gtaxi/api — API client with auth/retry
│   ├── config/              # @gtaxi/config — Zod-based env validation
│   └── bootstrap/           # @gtaxi/bootstrap — App init, logging, telemetry
├── supabase/
│   ├── functions/           # 73 Deno edge functions
│   ├── migrations/          # 123 SQL migration files
│   └── config.toml          # Edge function JWT, import map config
├── scripts/                 # 33 Node.js audit/simulation/debug utilities
├── .github/workflows/       # CI (single lint workflow)
├── docs/                    # Architecture reports, monorepo CI rules, audits
├── agent/                   # AI agent skill definitions
├── _agents/                 # Additional agent configurations
├── superpowers/             # Separate git repo: agent skill plugin system v5.0.6
├── ui-ux-pro-max-skill/     # UI/UX audit skill (separate project)
└── stitch_ride_confirmation_screen/  # 81 UI mockup subdirectories
```

### 1.2 Application Details

| App | Type | Framework | Scripts | Internal Deps |
|-----|------|-----------|---------|---------------|
| **rider** | Mobile (Android/iOS) | Expo SDK 52, React Native 0.76.9 | `start`, `android`, `ios`, `typecheck` | `@gtaxi/core`, `@gtaxi/design-system`, `@gtaxi/shared` |
| **driver** | Mobile (Android/iOS) | Expo SDK 52, React Native 0.76.9 | `start`, `android`, `ios`, `typecheck` | `@gtaxi/core`, `@gtaxi/design-system`, `@gtaxi/shared` |
| **admin** | Web dashboard | Vite 7.3.5, React 18, Tailwind 4 | `dev`, `build`, `typecheck` | `@gtaxi/core` |
| **merchant** | Web dashboard | Vite 7.3.5, React 18, Tailwind 4 | `dev`, `build`, `typecheck` | `@gtaxi/core`, `@gtaxi/design-system` |
| **merchant-mobile** | Mobile | Expo SDK 52, React Native 0.76.9 | `start`, `android`, `ios`, `typecheck` | `@gtaxi/core`, `@gtaxi/design-system`, `@gtaxi/shared` |
| **admin-mobile** | Mobile | Expo SDK 52, React Native 0.76.9 | `start`, `android`, `ios`, `typecheck` | `@gtaxi/core`, `@gtaxi/design-system`, `@gtaxi/shared` |
| **qr-landing** | Static HTML | None (single `index.html`) | None | None |

**Key external dependencies per app:**
- **Expo mobile apps** (`rider`, `driver`, `merchant-mobile`, `admin-mobile`): `expo-location`, `expo-notifications`, `react-native-maps` (Mapbox), `@supabase/supabase-js`, `@react-navigation/native`, `expo-secure-store`
- **rider + driver only**: `@stripe/stripe-react-native`, `@sentry/react-native`, `react-native-nfc-manager`
- **rider only**: `@tanstack/react-query`, `expo-camera`
- **driver only**: `expo-sensors`
- **admin only**: `mapbox-gl`, `react-map-gl`
- **admin-mobile only**: `expo-dev-client`, `react-native-gesture-handler`

### 1.3 Supabase Backend

The backend consists of two layers:

**Edge Functions** (73 deployed Deno functions):
- 12 core ride flow functions (`create_ride`, `accept_ride`, `complete_ride`, `match_driver`, etc.)
- 18 admin functions (`admin_get_users`, `admin_assign_driver`, `admin_settle_debt`, etc.)
- 9 merchant functions (`merchant_dispatch`, `merchant_gateway`, `merchant_signup`, etc.)
- 9 AI/concierge functions (`ai_concierge_proactive`, `parse_natural_language`, etc.)
- 5 payment functions (`stripe_webhook`, `create_payment_intent`, etc.)
- 2 NFC functions, 3 push notification functions, plus utilities (geocode, etc.)
- 8 shared modules in `_shared/` (auth, pricing, push, rateLimit, redis, sentry, sms, merchant_auth)

**Database**: 123 applied migrations covering:
- Core schema (rides, drivers, profiles, orders, wallet, payment ledger)
- RLS policies (user-isolation, driver/rider role-based, service-role admin)
- Full ride state machine with `validate_ride_status_transition()` trigger
- GPS spoof detection, rate limiting, concurrency/advisory locks
- Multiple debt/threshold systems (unified to -$300 TTD as of 2026-06-04)
- NFC dispatch layer, AI/merchant foundation, fleet management

### 1.4 Inter-package Dependency Graph

```
@gtaxi/config (zod)
    └── @gtaxi/bootstrap (init, logging, telemetry)
    └── @gtaxi/api (API client, auth interceptors, retry, timeout)

@gtaxi/core (supabase-js, expo-secure-store)
    └── @gtaxi/shared (ErrorBoundary, shadow wrappers, re-exports)
    └── @gtaxi/design-system (web DS tokens, WalletCard)
         └── @gtaxi/design-system-native (RN components, theme)

Application consumption:
  rider      → @gtaxi/core, @gtaxi/design-system, @gtaxi/design-system-native, @gtaxi/shared
  driver     → @gtaxi/core, @gtaxi/design-system, @gtaxi/design-system-native, @gtaxi/shared
  admin      → @gtaxi/core
  merchant   → @gtaxi/core, @gtaxi/design-system
  admin-mobile → @gtaxi/core, @gtaxi/shared
  merchant-mobile → @gtaxi/core, @gtaxi/shared
```

All dependencies are managed via **npm workspaces** (`"workspaces": ["apps/*", "packages/*"]`). Internal packages are referenced as `"@gtaxi/core": "1.0.0"` in each app's `package.json`. The root `tsconfig.json` provides path aliases:

```json
{
  "compilerOptions": {
    "paths": {
      "@gtaxi/shared/*": ["packages/shared/src/*"],
      "@gtaxi/shared": ["packages/shared/src/index.ts"],
      "@gtaxi/design-system/*": ["packages/design-system/src/*"],
      "@gtaxi/design-system": ["packages/design-system/src/index.ts"]
    }
  },
  "extends": "expo/tsconfig.base"
}
```

Note: `@gtaxi/api`, `@gtaxi/bootstrap`, and `@gtaxi/config` are NOT consumed by any application. They appear to be pre-built packages with `dist/` output, likely unused remnants of an earlier architecture.

---

## 2. Tooling and Build System

### 2.1 Monorepo Management

**Tool:** npm workspaces (native npm feature, no external tool)

The decision to use bare npm workspaces (no Nx, Turborepo, pnpm, or Yarn) reflects the monorepo's origins as a single-rider-app that grew organically. There is no task orchestration, no caching layer, and no dependency graph optimization.

**What's missing:**
- `nx.json`, `turbo.json`, `lerna.json` — none exist
- `pnpm-workspace.yaml`, `.yarnrc.yml` — none exist

### 2.2 Build / Task Runner

All commands use `npm --workspace <name> run <script>` syntax:

```bash
# Development
npm run dev:rider          # npm --workspace apps/rider run start
npm run dev:driver         # npm --workspace apps/driver run start
npm run dev:admin          # npm --workspace apps/admin run dev
npm run dev:merchant       # npm --workspace apps/merchant run dev

# Production builds
npm run build              # Builds admin + merchant (web apps only)
npm run build:admin        # npm --workspace apps/admin run build
npm run build:merchant     # npm --workspace apps/merchant run build

# Type checking
npm run typecheck          # Sequentially runs tsc --noEmit in all 4 major apps

# Linting
npm run lint               # eslint . --ext .ts,.tsx,.js,.jsx
npm run lint:strict        # lint + typecheck

# Verification
npm run verify:all         # node scripts/verify-all.js

# Expo native builds
npm run android            # expo run:android
npm run ios                # expo run:ios
```

**Web app builds** (admin, merchant): Each runs `tsc -b && vite build` — TypeScript project build first, then Vite production bundle.

**Mobile builds**: Use Expo Application Services (EAS) via `eas.json` with three profiles:
- `development` — dev client, internal distribution
- `preview` — APK (Android), simulator (iOS)
- `production` — app-bundle (Android), archive (iOS)

### 2.3 Dependency Management

- **Package manager:** npm (lockfile: `package-lock.json`, ~6.3MB)
- **Hoisting:** npm workspaces hoist shared dependencies to root `node_modules/`. Workspace-specific overrides exist in root `package.json` via `overrides`: `expo-task-manager` (12.0.6), `react` (18.3.1), `react-native` (0.76.9).
- **Version conflicts:** The `package-lock.json` is large (874K lines before recent cleanup) reflecting accumulated version drift. A `package-lock.backup.json` is kept as safety.
- **Security:** GitHub Dependabot reports 17 open vulns (11 high, 5 moderate, 1 low) — all are Expo/SDK-transitive (tar, xmldom, xml2js, ajv, etc.), deferred until SDK 52→56 upgrade.

### 2.4 Code Formatting and Linting

**Linter:** ESLint 9 with flat config (`eslint.config.js`)

The configuration enforces:
- `import/no-relative-parent-imports: error` — blocks `../../` imports between packages, forcing use of workspace package names
- `import/no-cycle: error` — prevents circular dependencies
- `no-restricted-imports` — blocks deep relative imports matching `../../*`, `../../../*`, `../../../../*`

**Formatter:** No Prettier configuration found anywhere in the repo. No `.prettierrc`, `prettier.config.js`, or `package.json` prettier entry exists.

---

## 3. CI/CD and Deployment

### 3.1 CI Pipeline

**Platform:** GitHub Actions

**Single workflow** (`.github/workflows/lint.yml`):
```yaml
name: Lint
on: [push, pull_request]
jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm install
      - run: npm run lint
```

**What's missing from CI:**
- No build step — TypeScript compilation not verified
- No test execution — zero test runs in CI
- No type checking — `tsc --noEmit` not run
- No Docker containerization
- No test, staging, or preview deployments
- No caching of `node_modules` or build artifacts

A comprehensive CI validation document exists at `docs/monorepo/CI-VALIDATION.md` (343 lines) defining desired stages (workspace integrity, static analysis, type checking, unit tests, E2E, deployment gating) — but none of these are implemented in the actual workflow.

### 3.2 Deployment Strategy

**Web apps (admin, merchant):**
- Built with `npm run build` (Vite)
- Static assets output to `dist/`
- No deployment automation exists in the repo
- No hosting configuration (Netlify, Vercel, Cloudflare Pages, etc.) is checked in

**Mobile apps (rider, driver, merchant-mobile, admin-mobile):**
- Built via EAS (Expo Application Services) using `eas build`
- Three build profiles: `development`, `preview` (APK), `production` (app-bundle)
- No CI-based deployment pipeline
- APK builds triggered manually

**Edge Functions:**
- Deployed via Supabase CLI (`npx supabase functions deploy <name>`)
- 73 functions deployed, most with `verify_jwt = true`
- Three webhook-facing functions with `verify_jwt = false`: `stripe_webhook`, `whatsapp_webhook`, `merchant_gateway`

**Environment configuration:**
- **Expo apps** (rider, driver): Use `EXPO_PUBLIC_*` prefix, defined in `.env` files
- **Vite apps** (admin, merchant): Use `VITE_*` prefix, defined in `.env` files
- **Edge functions**: Use `Deno.env.get()` for all secrets
- **Supabase vault**: Secrets stored in Supabase dashboard (not in repo), including `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `FIREBASE_SERVICE_ACCOUNT_JSON`, `SUPABASE_SERVICE_ROLE_KEY`, `UPSTASH_REDIS_*`, `MAPBOX_ACCESS_TOKEN`, `GEMINI_API_KEY`, `GROQ_API_KEY`
- **Missing vault secrets:** `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`, `SENTRY_DSN`

### 3.3 Version Control

- **Git:** Single `main` branch. No release branching strategy (no `develop`, `staging`, or release branches).
- **Commits:** Conventional commit prefixes (`feat:`, `fix:`, `security:`, `db:`).
- **Backup:** `package-lock.backup.json` kept at root.

---

## 4. Testing Strategy

### 4.1 Test Frameworks

| Context | Framework | Configuration |
|---------|-----------|---------------|
| Rider mobile app | Jest 29 + `@testing-library/react-native` | `apps/rider/jest.config.js` (preset: `react-native`) |
| Driver mobile app | Jest 29 + `@testing-library/react-native` | **No configuration** — test files exist but Jest is not declared as dependency |
| Admin web app | None | No test config, no test files |
| Merchant web app | None | No test config, no test files |
| Merchant-mobile | None | No test config |
| Admin-mobile | None | No test config |
| Edge functions | Deno built-in (`Deno.test`) | 6 test files in function subdirectories |
| Shared packages | None | `@gtaxi/core` has empty `__tests__/` directory |

### 4.2 Test Files by App

| App | Test Files | Can Run? |
|-----|-----------|----------|
| **rider** | 37 screen tests | ✅ Yes (Jest configured + dependencies declared) |
| **driver** | 12 tests (screens + components) | ❌ No (Jest + testing-library not in package.json) |
| **admin-mobile** | 3 tests | ❌ Probably not (no config) |
| **merchant-mobile** | 4 tests | ❌ Probably not (no config) |
| **admin** | 0 | N/A |
| **merchant** | 0 | N/A |
| **Edge functions** | 6 Deno tests | ✅ Yes (Deno.test) |

### 4.3 Test Coverage

- **Not configured.** No coverage reporting tools (Istanbul, c8, v8) are set up anywhere.
- No coverage thresholds defined.

### 4.4 Test Execution

There is **no unified test command** in the root `package.json`. No `npm test` script exists at any level. Tests can only be run individually:
- `cd apps/rider && npx jest` (for rider tests)
- `cd supabase/functions/<name> && deno test` (for edge function tests)

### 4.5 Testing Gaps

1. **No CI test execution** — the only CI step is `npm run lint`
2. **Driver app tests orphaned** — 12 test files exist but cannot execute
3. **Admin + merchant dashboards** — zero test coverage
4. **No E2E tests** — no Cypress, Playwright, Detox, or Maestro
5. **No integration tests** — no API contract or DB interaction tests
6. **Shared packages untested** — `@gtaxi/core`, `@gtaxi/shared`, design system have no tests

---

## 5. Shared Code and Components

### 5.1 Package Inventory

**@gtaxi/core** (`packages/core/`) — 16 source files:
- `client.ts` — Unified Supabase client factory with platform-aware storage (expo-secure-store for native, localStorage for web, in-memory fallback)
- `supabase.ts` — Low-level `createSupabaseClient()` factory
- `env.ts` — `ENV` const with platform-agnostic env var resolution (`EXPO_PUBLIC_` / `VITE_`), plus Trinidad default location
- `api.ts` — `AppError` class + `secureApiCall<T>()` wrapper mapping HTTP codes to typed errors
- `retryWrapper.ts` — `withRetry()` exponential backoff + `fetchWithRetry()`
- `realtime.ts` — `subscribeToSystemSettings()` for Postgres changes
- `featureFlags.ts` — `syncFeatureFlags()` with AsyncStorage caching
- `outbox.ts` — `OutboxService` singleton, offline-first event queue with retry
- `CrashReporter.ts` — hooks `ErrorUtils` + `unhandledrejection`, stores in AsyncStorage
- `nfcRouter.ts` — `routeNfcTag()` token resolution
- `native.ts` — Native-mode Supabase initialization
- `services/geofencing.ts` — Haversine distance, bearing, geofence zone checks
- `types/ride.ts`, `types/profile.ts`, `types/marketplace.ts` — Shared TypeScript interfaces

**@gtaxi/shared** (`packages/shared/`) — 5 source files:
- `ErrorBoundary.tsx` — React class component catching render errors with dark-themed error panel
- `RideEngine.shadow.ts` — Singleton shadow wrapper monitoring ride flows
- `FinancialLedger.shadow.ts` — Shadow layer for fare math (base 1600 TTD, per-km 175, per-min 95, min 2200)
- `AIGateway.shadow.ts` — Shadow wrapper for AI interactions
- `index.ts` — Barrel re-exports from `@gtaxi/core` plus above

**@gtaxi/design-system** (`packages/design-system/`) — Web design system
- Re-exports from `@gtaxi/design-system-native`
- `WalletCard.tsx` — Wallet balance display with top-up button

**@gtaxi/design-system-native** (`packages/design-system-native/`) — Native components + theme
- `theme.ts` — Design tokens: BRAND colors (purple, cyan, gold, crimson), SPACING (4-48px), RADIUS (12-999), GRADIENTS, VOICES (rider/driver/admin/merchant themes)
- `components.tsx` — 7 components: Logo (glass pin), GlassCard (BlurView), PrimaryButton (gradient pill), InfoChip, StatusBadge, LoadingOverlay, Skeleton

**@gtaxi/api** (`packages/api/`) — Full API client
- `ApiClient` class with `setAuthToken()`, `get()`, `post()`, `put()`, `delete()`
- Configurable timeout (30s), retries (3), exponential backoff, correlation IDs
- Not imported by any app — likely deprecated

**@gtaxi/config** (`packages/config/`) — Zod-based env validation
- Validates `SUPABASE_URL`, `SUPABASE_ANON_KEY` (required), `MAPBOX_ACCESS_TOKEN`, `STRIPE_PUBLISHABLE_KEY`, `SENTRY_DSN` (optional)
- `initializeEnv()` / `getEnv()` singleton pattern
- Not imported by any app — likely deprecated

**@gtaxi/bootstrap** (`packages/bootstrap/`) — App initialization
- `bootstrapApp()` — logger, error handling, telemetry (Sentry stub)
- Not imported by any app — likely deprecated

### 5.2 Design System Philosophy

From `packages/design-system/src/MASTER.md`:
- **Style:** "Vibrant Futurism" / "Friendly Cyberpunk"
- **Colors:** Electric Cyan `#00FFFF`, Vibe Purple `#7B61FF`, Evening Mist `#0A0A1F`
- **Typography:** Inter (headline), Space Grotesk (body)
- **Radius:** Super-soft 32px cards
- **Distinct voice per role:** Rider (cyan/purple), Driver (amber/orange), Admin (teal/steel), Merchant (gold/emerald)

### 5.3 Versioning Strategy

All internal packages are version `1.0.0` with no formal versioning strategy. There is no release process, changelog, or semantic versioning for shared packages. Packages are referenced by exact version (`"@gtaxi/core": "1.0.0"`) rather than workspace protocol (`"@gtaxi/core": "workspace:*"`).

---

## 6. Potential Challenges and Future Improvements

### 6.1 Known Issues / Pain Points

| Issue | Severity | Details |
|-------|----------|---------|
| **No build orchestration** | High | Without Nx/Turborepo, each workspace builds independently. No incremental builds, no affected-detection, no caching. Full `typecheck` runs sequentially across all 4 major apps. |
| **Testing infrastructure broken** | High | Driver app tests have missing dependencies. Admin/merchant web apps have zero tests. No CI test execution. |
| **Three deprecated packages** | Medium | `@gtaxi/api`, `@gtaxi/config`, `@gtaxi/bootstrap` are not consumed by any app but are maintained in the workspace, adding install overhead and confusion. |
| **No Prettier/format enforcement** | Medium | No code formatter configured. Code style consistency relies entirely on manual review. |
| **npm workspaces limitations** | Medium | No parallel execution, no task caching, no dependency graph awareness. `npm install` is slow on the large lockfile. |
| **CI is a no-op** | High | Single lint workflow. No builds, tests, or typechecks run on push. Broken code can merge without detection. |
| **Deployment is manual** | Medium | No automated deployments for web apps, mobile apps, or edge functions. |
| **Driver app tests orphaned** | Medium | 12 test files exist but `@testing-library/react-native` and `jest` are not in `apps/driver/package.json`. |
| **Secret management gap** | High | Twilio SMS and Sentry DSN secrets never provisioned in Supabase vault. SMS fallback and error reporting are dark. |
| **Migration drift** | Medium | Ghost migrations exist in the live database with no corresponding local `.sql` files. History was repaired but schema not captured locally. |
| **No containerization** | Low | No Docker environment. Reproducibility depends on Node.js version (20, set in CI). |

### 6.2 Performance Bottlenecks

- **npm install:** Takes 60-120s on the large lockfile. No caching in CI.
- **Full typecheck:** 4 sequential `tsc --noEmit` runs across rider, driver, admin, merchant. No parallelization.
- **package-lock.json:** ~6.3MB, 874K+ lines before recent cleanup. Contributes to slow installs and merge conflicts.
- **Edge function deployment:** 73 functions deployed individually. No bulk deployment script.

### 6.3 Future Roadmap

**Short-term (next 1-2 weeks):**
1. Add driver app test dependencies (`jest`, `@testing-library/react-native`) to `apps/driver/package.json`
2. Add `npm test` to CI workflow (at minimum: rider tests + typecheck) to catch regressions
3. Provision `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`, `SENTRY_DSN` in Supabase vault
4. Remove deprecated packages (`@gtaxi/api`, `@gtaxi/config`, `@gtaxi/bootstrap`) or document their purpose

**Medium-term (next 1-2 months):**
5. Introduce Turborepo or Nx for task orchestration, caching, and affected-detection to speed up builds and CI
6. Add Prettier configuration with pre-commit hooks
7. Implement GitHub Actions workflow with stages: install → lint → typecheck → test → build
8. Add E2E tests using Playwright (web apps) and Detox or Maestro (mobile apps)
9. Set up automated deployments for web apps (Vercel/Netlify) and edge functions (Supabase CLI)

**Long-term (next 3-6 months):**
10. Upgrade Expo SDK from 52 to 56 to resolve 27 transitive security vulnerabilities
11. Extract ghost migration schemas from live database into local `.sql` files (requires Docker for `supabase db pull`)
12. Implement semantic versioning and changelog for shared packages
13. Add containerization (Docker Compose) for reproducible local development
14. Establish release branching strategy (`develop` → `staging` → `main`)

---

## Appendix A: Workspace Script Reference

```bash
npm run dev:rider          # Start rider Expo dev server with dev-client
npm run dev:driver         # Start driver Expo dev server
npm run dev:admin          # Start Vite dev server for admin dashboard (port 5173)
npm run dev:merchant       # Start Vite dev server for merchant dashboard (port 5174)
npm run dev                # Alias for dev:rider
npm run build              # Build admin + merchant web apps for production
npm run build:admin        # tsc -b && vite build (admin)
npm run build:merchant     # tsc -b && vite build (merchant)
npm run lint               # ESLint across all .ts/.tsx/.js/.jsx
npm run lint:strict        # lint + typecheck
npm run typecheck          # Sequential tsc --noEmit for rider, driver, admin, merchant
npm run verify:all         # node scripts/verify-all.js (workspace integrity checks)
```

## Appendix B: Supabase Environment

| Property | Value |
|----------|-------|
| Project ID | `ffbbuafgeypvkpcuvdnv` |
| Region | Likely US East (default) |
| Postgres version | 15+ (supports `ALTER TYPE ADD VALUE IF NOT EXISTS`) |
| PostGIS | Enabled |
| Edge Functions | 73 deployed, Deno runtime |
| Database | Supabase Postgres with RLS, Realtime enabled |
| Connection pool | Transaction mode (port 6543) — enforced by AGENTS.md rules |
