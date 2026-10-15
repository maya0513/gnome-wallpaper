import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve as absolute } from "node:path";
import { expect, it } from "vite-plus/test";
import { isolatedEnvironment } from "../scripts/gnome-environment";

it("isolates settings and files while keeping only the host sockets needed for Devkit", () => {
  const parent = {
    XDG_CONFIG_HOME: "/host/config",
    XDG_DATA_HOME: "/host/data",
    XDG_RUNTIME_DIR: "/host/runtime",
    WAYLAND_DISPLAY: "wayland-0",
    DISPLAY: ":0",
    DBUS_SESSION_BUS_ADDRESS: "host-bus",
    GSETTINGS_BACKEND: "dconf",
    GIO_USE_VFS: "gvfs",
    GSETTINGS_SCHEMA_DIR: "/host/schemas",
    DCONF_PROFILE: "/host/profile",
    GNOME_SHELL_SESSION_MODE: "ubuntu",
    PIPEWIRE_REMOTE: "pipewire-0",
    XDG_SESSION_ID: "2",
    PATH: "/usr/bin",
  };
  const nested = isolatedEnvironment("/test", parent, "nested");
  const headless = isolatedEnvironment("/test", parent, "headless");
  expect(nested).toMatchObject({
    XDG_CONFIG_HOME: "/test/config",
    XDG_DATA_HOME: "/test/data",
    XDG_RUNTIME_DIR: "/test/runtime",
    GSETTINGS_BACKEND: "keyfile",
    GIO_USE_VFS: "local",
    WAYLAND_DISPLAY: "/host/runtime/wayland-0",
    PIPEWIRE_REMOTE: "/host/runtime/pipewire-0",
    GNOME_SHELL_SESSION_MODE: "user",
    PATH: "/usr/bin",
  });
  expect(headless).not.toHaveProperty("WAYLAND_DISPLAY");
  expect(headless).not.toHaveProperty("DISPLAY");
  expect(headless).not.toHaveProperty("PIPEWIRE_REMOTE");
  expect(nested).not.toHaveProperty("DBUS_SESSION_BUS_ADDRESS");
  expect(nested).not.toHaveProperty("GSETTINGS_SCHEMA_DIR");
  expect(nested).not.toHaveProperty("DCONF_PROFILE");
  expect(nested).not.toHaveProperty("XDG_SESSION_ID");
  expect(parent.XDG_CONFIG_HOME).toBe("/host/config");
  expect(
    isolatedEnvironment("/test", { ...parent, WAYLAND_DISPLAY: "/other/socket" }, "nested")
      .WAYLAND_DISPLAY,
  ).toBe("/other/socket");
});

const fixtureProgram = `#!/usr/bin/env node
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
const tool = path.basename(process.argv[1]);
const args = process.argv.slice(2);
const state = path.join(process.env.FIXTURE_ROOT, 'state.json');
if (args.includes('--version') || args.includes('-v')) {
    console.log(tool === 'gnome-shell' ? 'GNOME Shell 50.1' : 'fixture');
} else if (tool === 'dbus-run-session') {
    const child = spawn(args[1], args.slice(2), {stdio: 'inherit', env: {...process.env, DBUS_SESSION_BUS_ADDRESS: 'private-fixture-bus'}});
    child.on('close', code => process.exit(code ?? 1));
    process.on('SIGTERM', () => {});
} else if (tool === 'gnome-shell') {
    const child = spawn(process.execPath, ['-e', 'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000)'], {stdio: 'ignore'});
    fs.writeFileSync(state, JSON.stringify({pid: process.pid, child: child.pid, config: process.env.XDG_CONFIG_HOME, data: process.env.XDG_DATA_HOME, runtime: process.env.XDG_RUNTIME_DIR, bus: process.env.DBUS_SESSION_BUS_ADDRESS}));
    process.on('SIGTERM', () => {});
    setInterval(() => {}, 1000);
} else if (tool === 'gjs' && args[4] === 'GetExtensionInfo') {
    console.log(JSON.stringify([fs.existsSync(state) ? {state: process.env.FIXTURE_FAIL === '1' ? 3 : 1, error: 'fixture load failure', path: path.join(process.env.XDG_DATA_HOME, 'gnome-shell/extensions/gnome-wallpaper@maya0513.github.io')} : {}]));
} else if (tool === 'gjs' && args[4] === 'Eval') {
    console.log(JSON.stringify([true, JSON.stringify({light: '', dark: '', loaded: false, labels: ['No image yet', 'Bing', 'Updating…']})]));
}
`;

