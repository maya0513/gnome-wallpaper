import { spawnSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vite-plus/test";

const runToolchain = (options: Record<string, boolean> = {}) => {
  const directory = mkdtempSync(join(tmpdir(), "wallpaper-toolchain-"));
  try {
    mkdirSync(join(directory, "scripts"));
    mkdirSync(join(directory, "node_modules"));
    symlinkSync(realpathSync("node_modules/yaml"), join(directory, "node_modules/yaml"));
    cpSync("scripts/toolchain.ts", join(directory, "scripts/toolchain.ts"));
    writeFileSync(
      join(directory, "package.json"),
      JSON.stringify({
        name: "fixture",
        version: "1.0.0",
        type: "module",
        devDependencies: {
          "@vitest/coverage-v8": options.stale === true ? "5.0.0" : "5.0.1",
          other: "^1.0.0",
        },
      }),
    );
    const workspace = `# Preserve this comment\noverrides:\n  vite: npm:@voidzero-dev/vite-plus-core@${options.stale === true ? "1.0.0" : "1.0.1"}\n  vitest: ${options.stale === true ? "5.0.0" : "5.0.1"}\n  other: ^1.0.0\n`;
    writeFileSync(join(directory, "pnpm-workspace.yaml"), workspace);
    const lock = `lockfileVersion: '9.0'\n${options.documents === true ? "overrides:\n  vitest@*: 5.0.9\n---\n" : ""}packages:\n  vitest@5.0.1: {}\n${options.duplicate === true ? "  vitest@5.0.2: {}\n" : ""}snapshots:\n  vitest@5.0.1: {}\n`;
    writeFileSync(join(directory, "pnpm-lock.yaml"), lock);
    const packageFile = (name: string, value: unknown): void => {
      const path = join(directory, "node_modules", name);
      mkdirSync(path, { recursive: true });
      writeFileSync(join(path, "package.json"), JSON.stringify(value));
    };
    packageFile("vite-plus", {
      name: "vite-plus",
      version: "1.0.0",
      dependencies: {
        vitest: options.major === true ? "6.0.0" : "5.0.1",
        vite: "npm:@voidzero-dev/vite-plus-core@1.0.1",
      },
    });
    packageFile("vitest", { name: "vitest", version: "5.0.1" });
    packageFile("@vitest/coverage-v8", {
      name: "@vitest/coverage-v8",
      version: options.mismatch === true ? "5.0.2" : "5.0.1",
    });
    packageFile("vite", {
      name: options.alias === true ? "vite" : "@voidzero-dev/vite-plus-core",
      version: options.core === true ? "1.0.0" : "1.0.1",
    });
    packageFile("other", {
      name: "other",
      version: "1.0.0",
      dependencies: { transitive: "1.0.0" },
    });
    packageFile("transitive", { name: "transitive", version: "1.0.0" });
    if (options.exports === true) {
      packageFile("other", {
        name: "other",
        version: "1.0.0",
        exports: { ".": "./index.js" },
        dependencies: { transitive: "1.0.0" },
      });
      writeFileSync(join(directory, "node_modules/other/index.js"), "export {};\n");
    }
    if (options.instances === true) {
      mkdirSync(join(directory, "node_modules/@vitest/coverage-v8/node_modules/vitest"), {
        recursive: true,
      });
      writeFileSync(
        join(directory, "node_modules/@vitest/coverage-v8/node_modules/vitest/package.json"),
        '{"name":"vitest","version":"5.0.1"}',
      );
    }
    writeFileSync(join(directory, "calls.jsonl"), "");
    const pnpm = join(directory, "pnpm");
    writeFileSync(
      pnpm,
      `#!/usr/bin/env node
import fs from 'node:fs';
const args = process.argv.slice(2);
fs.appendFileSync('calls.jsonl', JSON.stringify(args) + '\\n');
if (${options.failed === true}) process.exit(1);
if (args.includes('--no-frozen-lockfile')) {
  if (${options.unrelated === true}) fs.writeFileSync('node_modules/transitive/package.json', '{"name":"transitive","version":"1.0.1"}');
  if (${options.declarations === true}) fs.writeFileSync('pnpm-workspace.yaml', 'overrides: {}');
  if (${options.runner === true}) fs.writeFileSync('node_modules/vite-plus/package.json', '{"name":"vite-plus","version":"1.0.1","dependencies":{"vitest":"5.0.1","vite":"npm:@voidzero-dev/vite-plus-core@1.0.1"}}');
}
`,
    );
    chmodSync(pnpm, 0o755);
    const result = spawnSync(
      process.execPath,
      [join(directory, "scripts/toolchain.ts"), ...(options.align === true ? ["--align"] : [])],
      {
        cwd: directory,
        encoding: "utf8",
        timeout: 10_000,
        env: { ...process.env, PATH: `${directory}:${process.env.PATH}` },
      },
    );
    return {
      status: result.status,
      output: result.stdout + result.stderr,
      calls: readFileSync(join(directory, "calls.jsonl"), "utf8"),
      project: JSON.parse(readFileSync(join(directory, "package.json"), "utf8")) as unknown,
      workspace: readFileSync(join(directory, "pnpm-workspace.yaml"), "utf8"),
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
};

it("verifies exact declarations and a single coherent graph without modifying dependencies", () => {
  const result = runToolchain();
  expect(result.status).toBe(0);
  expect(result.output).toContain("verified a single Vitest / coverage 5.0.1 resolution");
  expect(result.calls).toBe("");
  expect(result.workspace).toContain("# Preserve this comment");
});

it("reads the final graph document without treating override selectors as resolved packages", () => {
  expect(runToolchain({ documents: true }).status).toBe(0);
});

it("aligns dependencies whose exports hide package.json", () => {
  const result = runToolchain({ align: true, exports: true });
  expect(result.status).toBe(0);
  expect(result.output).toContain("verified a single Vitest / coverage 5.0.1 resolution");
});

it("aligns exact declarations and overrides while retaining unrelated settings", () => {
  const result = runToolchain({ align: true, stale: true });
  expect(result.status).toBe(0);
  expect(result.project).toMatchObject({
    devDependencies: { "@vitest/coverage-v8": "5.0.1", other: "^1.0.0" },
  });
  expect(result.workspace).toContain("# Preserve this comment");
  expect(result.workspace).toContain("npm:@voidzero-dev/vite-plus-core@1.0.1");
  expect(result.workspace).toContain("vitest: 5.0.1");
  expect(result.workspace).toContain("other: ^1.0.0");
  const calls = result.calls
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as unknown);
  expect(calls).toStrictEqual([
    ["install", "--frozen-lockfile", "--ignore-scripts", "--ignore-pnpmfile", "--pm-on-fail=error"],
    [
      "install",
      "--no-frozen-lockfile",
      "--ignore-scripts",
      "--ignore-pnpmfile",
      "--pm-on-fail=error",
    ],
    ["install", "--frozen-lockfile", "--ignore-scripts", "--ignore-pnpmfile", "--pm-on-fail=error"],
  ]);
});

it.each([
  { options: { major: true }, message: "changed its bundled Vitest major" },
  { options: { duplicate: true }, message: "lockfile must resolve a single Vitest version" },
  { options: { mismatch: true }, message: "Coverage and Vitest differ" },
  { options: { alias: true }, message: "Vite alias does not match" },
  { options: { core: true }, message: "Vite core differs from bundled Vite" },
  { options: { instances: true }, message: "Multiple Vitest instances" },
  { options: { stale: true }, message: "Coverage declaration differs" },
  { options: { align: true, mismatch: true }, message: "Coverage and Vitest differ" },
  { options: { align: true, failed: true }, message: "Command failed: pnpm install" },
  { options: { align: true, unrelated: true }, message: "Unrelated dependency versions changed" },
  { options: { align: true, declarations: true }, message: "pnpm changed dependency declarations" },
  { options: { align: true, runner: true }, message: "Synchronization must not update Vite+" },
])(
  "rejects incompatible graphs and unintended synchronization changes: %j",
  ({ options, message }) => {
    const result = runToolchain(options);
    expect(result.status).toBe(1);
    expect(result.output).toContain(message);
  },
);
