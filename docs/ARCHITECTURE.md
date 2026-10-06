# Architecture and tested behavior

[日本語](ARCHITECTURE.ja.md)

This document describes the behavior expressed by the tests and supported by the implementation. **Tests define the executable specification; implementation satisfies it; documentation follows both.** For a behavior change, update the relevant test first, observe its failure, implement the change, and then update these documents. A contradiction is something to resolve, rather than silently treating prose or current code as the specification. Passing tests only establish the cases they exercise.

## Runtime and boundaries

The target is GNOME Shell 50. The extension runs as GJS ESM; Node is used only for development tools. TypeScript and both bundles target ES2025 without runtime polyfills. GTK and Adwaita belong to the separate preferences process.

| Layer                                              | Responsibility                                                               | Tests                                                                                  |
| -------------------------------------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| [model.ts](../src/model.ts)                        | Readonly values, `Result`, `ImageSource`, and injected effect ports          | Type checks and consumers' tests                                                       |
| [core.ts](../src/core.ts)                          | Pure parsing, image identity, scheduling, retries, retention, restoration    | [core.test.ts](../tests/core.test.ts)                                                  |
| [bing.ts](../src/bing.ts)                          | Bing metadata request and conversion to a `Result`                           | [bing.test.ts](../tests/bing.test.ts)                                                  |
| [controller.ts](../src/controller.ts)              | Coordinate effects, request generations, cached images, background ownership | [controller.test.ts](../tests/controller.test.ts)                                      |
| [gjs.ts](../src/gjs.ts)                            | Soup HTTP, Gio storage, GSettings transactions, cancellables, timers         | [gjs.test.ts](../tests/gjs.test.ts), [native integration](../tests/integration/gjs.ts) |
| [extension.ts](../src/extension.ts)                | GNOME entry point, settings signals, dependency wiring, teardown             | [extension.test.ts](../tests/extension.test.ts)                                        |
| [ui.ts](../src/ui.ts), [prefs.ts](../src/prefs.ts) | Panel menu and market/resolution preferences                                 | [ui.test.ts](../tests/ui.test.ts), [prefs.test.ts](../tests/prefs.test.ts)             |

The core does not import GNOME or Node APIs. `ImageSource` allows another provider to replace Bing without changing the controller. Communication, storage, background settings, time, timers, rendering, logging, and cancellation are injected. Controller state is private to its factory; domain values are readonly. Classes are confined to the entry points required by GNOME.

## Image source contract

The defaults are `market = ja-JP` and `resolution = UHD`; the other resolution is `1920x1080`.

The Bing provider requests `https://www.bing.com/HPImageArchive.aspx?format=js&idx=0&n=1&mkt=<encoded-market>` and parses the first image. Tests specify rejection of malformed UTF-8, JSON, missing fields, impossible dates, and unexpected URL prefixes. `fullstartdate` is interpreted as UTC and must round-trip as a valid calendar timestamp. Image paths must begin with `/th?id=OHR.` and the information link with `https://www.bing.com/`. These are prefix checks, not a general URL security proof.

Image identity includes the market, requested resolution, and encoded URL base. The selected-resolution URL is built from the base; the fallback is the normal image URL supplied in the response. A missing title uses the copyright text. Metadata parsing and network failures become `{ ok: false, error }` results.

UHD download failure triggers one attempt at the supplied fallback URL. Normal-resolution failure schedules a retry without that fallback attempt. Cancellation does not trigger a fallback. A cached fallback image keeps the requested UHD identity, so later requests reuse it while the file exists.

## Update, retry, and cancellation contract

The lifecycle tests specify this sequence:

1. Capture the original light and dark background values when the controller is created.
2. On enable, manual refresh, or preferences changes, load the cache and request metadata.
3. Reuse a matching cache entry if its file exists; otherwise download and atomically save the image.
4. Write the updated cache index, then apply the image to both background keys and display its information.
5. Remove expired, unprotected entries; record the remaining index; schedule the next check.

