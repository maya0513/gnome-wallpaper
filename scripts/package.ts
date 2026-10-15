import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import { cp, mkdir, rm, readFile, readdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";

const zip = resolve("artifacts/gnome-wallpaper@maya0513.github.io.zip");
await mkdir("artifacts", { recursive: true });
await cp("schemas", "dist/schemas", { recursive: true });
await Promise.all(["metadata.json", "LICENSE"].map((file) => cp(file, `dist/${file}`)));
const modulesFile = "dist/bundled-dependencies.json";
const paths: unknown = JSON.parse(await readFile(modulesFile, "utf8"));
assert.ok(Array.isArray(paths));
const directories: readonly unknown[] = paths;
const notices = await Promise.all(
  directories.map(async (path) => {
    assert.ok(typeof path === "string");
    const manifest: unknown = JSON.parse(await readFile(join(path, "package.json"), "utf8"));
    assert.ok(
      manifest !== null &&
        typeof manifest === "object" &&
        "name" in manifest &&
        "version" in manifest,
    );
    const names = await readdir(path);
    const license = names.find((name) => /^licen[cs]e(?:\..*)?$/iu.test(name));
    const file =
      license === undefined
        ? join(
            "licenses",
            `${String(manifest.name).replaceAll("/", "-")}-${String(manifest.version)}.txt`,
          )
        : join(path, license);
    return `${String(manifest.name)} ${String(manifest.version)}\n\n${await readFile(file, "utf8")}`;
  }),
);
await writeFile(
  "dist/THIRD_PARTY_LICENSES.txt",
  `Bundled dependency license notices\n\n${notices.join("\n\n-----\n\n")}\n`,
);
await rm(modulesFile);
execFileSync("glib-compile-schemas", ["--strict", "dist/schemas"], { stdio: "inherit" });
await rm(zip, { force: true });
execFileSync("zip", ["-q", "-r", zip, "."], { cwd: "dist", stdio: "inherit" });
console.log(zip);
