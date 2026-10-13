import { existsSync, readFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vite-plus/test";
import { parse } from "yaml";

const document = (path: string): Record<string, unknown> => {
  const data: unknown = parse(readFileSync(path, "utf8"));
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    throw new TypeError(`Expected a mapping: ${path}`);
  }
  return Object.fromEntries(Object.entries(data));
};

const mapping = (value: unknown): Record<string, unknown> => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Expected a mapping");
  }
  return Object.fromEntries(Object.entries(value));
};

const ci = document(".github/workflows/ci.yml");
const jobs = mapping(ci.jobs);

describe("CI acceptance policy", () => {
  it("pins Node and pnpm patches and keeps their lockfile under version control", () => {
    const tools = readFileSync("mise.toml", "utf8");
    expect(tools).toMatch(/^node = "24\.\d+\.\d+"$/mu);
    expect(tools).toMatch(/^pnpm = "12\.\d+\.\d+"$/mu);
    expect(existsSync("mise.lock")).toBe(true);
    expect(readFileSync(".gitignore", "utf8").split("\n")).not.toContain("mise.lock");
    expect(mapping(ci.env)).toStrictEqual({ MISE_LOCKED: "1" });
  });

  it("keeps runtime declarations synchronized and uses caret ranges except bundled coverage", () => {
    const manifest: unknown = JSON.parse(readFileSync("package.json", "utf8"));
    const tools = readFileSync("mise.toml", "utf8");
    const node = /^node = "(?<version>[^"]+)"$/mu.exec(tools)?.groups?.version;
    const pnpm = /^pnpm = "(?<version>[^"]+)"$/mu.exec(tools)?.groups?.version;
    expect(mapping(mapping(manifest).engines)).toStrictEqual({ node });
    expect(mapping(manifest).packageManager).toBe(`pnpm@${pnpm}`);
    expect(mapping(manifest).scripts).toBeUndefined();
    const dependencies = mapping(mapping(manifest).devDependencies);
    expect(dependencies["@vitest/coverage-v8"]).toMatch(/^\d+\.\d+\.\d+$/u);
    expect(
      Object.entries(dependencies).filter(([name]) => name !== "@vitest/coverage-v8"),
    ).toSatisfy((entries: [string, unknown][]) =>
      entries.every(([, value]) => typeof value === "string" && /^\^\d+\.\d+\.\d+$/u.test(value)),
    );
  });

  it("gates acceptance on every independent check even when one fails or is cancelled", () => {
    expect(Object.keys(jobs).toSorted()).toStrictEqual([
      "configuration",
      "dependency-artifacts",
      "native",
      "quality",
      "static",
      "tests",
    ]);
    const gate = mapping(jobs.quality);
    expect(gate.needs).toStrictEqual([
      "configuration",
      "static",
      "tests",
      "native",
      "dependency-artifacts",
    ]);
    expect(gate.if).toBe("always()");
    expect(mapping(ci.permissions)).toStrictEqual({ contents: "read" });
    expect(mapping(ci.on)).toHaveProperty("merge_group");
    for (const job of Object.values(jobs)) {
      expect(mapping(job).permissions).toBeUndefined();
      expect(mapping(job).continueOnError).toBeUndefined();
      expect(mapping(job)["continue-on-error"]).toBeUndefined();
    }
  });

  it("keeps CI tasks local, validates workflows, and verifies native artifacts", () => {
    const config = readFileSync("vite.config.ts", "utf8");
    expect(config).toContain("workflows:");
    expect(config).toContain('"configuration"');
    expect(config).toContain('"native"');
    const native = mapping(jobs.native);
    expect(native["runs-on"]).toBe("ubuntu-26.04");
    const text = JSON.stringify(native);
    expect(text).toContain("vp run native");
    expect(text).toContain('"if":"always()"');
    expect(text).toContain("artifacts/build-size.json");
    expect(text).toContain("artifacts/gjs-integration.json");
    expect(text).toContain("artifacts/*.zip");
    for (const job of ["configuration", "static", "tests", "native"]) {
      expect(JSON.stringify(jobs[job])).toContain("jdx/mise-action@");
      expect(JSON.stringify(jobs[job])).not.toContain("mise upgrade");
      expect(JSON.stringify(jobs[job])).toContain("mise install --locked");
      expect(JSON.stringify(jobs[job])).toContain("pnpm install --frozen-lockfile");
    }
  });

  it("pins every external action and reusable workflow to a complete SHA", () => {
    for (const name of readdirSync(".github/workflows").filter((file) => file.endsWith(".yml"))) {
      const path = `.github/workflows/${name}`;
      for (const job of Object.values(mapping(document(path).jobs))) {
        const { steps = [], uses: reusable } = mapping(job);
        if (!Array.isArray(steps)) {
          throw new TypeError("Expected workflow steps");
        }
        const references = [reusable, ...steps.map((step: unknown) => mapping(step).uses)].filter(
          (uses: unknown) => uses !== undefined,
        );
        for (const uses of references) {
          expect(uses).toMatch(
            /^[\w-]+\/[\w-]+(?:\/\.github\/workflows\/[\w.-]+\.yml)?@[a-f0-9]{40}$/u,
          );
        }
      }
    }
  });

  it("inherits shared policy and lets Vite+ select its coupled dependencies", () => {
    const config = document("renovate.json");
    expect(config.extends).toStrictEqual([
      "local>maya0513/renovate-config#0bfed18e17cdcff074edec7eaf386f998747819a",
      "local>maya0513/renovate-config//presets/mise-pnpm#0bfed18e17cdcff074edec7eaf386f998747819a",
      "local>maya0513/renovate-config//presets/vite-plus#0bfed18e17cdcff074edec7eaf386f998747819a",
    ]);
    expect(config.mise).toBeUndefined();
    expect(config.packageRules).toStrictEqual([
      {
        matchManagers: ["npm"],
        matchPackageNames: ["@types/node"],
        allowedVersions: ">=24.0.0 <25.0.0",
      },
    ]);
    for (const path of [
      ".github/dependabot.yml",
      ".github/workflows/dependabot-auto-merge.yml",
      ".github/workflows/update-tooling.yml",
      ".github/workflows/update-mise-lock.yml",
      ".github/workflows/update-vite-plus.yml",
      ".github/zizmor.yml",
    ]) {
      expect(existsSync(path)).toBe(false);
    }
  });

  it("uses mise-managed pnpm and fails on a mismatched executable", () => {
    expect(document("pnpm-workspace.yaml").pmOnFail).toBe("error");
    expect(readFileSync("scripts/toolchain.ts", "utf8")).toContain('"--pm-on-fail=error"');
    expect(readFileSync("scripts/toolchain.ts", "utf8")).not.toContain(
      "manage-package-manager-versions",
    );
  });

  it("reviews dependency vulnerabilities on every pull request", () => {
    const { steps } = mapping(jobs.configuration);
    if (!Array.isArray(steps)) {
      throw new TypeError("Expected configuration steps");
    }
    const review = steps
      .map((step: unknown) => mapping(step))
      .find(
        (step) =>
          typeof step.uses === "string" &&
          step.uses.startsWith("actions/dependency-review-action@"),
      );
    expect(review).toBeDefined();
    expect(review?.if).toBe("github.event_name == 'pull_request'");
    expect(mapping(review?.with)["fail-on-severity"]).toBe("moderate");
  });

  it("shares one artifact contract for verification and Renovate updates", () => {
    const updater = document(".github/workflows/update-dependencies.yml");
    expect(mapping(updater.on)).toStrictEqual({ push: { branches: ["renovate/**"] } });
    expect(mapping(updater.permissions)).toStrictEqual({ contents: "read" });
    const update = mapping(mapping(updater.jobs)["dependency-artifacts"]);
    const verify = mapping(jobs["dependency-artifacts"]);
    expect(update.uses).toBe(verify.uses);
    expect(update.uses).toMatch(
      /^maya0513\/renovate-config\/\.github\/workflows\/dependency-artifacts\.yml@[a-f0-9]{40}$/u,
    );
    expect(mapping(update.with)).toStrictEqual({
      ...mapping(verify.with),
      "verify-only": false,
      "app-client-id": `\${{ vars.DEPENDENCY_ARTIFACTS_APP_CLIENT_ID }}`,
    });
    expect(mapping(verify.with)).toStrictEqual({
      "verify-only": true,
      "sync-vite-plus": true,
      "sync-declarations": true,
      "lock-groups":
        '[{"lockfile":"mise.lock","tools":["node","pnpm"],"platforms":["linux-x64","linux-arm64"],"verify":"regenerate"}]',
    });
    expect(mapping(update.secrets)).toStrictEqual({
      "app-private-key": `\${{ secrets.DEPENDENCY_ARTIFACTS_APP_PRIVATE_KEY }}`,
    });
    expect(verify.secrets).toBeUndefined();
    expect(verify.if).toBeUndefined();
    expect(update.steps).toBeUndefined();
    expect(verify.steps).toBeUndefined();
    expect(mapping(mapping(ci.on).pull_request)).toStrictEqual({ branches: ["main"] });
    expect(JSON.stringify(jobs.static)).toContain("vp run toolchain");
  });
});

