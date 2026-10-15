import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isMap, parseAllDocuments, parseDocument } from "yaml";

const require = createRequire(import.meta.url);
const mapping = (value: unknown): Record<string, unknown> => {
  assert.ok(value !== null && typeof value === "object" && !Array.isArray(value));
  return Object.fromEntries(Object.entries(value));
};
const json = (path: string): Record<string, unknown> => {
  const value: unknown = JSON.parse(readFileSync(path, "utf8"));
  return mapping(value);
};
const strings = (value: unknown): Record<string, string> =>
  Object.fromEntries(
    Object.entries(mapping(value)).map(([name, version]) => {
      assert.equal(typeof version, "string");
      return [name, String(version)];
    }),
  );
const manifest = (path: string) => {
  const data = json(path);
  assert.equal(typeof data.name, "string");
  assert.equal(typeof data.version, "string");
  return {
    name: String(data.name),
    version: String(data.version),
    dependencies: strings(data.dependencies ?? {}),
    optionalDependencies: strings(data.optionalDependencies ?? {}),
  };
};
const packagePath = (name: string, from: NodeJS.Require = require): string => {
  // Read installed manifests independently of exports without executing package code.
  for (const directory of from.resolve.paths(name) ?? []) {
    const path = join(directory, name, "package.json");
    try {
      manifest(path);
      return realpathSync(path);
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") {
        throw error;
      }
    }
  }
  throw Object.assign(new Error(`Cannot resolve package manifest: ${name}`), {
    code: "MODULE_NOT_FOUND",
  });
};
const declarations = ["package.json", "pnpm-workspace.yaml"];
const readDeclarations = () => declarations.map((path) => readFileSync(path, "utf8"));
const pnpm = (...args: string[]): void => {
  execFileSync("pnpm", [...args, "--ignore-scripts", "--ignore-pnpmfile", "--pm-on-fail=error"], {
    stdio: "inherit",
  });
};
const unrelated = () => {
  const project = json("package.json");
  const visited = new Set<string>();
  const versions = new Map<string, Set<string>>();
  const visit = (name: string, from: NodeJS.Require, optional: boolean): void => {
    let path: string;
    try {
      path = realpathSync(packagePath(name, from));
    } catch (error) {
      if (
        optional &&
        error instanceof Error &&
        "code" in error &&
        error.code === "MODULE_NOT_FOUND"
      ) {
        return;
      }
      throw error;
    }
    if (visited.has(path)) {
      return;
    }
    visited.add(path);
    const pkg = manifest(path);
    const found = versions.get(pkg.name) ?? new Set<string>();
    found.add(pkg.version);
    versions.set(pkg.name, found);
    const child = createRequire(path);
    for (const dep of Object.keys({ ...pkg.dependencies, ...pkg.optionalDependencies })) {
      visit(dep, child, Object.hasOwn(pkg.optionalDependencies, dep));
    }
  };
  const optional = strings(project.optionalDependencies ?? {});
  const direct = {
    ...strings(project.dependencies ?? {}),
    ...strings(project.devDependencies ?? {}),
    ...optional,
  };
  for (const name of Object.keys(direct)) {
    if (name !== "vite-plus" && name !== "@vitest/coverage-v8") {
      visit(name, require, Object.hasOwn(optional, name));
    }
  }
  return Object.fromEntries(
    [...versions]
      .toSorted(([a], [b]) => a.localeCompare(b))
      .map(([name, values]) => [name, [...values].toSorted()]),
  );
};
const lockedVitestVersions = (): string[] => {
  const documents = parseAllDocuments(readFileSync("pnpm-lock.yaml", "utf8"));
  for (const document of documents) {
    assert.equal(document.errors.length, 0, "Invalid pnpm lockfile");
  }
  const value: unknown = documents.at(-1)?.toJS();
  const lock = mapping(value);
  return [
    ...new Set(
      ["packages", "snapshots"].flatMap((section) =>
        Object.keys(mapping(lock[section] ?? {})).flatMap((key) => {
          const version = /^vitest@(?<version>[^(:]+)/u.exec(key)?.groups?.version;
          return version === undefined ? [] : [version];
        }),
      ),
    ),
  ];
};
const verify = (): void => {
  const vpPath = require.resolve("vite-plus/package.json");
  const vp = manifest(vpPath);
  const bundled = vp.dependencies.vitest;
  const alias = vp.dependencies.vite;
  assert.ok(bundled !== undefined && alias !== undefined);
  assert.match(bundled, /^\d+\.\d+\.\d+$/u, "Bundled Vitest must be an exact stable version");
  assert.match(alias, /^npm:@voidzero-dev\/vite-plus-core@\d+\.\d+\.\d+$/u);
  const coverage = strings(json("package.json").devDependencies)["@vitest/coverage-v8"];
  assert.equal(
    coverage?.split(".")[0],
    bundled.split(".")[0],
    "Vite+ changed its bundled Vitest major; review compatibility before updating",
  );
  assert.equal(coverage, bundled, "Coverage declaration differs from bundled Vitest");
  const workspace = parseDocument(readFileSync("pnpm-workspace.yaml", "utf8"));
  assert.equal(workspace.errors.length, 0);
  const overrides = workspace.get("overrides", true);
  assert.ok(isMap(overrides), "Workspace needs an overrides mapping");
  const values = strings(overrides.toJSON());
  for (const [name, expected] of [
    ["vite", alias],
    ["vitest", bundled],
  ]) {
    assert.ok(name !== undefined && expected !== undefined);
    const selectors = Object.keys(values).filter((key) => key === name || key === `${name}@*`);
    assert.equal(selectors.length, 1, `Declare exactly one ${name} override`);
    assert.equal(values[String(selectors[0])], expected, `${name} override differs from Vite+`);
  }
  assert.deepEqual(
    lockedVitestVersions(),
    [bundled],
    "The lockfile must resolve a single Vitest version",
  );
  const fromRunner = createRequire(vpPath);
  const coveragePath = require.resolve("@vitest/coverage-v8/package.json");
  const runnerPath = fromRunner.resolve("vitest/package.json");
  assert.equal(
    manifest(runnerPath).version,
    bundled,
    "The runner differs from Vite+'s bundled Vitest",
  );
  assert.equal(manifest(coveragePath).version, bundled, "Coverage and Vitest differ");
  assert.equal(
    realpathSync(createRequire(coveragePath).resolve("vitest/package.json")),
    realpathSync(runnerPath),
    "Multiple Vitest instances are resolved",
  );
  const vite = manifest(fromRunner.resolve("vite/package.json"));
  assert.equal(vite.name, "@voidzero-dev/vite-plus-core", "The Vite alias does not match");
  assert.equal(vite.version, alias.split("@").at(-1), "The Vite core differs from bundled Vite");
  console.log(`Vite+ ${vp.version}: verified a single Vitest / coverage ${bundled} resolution`);
};
const align = (): void => {
  pnpm("install", "--frozen-lockfile");
  const vp = manifest(require.resolve("vite-plus/package.json"));
  const bundled = vp.dependencies.vitest;
  const alias = vp.dependencies.vite;
  assert.ok(bundled !== undefined && alias !== undefined);
  assert.match(bundled, /^\d+\.\d+\.\d+$/u);
  assert.match(alias, /^npm:@voidzero-dev\/vite-plus-core@\d+\.\d+\.\d+$/u);
  const project = json("package.json");
  const dependencies = strings(project.devDependencies);
  const coverage = dependencies["@vitest/coverage-v8"];
  assert.ok(coverage !== undefined);
  assert.match(coverage, /^\d+(?:\.\d+\.\d+)?$/u);
  assert.equal(
    coverage.split(".")[0],
    bundled.split(".")[0],
    "Vite+ changed its bundled Vitest major; review compatibility before updating",
  );
  const original = unrelated();
  const workspace = parseDocument(readFileSync("pnpm-workspace.yaml", "utf8"));
  assert.equal(workspace.errors.length, 0);
  const overrides = workspace.get("overrides", true);
  assert.ok(isMap(overrides), "Workspace needs an overrides mapping");
  const values = strings(overrides.toJSON());
  for (const [name, version] of [
    ["vite", alias],
    ["vitest", bundled],
  ]) {
    assert.ok(name !== undefined && version !== undefined);
    const selectors = Object.keys(values).filter((key) => key === name || key === `${name}@*`);
    assert.ok(selectors.length <= 1, `Ambiguous ${name} overrides`);
    workspace.setIn(["overrides", selectors[0] ?? `${name}@*`], version);
  }
  if (coverage !== bundled) {
    writeFileSync(
      "package.json",
      `${JSON.stringify({ ...project, devDependencies: { ...dependencies, "@vitest/coverage-v8": bundled } }, null, 2)}\n`,
    );
  }
  writeFileSync("pnpm-workspace.yaml", workspace.toString());
  const directory = mkdtempSync(join(tmpdir(), "wallpaper-alignment-"));
  try {
    const state = join(directory, "state.json");
    writeFileSync(
      state,
      JSON.stringify({
        version: vp.version,
        bundled,
        declarations: readDeclarations(),
        unrelated: original,
      }),
    );
    pnpm("install", "--no-frozen-lockfile");
    pnpm("install", "--frozen-lockfile");
    // Verify in a fresh process after pnpm changes package symlinks.
    execFileSync(process.execPath, [import.meta.filename, "--verify-align", state], {
      stdio: "inherit",
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
};
const [mode, statePath] = process.argv.slice(2);
switch (mode) {
  case "--align": {
    align();
    break;
  }
  case "--verify-align": {
    assert.ok(statePath !== undefined);
    const state = json(statePath);
    const vp = manifest(require.resolve("vite-plus/package.json"));
    assert.equal(vp.version, state.version, "Synchronization must not update Vite+");
    assert.equal(
      vp.dependencies.vitest,
      state.bundled,
      "Bundled Vitest changed during synchronization",
    );
    assert.deepEqual(
      readDeclarations(),
      state.declarations,
      "pnpm changed dependency declarations",
    );
    assert.deepEqual(unrelated(), state.unrelated, "Unrelated dependency versions changed");
    verify();
    break;
  }
  case undefined: {
    verify();
    break;
  }
  default: {
    throw new Error(`Unknown toolchain mode: ${mode}`);
  }
}
