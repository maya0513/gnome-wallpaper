import assert from "node:assert/strict";
import * as ChildProcesses from "node:child_process";
import { constants, createWriteStream } from "node:fs";
import { access, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve as absolute } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";

import { prepareSelfFixture, verifySelfFixture } from "./self-fixture.ts";
import {
  cleanupEnvironment,
  createEnvironmentRoot,
  isolatedEnvironment,
  stopGroup,
} from "./gnome-environment.ts";

const execute = promisify(ChildProcesses.execFile);
const uuid = "gnome-wallpaper@maya0513.github.io";
const script = import.meta.filename;
const startupTimeout = 30_000;
const smokeTimeout = 120_000;

export type Mode = "nested" | "headless";
interface Check {
  name: string;
  ok: boolean;
  detail?: unknown;
}
interface Report {
  ok: boolean;
  mode: Mode;
  source: "bing" | "nasa-iotd" | "self";
  startedAt: string;
  finishedAt?: string;
  checks: Check[];
  screenshots: string[];
  log: string;
  image?: string;
  error?: string;
}

const message = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);
const mapping = (value: unknown): Record<string, unknown> => {
  assert.ok(value !== null && typeof value === "object" && !Array.isArray(value));
  return Object.fromEntries(Object.entries(value));
};

const validateReport = (input: unknown): input is Report => {
  const item = mapping(input);
  return (
    typeof item.ok === "boolean" &&
    (item.mode === "nested" || item.mode === "headless") &&
    (item.source === "bing" || item.source === "nasa-iotd" || item.source === "self") &&
    typeof item.startedAt === "string" &&
    typeof item.log === "string" &&
    Array.isArray(item.checks) &&
    item.checks.every((check: unknown) => {
      const record = mapping(check);
      return typeof record.name === "string" && typeof record.ok === "boolean";
    }) &&
    Array.isArray(item.screenshots) &&
    item.screenshots.every((path: unknown) => typeof path === "string") &&
    [item.finishedAt, item.error, item.image].every(
      (text: unknown) => text === undefined || typeof text === "string",
    )
  );
};
const cleanupFailure = (cause: unknown): string => {
  const error = `GNOME cleanup failed: ${message(cause)}`;
  console.error(error);
  process.exitCode = 1;
  return error;
};
const readReport = async (output: string): Promise<Report> => {
  const value: unknown = JSON.parse(await readFile(join(output, "result.json"), "utf8"));
  assert.ok(validateReport(value), "Invalid GNOME report");
  return value;
};

const runCommand = async (
  command: string,
  args: string[],
  signal?: AbortSignal,
): Promise<string> => {
  const result = await execute(command, args, { timeout: 6000, maxBuffer: 1024 * 1024, signal });
  return result.stdout.trim();
};

const preflight = async (mode: Mode, signal: AbortSignal): Promise<string> => {
  const version = await runCommand("gnome-shell", ["--version"], signal);
  assert.match(version, /^GNOME Shell 50\./u, "GNOME Shell 50 is required");
  await runCommand("dbus-run-session", ["--version"], signal);
  await runCommand("gsettings", ["--version"], signal);
  await runCommand("unzip", ["-v"], signal);
  await runCommand("fusermount3", ["--version"], signal);
  await runCommand(
    "gjs",
    [
      "-c",
      `imports.gi.versions.Soup = '3.0';
     imports.gi.versions.Gtk = '4.0';
     imports.gi.versions.Adw = '1';
     imports.gi.versions.GdkPixbuf = '2.0';
     for (const name of ['Soup', 'Gtk', 'Adw', 'GdkPixbuf']) void imports.gi[name];
     const source = imports.gi.Gio.SettingsSchemaSource.get_default();
     for (const name of ['org.gnome.desktop.background', 'org.gnome.desktop.interface', 'org.gnome.shell'])
       if (!source.lookup(name, true)) throw new Error('Missing GSettings schema: ' + name);`,
    ],
    signal,
  );
  if (mode === "nested") {
    assert.ok(
      Boolean(process.env.WAYLAND_DISPLAY) && Boolean(process.env.XDG_RUNTIME_DIR),
      "Run the nested test from a Wayland desktop session (WAYLAND_DISPLAY and XDG_RUNTIME_DIR)",
    );
    try {
      await access("/usr/libexec/mutter-devkit", constants.X_OK);
    } catch {
      throw new Error(
        "Missing /usr/libexec/mutter-devkit. Install the GNOME 50 Mutter Devkit package " +
          "(Ubuntu 26.04: mutter-dev-bin), then retry. " +
          "No system packages are installed by this test.",
      );
    }
  }
  return version;
};

