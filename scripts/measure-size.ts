import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

const files = await readdir("dist", { recursive: true });
const groups = await Promise.all(
  files.toSorted().map(async (name) => {
    const path = join("dist", name);
    const information = await stat(path);
    if (!information.isFile()) {
      return [];
    }
    const bytes = await readFile(path);
    return [{ path: name, bytes: bytes.byteLength, gzipBytes: gzipSync(bytes).byteLength }];
  }),
);
const measurements = groups.flat();
const sum = (entries: typeof measurements): number =>
  entries.reduce((total, file) => total + file.bytes, 0);
const archive = await stat("artifacts/gnome-wallpaper@maya0513.github.io.zip");
const report = {
  unit: "bytes",
  minified: false,
  javascriptBytes: sum(measurements.filter((file) => file.path.endsWith(".js"))),
  unpackedBytes: sum(measurements),
  zipBytes: archive.size,
  files: measurements,
};
await writeFile("artifacts/build-size.json", `${JSON.stringify(report, null, 2)}\n`);
console.table(measurements);
console.log(
  `JavaScript: ${report.javascriptBytes} B; unpacked: ${report.unpackedBytes} B; ZIP: ${report.zipBytes} B`,
);
