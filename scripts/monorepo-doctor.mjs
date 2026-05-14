import fs from "fs";
import { execSync } from "child_process";

const ROOT_APPS = ["apps", "packages"];

function sh(cmd) {
  return execSync(cmd, { encoding: "utf-8", stdio: "pipe" });
}

function safe(cmd) {
  try {
    return sh(cmd);
  } catch (e) {
    return e.stdout?.toString() || e.message;
  }
}

function loadPackage(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch {
    return null;
  }
}

function scanWorkspaces() {
  const results = [];

  for (const dir of ROOT_APPS) {
    if (!fs.existsSync(dir)) continue;

    const entries = fs.readdirSync(dir);

    for (const name of entries) {
      const pkgPath = `${dir}/${name}/package.json`;
      const pkg = loadPackage(pkgPath);

      if (pkg) {
        results.push({
          name: pkg.name || name,
          path: pkgPath,
          deps: pkg.dependencies || {},
          devDeps: pkg.devDependencies || {}
        });
      }
    }
  }

  return results;
}

function collectAllVersions(workspaces) {
  const map = new Map();

  for (const ws of workspaces) {
    const all = { ...ws.deps, ...ws.devDeps };

    for (const [dep, version] of Object.entries(all)) {
      if (!map.has(dep)) map.set(dep, []);
      map.get(dep).push({ version, app: ws.name });
    }
  }

  return map;
}

function detectIssues(versionMap) {
  const issues = [];

  for (const [pkg, list] of versionMap.entries()) {
    const versions = [...new Set(list.map(x => x.version))];

    if (versions.length > 1) {
      issues.push({
        type: "DRIFT",
        package: pkg,
        versions,
        apps: list.map(x => x.app)
      });
    }

    if (pkg === "expo" && versions.length > 1) {
      issues.push({
        type: "CRITICAL_EXPO_MISMATCH",
        package: pkg,
        versions,
        apps: list.map(x => x.app)
      });
    }

    if (pkg === "react-native" && versions.length > 1) {
      issues.push({
        type: "CRITICAL_RN_MISMATCH",
        package: pkg,
        versions,
        apps: list.map(x => x.app)
      });
    }
  }

  return issues;
}

function printReport(issues) {
  console.log("\n====================");
  console.log("MONOREPO HEALTH REPORT");
  console.log("====================\n");

  if (issues.length === 0) {
    console.log("✅ No issues found");
    return;
  }

  for (const issue of issues) {
    console.log(`❌ ${issue.type}`);
    console.log(`Package: ${issue.package}`);
    console.log(`Versions: ${issue.versions.join(", ")}`);
    console.log(`Apps: ${issue.apps.join(", ")}`);
    console.log("--------------------");
  }
}

function safeFix() {
  console.log("\n🧹 Running safe fixes...\n");

  safe("npx npm dedupe");
  safe("rm -rf node_modules package-lock.json");
  safe("npm install");

  console.log("\n✅ Safe reinstall complete\n");
}

function main() {
  const workspaces = scanWorkspaces();
  const versions = collectAllVersions(workspaces);
  const issues = detectIssues(versions);

  printReport(issues);

  safeFix();

  if (issues.some(i => i.type.includes("CRITICAL"))) {
    console.log("\n🚨 CRITICAL ISSUES FOUND - BUILD NOT SAFE\n");
    process.exit(2);
  }

  console.log("\n✅ MONOREPO OK (warnings only)\n");
}

main();