// The client and Shell communicate only through the private session bus.
const dbusClient = `
const {Gio, GLib} = imports.gi;
const [path, iface, method, signature, values] = ARGV;
const result = Gio.DBus.session.call_sync('org.gnome.Shell', path, iface, method,
    new GLib.Variant(signature, JSON.parse(values)), null, Gio.DBusCallFlags.NONE, 5000, null);
print(JSON.stringify(result.recursiveUnpack()));
`;
const call = async (
  method: string,
  signature: string,
  values: unknown[],
  signal: AbortSignal,
): Promise<unknown[]> => {
  const screenshot = method === "Screenshot";
  const output = await runCommand(
    "gjs",
    [
      "-c",
      dbusClient,
      screenshot ? "/org/gnome/Shell/Screenshot" : "/org/gnome/Shell",
      screenshot
        ? "org.gnome.Shell.Screenshot"
        : method === "Eval"
          ? "org.gnome.Shell"
          : "org.gnome.Shell.Extensions",
      method,
      signature,
      JSON.stringify(values),
    ],
    signal,
  );
  const result: unknown = JSON.parse(output);
  assert.ok(Array.isArray(result), "Invalid D-Bus response");
  return Array.from(result, (value: unknown) => value);
};
const evaluate = async (code: string, signal: AbortSignal): Promise<unknown> => {
  const [ok, value] = await call("Eval", "(s)", [code], signal);
  assert.ok(ok === true && typeof value === "string", `Shell evaluation failed: ${String(value)}`);
  const result: unknown = JSON.parse(value);
  return result;
};

const backgroundProbe = `(() => {
    const settings = new Gio.Settings({schema_id: 'org.gnome.desktop.background'});
    const button = Main.panel.statusArea['gnome-wallpaper'];
    const labels = button?.menu._getMenuItems().map(item => item.label?.text ?? '') ?? [];
    const backgrounds = Main.layoutManager._bgManagers ?? [];
    return {
        light: settings.get_string('picture-uri'),
        dark: settings.get_string('picture-uri-dark'),
        labels,
        loaded: backgrounds.length > 0 && backgrounds.every(manager =>
            manager.backgroundActor.content.background.isLoaded && !manager._newBackgroundActor &&
            manager.backgroundActor.content.background._file?.get_uri() === settings.get_string('picture-uri')),
    };
})()`;

const waitUntil = async <T>(
  probe: (attemptSignal: AbortSignal) => Promise<T | null>,
  timeout: number,
  description: string,
  signal: AbortSignal,
): Promise<T> => {
  const deadline = Date.now() + timeout;
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(timeout)]);
  try {
    while (Date.now() < deadline) {
      bounded.throwIfAborted();
      const result = await probe(bounded);
      if (result !== null) {
        return result;
      }
      await delay(400, undefined, { signal: bounded });
    }
  } catch (error) {
    if (signal.aborted || !bounded.aborted) {
      throw error;
    }
  }
  throw new Error(`Timed out waiting for ${description}`);
};

const decodeImage = async (uri: string, signal: AbortSignal): Promise<unknown> => {
  const output = await runCommand(
    "gjs",
    [
      "-c",
      `imports.gi.versions.GdkPixbuf = '2.0';
       const path = imports.gi.Gio.File.new_for_uri(ARGV[0]).get_path();
       const pixbuf = imports.gi.GdkPixbuf.Pixbuf.new_from_file(path);
       if (pixbuf.width < 1 || pixbuf.height < 1) throw new Error('Invalid image dimensions');
       print(JSON.stringify({width: pixbuf.width, height: pixbuf.height}));`,
      uri,
    ],
    signal,
  );
  const dimensions: unknown = JSON.parse(output);
  return dimensions;
};

