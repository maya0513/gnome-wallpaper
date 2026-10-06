# Agent workflow

## Loop

1. Check `git status --short`; preserve existing changes. Use `rg` to find the relevant tests, read their assertions, then trace the implementation.
2. Treat tests as the executable specification. For behavior changes, add a focused test and run `pnpm exec vp test run tests/<area>.test.ts`; observe the intended failure.
3. Implement the smallest change, rerun the focused test, then refactor while green. Resolve contradictions explicitly; never change expectations merely to accept a bug.
4. Update affected documentation to match the tests and implementation; keep English and Japanese versions consistent. Documentation-only changes do not need new behavior tests.
5. Run `pnpm exec vp run format`, then `pnpm exec vp run ci` after final edits. Fix failures and repeat until green.
6. Check `git diff --check`, status, native results, and size changes in `artifacts/`. Report changes, verification results, and remaining limits.

## Constraints

- Use pure functions, readonly domain values, `Result`, and injected effects. Keep the core independent of runtime APIs; classes are limited to GNOME entry points.
- Target GNOME 50, ES2025, and GJS ESM. Preserve `gi://` and `resource:///` imports; keep Node out of application runtime and GTK/Adwaita in preferences. Keep output readable and unminified.
- Preserve cancellation of stale work, conditional wallpaper restoration, atomic saves, and protection of current/restoration images during cleanup.
- Require per-file 100% lines, statements, functions, and branches for all executable source, including UI and adapters. Never skip tests, exclude implementation, add coverage ignores, or weaken lint/type checks to pass.
- Tests must use boundary mocks or local HTTP, temporary files, and memory GSettings; never live Bing or real wallpaper settings.
- Keep tasks in `vite.config.ts`, `package.json` free of scripts, and mise limited to Node/pnpm management. Use major version ranges and frozen lockfile installs; match coverage to Vite+'s bundled Vitest with one resolution. Dependency updates must pass full CI.
- Edit source inputs, not generated files. Keep generated output out of commits. Write code, tests, and this file in English.

Commands run from the repository root with mise active; otherwise prefix them with `mise exec --`. Prepare Node/pnpm with `mise install` and dependencies with `pnpm install --frozen-lockfile`. Native CI needs GJS, Soup 3 introspection, desktop GSettings schemas, `glib-compile-schemas`, `zip`, and `unzip`.

For this iteration, use ordinary commits and pushes on `main`; do not create work branches or pull requests. Installation, activation, releases, deployment, and real desktop testing are out of scope.
