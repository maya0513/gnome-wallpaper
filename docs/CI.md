# CI and dependency updates

[日本語](CI.ja.md)

CI checks the committed dependency graph and the extension package. Dependency updates use the existing Mend Renovate App and the shared GitHub App; releases, installation, and deployment are outside these workflows.

## Local checks

Run from the repository root:

```sh
mise install --locked node pnpm
mise exec -- pnpm install --frozen-lockfile
mise exec -- pnpm exec vp run format
mise exec -- pnpm exec vp run ci
```

Node and pnpm are selected by `mise.toml`, with checksums and platform entries in `mise.lock`. `package.json` repeats the exact Node version in `engines.node` and the exact pnpm version in `packageManager` so Renovate's dependency generation uses the same tools. `pmOnFail: error` prevents pnpm from silently downloading or accepting a different package-manager version. CI checks that these declarations agree. Linux x64 and ARM64 are the recorded platforms; acceptance jobs currently execute on Linux x64.

Vite tasks are the main task interface. There are no package scripts or mise tasks. Native checks require GJS, Soup 3 introspection, desktop GSettings schemas, `glib-compile-schemas`, `zip`, and `unzip`. Application code remains GJS ESM and is packaged without minification.

Useful tasks:

| Task              | Checks or output                                                                           |
| ----------------- | ------------------------------------------------------------------------------------------ |
| `configuration`   | Workflow syntax, ShellCheck, security audits, and CI policy tests                          |
| `toolchain`       | Exact coverage/overrides and a single matching Vitest instance; reads only                 |
| `static`          | Strict lint, formatting, type-aware checks, and application-only types                     |
| `coverage`        | All executable application files: 100% lines, statements, functions, and branches per file |
| `native`          | Build, real GJS integration, ZIP validation, and size measurement                          |
| `size`            | Rebuild and measure the package                                                            |
| `align-toolchain` | Explicitly synchronize Vite+-derived declarations and lockfile, then verify                |
| `ci`              | All local acceptance checks                                                                |

The workflow tools are actionlint, ShellCheck, and zizmor. The installer verifies official release SHA-256 digests and accepts only their declared tool majors. Zizmor runs with `--pedantic --offline`, without pinning exceptions; checks that require remote GitHub data are outside this audit.

## GitHub acceptance

[CI](../.github/workflows/ci.yml) runs on main pushes, PRs targeting main, merge groups, and manual dispatch. There are no author or changed-path exclusions: human, Renovate, and shared-App commits receive the same checks.

| Job                    | Responsibility                                                                                                           |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `dependency-artifacts` | Shared workflow in verification mode: regenerate mise locks and verify synchronized Vite+ artifacts; fail on differences |
| `configuration`        | Validate workflow syntax/security, repository policy, and moderate-or-higher dependency vulnerabilities on PRs           |
| `static`               | Validate toolchain, strict lint, formatting, and types                                                                   |
| `tests`                | Unit/boundary tests and per-file 100% application coverage                                                               |
| `native`               | Build and test with real GJS, validate the ZIP and schemas, measure size                                                 |
| `quality`              | Always run and require success from all five prerequisite jobs                                                           |

All repository tokens in acceptance CI are read-only. Node/pnpm installs use `--locked`; dependency installs use `--frozen-lockfile`. Acceptance does not repair committed files. The shared verification job may regenerate files in its disposable checkout to detect stale artifacts, but fails instead of publishing those changes. Its `verify-only: true` mode needs no App credentials.