const observe = async (mode: Mode, output: string, report: Report, signal: AbortSignal) => {
  const extensionInfo = await waitUntil(
    async (attemptSignal) => {
      let info: Record<string, unknown>;
      try {
        const [value] = await call("GetExtensionInfo", "(s)", [uuid], attemptSignal);
        info = mapping(value);
      } catch {
        attemptSignal.throwIfAborted();
        return null;
      }
      if (info.state === 3 || info.state === 4) {
        throw new Error(`Extension failed to load: ${JSON.stringify(info.error ?? info.state)}`);
      }
      return info.state === 1 ? info : null;
    },
    startupTimeout,
    "the enabled extension (30 seconds)",
    signal,
  );
  assert.equal(
    extensionInfo.path,
    join(String(process.env.XDG_DATA_HOME), "gnome-shell/extensions", uuid),
    "Loaded extension is outside the isolated directory",
  );
  report.checks.push({ name: "extension-enabled", ok: true, detail: extensionInfo.path });
  const image = await waitUntil(
    async (attemptSignal) => {
      if (mode === "nested") {
        const uri = await runCommand(
          "gsettings",
          ["get", "org.gnome.desktop.background", "picture-uri"],
          attemptSignal,
        );
        return uri.includes("/gnome-wallpaper/") ? { light: uri.slice(1, -1) } : null;
      }
      const state = mapping(await evaluate(backgroundProbe, attemptSignal));
      assert.ok(Array.isArray(state.labels), "Missing panel menu");
      const labels: unknown[] = state.labels;
      const status = labels.at(2);
      if (
        typeof status === "string" &&
        status !== "Updating…" &&
        status !== "Waiting for an update" &&
        !status.startsWith("Next check:")
      ) {
        throw new Error(`Wallpaper update failed: ${status}`);
      }
      return typeof state.light === "string" &&
        state.light.includes("/gnome-wallpaper/") &&
        state.loaded === true &&
        typeof status === "string" &&
        status.startsWith("Next check:")
        ? state
        : null;
    },
    smokeTimeout - startupTimeout,
    `a real ${report.source} wallpaper`,
    signal,
  );
  assert.equal(typeof image.light, "string");
  const uri = String(image.light);
  const dimensions = await decodeImage(uri, signal);
  const file = fileURLToPath(uri);
  assert.ok(
    file.startsWith(`${process.env.XDG_DATA_HOME}/gnome-wallpaper/`),
    "Image outside the isolated storage",
  );
  if (report.source === "self") {
    assert.equal(file, join(String(process.env.XDG_DATA_HOME), "gnome-wallpaper/self/image1.jpg"));
    await verifySelfFixture(String(process.env.XDG_DATA_HOME));
    report.checks.push({ name: "self-original-files-unchanged", ok: true });
  }
  const downloaded = join(output, "wallpaper.jpg");
  await copyFile(file, downloaded);
  report.checks.push({ name: "image-decoded", ok: true, detail: dimensions });
  if (mode === "nested") {
    return downloaded;
  }
  assert.equal(image.dark, uri, "Light and dark backgrounds must use the downloaded image");
  assert.ok(
    Array.isArray(image.labels) &&
      image.labels[0] !== "No image yet" &&
      typeof image.labels[1] === "string" &&
      image.labels[1].startsWith(
        { bing: "Bing · ", "nasa-iotd": "NASA Image of the Day · ", self: "My images · " }[
          report.source
        ],
      ),
    "Panel photo information missing",
  );
  report.checks.push(
    { name: "both-background-uris", ok: true },
    { name: "background-loaded", ok: true },
    { name: "panel-photo-information", ok: true, detail: image.labels },
  );
  await evaluate(
    "Main.overview.hide(); Main.panel.statusArea['gnome-wallpaper'].menu.close(); true",
    signal,
  );
  for (const name of ["desktop", "menu"]) {
    if (name === "menu") {
      await evaluate("Main.panel.statusArea['gnome-wallpaper'].menu.open(); true", signal);
    }
    await delay(1000, undefined, { signal });
    const path = join(output, `${name}.png`);
    const [ok, saved] = await call("Screenshot", "(bbs)", [false, false, path], signal);
    assert.ok(ok === true && saved === path, `Unable to capture ${name}`);
    await decodeImage(pathToFileURL(path).href, signal);
    report.screenshots.push(path);
  }
  report.checks.push({ name: "screenshots-saved", ok: true });
  const [info] = await call("GetExtensionInfo", "(s)", [uuid], signal);
  const [errors] = await call("GetExtensionErrors", "(s)", [uuid], signal);
  assert.equal(mapping(info).state, 1, "Extension stopped during verification");
  assert.deepEqual(errors, [], "GNOME reported extension errors");
  report.checks.push({ name: "no-extension-errors", ok: true });
  return downloaded;
};

