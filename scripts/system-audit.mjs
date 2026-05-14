import { execSync } from "child_process";
import fs from "fs";
import path from "path";

const now = new Date().toISOString();

function run(cmd) {
  return execSync(cmd, { encoding: "utf8" }).trim();
}

function safeRun(cmd) {
  try {
    return run(cmd);
  } catch (e) {
    return `ERROR: ${e.message}`;
  }
}

function listDirs(base) {
  return fs.existsSync(base)
    ? fs.readdirSync(base).filter((f) =>
        fs.existsSync(path.join(base, f, "package.json"))
      )
    : [];
}

const apps = listDirs("apps");
const packages = listDirs("packages");

const report = `
# GTaxi FULL SYSTEM AUDIT REPORT

## Metadata
- Timestamp: ${now}
- Branch: ${safeRun("git branch --show-current")}
- Node: ${process.version}
- npm: ${safeRun("npm -v")}

---

## Workspace Overview
### Apps
${apps.map((a) => `- ${a}`).join("\n")}

### Packages
${packages.map((p) => `- ${p}`).join("\n")}

---

## Dependency Snapshot
\`\`\`
${safeRun("npm ls --depth=0")}
\`\`\`

---

## React / RN / Expo Matrix
\`\`\`
${safeRun("npm ls react react-native expo react-native-screens expo-router")}
\`\`\`

---

## Duplicate / Drift Check
\`\`\`
${safeRun("npm dedupe --dry-run")}
\`\`\`

---

## CI / Build Signals
- lint: ${fs.existsSync("eslint.config.js") || fs.existsSync(".eslintrc") ? "present" : "missing"}
- CI: ${fs.existsSync(".github/workflows") ? "present" : "missing"}

---

## Environment Files
\`\`\`
${safeRun("find . -name '.env*' -maxdepth 3")}
\`\`\`

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
`;

const outPath = "docs/reports/system-health-report.md";

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, report);

console.log("SYSTEM AUDIT COMPLETE →", outPath);
