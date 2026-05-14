import { execSync } from "child_process";

try {
  const out = execSync(
    "npx madge apps packages --extensions ts,tsx --circular",
    { encoding: "utf8" }
  );

  if (out.trim()) {
    console.error("❌ CIRCULAR DEPENDENCIES FOUND:\n");
    console.error(out);
    process.exit(1);
  }

  console.log("✅ Architecture clean");
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
