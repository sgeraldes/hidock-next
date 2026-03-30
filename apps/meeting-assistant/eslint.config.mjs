import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { configs, config } = require("@electron-toolkit/eslint-config-ts");

export default config(
  ...configs.recommended,
  {
    rules: {
      "@typescript-eslint/explicit-function-return-type": "off",
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
  {
    ignores: [
      "node_modules/**",
      "out/**",
      "*.tsbuildinfo",
      "postcss.config.js",
      "tailwind.config.js",
    ],
  },
);
