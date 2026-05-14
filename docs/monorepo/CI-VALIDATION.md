# Monorepo CI Validation Rules

**Purpose:** Prevent dependency drift, incompatible changes, and silent failures before code merges.

**For:** GitHub Actions, GitLab CI, or equivalent CI system

---

## Pre-Commit Hooks (Local)

Before any commit:

```bash
npm run verify:all
```

This must pass locally before pushing.

---

## PR Validation (CI Pipeline)

### Stage 1: Workspace Integrity (must pass)

```bash
npm ci --legacy-peer-deps
npm run verify:all
```

**Fails if:**
- Workspace structure is invalid
- Admin has Expo/RN deps
- Native apps don't match baseline
- Forbidden packages present
- app.json invalid
- Metro config broken

### Stage 2: Type Safety (must pass)

```bash
npx tsc --noEmit
npm run lint
```

**Fails if:**
- TypeScript compilation errors
- ESLint violations

### Stage 3: Compatibility Check (must pass)

```bash
npm ls react-native-screens
npm ls react-native
npm ls expo
```

Expected output shows all apps on compatible versions.

### Stage 4: Dependency Freeze Enforcement (must pass)

```bash
# Fails if Expo SDK drifts
npm ls expo | grep -v "52.0"

# Fails if RN drifts
npm ls react-native | grep -v "0.76"

# Fails if screens drifts
npm ls react-native-screens | grep -v "4.4"
```

### Stage 5: Expo Health (warning only)

```bash
npx expo-doctor
```

**Warns if:** @expo/config-plugins mismatch (known issue, safe)

---

## Forbidden Changes (Auto-reject)

The CI pipeline MUST automatically reject PRs that:

### 1. Upgrade Expo SDK
```bash
if grep '"expo": "~5[3-9]' package.json; then
  echo "ERROR: Expo SDK upgrade blocked (Phase 2 only)"
  exit 1
fi
```

### 2. Upgrade React Native
```bash
if grep '"react-native": "^0\.[789]' apps/*/package.json; then
  echo "ERROR: React Native upgrade blocked (Phase 2 only)"
  exit 1
fi
```

### 3. Introduce Forbidden Packages
```bash
grep -r "@sentry/react-native\|stripe-react-native" apps/ && {
  echo "ERROR: Forbidden packages detected"
  exit 1
}
```

### 4. Add Expo/RN to Admin
```bash
if grep -E "expo|react-native" apps/admin/package.json; then
  echo "ERROR: Admin app must be web-only"
  exit 1
fi
```

### 5. Use Unsafe npm Commands in CI
```bash
# These commands MUST NOT be in CI scripts:
# - npm update
# - npm audit fix --force
# - npx expo-doctor --fix
```

---

## Approval Gates

### Auto-approve (no manual review needed):
- ✅ Point releases (0.76.9 → 0.76.10)
- ✅ Dev dependency updates (eslint, typescript)
- ✅ App-specific code changes
- ✅ New packages in `packages/`

### Requires Manual Review:
- 🟡 Any change to `package.json` in root
- 🟡 Any change to `app.json`
- 🟡 Any change to Metro configs
- 🟡 New native modules/plugins
- 🟡 Changes to `.env` or secrets

### Requires Tech Lead Sign-off:
- 🔴 Dependency baseline changes
- 🔴 Plugin additions/removals
- 🔴 Workspace structure changes
- 🔴 CI rule changes

---

## Sample GitHub Actions Workflow

```yaml
name: Monorepo Validation

on:
  pull_request:
    branches: [main, staging]

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - uses: actions/setup-node@v3
        with:
          node-version: '18'
          cache: 'npm'

      # Stage 1: Install & Verify
      - name: Install dependencies
        run: npm ci --legacy-peer-deps

      - name: Workspace integrity
        run: npm run verify:all

      # Stage 2: Type & Lint
      - name: TypeScript
        run: npx tsc --noEmit

      - name: ESLint
        run: npm run lint

      # Stage 3: Compatibility
      - name: Expo SDK baseline
        run: |
          npm ls expo | grep "~52.0" || {
            echo "ERROR: Expo SDK version mismatch"
            exit 1
          }

      - name: React Native baseline
        run: |
          npm ls react-native | grep "^0.76" || {
            echo "ERROR: React Native version mismatch"
            exit 1
          }

      - name: Native screens baseline
        run: |
          npm ls react-native-screens | grep "~4.4" || {
            echo "ERROR: react-native-screens version mismatch"
            exit 1
          }

      # Stage 4: Freeze Enforcement
      - name: Check for forbidden upgrades
        run: |
          if grep -r "@sentry/react-native\|stripe-react-native" apps/; then
            echo "ERROR: Forbidden packages detected"
            exit 1
          fi

          if grep -E "expo.*5[3-9]|react-native.*0\.[789]" apps/*/package.json; then
            echo "ERROR: Major dependency upgrade blocked (Phase 2 only)"
            exit 1
          fi

          if grep -E "expo|react-native" apps/admin/package.json; then
            echo "ERROR: Admin app must remain web-only"
            exit 1
          fi

      # Stage 5: Expo Doctor (warning)
      - name: Expo Doctor
        run: npx expo-doctor || true

  commit-lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
        with:
          fetch-depth: 0

      # Optional: Use commitlint to enforce conventional commits
      - name: Commit message validation
        uses: wagoid/commitlint-github-action@v5
```

---

## Local Pre-commit Hook (Optional)

Create `.git/hooks/pre-commit`:

```bash
#!/bin/bash
npm run verify:all
if [ $? -ne 0 ]; then
  echo "❌ Verification failed. Fix issues before committing."
  exit 1
fi
```

Make executable:
```bash
chmod +x .git/hooks/pre-commit
```

---

## Merge Requirements

Before merging to `main`:

- ✅ All CI checks pass
- ✅ At least one code review approval
- ✅ No outstanding verification warnings
- ✅ Squash commits (keep history clean)
- ✅ Delete branch after merge

Before merging to `staging`:

- ✅ All CI checks pass
- ✅ At least one review

Before merging to `production`:

- ✅ Staged release
- ✅ Manual testing on real devices
- ✅ Dependency freeze verified
- ✅ Rollback plan documented

---

## Enforcement Commands

Tech lead can enforce stricter rules:

```bash
# Lock main branch (no direct pushes)
git branch -m main --protection

# Require 2 approvals for native changes
# (configure in GitHub/GitLab settings)

# Block direct commits to main
# (configure in repository settings)
```

---

## Monitoring & Alerts

### Weekly Checks
```bash
npm outdated
npm audit --omit=dev
npx expo-doctor
```

### On Any Upgrade Alert
1. Do NOT auto-upgrade
2. Create Phase 2 issue
3. Plan compatibility audit
4. Tag for review

---

## Rollback Procedures

If a change breaks production:

```bash
# Immediate rollback
git revert <commit-hash>
git push

# Postmortem
1. Create root cause issue
2. Update STABILITY.md
3. Add CI checks to prevent recurrence
4. Unblock team
```

---

## References

- [Monorepo STABILITY.md](./STABILITY.md)
- [Dependency Baseline](../architecture/dependency-baseline.md)
- [CLAUDE.md - Production Status](../../CLAUDE.md)
