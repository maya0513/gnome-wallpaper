import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const manifest = (
  path: string,
): { name: string; version: string; dependencies: Record<string, string> } => {
  const data: unknown = JSON.parse(readFileSync(path, "utf8"));
  assert.ok(
    data !== null &&
      typeof data === "object" &&
      "name" in data &&
      typeof data.name === "string" &&
      "version" in data &&
      typeof data.version === "string",
  );
  const dependencies =
    "dependencies" in data && data.dependencies !== null && typeof data.dependencies === "object"
      ? Object.fromEntries(
          Object.entries(data.dependencies).map(([name, version]: [string, unknown]) => {
            assert.equal(typeof version, "string");
            return [name, String(version)];
          }),
        )
      : {};
  return { name: data.name, version: data.version, dependencies };
};
const vpPath = require.resolve("vite-plus/package.json");
const vp = manifest(vpPath);
const bundled = vp.dependencies.vitest;
assert.ok(bundled !== undefined);
if (process.argv.includes("--align")) {
  execFileSync("pnpm", ["update", `@vitest/coverage-v8@${bundled}`, "--no-save"], {
    stdio: "inherit",
  });
} else {
  const lock = readFileSync("pnpm-lock.yaml", "utf8");
  const resolvedVersions = new Set(
    [...lock.matchAll(/^ {2}vitest@(?<version>[^(:\n]+)/gmu)].map((match) => match.groups?.version),
  );
  assert.deepEqual(
    [...resolvedVersions],
    [bundled],
    "The lockfile must resolve a single Vitest version",
  );
  const fromRunner = createRequire(vpPath);
  const coveragePath = require.resolve("@vitest/coverage-v8/package.json");
  const fromCoverage = createRequire(coveragePath);
  const runnerPath = fromRunner.resolve("vitest/package.json");
  assert.equal(
    manifest(runnerPath).version,
    bundled,
    "The runner differs from Vite+'s bundled Vitest",
  );
  assert.equal(
    manifest(coveragePath).version,
    bundled,
    "Coverage and Vitest differ. Run pnpm exec vp run align-toolchain",
  );
  assert.equal(
    realpathSync(fromCoverage.resolve("vitest/package.json")),
    realpathSync(runnerPath),
    "Multiple Vitest instances are resolved",
  );
  assert.equal(
    manifest(fromRunner.resolve("vite/package.json")).name,
    "@voidzero-dev/vite-plus-core",
    "The Vite alias does not match",
  );
  console.log(`Vite+ ${vp.version}: verified a single Vitest / coverage ${bundled} resolution`);
}
