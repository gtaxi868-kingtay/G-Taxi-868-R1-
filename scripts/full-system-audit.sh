#!/usr/bin/env bash

set -e

REPORT="docs/reports/system-health-report.md"

mkdir -p docs/reports

echo "# GTaxi Monorepo System Health Report" > "$REPORT"
echo "" >> "$REPORT"
echo "- Timestamp: $(date)" >> "$REPORT"
echo "- Git Branch: $(git branch --show-current)" >> "$REPORT"
echo "- Node: $(node -v)" >> "$REPORT"
echo "- NPM: $(npm -v)" >> "$REPORT"
echo "" >> "$REPORT"

section () {
  echo "" >> "$REPORT"
  echo "## $1" >> "$REPORT"
  echo "" >> "$REPORT"
}

cmd () {
  echo '```bash' >> "$REPORT"
  echo "$1" >> "$REPORT"
  echo '```' >> "$REPORT"

  echo '```' >> "$REPORT"
  eval "$1" >> "$REPORT" 2>&1 || true
  echo '```' >> "$REPORT"
}

section "Workspace Structure"
cmd "find apps packages -maxdepth 2 -name package.json"

section "Root Package"
cmd "cat package.json"

section "Workspace Integrity"
cmd "npm ls --depth=0"

section "Dependency Graph"
cmd "npm ls react react-native expo react-native-screens expo-router"

section "Duplicate Dependencies"
cmd "npm dedupe --dry-run"

section "Expo Doctor"
cmd "npx expo-doctor"

section "TypeScript"
cmd "npx tsc --noEmit"

section "Lint"
cmd "npm run lint"

section "Metro Configs"
cmd "find . -name metro.config.js -o -name metro.config.cjs"

section "Vite Configs"
cmd "find . -name vite.config.*"

section "Expo App Configs"
cmd "find apps -name app.json -o -name app.config.*"

section "Environment Files"
cmd "find . -name '.env*'"

section "Security Scan"
cmd "grep -R \"SECRET\\|TOKEN\\|PASSWORD\\|API_KEY\\|sk_live\\|AIza\" . --exclude-dir=node_modules"

section "Native Plugin Usage"
cmd "grep -R \"expo-location\\|expo-camera\\|expo-notifications\\|stripe\" apps packages"

section "Boundary Violations"
cmd "grep -R \"from 'expo\\|from \\\"expo\\|from 'react-native\\|from \\\"react-native\" apps/admin packages || true"

section "Shared Package Imports"
cmd "grep -R \"@gtaxi/\" apps"

section "Navigation"
cmd "find apps -type f \\( -name '*router*' -o -name '*navigation*' -o -name '_layout.tsx' \\)"

section "Build Scripts"
cmd "cat package.json && find apps -name package.json -exec cat {} \\;"

section "CI Config"
cmd "find . -path '*/.github/*' -o -name '*.yml' -o -name '*.yaml'"

section "Lockfiles"
cmd "find . -name package-lock.json -o -name yarn.lock -o -name pnpm-lock.yaml"

section "Node Modules"
cmd "find . -name node_modules -type d -prune"

section "Runtime Boot Checks"
cmd "npm run rider -- --help"
cmd "npm run driver -- --help"
cmd "npm run admin -- --help"
cmd "npm run merchant -- --help"

section "Git Status"
cmd "git status"

section "Production Risk Summary"
echo "- Review all CRITICAL/HIGH findings manually." >> "$REPORT"
echo "- Validate native/web dependency boundaries." >> "$REPORT"
echo "- Confirm all apps boot independently." >> "$REPORT"
echo "- Confirm shared packages resolve correctly." >> "$REPORT"

echo ""
echo "Audit complete:"
echo "$REPORT"

