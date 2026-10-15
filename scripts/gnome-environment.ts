import type * as ChildProcesses from "node:child_process";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { isAbsolute, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

export const createEnvironmentRoot = (): Promise<string> =>
  mkdtemp(join(tmpdir(), "gnome-wallpaper-"));

export const cleanupEnvironment = async (root: string): Promise<void> => {
  // Document Portal and GVfs can leave FUSE mounts after the private bus exits.
  // Unmount only this run's mounts; never traverse it during removal.
  const mounts = await readFile("/proc/self/mountinfo", "utf8");
  await Promise.all(
    ["doc", "gvfs"].map(async (name) => {
      const path = join(root, "runtime", name);
      if (
        mounts.split("\n").some((line) => line.includes(` ${path} `) && line.includes(" - fuse."))
      ) {
        await promisify(execFile)("fusermount3", ["-u", path], { timeout: 5000 });
      }
    }),
  );
  await rm(root, { recursive: true, force: true });
};

export const isolatedEnvironment = (
  root: string,
  parent: NodeJS.ProcessEnv,
  mode: "nested" | "headless",
): NodeJS.ProcessEnv => {
  const env = { ...parent };
  for (const [key, name] of Object.entries({
    XDG_CONFIG_HOME: "config",
    XDG_DATA_HOME: "data",
    XDG_CACHE_HOME: "cache",
    XDG_STATE_HOME: "state",
    XDG_RUNTIME_DIR: "runtime",
  })) {
    env[key] = join(root, name);
  }
  for (const key of [
    "DBUS_SESSION_BUS_ADDRESS",
    "DBUS_STARTER_ADDRESS",
    "DBUS_STARTER_BUS_TYPE",
    "SESSION_MANAGER",
    "XDG_SESSION_ID",
    "DESKTOP_AUTOSTART_ID",
    "GSETTINGS_SCHEMA_DIR",
    "DCONF_PROFILE",
    "DISPLAY",
    "WAYLAND_DISPLAY",
    "GNOME_SHELL_SESSION_MODE",
    "PIPEWIRE_REMOTE",
  ]) {
    delete env[key];
  }
  env.GSETTINGS_BACKEND = "keyfile";
  env.GNOME_SHELL_SESSION_MODE = "user";
  env.GTK_USE_PORTAL = "0";
  // Local folders need no GVfs network discovery helpers in the private session.
  env.GIO_USE_VFS = "local";
  if (
    mode === "nested" &&
    typeof parent.WAYLAND_DISPLAY === "string" &&
    typeof parent.XDG_RUNTIME_DIR === "string"
  ) {
    env.WAYLAND_DISPLAY = isAbsolute(parent.WAYLAND_DISPLAY)
      ? parent.WAYLAND_DISPLAY
      : join(parent.XDG_RUNTIME_DIR, parent.WAYLAND_DISPLAY);
    // Devkit's stream uses the host PipeWire server; settings and files stay private.
    const remote = parent.PIPEWIRE_REMOTE ?? "pipewire-0";
    env.PIPEWIRE_REMOTE = isAbsolute(remote) ? remote : join(parent.XDG_RUNTIME_DIR, remote);
  }
  return env;
};

const groupHasLiveProcesses = async (group: number): Promise<boolean> => {
  const entries = await readdir("/proc");
  const members = await Promise.all(
    entries
      .filter((name) => /^\d+$/u.test(name))
      .map(async (name) => {
        try {
          const stat = await readFile(`/proc/${name}/stat`, "utf8");
          const [state, , processGroup] = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
          return Number(processGroup) === group && state !== "Z" && state !== "X";
        } catch (error) {
          if (error instanceof Error && "code" in error && error.code === "ENOENT") {
            return false;
          }
          throw error;
        }
      }),
  );
  return members.some(Boolean);
};

export const stopGroup = async (child: Pick<ChildProcesses.ChildProcess, "pid">): Promise<void> => {
  const { pid } = child;
  if (pid === undefined) {
    return;
  }
  const kill = (signal: NodeJS.Signals) => {
    try {
      process.kill(-pid, signal);
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) {
        throw error;
      }
    }
  };
  kill("SIGTERM");
  await delay(750);
  try {
    kill("SIGKILL");
  } catch (error) {
    // A dying sandboxed helper can reject group signals even after its bus exits.
    // Only tolerate that race after proving no live member remains.
    if (
      !(
        error instanceof Error &&
        "code" in error &&
        (error.code === "EACCES" || error.code === "EPERM")
      )
    ) {
      throw error;
    }
    await delay(750);
    if (await groupHasLiveProcesses(pid)) {
      throw error;
    }
  }
};