A refresh already in progress coalesces additional manual requests. Each request has a generation and cancellation token. Preferences changes cancel the old request and timer and start a new generation. After each asynchronous stage, stale work stops without further wallpaper, menu, or timer updates. Cancellation does not undo effects already completed, including files already written.

| Decision                              | Tested behavior                                                               |
| ------------------------------------- | ----------------------------------------------------------------------------- |
| Next daily check                      | Publication timestamp + 24 hours + 5 minutes, if still in the future          |
| Publication already old               | Check again in 1 hour; this includes another response for the same old image  |
| Failure retry                         | 15, 30, 60, 120, 240, then 360 minutes; subsequent failures remain at 360     |
| Successful full update                | Reset the failure count                                                       |
| Failure before background application | Keep the existing wallpaper, display/log the error, and schedule a retry      |
| Cleanup failure after application     | Keep the newly applied wallpaper, display/log the error, and schedule a retry |

The publication timestamp drives scheduling; this is not a promise of a particular local midnight. Leap-day and old-image cases are exercised in the core tests. Timer cancellation and one-shot firing are covered at the adapter boundary.

Disable is idempotent. The entry point disconnects the settings signal, stops controller work, closes the HTTP session, and destroys the menu. Restoration compares the two background keys independently with the last URI successfully applied by the extension. A matching key returns to its original value; a manually changed key stays as it is. If no image was applied, disabling does not write background settings. Restoration failure is logged.

## Storage and settings contract

The data directory is `$XDG_DATA_HOME/gnome-wallpaper`, normally `~/.local/share/gnome-wallpaper`. It contains an `index.json` array and images named `<encodeURIComponent(image.id)>.jpg`. Entries contain `id`, `publishedAt`, and `uri`.

Storage uses asynchronous Gio operations and `replace_contents_async` with `REPLACE_DESTINATION`. Image and index replacements are atomic individually; they are separate operations, not one transaction. A missing index means an empty cache. Malformed indexes and IO errors fail the update. Loaded entries must have valid field types, finite timestamps, and the exact URI generated for their ID inside the managed directory. Deleting an unmanaged entry is rejected.

Retention removes indexed images whose publication timestamp is strictly older than seven days. An image exactly on the boundary stays. Both current background URIs and both original restoration URIs are protected, even if older. Cleanup occurs after a successful application, manages indexed files only, and is not a strict seven-file limit. Unindexed files can remain if saving succeeds before indexing fails or the request is cancelled.

Background writes use delayed GSettings updates for `picture-uri` and `picture-uri-dark` in `org.gnome.desktop.background`. Both writes must be accepted before `apply`; rejection or an exception reverts the pending transaction. The extension preferences schema is `org.gnome.shell.extensions.gnome-wallpaper` and contains only market and resolution.

## UI contract and verification limits

Boundary tests exercise photo title and credit, waiting/updating/error/next-check states, refresh and preferences actions, and menu destruction. Refresh is disabled while busy. Errors take precedence over the next-check text. The credit is display text, not a clickable information link. Controls and status dates are English; image text comes from the source. Market is a text entry with examples, not a validated list of supported regions. Preferences changes are observed through GSettings; the resolution signal is disconnected on window close.

Metadata declares `user` and `unlock-dialog` session modes to allow updates while locked. Tests validate those declarations, not actual lock-screen operation.

All executable `src/**/*.ts` files, including UI, entry points, adapters, and unimported files, require **100% lines, statements, functions, and branches per file**. Type declarations contain no executable code. GNOME API aliases supply boundary mocks for unit tests; they do not establish live desktop behavior.

The [native test](../tests/integration/gjs.ts), launched by [test-gjs.ts](../scripts/test-gjs.ts), runs the actual core, provider, controller, and adapters with real GJS, Soup, and Gio. A local HTTP server, temporary directory, and memory GSettings exercise UHD fallback, cache reuse, indexed cleanup and protection, conditional restoration, invalid metadata, HTTP errors, native network/storage cancellation, and schema defaults/writes. Selected ES2025 APIs are also exercised. The HTTP fixture uses synthetic bytes; it does not verify decoding/displaying a real photograph or Bing's live responses.

