import { execFileSync } from "node:child_process";
import { cp, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";

const zip = resolve("artifacts/gnome-wallpaper@maya0513.github.io.zip");
await mkdir("artifacts", { recursive: true });
await cp("schemas", "dist/schemas", { recursive: true });
await Promise.all(["metadata.json", "LICENSE"].map((file) => cp(file, `dist/${file}`)));
execFileSync("glib-compile-schemas", ["--strict", "dist/schemas"], { stdio: "inherit" });
await rm(zip, { force: true });
execFileSync("zip", ["-q", "-r", zip, "."], { cwd: "dist", stdio: "inherit" });
console.log(zip);