The shared verification and update callers both enable `sync-vite-plus` and `sync-declarations`. Their identical `lock-groups` select `mise.lock`, Node/pnpm, Linux x64/ARM64, and `verify: regenerate`. Both callers pin the same complete SHA of [the shared workflow](https://github.com/maya0513/renovate-config/blob/1070616046be77fce7b54ff3d1eb36d7f3f2732e/.github/workflows/dependency-artifacts.yml). Renovate maintains these pins and every external Action pin.

Local `ci` checks the graph and repository policy. The reusable workflow additionally regenerates artifacts in a clean GitHub checkout; local success does not establish that this remote job has passed.

## Dependency updates

[Renovate configuration](../renovate.json) inherits the common preset and its optional Vite+ preset. The common policy schedules routine updates on Tuesday in Asia/Tokyo and waits seven days after release. Non-major updates, including SHA updates and lockfile maintenance, may automerge after required checks; major updates require manual review. Local rules also require manual review for runner and shared-workflow revisions; shared-workflow revisions have no release-age delay. Security fixes bypass the schedule/release-age delay, while major security updates still require review. Dependency graph and Dependabot alerts support vulnerability fixes; Dependabot version-update workflows are removed.

Ordinary npm declarations use caret ranges based on the existing locked stable versions. `rangeStrategy: update-lockfile` updates the lockfile within those ranges and replaces declarations for out-of-range updates. Node and pnpm have separate Renovate groups spanning npm and mise so each tool's declarations update together. Node type definitions remain within Node 24 until a runtime-major change is reviewed. Normal CI never searches for newer versions.

Mise artifact generation and mise lock maintenance are disabled in Renovate and delegated to the shared workflow. Node-only groups also skip artifact generation. The pnpm group deliberately retains Renovate's npm artifact generation: changing `packageManager` without refreshing pnpm's separate manager lock document makes the shared workflow's initial frozen install fail. This verified exception and the proposed shared consumer preset are tracked in [renovate-config #3](https://github.com/maya0513/renovate-config/issues/3). Equivalent local rules can be removed once that shared change is reviewed and adopted.

Vite+ selects its exact bundled Vitest and Vite core versions. Coverage uses that exact Vitest version, and workspace overrides select the exact Vitest and Vite core alias. The optional preset disables independent npm updates for coverage, Vitest, and Vite core. A bundled Vitest major change fails synchronization until compatibility is explicitly reviewed; a security issue in a coupled package may also need manual action if Vite+ has not supplied a compatible fix.

[Update dependency artifacts](../.github/workflows/update-dependencies.yml) runs on pushes to `renovate/**`, without path filters. It calls the same shared workflow in update mode. The shared workflow accepts only the Mend Renovate sender (ID `29139614`) for that branch prefix:

1. A read-only preparation job regenerates mise locks, then synchronizes the selected Vite+ graph. It disables dependency scripts, pnpm hooks, and automatic package-manager switching during synchronization. Unrelated dependency changes, duplicate Vitest, wrong aliases, and declaration mismatches fail.
2. The preparation job emits an exact binary patch and base SHA through a same-run artifact with one-day retention.
3. A separate publishing job validates allowed paths and ordinary files, creates one commit, and obtains a repository-scoped App token with Contents write. It does not install or execute the candidate dependencies.
4. It pushes to the existing Renovate branch only with an exact base-SHA lease. A moved branch fails instead of overwriting newer work.
5. The App push triggers PR CI on the corrected commit. Because the sender is no longer Renovate, it does not start another repair cycle.

The combined workflow avoids competing mise/Vite+ repair pushes. It may update `mise.lock` and its sidecars, `package.json`, `pnpm-workspace.yaml`, and `pnpm-lock.yaml`; it does not update application source or workflow definitions. No post-update mise task is configured. Humans and other bots must regenerate their own dependency artifacts; verification still runs on their PRs.

## Authentication and merge protection

Use the already registered Renovate App and common GitHub App. The repair caller reads:

- Actions variable `DEPENDENCY_ARTIFACTS_APP_CLIENT_ID`.
- Actions secret `DEPENDENCY_ARTIFACTS_APP_PRIVATE_KEY`.

These may be repository settings or organization settings granted to this repository. App installation and Actions credential availability are separate requirements. The common App needs access to this repository with Contents write; no new App, PAT, approval bot, or write-capable PR execution is introduced. Never put private keys in commits or chat. The shared workflow uses App authentication so its repair push triggers normal CI; a `GITHUB_TOKEN` push does not trigger the usual push workflows.

Enable **Allow auto-merge** and protect main with the required `quality` check from GitHub Actions and **Require branches to be up to date before merging**. Do not permit unattended administrator bypass. Because `quality` includes artifact verification, stale generated files cannot pass the gate. Do not require `renovate/artifacts` globally: it is an error status that Renovate reports when its own generation fails, not a check present on every PR.

After publication, confirm ordinary CI, the shared verification job, and a real Renovate repair commit followed by CI. App registration, local mocks, or a no-change synchronization run alone do not prove the entire automatic update/merge path works. This redesign has not yet been verified on GitHub.

## Manual changes and failures

After changing a runtime version, update `mise.toml` and the corresponding `package.json` field together, then run `mise lock --platform linux-x64,linux-arm64 node pnpm`. Regenerate the pnpm lockfile with the selected toolchain. After selecting a different Vite+ version and updating its lockfile, run:

```sh
mise exec -- pnpm exec vp run align-toolchain
mise exec -- pnpm exec vp run format
mise exec -- pnpm exec vp run ci
```

Alignment intentionally writes exact coverage and overrides, then performs a non-frozen install followed by a frozen install. A fresh Node process verifies that Vite+ and unrelated direct/transitive dependencies did not change. A failure can leave files modified: inspect the diff and correct the cause before committing. Never delete the whole lockfile or disable verification to resolve a conflict.

| Failure                                       | Response                                                                         |
| --------------------------------------------- | -------------------------------------------------------------------------------- |
| Locked/frozen install fails                   | Check tool versions and declarations; regenerate the corresponding artifacts     |
| Artifact verification reports differences     | Generate and commit the missing changes using the same inputs                    |
| Vitest/coverage/core mismatch or major change | Review compatibility and align the selected graph; keep the checks enabled       |
| App credentials unavailable                   | Check Actions variable/secret access and App installation; do not expose the key |
| Push lease fails                              | Inspect the latest Renovate branch and regenerate from its current SHA           |
| Repair commit has no CI                       | Check App authentication and workflow events; do not merge an unverified head    |

## Reports and limitations

Actions retain coverage/JUnit reports, native/size reports, and the validated extension ZIP for 14 days. The size table is also in the run summary. Locally, inspect `artifacts/build-size.json`, `artifacts/gjs-integration.json`, and `coverage/`; run `vp run size` for fresh measurements. Size includes emitted JavaScript, unpacked files, and ZIP bytes, not memory use or downloaded photos. The ZIP remains readable and unminified.

Unit tests use GNOME boundary mocks. Native integration uses actual GJS, a local HTTP server, temporary storage, and memory GSettings. Neither layer depends on live Bing or modifies the real wallpaper. CI does not verify GNOME's actual panel, preferences window, image display, or locked-session behavior. Installation, desktop testing, distribution, and deployment remain future work.
