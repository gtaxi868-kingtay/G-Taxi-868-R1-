import importPlugin from "eslint-plugin-import";

export default [
  {
    files: ["**/*.{ts,tsx,js,jsx}"],

    plugins: {
      import: importPlugin,
    },

    settings: {
      "import/resolver": {
        alias: {
          map: [
            ["@gtaxi/shared", "./packages/shared/src"],
            ["@gtaxi/design-system", "./packages/design-system/src"],
          ],
          extensions: [".ts", ".tsx", ".js", ".jsx"],
        },
      },
    },

    rules: {
      // 🚨 ARCHITECTURE GUARDRAILS
      "import/no-relative-parent-imports": "error",
      "import/no-cycle": "error",

      // BLOCK DEEP CROSS-PACKAGE IMPORTS
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            "../../*",
            "../../../*",
            "../../../../*"
          ],
        },
      ],
    },
  },
];