const successfulChecks = {
  configuration: { result: "success" },
  static: { result: "success" },
  tests: { result: "success" },
  native: { result: "success" },
  "dependency-artifacts": { result: "success" },
};

it.each([
  { name: "all successful checks", results: successfulChecks, status: 0 },
  { name: "no checks", results: {}, status: 1 },
  { name: "missing checks", results: { static: { result: "success" } }, status: 1 },
  ...Object.keys(successfulChecks).flatMap((check) =>
    ["failure", "cancelled", "skipped"].map((result) => ({
      name: `${check}: ${result}`,
      results: { ...successfulChecks, [check]: { result } },
      status: 1,
    })),
  ),
])("validates the final gate for $name", ({ results, status }) => {
  const { steps } = mapping(jobs.quality);
  if (!Array.isArray(steps)) {
    throw new TypeError("Expected acceptance steps");
  }
  const script = mapping(steps[0]).run;
  if (typeof script !== "string") {
    throw new TypeError("Expected acceptance script");
  }
  const processResult = spawnSync("bash", ["-c", script], {
    encoding: "utf8",
    env: {
      ...process.env,
      RESULTS: JSON.stringify(results),
      GITHUB_STEP_SUMMARY: "/dev/null",
    },
  });
  expect(processResult.status).toBe(status);
});
