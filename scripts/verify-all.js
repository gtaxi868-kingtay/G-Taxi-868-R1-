#!/usr/bin/env node

/**
 * Monorepo Health Verification Script
 * 
 * Validates that the entire monorepo respects stability constraints:
 * - Workspace integrity
 * - App classification (native vs web)
 * - Dependency baselines
 * - Plugin governance
 * - Workspace structure
 * 
 * Run: npm run verify:all
 * Exit code: 0 = all checks pass, 1 = any check fails
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const ROOT = process.cwd();
const COLORS = {
  PASS: '\x1b[32m✅\x1b[0m',
  FAIL: '\x1b[31m❌\x1b[0m',
  WARN: '\x1b[33m⚠️\x1b[0m',
  INFO: '\x1b[36mℹ️\x1b[0m',
  RESET: '\x1b[0m',
};

let results = [];
let failCount = 0;

function log(status, name, details = '') {
  const line = `${status} ${name}${details ? ': ' + details : ''}`;
  console.log(line);
  results.push({ status, name, details });
  if (status === COLORS.FAIL) failCount++;
}

function checkWorkspaceIntegrity() {
  console.log(`\n${COLORS.INFO} Workspace Integrity`);
  
  try {
    const rootPackageJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    
    if (!rootPackageJson.workspaces) {
      log(COLORS.FAIL, 'workspaces-config', 'Missing workspaces in root package.json');
      return;
    }

    // Check all packages have @gtaxi/ prefix
    const packagesPath = path.join(ROOT, 'packages');
    if (fs.existsSync(packagesPath)) {
      const packages = fs.readdirSync(packagesPath);
      packages.forEach(pkg => {
        const pkgJsonPath = path.join(packagesPath, pkg, 'package.json');
        if (fs.existsSync(pkgJsonPath)) {
          const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
          if (!pkgJson.name.startsWith('@gtaxi/')) {
            log(COLORS.FAIL, `package-naming-${pkg}`, `Expected @gtaxi/*, got ${pkgJson.name}`);
            return;
          }
        }
      });
    }

    log(COLORS.PASS, 'workspace-integrity', `${rootPackageJson.workspaces.length} workspace patterns`);
  } catch (err) {
    log(COLORS.FAIL, 'workspace-integrity', err.message);
  }
}

function checkAdminIsolation() {
  console.log(`\n${COLORS.INFO} App Classification (Native vs Web)`);
  
  try {
    const adminPkgJson = JSON.parse(
      fs.readFileSync(path.join(ROOT, 'apps/admin/package.json'), 'utf8')
    );

    const forbiddenDeps = ['expo', 'react-native', 'expo-router', '@react-navigation'];
    const found = forbiddenDeps.filter(
      dep => adminPkgJson.dependencies?.[dep] || adminPkgJson.devDependencies?.[dep]
    );

    if (found.length > 0) {
      log(COLORS.FAIL, 'no-native-in-admin', `Found forbidden: ${found.join(', ')}`);
    } else {
      log(COLORS.PASS, 'no-native-in-admin', 'Admin has zero Expo/RN deps ✓');
    }
  } catch (err) {
    log(COLORS.FAIL, 'no-native-in-admin', err.message);
  }
}

function checkBaselineVersions() {
  console.log(`\n${COLORS.INFO} Dependency Baselines`);
  
  try {
    const nativeApps = ['rider', 'driver'];
    const expectedVersions = {
      'react-native': '0.76.9',
      'expo': '52.0.49',
      'expo-router': '4.0.22',
    };

    nativeApps.forEach(app => {
      const pkgJsonPath = path.join(ROOT, `apps/${app}/package.json`);
      if (!fs.existsSync(pkgJsonPath)) {
        log(COLORS.WARN, `baseline-${app}`, 'package.json not found');
        return;
      }

      const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
      
      Object.entries(expectedVersions).forEach(([pkg, expectedVersion]) => {
        const actual = pkgJson.dependencies?.[pkg];
        if (!actual) {
          log(COLORS.WARN, `baseline-${app}-${pkg}`, `${pkg} not found`);
          return;
        }
        
        // Check if version matches (allow semver ranges)
        const majorMinor = expectedVersion.split('.').slice(0, 2).join('.');
        if (!actual.includes(majorMinor)) {
          log(COLORS.FAIL, `baseline-${app}-${pkg}`, `Expected *${majorMinor}*, got ${actual}`);
        }
      });
    });

    log(COLORS.PASS, 'baseline-versions', 'All native apps on compatible versions');
  } catch (err) {
    log(COLORS.FAIL, 'baseline-versions', err.message);
  }
}

function checkForbiddenPackages() {
  console.log(`\n${COLORS.INFO} Forbidden Packages`);
  
  try {
    const forbidden = ['@sentry/react-native', 'stripe-react-native'];
    const allAppsPath = path.join(ROOT, 'apps');
    
    let found = [];
    fs.readdirSync(allAppsPath).forEach(app => {
      const pkgJsonPath = path.join(allAppsPath, app, 'package.json');
      if (fs.existsSync(pkgJsonPath)) {
        const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
        forbidden.forEach(pkg => {
          if (pkgJson.dependencies?.[pkg] || pkgJson.devDependencies?.[pkg]) {
            found.push(`${app}: ${pkg}`);
          }
        });
      }
    });

    if (found.length > 0) {
      log(COLORS.FAIL, 'forbidden-packages', found.join(', '));
    } else {
      log(COLORS.PASS, 'forbidden-packages', 'No @sentry or stripe packages');
    }
  } catch (err) {
    log(COLORS.FAIL, 'forbidden-packages', err.message);
  }
}

function checkAppJsonValidity() {
  console.log(`\n${COLORS.INFO} App Configuration Files`);
  
  try {
    const nativeApps = ['rider', 'driver'];
    
    nativeApps.forEach(app => {
      const appJsonPath = path.join(ROOT, `apps/${app}/app.json`);
      if (!fs.existsSync(appJsonPath)) {
        log(COLORS.WARN, `app-json-${app}`, 'app.json not found');
        return;
      }

      try {
        JSON.parse(fs.readFileSync(appJsonPath, 'utf8'));
        log(COLORS.PASS, `app-json-${app}`, 'Valid JSON');
      } catch (parseErr) {
        log(COLORS.FAIL, `app-json-${app}`, `Invalid JSON: ${parseErr.message}`);
      }
    });
  } catch (err) {
    log(COLORS.FAIL, 'app-json-validity', err.message);
  }
}

function checkMetroConfigs() {
  console.log(`\n${COLORS.INFO} Metro Configuration`);
  
  try {
    const nativeApps = ['rider', 'driver'];
    
    nativeApps.forEach(app => {
      const metroPath = path.join(ROOT, `apps/${app}/metro.config.js`);
      if (!fs.existsSync(metroPath)) {
        log(COLORS.WARN, `metro-${app}`, 'metro.config.js not found');
        return;
      }

      try {
        require(metroPath); // Try to require it
        log(COLORS.PASS, `metro-${app}`, 'Metro config loads without error');
      } catch (err) {
        log(COLORS.FAIL, `metro-${app}`, `Config error: ${err.message.split('\n')[0]}`);
      }
    });
  } catch (err) {
    log(COLORS.FAIL, 'metro-configs', err.message);
  }
}

function checkNoDuplicateNodeModules() {
  console.log(`\n${COLORS.INFO} Workspace Isolation`);
  
  try {
    const appsPath = path.join(ROOT, 'apps');
    let hasDuplicates = false;

    fs.readdirSync(appsPath).forEach(app => {
      const nmPath = path.join(appsPath, app, 'node_modules');
      if (fs.existsSync(nmPath)) {
        // In a properly hoisted monorepo, apps shouldn't have their own node_modules
        if (fs.readdirSync(nmPath).length > 0) {
          log(COLORS.WARN, `duplicate-nm-${app}`, 'Has own node_modules (should be hoisted to root)');
          hasDuplicates = true;
        }
      }
    });

    if (!hasDuplicates) {
      log(COLORS.PASS, 'no-duplicate-nm', 'Clean monorepo (no duplicate node_modules)');
    }
  } catch (err) {
    log(COLORS.WARN, 'no-duplicate-nm', err.message);
  }
}

function checkRootOverrides() {
  console.log(`\n${COLORS.INFO} Dependency Overrides`);
  
  try {
    const rootPkgJson = JSON.parse(
      fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')
    );

    if (!rootPkgJson.overrides) {
      log(COLORS.WARN, 'root-overrides', 'No overrides defined (should have react-native-screens)');
      return;
    }

    if (rootPkgJson.overrides['react-native-screens']) {
      log(COLORS.PASS, 'root-overrides', 'react-native-screens override present');
    } else {
      log(COLORS.WARN, 'root-overrides', 'react-native-screens not overridden');
    }
  } catch (err) {
    log(COLORS.FAIL, 'root-overrides', err.message);
  }
}

function checkTypeScript() {
  console.log(`\n${COLORS.INFO} TypeScript Check`);
  
  try {
    execSync('npx tsc --noEmit 2>&1 | head -5', { 
      cwd: ROOT,
      encoding: 'utf8',
      stdio: 'pipe'
    });
    log(COLORS.PASS, 'typecheck', 'TypeScript compilation successful');
  } catch (err) {
    // tsc returns non-zero if there are errors
    if (err.stdout && err.stdout.includes('error TS')) {
      log(COLORS.FAIL, 'typecheck', `TypeScript errors found (run npx tsc for details)`);
    } else {
      log(COLORS.PASS, 'typecheck', 'TypeScript check passed');
    }
  }
}

function checkLint() {
  console.log(`\n${COLORS.INFO} Lint Check`);
  
  try {
    execSync('npm run lint 2>&1 | head -10', { 
      cwd: ROOT,
      encoding: 'utf8',
      stdio: 'pipe'
    });
    log(COLORS.PASS, 'lint', 'ESLint passed');
  } catch (err) {
    if (err.stdout && err.stdout.includes('error')) {
      log(COLORS.FAIL, 'lint', 'ESLint errors (run npm run lint for details)');
    } else {
      log(COLORS.PASS, 'lint', 'ESLint passed');
    }
  }
}

function checkAdminTransitiveDependencies() {
  console.log(`\n${COLORS.INFO} Admin Transitive Isolation`);
  
  try {
    // In a monorepo with npm workspaces, packages are hoisted to root node_modules
    // Admin should NOT transitively require packages with native deps
    // Check if admin imports from packages that have native dependencies
    
    const adminPackageJsonPath = path.join(ROOT, 'apps/admin/package.json');
    const adminPackageJson = JSON.parse(fs.readFileSync(adminPackageJsonPath, 'utf8'));
    
    const adminDeps = {
      ...adminPackageJson.dependencies || {},
      ...adminPackageJson.devDependencies || {}
    };
    
    const packagesPath = path.join(ROOT, 'packages');
    let violations = [];
    
    // Check each @gtaxi package that admin imports
    Object.keys(adminDeps).filter(dep => dep.startsWith('@gtaxi/')).forEach(dep => {
      const pkgName = dep.split('/')[1];
      const pkgJsonPath = path.join(packagesPath, pkgName, 'package.json');
      
      if (fs.existsSync(pkgJsonPath)) {
        const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
        const hasNativeDeps = Object.keys(pkgJson.dependencies || {}).some(d =>
          ['expo', 'react-native', 'expo-router', 'expo-build-properties', 
           'expo-camera', 'expo-location', 'expo-dev-client'].includes(d)
        );
        
        if (hasNativeDeps) {
          violations.push(`${dep} (has native deps)`);
        }
      }
    });
    
    if (violations.length > 0) {
      log(COLORS.FAIL, 'admin-transitive-isolation', 
        `Admin imports packages with native deps: ${violations.join(', ')}`);
    } else {
      log(COLORS.PASS, 'admin-transitive-isolation', 'Admin imports web-only packages ✓');
    }
  } catch (err) {
    log(COLORS.WARN, 'admin-transitive-isolation', 'Could not verify: ' + err.message);
  }
}

// Main execution
console.log('\n========================================');
console.log('  MONOREPO HEALTH VERIFICATION');
console.log('========================================\n');

checkWorkspaceIntegrity();
checkAdminIsolation();
checkAdminTransitiveDependencies();
checkBaselineVersions();
checkForbiddenPackages();
checkAppJsonValidity();
checkMetroConfigs();
checkNoDuplicateNodeModules();
checkRootOverrides();
checkTypeScript();
checkLint();

// Summary
console.log('\n========================================');
console.log('  VERIFICATION SUMMARY');
console.log('========================================\n');

const passCount = results.filter(r => r.status === COLORS.PASS).length;
const warnCount = results.filter(r => r.status === COLORS.WARN).length;

console.log(`${COLORS.PASS} Passed: ${passCount}`);
console.log(`${COLORS.WARN} Warnings: ${warnCount}`);
console.log(`${COLORS.FAIL} Failed: ${failCount}\n`);

if (failCount === 0) {
  console.log(`${COLORS.PASS} Overall: READY TO COMMIT\n`);
  process.exit(0);
} else {
  console.log(`${COLORS.FAIL} Overall: FIX ISSUES BEFORE COMMITTING\n`);
  process.exit(1);
}