const session = async (mode: Mode, output: string) => {
  const report = await readReport(output);
  const controller = new AbortController();
  const interrupted = () => {
    controller.abort(new Error("Interrupted"));
  };
  process.on("SIGINT", interrupted);
  process.on("SIGTERM", interrupted);
  const timeout = setTimeout(() => {
    controller.abort(new Error("GNOME smoke test exceeded 120 seconds"));
  }, smokeTimeout);
  const shell = ChildProcesses.spawn(
    "gnome-shell",
    [
      "--wayland",
      "--no-x11",
      "--mode=user",
      "--wayland-display=gnome-wallpaper-test",
      ...(mode === "headless"
        ? ["--headless", "--virtual-monitor=1280x720", "--unsafe-mode"]
        : ["--devkit"]),
    ],
    { stdio: ["ignore", "inherit", "inherit"] },
  );
  const closed = new Promise<void>((resolve) => {
    shell.on("error", (cause) => {
      controller.abort(cause);
    });
    shell.on("close", (code, signal) => {
      if (!report.ok || code !== 0) {
        controller.abort(
          new Error(`GNOME Shell exited before verification (${String(code ?? signal)})`),
        );
      }
      resolve();
    });
  });
  try {
    // Preferences services use the test compositor; Devkit uses the host.
    // Update only the private bus, without exporting settings to systemd.
    await runCommand(
      "gjs",
      [
        "-c",
        `
      const {Gio, GLib} = imports.gi;
      Gio.DBus.session.call_sync('org.freedesktop.DBus', '/org/freedesktop/DBus',
          'org.freedesktop.DBus', 'UpdateActivationEnvironment',
          new GLib.Variant('(a{ss})', [{WAYLAND_DISPLAY: 'gnome-wallpaper-test', DISPLAY: ''}]),
          null, Gio.DBusCallFlags.NONE, 5000, null);
    `,
      ],
      controller.signal,
    );
    report.image = await observe(mode, output, report, controller.signal);
    report.ok = true;
    await writeFile(join(output, "result.json"), JSON.stringify(report, null, 2));
    if (mode === "nested") {
      clearTimeout(timeout);
      console.log(
        `${report.source} image ready. Use the wallpaper panel icon to refresh or open Preferences. Close the Devkit window or press Ctrl+C to exit.`,
      );
      await Promise.race([
        closed,
        new Promise<void>((_resolve, reject) => {
          controller.signal.addEventListener(
            "abort",
            () => {
              reject(new Error(message(controller.signal.reason)));
            },
            {
              once: true,
            },
          );
        }),
      ]);
    }
  } catch (error) {
    report.ok = false;
    report.error = message(controller.signal.aborted ? controller.signal.reason : error);
    process.exitCode = report.error === "Interrupted" ? 130 : 1;
  } finally {
    clearTimeout(timeout);
    shell.kill("SIGTERM");
    await Promise.race([closed, delay(1500)]);
    if (shell.exitCode === null && shell.signalCode === null) {
      shell.kill("SIGKILL");
    }
    report.finishedAt = new Date().toISOString();
    await writeFile(join(output, "result.json"), JSON.stringify(report, null, 2));
    process.off("SIGINT", interrupted);
    process.off("SIGTERM", interrupted);
  }
};

