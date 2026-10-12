import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { access, chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = ".cache/ci-tools";
const headers =
  process.env.GH_TOKEN === undefined ? {} : { Authorization: `Bearer ${process.env.GH_TOKEN}` };
const request = async (url: string, authenticated: boolean): Promise<Response> => {
  const response = await fetch(url, {
    headers: authenticated ? headers : {},
    signal: AbortSignal.timeout(60_000),
  });
  assert.ok(response.ok, `Cannot fetch ${url}: HTTP ${response.status}`);
  return response;
};
const install = async (repository: string, name: string, major: string): Promise<void> => {
  const path = join(directory, name);
  try {
    await access(path);
    const version = execFileSync(path, ["--version"], { encoding: "utf8" });
    assert.match(version, new RegExp(`(?:^|version: |zizmor )${RegExp.escape(major)}\\.`, "mu"));
    return;
  } catch (error) {
    // A missing binary is installed; an invalid cached binary must fail verification.
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") {
      throw error;
    }
  }
  assert.equal(process.platform, "linux", "Workflow tools require Linux");
  assert.ok(process.arch === "x64" || process.arch === "arm64");
  const release = await request(`https://api.github.com/repos/${repository}/releases/latest`, true);
  const metadata: unknown = await release.json();
  assert.ok(
    metadata !== null &&
      typeof metadata === "object" &&
      "tag_name" in metadata &&
      "assets" in metadata,
  );
  assert.equal(typeof metadata.tag_name, "string");
  const tag = String(metadata.tag_name);
  assert.match(tag, new RegExp(`^v${RegExp.escape(major)}\\.\\d+\\.\\d+$`, "u"));
  assert.ok(Array.isArray(metadata.assets));
  const architecture = process.arch === "x64" ? "amd64" : "arm64";
  const linuxArchitecture = process.arch === "x64" ? "x86_64" : "aarch64";
  const assetName =
    name === "actionlint"
      ? `actionlint_${tag.slice(1)}_linux_${architecture}.tar.gz`
      : name === "shellcheck"
        ? `shellcheck-${tag}.linux.${linuxArchitecture}.tar.gz`
        : `zizmor-${linuxArchitecture}-unknown-linux-gnu.tar.gz`;
  const asset: unknown = metadata.assets.find(
    (candidate: unknown) =>
      candidate !== null &&
      typeof candidate === "object" &&
      "name" in candidate &&
      candidate.name === assetName,
  );
  assert.ok(
    asset !== null &&
      typeof asset === "object" &&
      "digest" in asset &&
      "browser_download_url" in asset,
  );
  assert.equal(typeof asset.digest, "string");
  assert.equal(typeof asset.browser_download_url, "string");
  const url = String(asset.browser_download_url);
  assert.equal(url, `https://github.com/${repository}/releases/download/${tag}/${assetName}`);
  const download = await request(url, false);
  const bytes = new Uint8Array(await download.arrayBuffer());
  assert.equal(
    `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
    asset.digest,
    "Release checksum mismatch",
  );
  const temp = await mkdtemp(join(tmpdir(), "wallpaper-ci-tools-"));
  try {
    const archive = join(temp, "tool.tar.gz");
    await writeFile(archive, bytes);
    const entry = name === "shellcheck" ? `shellcheck-${tag}/${name}` : name;
    execFileSync("tar", ["-xzf", archive, "-C", temp, entry]);
    await writeFile(path, await readFile(join(temp, entry)));
    await chmod(path, 0o755);
    console.log(`Installed ${name} ${tag} with verified SHA-256`);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
};
await mkdir(directory, { recursive: true });
await Promise.all([
  install("rhysd/actionlint", "actionlint", "1"),
  install("koalaman/shellcheck", "shellcheck", "0"),
  install("zizmorcore/zizmor", "zizmor", "1"),
]);
