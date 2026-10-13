import assert from "node:assert/strict";
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
const stepList = (value: unknown): Record<string, unknown>[] => {
  const items = mapping(value).steps;
  if (!Array.isArray(items)) {
    throw new TypeError("Expected steps");
  }
  return items.map((item: unknown) => mapping(item));
};
const updater = document(".github/workflows/update-dependencies.yml");
const references = (value: unknown): string[] => {
  const { uses, steps: items = [] } = mapping(value);
  if (!Array.isArray(items)) {
    throw new TypeError("Expected steps");
  }
  return [uses, ...items.map((step: unknown) => mapping(step).uses)].flatMap((reference) =>
    typeof reference === "string" ? [reference] : [],
  );
};

const checkDependencyAutomation = (
  check: Record<string, unknown>,
  update: Record<string, unknown>,
): void => {
  const verify = mapping(mapping(check.jobs)["dependency-artifacts"]);
  const prepare = mapping(mapping(update.jobs).prepare);
  const publish = mapping(mapping(update.jobs).publish);
  const prefix = "maya0513/renovate-config/.github/";
  const names = ["mise-pnpm", "pnpm-viteplus", "pnpm-outputs"];
  const components = (job: Record<string, unknown>) =>
    stepList(job).filter((step) => typeof step.uses === "string" && step.uses.startsWith(prefix));
  const [, revision] = String(components(verify)[0]?.uses).split("@");
  assert.match(revision ?? "", /^[a-f0-9]{40}$/u, "Shared components require a full SHA");
  for (const [job, mode] of [
    [verify, "true"],
    [prepare, "false"],
  ] as const) {
    assert.equal(job.secrets, undefined, "Preparation must not receive secrets");
    assert.doesNotMatch(
      JSON.stringify(job),
      /secrets\./u,
      "Preparation must not reference secrets",
    );
    assert.equal(job.permissions, undefined, "Preparation inherits read-only permissions");
    const selected = components(job);
    assert.deepEqual(
      selected.map((step) => step.uses),
      names.map((name) => `${prefix}actions/${name}@${revision}`),
      "Shared component order and SHA must match",
    );
    assert.deepEqual(
      selected.map((step) => step.id),
      ["mise", "viteplus", "outputs"],
      "Component IDs must connect",
    );
    assert.equal(mapping(selected[0]?.with)["verify-only"], mode, "Wrong verification mode");
    assert.deepEqual(
      JSON.parse(String(mapping(selected[0]?.with)["lock-groups"])),
      [
        {
          lockfile: "mise.lock",
          tools: ["actionlint", "node", "pnpm", "shellcheck", "zizmor"],
          platforms: ["linux-x64", "linux-arm64"],
          verify: "regenerate",
        },
      ],
      "Lock groups must cover all tools and platforms identically",
    );
    assert.deepEqual(
      selected[1]?.with,
      {
        "preparation-state": `\${{ steps.mise.outputs.state }}`,
      },
      "Vite+ preparation state must connect",
    );
    assert.deepEqual(
      selected[2]?.with,
      {
        "mise-state": `\${{ steps.mise.outputs.state }}`,
        "viteplus-state": `\${{ steps.viteplus.outputs.state }}`,
      },
      "Final validation states must connect",
    );
  }
  assert.deepEqual(check.permissions, { contents: "read" }, "CI must remain read-only");
  assert.deepEqual(update.permissions, { contents: "read" }, "Updates must remain read-only");
  assert.equal(verify.if, undefined, "Verification must run for every CI event");
  assert.equal(
    prepare.if,
    "github.event_name == 'push' && github.event.sender.id == 29139614 && startsWith(github.ref, 'refs/heads/renovate/')",
    "Updates require a Mend Renovate branch push",
  );
  assert.deepEqual(
    prepare.outputs,
    {
      base: `\${{ steps.outputs.outputs.base }}`,
      changed: `\${{ steps.outputs.outputs.changed }}`,
      "artifact-id": `\${{ steps.outputs.outputs.artifact-id }}`,
    },
    "Preparation outputs must connect",
  );
  assert.equal(publish.needs, "prepare", "Publish must depend on preparation");
  assert.equal(
    publish.uses,
    `${prefix}workflows/publish-pnpm-artifacts.yml@${revision}`,
    "Publisher SHA must match",
  );
  assert.deepEqual(
    publish.with,
    {
      base: `\${{ needs.prepare.outputs.base }}`,
      changed: `\${{ needs.prepare.outputs.changed }}`,
      "artifact-id": `\${{ needs.prepare.outputs.artifact-id }}`,
      mise: true,
      viteplus: true,
      "app-client-id": `\${{ vars.DEPENDENCY_ARTIFACTS_APP_CLIENT_ID }}`,
    },
    "Publishing outputs and component permissions must match",
  );
  assert.deepEqual(
    publish.secrets,
    {
      "app-private-key": `\${{ secrets.DEPENDENCY_ARTIFACTS_APP_PRIVATE_KEY }}`,
    },
    "Only publishing receives App credentials",
  );
};

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
      const jobSteps = stepList(jobs[job]);
      expect(jobSteps[0]?.uses).toMatch(/^actions\/checkout@[a-f0-9]{40}$/u);
      expect(mapping(jobSteps[0]?.with)["persist-credentials"]).toBe(false);
      expect(JSON.stringify(jobs[job])).toContain("jdx/mise-action@");
      expect(JSON.stringify(jobs[job])).toContain("mise install --locked node pnpm");
      expect(JSON.stringify(jobs[job])).toContain(
        "mise exec node pnpm -- pnpm install --frozen-lockfile",
      );
      expect(JSON.stringify(jobs[job])).not.toContain("mise upgrade");
    }
  });

  it("pins every external action and reusable workflow to a complete SHA", () => {
    const workflowJobs = readdirSync(".github/workflows")
      .filter((file) => /\.ya?ml$/u.test(file))
      .flatMap((file) => Object.values(mapping(document(`.github/workflows/${file}`).jobs)));
    for (const reference of workflowJobs.flatMap((value) => references(value))) {
      expect(reference).toMatch(/^[\w-]+\/[\w-]+(?:\/[\w.-]+)*@[a-f0-9]{40}$/u);
    }
  });

  it("locks audit tools in mise and installs them only for configuration tasks", () => {
    const tools = readFileSync("mise.toml", "utf8");
    const lock = readFileSync("mise.lock", "utf8");
    for (const name of ["actionlint", "shellcheck", "zizmor"]) {
      const declaration = new RegExp(`^${name} = "(?<version>\\d+\\.\\d+\\.\\d+)"$`, "mu").exec(
        tools,
      );
      expect(declaration?.groups?.version).toBeDefined();
      expect(lock).toContain(`[[tools.${name}]]\nversion = "${declaration?.groups?.version}"`);
    }
    const config = readFileSync("vite.config.ts", "utf8");
    expect(config).toContain('"ci-tools": "mise install --locked actionlint shellcheck zizmor"');
    expect(config).toContain("mise exec -- actionlint -shellcheck=shellcheck");
    expect(config).toContain(
      "mise exec -- zizmor --pedantic --offline --strict-collection .github/workflows",
    );
    expect(config).toContain('dependsOn: ["ci-tools"]');
    expect(existsSync("scripts/install-ci-tools.ts")).toBe(false);
    expect(existsSync("scripts/check-actions.ts")).toBe(false);
    expect(existsSync(".github/actions")).toBe(false);
  });

  it("inherits shared policy and lets Vite+ select its coupled dependencies", () => {
    const config = document("renovate.json");
    expect(config.extends).toStrictEqual([
      "local>maya0513/renovate-config",
      "local>maya0513/renovate-config//presets/mise-pnpm",
      "local>maya0513/renovate-config//presets/viteplus",
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

  it("connects read-only verification and Renovate preparation to a separate publisher", () => {
    expect(() => {
      checkDependencyAutomation(ci, updater);
    }).not.toThrow();
    expect(mapping(updater.on)).toStrictEqual({ push: { branches: ["renovate/**"] } });
    expect(mapping(mapping(updater.jobs).prepare).concurrency).toStrictEqual({
      group: `dependency-artifacts-\${{ github.ref }}`,
      "cancel-in-progress": true,
    });
  });

  const [, revision] = String(stepList(jobs["dependency-artifacts"])[2]?.uses).split("@");

  it.each([
    {
      name: "missing component",
      target: "ci",
      before: "actions/pnpm-viteplus@",
      after: "actions/other@",
      error: "component order and SHA",
    },
    {
      name: "mixed SHA",
      target: "ci",
      before: `pnpm-viteplus@${revision}`,
      after: `pnpm-viteplus@${"a".repeat(40)}`,
      error: "component order and SHA",
    },
    {
      name: "unpinned SHA",
      target: "ci",
      before: `mise-pnpm@${revision}`,
      after: "mise-pnpm@main",
      error: "full SHA",
    },
    {
      name: "wrong state",
      target: "ci",
      before: "steps.mise.outputs.state",
      after: "steps.other.outputs.state",
      error: "preparation state",
    },
    {
      name: "missing final state",
      target: "ci",
      before: "viteplus-state:",
      after: "missing-state:",
      error: "Final validation states",
    },
    {
      name: "wrong update mode",
      target: "update",
      before: 'verify-only: "false"',
      after: 'verify-only: "true"',
      error: "verification mode",
    },
    {
      name: "wrong verification mode",
      target: "ci",
      before: 'verify-only: "true"',
      after: 'verify-only: "false"',
      error: "verification mode",
    },
    {
      name: "different platforms",
      target: "update",
      before: '["linux-x64","linux-arm64"]',
      after: '["linux-x64"]',
      error: "Lock groups",
    },
    {
      name: "omitted tool in both callers",
      target: "both",
      before: ',"shellcheck"',
      after: "",
      error: "Lock groups",
    },
    {
      name: "verification secret",
      target: "ci",
      before: 'MISE_SAFE: "1"',
      after: `TOKEN: \${{ secrets.PRIVATE_KEY }}`,
      error: "reference secrets",
    },
    {
      name: "preparation secret",
      target: "update",
      before: 'MISE_SAFE: "1"',
      after: `TOKEN: \${{ secrets.PRIVATE_KEY }}`,
      error: "reference secrets",
    },
    {
      name: "inherited preparation secrets",
      target: "update",
      before: '    env:\n      MISE_SAFE: "1"',
      after: '    secrets: inherit\n    env:\n      MISE_SAFE: "1"',
      error: "receive secrets",
    },
    {
      name: "wrong sender",
      target: "update",
      before: "github.event.sender.id == 29139614",
      after: "true",
      error: "Mend Renovate",
    },
    {
      name: "wrong preparation output",
      target: "update",
      before: `base: \${{ steps.outputs.outputs.base }}`,
      after: "base: wrong",
      error: "Preparation outputs",
    },
    {
      name: "wrong publishing dependency",
      target: "update",
      before: "needs: prepare",
      after: "needs: other",
      error: "depend on preparation",
    },
    {
      name: "wrong publishing artifact",
      target: "update",
      before: `artifact-id: \${{ needs.prepare.outputs.artifact-id }}`,
      after: "artifact-id: wrong",
      error: "Publishing outputs",
    },
    {
      name: "wrong publishing permission",
      target: "update",
      before: "viteplus: true",
      after: "viteplus: false",
      error: "component permissions",
    },
  ])("rejects $name", ({ target, before, after, error }) => {
    const checkText = readFileSync(".github/workflows/ci.yml", "utf8");
    const updateText = readFileSync(".github/workflows/update-dependencies.yml", "utf8");
    const change = (text: string): Record<string, unknown> => {
      expect(text).toContain(before);
      const parsed: unknown = parse(text.replace(before, after));
      return mapping(parsed);
    };
    const check = target === "update" ? structuredClone(ci) : change(checkText);
    const update = target === "ci" ? structuredClone(updater) : change(updateText);
    expect(() => {
      checkDependencyAutomation(check, update);
    }).toThrow(error);
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
