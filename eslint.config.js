import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

export default tseslint.config(
  { ignores: ["coverage/**", "dist/**", "dist-electron/**", "release/**", "node_modules/**", ".cache/**", "public/**", "test-results/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
  {
    // The simulation and rules must stay deterministic and headless.
    files: ["src/sim/**/*.ts", "src/rules/**/*.ts"],
    rules: {
      "no-restricted-imports": ["error", { patterns: ["three", "three/*", "../render/*", "../ui/*", "../audio/*", "../input/*"] }],
      "no-restricted-properties": ["error", { object: "Math", property: "random", message: "Use the seeded RNG." }, { object: "Date", property: "now", message: "Sim time comes from ticks." }],
      "no-restricted-globals": ["error", "window", "document", "performance"],
    },
  },
);
