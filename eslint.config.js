import importPlugin from "eslint-plugin-import";
import reactHooksPlugin from "eslint-plugin-react-hooks";
import tsParser from "@typescript-eslint/parser";

export default [
  {
    ignores: [
      ".claude/**",
      "_agents/**",
      "superpowers/**",
      "tools/**",
      "ui-ux-pro-max-skill/**",
      "**/node_modules/**",
      "**/.expo/**",
      "**/dist/**",
      "**/build/**",
      "**/.turbo/**",
      "**/.vercel/**",
      "**/out/**",
    ],
  },
  // TypeScript / TSX files — must use TS parser
  {
    files: ["**/*.{ts,tsx}"],

    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: "module",
        ecmaFeatures: { jsx: true },
      },
    },

    plugins: {
      import: importPlugin,
      "react-hooks": reactHooksPlugin,
    },

    settings: {
      "import/resolver": {
        typescript: {
          alwaysTryTypes: true,
          project: ["apps/*/tsconfig.json", "packages/*/tsconfig.json"],
        },
        node: {
          extensions: [".ts", ".tsx", ".js", ".jsx"],
        },
      },
    },

    rules: {
      // Registered as "warn", not the plugin's own recommended severity, so
      // this doesn't retroactively fail every existing incomplete deps array
      // across the codebase in one shot. Was previously not registered as a
      // plugin at all, which made ESLint's flat config reject the existing
      // `// eslint-disable-next-line react-hooks/exhaustive-deps` comments
      // (e.g. DriverMap.tsx) as referencing an unknown rule — hard-failing
      // `npm run lint` (and CI's "quality" check) on files that had done
      // nothing wrong.
      "react-hooks/exhaustive-deps": "warn",
      // Block deep cross-tree imports (app code reaching into other packages by path).
      // Single ../ is fine — that's how test files reference the module they test,
      // and how package index files re-export siblings.
      "import/no-cycle": ["error", { maxDepth: 5, ignoreExternal: true }],
      "no-restricted-imports": [
        "error",
        {
          patterns: ["../../../*", "../../../../*"],
        },
      ],
    },
  },
  // Supabase edge functions (Deno) — parent-relative imports to ../_shared/ are required
  {
    files: ["supabase/functions/**/*.ts"],
    rules: {
      "import/no-relative-parent-imports": "off",
      "import/no-cycle": "off",
      "no-restricted-imports": "off",
    },
  },
  // Plain JS / JSX files
  {
    files: ["**/*.{js,jsx}"],

    languageOptions: {
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: "module",
        ecmaFeatures: { jsx: true },
      },
    },

    plugins: {
      import: importPlugin,
    },

    settings: {
      "import/resolver": {
        node: {
          extensions: [".js", ".jsx"],
        },
      },
    },

    rules: {
      "import/no-relative-parent-imports": "error",
    },
  },
];
