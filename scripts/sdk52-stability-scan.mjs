import fs from "fs";
import path from "path";
import { execSync } from "child_process";

function sh(cmd) {
  return execSync(cmd, { encoding: "utf-8", stdio: "pipe" });
}

function findAllPackageJson(dir, out = []) {
  for (const item of fs.readdirSync(dir)) {
    if (item === "node_modules" || item === ".git") continue;

    const full = path.join(dir, item);
    const stat = fs.statSync(full);

    if (stat.isDirectory()) {
      findAllPackageJson(full, out);
    } else if (item === "package.json") {
      out.push(full);
    }
  }
  return out;
}

function load(file) {
  return JSON.parse(fs.readFileSync(file, "utf-8"));
}

function getAllDeps(files) {
  const map = new Map();

  for (const f of files) {
    const pkg = load(f);
    const deps = {
      ...pkg.dependencies,
      ...pkg.devDependencies
    };

    for (const [k, v] of Object.entries(deps || {})) {
      if (!map.has(k)) map.set(k, new Set());
      map.get(k).add(v);
    }
  }

  return map;
}

function detectExpoMismatch(files) {
  const issues = [];

  const SDK52_RULES = {
    expo: "52.0.0",
    "react-native": "0.76.9"
  };

  for (const f of files) {
    const pkg = load(f);
    const name = pkg.name || f;

    const expo = pkg.dependencies?.expo;
    const rn = pkg.dependencies?.["react-native"];

    if (expo && expo !== "52.0.49") {
      issues.push({ file: name, type: "EXPO_MISMATCH", value: expo });
    }

    if (rn && rn !== "0.76.9") {
      issues.push({ file: name, type: "RN_MISMATCH", value: rn });
    }
  }

  return issues;
}

function detectDrift(map) {
  const drift = [];

  for (const [pkg, versions] of map.entries()) {
    if (versions.size > 1) {
      drift.push({
        package: pkg,
        versions: [...versions]
      });
    }
  }

  return drift;
}

function main() {
  console.log("🔍 SCANNING MONOREPO FOR SDK 52 STABILITY...\n");

  const files = findAllPackageJson(process.cwd());

  const deps = getAllDeps(files);
  const drift = detectDrift(deps);
  const expoIssues = detectExpoMismatch(files);

  console.log("==============================");
  console.log("SDK 52 STABILITY REPORT");
  console.log("==============================\n");

  if (expoIssues.length === 0) {
    console.log("✅ Expo / React Native versions OK\n");
  } else {
    console.log("❌ SDK MISMATCH DETECTED:\n");
    expoIssues.forEach(i => {
      console.log(`- ${i.file}: ${i.type} → ${i.value}`);
    });
  }

  console.log("\n------------------------------\n");

  if (drift.length === 0) {
    console.log("✅ No dependency drift detected");
  } else {
    console.log("❌ VERSION DRIFT DETECTED:\n");
    drift.forEach(d => {
      console.log(`- ${d.package}:`);
      d.versions.forEach(v => console.log(`   • ${v}`));
    });
  }

  console.log("\n==============================");
  console.log("SUMMARY");
  console.log("==============================");

  const critical = expoIssues.length + drift.length;

  if (critical === 0) {
    console.log("🟢 SYSTEM STABLE FOR SDK 52");
  } else {
    console.log("🟠 SYSTEM NOT SAFE FOR BUILD");
  }

  process.exit(critical > 0 ? 1 : 0);
}

main();