const record = (value: unknown): Record<string, unknown> => {
  assert.ok(value !== null && typeof value === "object" && !Array.isArray(value));
  return Object.fromEntries(Object.entries(value));
};
const json = async (path: string): Promise<Record<string, unknown>> => {
  const value: unknown = JSON.parse(await readFile(path, "utf8"));
  return record(value);
};
const running = async (pid: number): Promise<boolean> => {
  try {
    const stat = await readFile(`/proc/${pid}/stat`, "utf8");
    return !stat.slice(stat.lastIndexOf(")") + 2).startsWith("Z");
  } catch {
    return false;
  }
};

it.each(["load failure", "interruption"])(
  "cleans private files and stubborn descendants after %s",
  async (scenario) => {
    const root = await mkdtemp(join(tmpdir(), "gnome-runner-fixture-"));
    const bin = join(root, "bin");
    await mkdir(bin);
    await Promise.all(
      ["gnome-shell", "dbus-run-session", "gsettings", "unzip", "gjs", "fusermount3"].map(
        async (name) => {
          const path = join(bin, name);
          await writeFile(path, fixtureProgram);
          await chmod(path, 0o755);
        },
      ),
    );
    // Child CLI fixtures use native ESM without changing the repository's package.
    await writeFile(join(root, "package.json"), '{"type":"module"}');
    const child = spawn(process.execPath, [absolute("scripts/test-gnome.ts"), "headless"], {
      cwd: root,
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        FIXTURE_ROOT: root,
        FIXTURE_FAIL: scenario === "load failure" ? "1" : "0",
        GNOME_WALLPAPER_TEST_SOURCE: "nasa-iotd",
      },
      stdio: "pipe",
    });
    let stderr = "";
    child.stdout.resume();
    child.stderr.on("data", (bytes: Buffer) => {
      stderr += bytes.toString();
    });
    const exit = new Promise<number | null>((resolve, reject) => {
      child.on("error", reject);
      child.on("close", resolve);
    });
    try {
      await expect
        .poll(
          async () => {
            try {
              await readFile(join(root, "state.json"));
              return true;
            } catch {
              return false;
            }
          },
          { timeout: 8000 },
        )
        .toBe(true);
      const state = await json(join(root, "state.json"));
      expect(state.bus).toBe("private-fixture-bus");
      expect(state.config).not.toBe(process.env.XDG_CONFIG_HOME);
      expect(state.runtime).toBeTypeOf("string");
      if (scenario === "interruption") {
        child.kill("SIGINT");
      }
      await expect(exit).resolves.toBe(scenario === "interruption" ? 130 : 1);
      expect(stderr).toContain(
        scenario === "interruption" ? "Interrupted" : "fixture load failure",
      );
      const runs = await readdir(join(root, "artifacts/gnome/headless"));
      const result = await json(
        join(root, "artifacts/gnome/headless", String(runs[0]), "result.json"),
      );
      expect(result.ok).toBe(false);
      expect(result.source).toBe("nasa-iotd");
      expect(result.error).toContain(
        scenario === "interruption" ? "Interrupted" : "fixture load failure",
      );
      await expect(running(Number(state.pid))).resolves.toBe(false);
      await expect(running(Number(state.child))).resolves.toBe(false);
      await expect(readdir(String(state.config))).rejects.toThrow("ENOENT");
      await expect(readdir(String(state.runtime))).rejects.toThrow("ENOENT");
      await expect(readdir(String(state.data))).rejects.toThrow("ENOENT");
    } finally {
      child.kill("SIGKILL");
      await rm(root, { recursive: true, force: true });
    }
  },
  15_000,
);
