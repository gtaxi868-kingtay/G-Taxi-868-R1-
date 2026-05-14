import fs from "fs";
import path from "path";
import { execSync } from "child_process";

const ROOT = process.cwd();

/**
 * Find all package.json files in monorepo
 */
function findPackageFiles(dir, results = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const full = path.join(dir, entry.name);

    if (entry.name === "node_modules") continue;

    if (entry.isDirectory()) {
      findPackageFiles(full, results);
    } else if (entry.name === "package.json") {
      results.push(full);
    }
  }

  return results;
}

/**
 * pick highest version (simple safe heuristic)
 */
function pick(versionList) {
  return [...versionList]
    .map(v => v.replace(/[^0-9.]/g, ""))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .at(-1);
}

/**
 * normalize deps inside one package.json
 */
function normalize(pkg, canon) {
  const update = (deps = {}) => {
    for (const k of Object.keys(deps)) {
      if (canon[k]) {
        deps[k] = canon[k];
      }
    }
  };

  update(pkg.dependencies);
  update(pkg.devDependencies);

  return pkg;
}

/**
 * collect all versions across repo
 */
function collect(files) {
  const map = {};

  for (const file of files) {
    const pkg = JSON.parse(fs.readFileSync(file, "utf-8"));

    const all = {
      ...pkg.dependencies,
      ...pkg.devDependencies,
    };

    for (const [name, version] of Object.entries(all)) {
      if (!map[name]) map[name] = new Set();
      map[name].add(version);
    }
  }

  const canon = {};
  for (const k of Object.keys(map)) {
    canon[k] = pick([...map[k]]);
  }

  return canon;
}

/**
 * apply fixes safely
 */
function apply(files, canon) {
  for (const file of files) {
    const pkg = JSON.parse(fs.readFileSync(file, "utf-8"));
    const updated = normalize(pkg, canon);

    fs.writeFileSync(file, JSON.stringify(updated, null, 2));
    console.log("fixed:", file);
  }
}

/**
 * main
 */
function main() {
  console.log("🔍 scanning monorepo...");

  const files = findPackageFiles(ROOT);
  const canon = collect(files);

  console.log("🔧 aligning versions...");

  apply(files, canon);

  console.log("\n🧹 reinstalling clean...");
  execSync("rm -rf node_modules package-lock.json", { stdio: "inherit" });
  execSync("npm install", { stdio: "inherit" });

  console.log("\n✅ DONE: monorepo aligned");
}

main();
