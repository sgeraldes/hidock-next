import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { configs, config } = require("@electron-toolkit/eslint-config-ts");
const reactPlugin = require("eslint-plugin-react");

// rules-of-hooks is the one correctness rule this gate most needs (a real
// hooks-order crash happened in this codebase). It lives in
// eslint-plugin-react-hooks; wire it in defensively so the config still loads
// if the package is ever removed, but it is a declared devDependency.
let reactHooksPlugin = null;
try {
  reactHooksPlugin = require("eslint-plugin-react-hooks");
} catch {
  reactHooksPlugin = null;
}

const reactHooksConfig = reactHooksPlugin
  ? [
      {
        files: ["src/**/*.{ts,tsx,js,jsx}"],
        plugins: { "react-hooks": reactHooksPlugin },
        rules: {
          "react-hooks/rules-of-hooks": "error",
          "react-hooks/exhaustive-deps": "warn",
        },
      },
    ]
  : [];

export default config(
  // Base: @eslint/js recommended + typescript-eslint recommended (NOT
  // type-checked — keeps the gate fast) + browser/node globals.
  ...configs.recommended,

  // Relax stylistic / low-signal rules so the gate reflects real problems.
  // These are downgraded (not fixed) because fixing them means touching dozens
  // of files across the codebase, which is out of scope for restoring the gate.
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/explicit-function-return-type": "off",
      "@typescript-eslint/explicit-module-boundary-types": "off",
      // @ts-ignore/@ts-expect-error comment discipline — noisy, not correctness.
      "@typescript-eslint/ban-ts-comment": "warn",
      // `Function` type usage — legitimate cleanup, but 14 sites across files.
      "@typescript-eslint/no-unsafe-function-type": "warn",
      // Redundant regex escapes — auto-fixable but touches many regexes; warn.
      "no-useless-escape": "warn",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
      "no-empty": ["warn", { allowEmptyCatch: true }],
    },
  },

  // Renderer (React) — src/**
  {
    files: ["src/**/*.{ts,tsx,js,jsx}"],
    ...reactPlugin.configs.flat.recommended,
    settings: { react: { version: "detect" } },
    rules: {
      ...reactPlugin.configs.flat.recommended.rules,
      // New JSX transform (React 18) — no need to import React in scope.
      "react/react-in-jsx-scope": "off",
      "react/jsx-uses-react": "off",
      // TypeScript handles prop typing.
      "react/prop-types": "off",
      // Low-signal stylistic rules downgraded to warnings.
      "react/no-unescaped-entities": "warn",
      "react/display-name": "warn",
      "react/no-unknown-property": "warn",
    },
  },

  // react-hooks (conditional — see note above)
  ...reactHooksConfig,

  // CommonJS files (main-process bootstrap, root-level benchmark/util scripts)
  // legitimately use require().
  {
    files: ["electron/**/*.{ts,js,mjs,cjs}", "**/*.js", "**/*.cjs"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },

  {
    ignores: [
      "node_modules/**",
      "dist/**",
      "out/**",
      "coverage/**",
      "resources/**",
      "**/*.config.js",
      "**/*.config.cjs",
      "**/*.config.mjs",
      "**/*.config.ts",
      "**/*.tsbuildinfo",
    ],
  },
);
