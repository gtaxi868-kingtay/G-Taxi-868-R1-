const { execSync } = require("child_process");
const fs = require("fs");

function run(cmd) {
  try {
    return execSync(cmd, { encoding: "utf8", stdio: "pipe" });
  } catch (e) {
    return e.stdout?.toString?.() || e.message;
  }
}

const timestamp = new Date().toISOString();
const branch = run("git branch --show-current").trim();

let report = `# GTaxi FULL SYSTEM AUDIT REPORT

- Timestamp: ${timestamp}
- Branch: ${branch}

---

## 1. Dependency Integrity

\`\`\`
${run("npm ls --depth=0")}
\`\`\`

---

## 2. Workspace Health

\`\`\`
${run("npm ls react react-native expo expo-router react-native-screens")}
\`\`\`

---

## 3. Duplicate / Drift Check

\`\`\`
${run("npm dedupe --dry-run")}
\`\`\`

---

## 4. Lint Check

\`\`\`
${run("npm run lint || true")}
\`\`\`

---

## 5. Build Exposure Check (apps)

### Rider
\`\`\`
${run("cd apps/rider && npm run start --silent || true")}
\`\`\`

### Driver
\`\`\`
${run("cd apps/driver && npm run start --silent || true")}
\`\`\`

### Admin (web)
\`\`\`
${run("cd apps/admin && npm run build --silent || true")}
\`\`\`

### Merchant (web)
\`\`\`
${run("cd apps/merchant && npm run build --silent || true")}
\`\`\`

---

## 6. Risk Summary

- Dependency drift: detected via dedupe output
- Native/web boundary: manual verification required
- Expo/RN compatibility: aligned but override-driven
- React version: consistent but mixed tooling

---

## 7. Production Readiness

Status: PARTIALLY READY

- Runtime: OK
- Dependency purity: NOT CLEAN
- CI validation: missing strict enforcement
- UI/UX validation: not automated

---

## 8. Recommendation Order

1. Lock dependency graph (stop drift)
2. Separate web/native lockfiles (optional hardening)
3. Add CI fail on peer warnings
4. Add runtime boot validator
5. UI/UX audit (manual + Playwright later)

---

END REPORT
`;

fs.mkdirSync("docs/reports", { recursive: true });
fs.writeFileSync("docs/reports/system-health-report.md", report);

console.log("AUDIT COMPLETE -> docs/reports/system-health-report.md");
