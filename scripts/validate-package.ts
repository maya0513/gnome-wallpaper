import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const zip = resolve("artifacts/gnome-wallpaper@maya0513.github.io.zip");
const temp = await mkdtemp(join(tmpdir(), "wallpaper-zip-"));
try {
  const entries = execFileSync("unzip", ["-Z1", zip], { encoding: "utf8" }).trim().split("\n");
  assert.ok(
    entries.every(
      (name) => !name.includes("..") && !name.startsWith("/") && !/\.(?:ts|map)$/u.test(name),
    ),
  );
  for (const file of [
    "extension.js",
    "prefs.js",
    "metadata.json",
    "LICENSE",
    "schemas/gschemas.compiled",
    "schemas/org.gnome.shell.extensions.gnome-wallpaper.gschema.xml",
  ]) {
    assert.ok(entries.includes(file), file);
  }
  assert.ok(
    entries.every((file) =>
      /^(?:[^/]+\.js|metadata\.json|LICENSE|schemas\/(?:gschemas\.compiled|org\.gnome\.shell\.extensions\.gnome-wallpaper\.gschema\.xml)?)$/u.test(
        file,
      ),
    ),
    "Unexpected package contents",
  );
  execFileSync("unzip", ["-q", zip, "-d", temp]);
  const metadata: unknown = JSON.parse(await readFile(join(temp, "metadata.json"), "utf8"));
  assert.ok(
    metadata !== null &&
      typeof metadata === "object" &&
      "uuid" in metadata &&
      "shell-version" in metadata &&
      "session-modes" in metadata,
  );
  assert.equal(metadata.uuid, "gnome-wallpaper@maya0513.github.io");
  assert.deepEqual(metadata["shell-version"], ["50"]);
  assert.deepEqual(metadata["session-modes"], ["user", "unlock-dialog"]);
  const names = await readdir(temp);
  const sources = await Promise.all(
    names.filter((name) => name.endsWith(".js")).map((name) => readFile(join(temp, name), "utf8")),
  );
  const all = sources.join("\n");
  assert.ok(
    all.includes("gi://Gio") && all.includes("resource:///org/gnome/shell/extensions/extension.js"),
  );
  assert.ok(all.includes("resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js"));
  assert.ok(
    !/from\s*["'](?:node:|@girs\/|vite-plus)/u.test(all),
    "Development dependencies leaked into the package",
  );
  assert.ok(/export\s*\{[^}]*default/su.test(await readFile(join(temp, "extension.js"), "utf8")));
  execFileSync("glib-compile-schemas", ["--strict", "--dry-run", join(temp, "schemas")]);
  console.log(`Validated ${entries.length} ZIP entries and GJS ESM`);
} finally {
  await rm(temp, { recursive: true, force: true });
}