export const main = async (mode: Mode): Promise<void> => {
  const runId = `${new Date().toISOString().replaceAll(/[:.]/gu, "-")}-${process.pid}`;
  const output = absolute("artifacts/gnome", mode, runId);
  await mkdir(output, { recursive: true });
  const report: Report = {
    ok: false,
    mode,
    source: "bing",
    startedAt: new Date().toISOString(),
    checks: [],
    screenshots: [],
    log: join(output, "shell.log"),
  };
  let root: string | null = null;
  let child: ChildProcesses.ChildProcess | null = null;
  const controller = new AbortController();
  const interrupted = () => {
    controller.abort(new Error("Interrupted"));
  };
  process.on("SIGINT", interrupted);
  process.on("SIGTERM", interrupted);
  const watchdog =
    mode === "headless"
      ? setTimeout(() => {
          controller.abort(new Error("GNOME smoke test exceeded 120 seconds"));
        }, smokeTimeout)
      : null;
  const log = createWriteStream(report.log);
  try {
    const source = process.env.GNOME_WALLPAPER_TEST_SOURCE ?? "bing";
    assert.ok(
      source === "bing" || source === "nasa-iotd" || source === "self",
      "GNOME_WALLPAPER_TEST_SOURCE must be bing, nasa-iotd or self",
    );
    report.source = source;
    report.checks.push({
      name: "prerequisites",
      ok: true,
      detail: await preflight(mode, controller.signal),
    });
    root = await createEnvironmentRoot();
    const env = isolatedEnvironment(root, process.env, mode);
    for (const name of ["config", "data", "cache", "state", "runtime"]) {
      await mkdir(join(root, name), { mode: 0o700 });
    }
    if (source === "self") {
      await prepareSelfFixture(join(root, "data"));
    }
    const extension = join(root, "data/gnome-shell/extensions", uuid);
    await mkdir(extension, { recursive: true });
    await runCommand(
      "unzip",
      ["-q", absolute("artifacts", `${uuid}.zip`), "-d", extension],
      controller.signal,
    );
    env.GSETTINGS_SCHEMA_DIR = join(extension, "schemas");
    await execute(
      "gsettings",
      ["set", "org.gnome.shell.extensions.gnome-wallpaper", "source", report.source],
      {
        env,
        signal: controller.signal,
      },
    );
    for (const [key, value] of [
      ["enabled-extensions", `['${uuid}']`],
      ["disable-user-extensions", "false"],
      ["welcome-dialog-last-shown-version", "'50'"],
    ]) {
      assert.ok(key !== undefined && value !== undefined);
      await execute("gsettings", ["set", "org.gnome.shell", key, value], {
        env,
        signal: controller.signal,
      });
    }
    await writeFile(join(output, "result.json"), JSON.stringify(report, null, 2));
    controller.signal.throwIfAborted();
    child = ChildProcesses.spawn(
      "dbus-run-session",
      ["--", process.execPath, script, "--session", mode, output],
      {
        env,
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    child.stdout?.on("data", (bytes: Buffer) => {
      log.write(bytes);
      process.stdout.write(bytes);
    });
    child.stderr?.on("data", (bytes: Buffer) => {
      log.write(bytes);
    });
    const exit = new Promise<number | null>((resolve, reject) => {
      child?.on("error", reject);
      child?.on("exit", resolve);
      controller.signal.addEventListener(
        "abort",
        () => {
          reject(new Error(message(controller.signal.reason)));
        },
        { once: true },
      );
    });
    const code = await exit;
    const result = await readReport(output);
    assert.ok(!controller.signal.aborted, "Interrupted");
    assert.ok(
      code === 0 && result.ok,
      result.error ?? `Session exited with status ${String(code)}`,
    );
    console.log(`GNOME ${mode} verification passed.`);
  } catch (error) {
    report.error = message(controller.signal.aborted ? controller.signal.reason : error);
    console.error(report.error);
    process.exitCode = report.error === "Interrupted" ? 130 : 1;
  } finally {
    if (watchdog !== null) {
      clearTimeout(watchdog);
    }
    try {
      if (child !== null) {
        await stopGroup(child);
      }
    } catch (error) {
      report.error = cleanupFailure(error);
    } finally {
      log.end();
      if (root !== null) {
        try {
          await cleanupEnvironment(root);
        } catch (error) {
          report.error = cleanupFailure(error);
        }
      }
      process.off("SIGINT", interrupted);
      process.off("SIGTERM", interrupted);
      if (report.error !== undefined) {
        let result = report;
        try {
          result = await readReport(output);
        } catch {
          /* No session report on preflight failure. */
        }
        result.ok = false;
        result.error = report.error;
        result.finishedAt = new Date().toISOString();
        await writeFile(join(output, "result.json"), JSON.stringify(result, null, 2));
      }
      console.log(`Artifacts: ${output}`);
    }
  }
};

if (process.argv[1] === script) {
  const internal = process.argv[2] === "--session";
  const mode = process.argv[internal ? 3 : 2];
  assert.ok(
    mode === "nested" || mode === "headless",
    "Usage: node scripts/test-gnome.ts nested|headless",
  );
  if (internal) {
    const output = process.argv.at(4);
    assert.ok(output !== undefined);
    await session(mode, output);
  } else {
    await main(mode);
  }
}
