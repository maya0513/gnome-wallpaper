import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { once } from "node:events";

const requests: (string | undefined)[] = [];
const server = createServer((request, response) => {
  requests.push(request.url);
  if (request.url === "/archive") {
    response.end(
      JSON.stringify({
        images: [
          {
            fullstartdate: "20261006000000",
            urlbase: "/th?id=OHR.Test",
            url: "/th?id=OHR.Test_1920x1080.jpg",
            title: "Autumn mountains",
            copyright: "© Test",
            copyrightlink: "https://www.bing.com/search",
          },
        ],
      }),
    );
  } else if (request.url === "/image") {
    response.end(Buffer.from([255, 216, 255, 217]));
  } else if (request.url === "/invalid") {
    response.end("{");
  } else if (request.url === "/slow") {
    const timer = setTimeout(() => response.end("late"), 5000);
    response.on("close", () => {
      clearTimeout(timer);
    });
  } else {
    response.writeHead(request.url === "/uhd" ? 404 : 500);
    response.end("error");
  }
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
const temp = await mkdtemp(join(tmpdir(), "wallpaper-gjs-"));
try {
  const address = server.address();
  assert.ok(address !== null && typeof address !== "string");
  const child = spawn(
    "gjs",
    ["-m", ".cache/gjs/test.js", `http://127.0.0.1:${address.port}`, temp],
    {
      env: {
        ...process.env,
        GSETTINGS_BACKEND: "memory",
        GSETTINGS_SCHEMA_DIR: resolve("dist/schemas"),
        XDG_DATA_HOME: temp,
      },
      timeout: 30_000,
    },
  );
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (bytes) => {
    stdout += bytes;
  });
  child.stderr.on("data", (bytes) => {
    stderr += bytes;
  });
  const completion: unknown[] = await once(child, "close");
  const code: unknown = completion[0];
  const report = { code, stdout, stderr, requests };
  await writeFile("artifacts/gjs-integration.json", JSON.stringify(report, null, 2));
  assert.equal(code, 0, stderr);
  const result: unknown = JSON.parse(stdout.trim());
  assert.ok(result !== null && typeof result === "object" && "ok" in result);
  assert.equal(result.ok, true);
  assert.equal(requests.filter((url) => url === "/archive").length, 2);
  assert.equal(requests.filter((url) => url === "/uhd").length, 1);
  assert.equal(requests.filter((url) => url === "/image").length, 1);
  const stored = await readdir(join(temp, "images"));
  assert.equal(stored.length, 3, "Unexpected temporary files");
  console.log(
    "Real GJS: verified Soup, asynchronous atomic storage, memory GSettings, cancellation, and conditional restoration",
  );
} finally {
  server.closeAllConnections();
  server.close();
  await rm(temp, { recursive: true, force: true });
}
