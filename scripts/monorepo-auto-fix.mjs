import fs from "fs";
import path from "path";
import { execSync } from "child_process";

const WORKSPACES = ["apps", "packages"];

// ---------- utils ----------
function sh(cmd) {
  return execSync(cmd, { encoding: "utf-8", stdio: "pipe" });
}

function loadJSON(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch {
    return null;
  }
}

function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// ---------- backup ----------
function backup(file) {
  const backupPath = `${file}.backup`;
  fs.copyFileSync(file, backupPath);
}

// ---------- scan all packages ----------
function getAllPackages() {
  const results = [];

  for (const root of WORKSPACES) {
    if (!fs.existsSync(root)) continue;

    for (const folder of fs.readdirSync(root)) {
      const pkgPath = path.join(root, folder, "package.json");
      const pkg = loadJSON(pkgPath);

      if (pkg) {
        results.push({ path: pkgPath, json: pkg });
      }
    }
  }

  return results;
}

// ---------- collect versions ----------
function collectVersions(packages) {
  const map = new Map();

  for (const pkg of packages) {
    const all = {
      ...pkg.json.dependencies,
      ...pkg.json.devDependencies,
    };

    for (const [dep, version] of Object.entries(all)) {
      if (!map.has(dep)) map.set(dep, []);
      map.get(dep).push(version);
    }
  }

  return map;
}

// ---------- pick canonical version ----------
function pickVersion(versions) {
  // simple safe rule: highest string (works for semver in most cases)
  return [...new Set(versions)].sort().at(-1);
}

// ---------- build canonical map ----------
function buildCanonical(versionMap) {
  const canonical = new Map();

  for (const [dep, versions] of versionMap.entries()) {
    const chosen = pickVersion(versions);
    canonical.set(dep, chosen);
  }

  return canonical;
}

// ---------- apply fixes ----------
function applyFixes(packages, canonical) {
  const changes = [];

  for (const pkg of packages) {
    const original = JSON.stringify(pkg.json);

    const fixDeps = (obj) => {
      if (!obj) return;

      for (const key of Object.keys(obj)) {
        if (canonical.has(key)) {
          obj[key] = canonical.get(key);
        }
      }
    };

    fixDeps(pkg.json.dependencies);
    fixDeps(pkg.json.devDependencies);

    const updated = JSON.stringify(pkg.json);

    if (original !== updated) {
      backup(pkg.path);
      writeJSON(pkg.path, pkg.json);

      changes.push(pkg.path);
    }
  }

  return changes;
}

// ---------- report ----------
function report(versionMap, changes) {
  console.log("\n==============================");
  console.log("MONOREPO AUTO FIX REPORT");
  console.log("==============================\n");

  console.log("📦 Packages updated:");
  changes.forEach(c => console.log(" -", c));

  console.log("\n🔧 Drift summary:");
  for (const [dep, versions] of versionMap.entries()) {
    const unique = [...new Set(versions)];
    if (unique.length > 1) {
      console.log(` - ${dep}: ${unique.join(", ")}`);
    }
  }

  console.log("\n==============================");
  console.log("DONE");
  console.log("==============================\n");
}

// ---------- main ----------
function main() {
  console.log("🔍 Scanning monorepo...");

  const packages = getAllPackages();
  const versionMap = collectVersions(packages);
  const canonical = buildCanonical(versionMap);

  console.log("🧠 Applying canonical versions...");
  const changes = applyFixes(packages, canonical);

  report(versionMap, changes);

  if (changes.length === 0) {
    console.log("✅ No changes needed");
    process.exit(0);
  }

  console.log("📦 Reinstall recommended: npm install");
}

main();
