import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
import jsxA11y from "eslint-plugin-jsx-a11y";
import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";

/**
 * Lint rules encode architectural invariants where a machine can check them.
 * See docs/architecture/TECHNICAL_ARCHITECTURE.md#enforced-boundaries.
 */
export default defineConfig([
  globalIgnores([
    ".next/**",
    "out/**",
    "coverage/**",
    "playwright-report/**",
    "test-results/**",
    "next-env.d.ts",
    "src/types/database.types.ts",
    "supabase/functions/**",
  ]),

  ...nextVitals,
  ...nextTypescript,

  // Full jsx-a11y recommended set (plugin is already registered by next config).
  {
    files: ["**/*.{jsx,tsx}"],
    rules: {
      ...jsxA11y.flatConfigs.recommended.rules,
      // Scrollable regions (e.g. wide tables on mobile) must be keyboard-focusable
      // to satisfy WCAG 2.1.1 (axe: scrollable-region-focusable). Allow tabIndex
      // on labelled role="region" containers only.
      "jsx-a11y/no-noninteractive-tabindex": ["error", { tags: [], roles: ["tabpanel", "region"] }],
    },
  },

  // Type-aware rules for application code.
  {
    files: ["**/*.{ts,tsx,mts}"],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-non-null-assertion": "error",
      "@typescript-eslint/ban-ts-comment": [
        "error",
        { "ts-expect-error": "allow-with-description", "ts-ignore": true, "ts-nocheck": true },
      ],
      "@typescript-eslint/consistent-type-imports": ["error", { fixStyle: "inline-type-imports" }],
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": [
        "error",
        { checksVoidReturn: { attributes: false } },
      ],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/switch-exhaustiveness-check": [
        "error",
        { considerDefaultExhaustiveForUnions: true },
      ],
    },
  },

  // Plain JS/MJS config files are not part of the TS project.
  { files: ["**/*.{js,mjs,cjs}"], extends: [tseslint.configs.disableTypeChecked] },

  // Application source: security and boundary rules.
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "react/no-danger": "error",
      "no-console": "error",
      "no-restricted-syntax": [
        "error",
        {
          selector: "MemberExpression[object.name='process'][property.name='env']",
          message:
            "Read configuration through src/config (env.public.ts / env.server.ts / runtime.ts), never process.env directly.",
        },
        {
          selector: "Identifier[name='SUPABASE_SERVICE_ROLE_KEY']",
          message:
            "Service-role access is not permitted in application code. See src/lib/supabase/README.md.",
        },
        {
          selector: "Literal[value=/service_role|sb_secret_/]",
          message:
            "Service-role access is not permitted in application code. See src/lib/supabase/README.md.",
        },
      ],
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@supabase/supabase-js",
              importNames: ["createClient"],
              message: "Use the helpers in src/lib/supabase (browser.ts / server.ts).",
            },
          ],
          patterns: [
            {
              group: ["@/features/*/*"],
              message: "Import another feature only through its public index: @/features/<name>.",
            },
          ],
        },
      ],
    },
  },

  // Modules that are allowed to touch process.env / console.
  {
    files: ["src/config/**/*.ts", "src/instrumentation.ts"],
    rules: { "no-restricted-syntax": "off" },
  },
  {
    files: ["src/lib/logging/logger.ts"],
    rules: { "no-console": "off" },
  },
]);