Local verification has passed with GJS 1.88.0. Live Bing, installation, real panel/preferences behavior, wallpaper display, and lock-screen operation remain unverified. There is no release or deployment in this iteration. GitHub CI runs on Ubuntu 26.04; current results and reports are available in [Actions](https://github.com/maya0513/gnome-wallpaper/actions). Branch protection and repository auto merge are not enabled.

## Build, tasks, and artifact size

Development uses mise-managed Node 24/pnpm 12 and project-local Vite+ 1/TypeScript 7, with major-range declarations and exact resolutions in `pnpm-lock.yaml`. The coverage provider must match Vite+'s bundled Vitest exactly, with a single resolved Vitest. Strict lint, type checks, coverage, build, native integration, ZIP validation, and size measurement run through Vite tasks in [vite.config.ts](../vite.config.ts). Setup and acceptance commands are in [AGENTS.md](../AGENTS.md).

`tsconfig.json` checks application code and development files with Node types. `tsconfig.app.json` adds an application-only check without ambient Node globals. It is a type-environment boundary, not a second output build; explicitly importing a Node module is not prevented by `types: []` alone. Packaging validation also checks for development imports in the emitted JavaScript.

The build emits readable ESM `extension.js` and `prefs.js`, preserving `gi://` and `resource:///` imports. The ZIP includes those files, metadata, the source and compiled GSettings schema, and MIT LICENSE. Development dependencies, tests, scripts, documentation, and wallpapers are outside the package. [validate-package.ts](../scripts/validate-package.ts) verifies its contents, GNOME 50/session metadata, ESM imports and default export, and schema validity.

Run `pnpm exec vp run size` to rebuild and print the measurements. Full `pnpm exec vp run ci` runs the same measurement command after all prerequisite checks succeed. Any failed prerequisite or measurement fails CI. The exact current report is [artifacts/build-size.json](../artifacts/build-size.json), generated by [measure-size.ts](../scripts/measure-size.ts):

| Field               | Meaning                                                            |
| ------------------- | ------------------------------------------------------------------ |
| `javascriptBytes`   | Total size of emitted JavaScript                                   |
| `unpackedBytes`     | Total file bytes in `dist/`, excluding directory entries           |
| `zipBytes`          | Actual extension ZIP size                                          |
| `files[].bytes`     | Uncompressed size of each file                                     |
| `files[].gzipBytes` | Independent gzip estimate for that file; not its ZIP size          |
| `minified`          | Whether the application build uses minification; currently `false` |

These measure artifact bytes, not RAM usage, downloaded photo sizes, or installed GNOME libraries. Do not copy a changing size total into a specification as a fixed requirement. The CI workflow saves the size report with its verification reports and uploads the ZIP separately.

Minification removes formatting and may shorten names to reduce JavaScript size. ZIP compression reduces archive size while keeping extracted code readable. This project uses ZIP compression and leaves JavaScript unminified, following [GNOME's requirement for readable, unminified extension code](https://gjs.guide/extensions/review-guidelines/review-guidelines.html#code-must-not-be-obfuscated). Future size changes should be assessed using the report and the same acceptance checks.

## Updates and licensing

The configured GitHub workflow runs on push, pull requests, and manual dispatch. It upgrades Node/pnpm within their specified majors, installs with the frozen lockfile, and runs local Vite CI tasks. Dependabot is configured for weekly lockfile-only dependency updates with Vite/Vitest/coverage grouped. Automatic merge is limited to minor/patch lockfile-only PRs, requires the configured `quality` branch check, and never checks out or executes PR code in its privileged workflow. Configured automation is not evidence that remote checks or protection settings are active.

The independently written code and documentation use MIT. Keep its copyright and permission notice with distributed copies. GNOME and dependencies retain their licenses; combined distribution must respect applicable GPL terms. See [GNOME's licensing requirements](https://gjs.guide/extensions/review-guidelines/review-guidelines.html#licensing). Software licensing does not grant rights to Bing's images.
