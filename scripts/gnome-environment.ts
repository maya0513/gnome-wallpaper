import type * as ChildProcesses from "node:child_process";
import { isAbsolute, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

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

export const stopGroup = async (child: ChildProcesses.ChildProcess): Promise<void> => {
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
  kill("SIGKILL");
};
