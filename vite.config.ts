import { defineConfig } from "vite-plus";

const measureSize = "node scripts/measure-size.ts";

export default defineConfig({
  run: {
    cache: false,
    tasks: {
      toolchain: "node scripts/toolchain.ts",
      "align-toolchain": "node scripts/toolchain.ts --align",
      format: "vp fmt",
      test: "vp test run",
      "test-watch": "vp test watch",
      static: ["vp check", "tsc -p tsconfig.app.json --noEmit"],
      coverage: "vp test run --coverage",
      bundle: ["vp pack", "node scripts/package.ts"],
      integration: { command: "node scripts/test-gjs.ts", dependsOn: ["bundle"] },
      size: { command: measureSize, dependsOn: ["bundle"] },
      validate: { command: "node scripts/validate-package.ts", dependsOn: ["bundle"] },
      ci: {
        command: measureSize,
        dependsOn: ["toolchain", "static", "coverage", "integration", "validate"],
      },
    },
  },
  lint: {
    options: { typeAware: true, typeCheck: true, denyWarnings: true },
    plugins: ["typescript", "unicorn", "oxc", "import", "promise", "vitest"],
    categories: {
      correctness: "error",
      suspicious: "error",
      pedantic: "error",
      perf: "error",
      style: "error",
    },
    rules: {
      // Async effects and expressions are deliberate parts of the functional design.
      "one-var": ["error", "never"],
      "sort-keys": "off",
      "sort-imports": "off",
      "no-ternary": "off",
      "unicorn/no-null": "off",
      "id-length": ["error", { min: 1 }],
      "no-magic-numbers": [
        "error",
        { ignore: [0, 1, 2, 3, -1], ignoreArrayIndexes: true, ignoreDefaultValues: true },
      ],
      "max-statements": ["error", 70],
      "max-params": ["error", 5],
      "max-lines": ["error", { max: 600, skipBlankLines: true, skipComments: true }],
      "max-lines-per-function": ["error", { max: 180, skipBlankLines: true, skipComments: true }],
      "typescript/no-explicit-any": "error",
      "typescript/explicit-module-boundary-types": "error",
      "no-param-reassign": ["error", { props: true }],
      // Test titles may begin with proper names such as Bing, GNOME, or UTC.
      "vitest/prefer-lowercase-title": "off",

      "typescript/no-non-null-assertion": "error",
      "typescript/consistent-type-imports": "error",
      "typescript/strict-boolean-expressions": ["error", { allowNullableObject: true }],
      "typescript/only-throw-error": ["error", { allowRethrowing: true }],
      // GI objects are mutable foreign interfaces; they cannot be made readonly.
      "typescript/prefer-readonly-parameter-types": "off",
      // GI callbacks and Node test mocks intentionally have synchronous implementations.
      "require-await": "off",
      "typescript/require-await": "off",
      "typescript/strict-void-return": "off",
      "vitest/require-hook": "off",
      // Named functions and colocated type exports make the functional API explicit.
      "import/no-named-export": "off",
      "import/prefer-default-export": "off",
      "import/group-exports": "off",
      "import/exports-last": "off",
      "import/no-namespace": "off",
      "no-nested-ternary": "off",
      "unicorn/no-nested-ternary": "off",
      "import/no-anonymous-default-export": "off",
      // Foreign async callbacks must be adapted to Promises at the GJS boundary.
      "promise/prefer-await-to-callbacks": "off",
      "promise/avoid-new": "off",
      // Every test imports its API; no ambient test globals enter application types.
      "vitest/prefer-importing-vitest-globals": "off",
      "vitest/no-importing-vitest-globals": "off",
      "vitest/consistent-test-it": ["error", { fn: "it" }],
      "vitest/require-mock-type-parameters": "off",
      "vitest/prefer-expect-assertions": "off",
      "vitest/require-top-level-describe": "off",
      "vitest/max-expects": ["error", { max: 25 }],
      "vitest/no-hooks": "off",
      "vitest/prefer-called-with": "off",
      "vitest/prefer-called-times": "off",
      "vitest/prefer-to-be-truthy": "off",
      "vitest/prefer-to-be-falsy": "off",

      "vitest/no-conditional-in-test": "off",
      "eslint/init-declarations": "off",
      "unicorn/max-nested-calls": ["error", { max: 5 }],
    },
    overrides: [
      {
        // Uint8Array is the native IO payload; all domain records remain readonly.
        files: ["src/core.ts", "src/model.ts", "src/bing.ts", "src/controller.ts"],
        rules: {
          "typescript/prefer-readonly-parameter-types": ["error", { allow: ["Uint8Array"] }],
        },
      },
      {
        files: ["src/core.ts", "src/model.ts"],
        rules: {
          "no-restricted-imports": [
            "error",
            {
              patterns: [
                "gi://*",
                "resource://*",
                "node:*",
                "./gjs",
                "./ui",
                "./extension",
                "./prefs",
              ],
            },
          ],
        },
      },
      {
        files: ["tests/**", "scripts/**", "vite.config.ts"],
        rules: { "typescript/explicit-module-boundary-types": "off" },
      },

      // This deliberately partial window stands in for the native GTK object.
      { files: ["tests/prefs.test.ts"], rules: { "typescript/no-unsafe-type-assertion": "off" } },
      // The fixture intentionally contains a hostile URL; Promise<void> needs explicit undefined.
      { files: ["tests/core.test.ts"], rules: { "no-script-url": "off" } },
      { files: ["tests/controller.test.ts"], rules: { "unicorn/no-useless-undefined": "off" } },

      // GNOME's preferences entry contract still requires this Adwaita API.
      { files: ["src/prefs.ts"], rules: { "typescript/no-deprecated": "off" } },
      // Preserve GI error domains so NOT_FOUND and EXISTS remain distinguishable.
      { files: ["src/gjs.ts"], rules: { "typescript/prefer-promise-reject-errors": "off" } },
      // These functions emulate constructors and GI's fixed argument lists.
      {
        files: ["tests/mocks/**"],
        rules: {
          "prefer-arrow-callback": "off",
          "max-params": ["error", 7],
          "max-classes-per-file": ["error", 2],
        },
      },

      { files: ["**/*.d.ts"], rules: { "import/no-unassigned-import": "off" } },
      {
        files: ["scripts/**", "vite.config.ts"],
        plugins: ["typescript", "unicorn", "oxc", "import", "promise"],
        rules: { "import/no-nodejs-modules": "off", "no-magic-numbers": "off" },
      },
      {
        files: ["tests/integration/**"],
        plugins: ["typescript", "unicorn", "oxc", "import", "promise"],
        rules: {
          "promise/prefer-await-to-then": "off",
          "promise/always-return": "off",
          "unicorn/prefer-top-level-await": "off",
        },
      },
      {
        files: ["tests/**"],
        rules: {
          "import/no-nodejs-modules": "off",
          "typescript/only-throw-error": "off",
          "typescript/prefer-promise-reject-errors": "off",
          "no-magic-numbers": "off",
          "max-lines-per-function": ["error", 350],
          "max-statements": ["error", 100],
        },
      },
      { files: ["src/gjs.ts"], rules: { "no-await-in-loop": "off" } },
      { files: ["src/controller.ts"], rules: { "no-await-in-loop": "off" } },
    ],
    ignorePatterns: ["dist/**", "artifacts/**", ".cache/**", "coverage/**"],
  },
  fmt: {
    ignorePatterns: [
      "dist/**",
      "artifacts/**",
      ".cache/**",
      "coverage/**",
      "pnpm-lock.yaml",
      "LICENSE",
    ],
  },
  test: {
    include: ["tests/**/*.test.ts"],
    alias: {
      "gi://Gio": "/tests/mocks/gio.ts",
      "gi://GLib": "/tests/mocks/glib.ts",
      "gi://Soup?version=3.0": "/tests/mocks/soup.ts",
      "gi://St": "/tests/mocks/shell.ts",
      "gi://GObject": "/tests/mocks/shell.ts",
      "gi://Gtk?version=4.0": "/tests/mocks/gtk.ts",
      "gi://Adw?version=1": "/tests/mocks/gtk.ts",
      "resource:///org/gnome/shell/extensions/extension.js": "/tests/mocks/extension.ts",
      "resource:///org/gnome/shell/ui/main.js": "/tests/mocks/main.ts",
      "resource:///org/gnome/shell/ui/panelMenu.js": "/tests/mocks/shell.ts",
      "resource:///org/gnome/shell/ui/popupMenu.js": "/tests/mocks/shell.ts",
      "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js": "/tests/mocks/extension.ts",
    },
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.d.ts"],
      reporter: ["text", "html", "lcov", "json-summary"],
      thresholds: { perFile: true, lines: 100, statements: 100, functions: 100, branches: 100 },
    },
  },
  pack: [
    {
      entry: { extension: "src/extension.ts", prefs: "src/prefs.ts" },
      platform: "neutral",
      target: "es2025",
      format: ["esm"],
      outExtensions: () => ({ js: ".js" }),
      dts: false,
      minify: false,
      sourcemap: false,
      deps: { neverBundle: [/^gi:\/\//u, /^resource:\/\//u] },
    },
    {
      entry: { test: "tests/integration/gjs.ts" },
      outDir: ".cache/gjs",
      platform: "neutral",
      target: "es2025",
      format: ["esm"],
      outExtensions: () => ({ js: ".js" }),
      dts: false,
      sourcemap: false,
      deps: { neverBundle: [/^gi:\/\//u, /^resource:\/\//u, /^system$/u] },
    },
  ],
});
