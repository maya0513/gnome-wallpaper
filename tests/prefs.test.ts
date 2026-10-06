import { defined } from "./helpers";
import { it, expect, vi } from "vite-plus/test";

import WallpaperPreferences from "../src/prefs";
import { widgets } from "./mocks/gtk";
import { settings } from "./mocks/extension";

it("configures only market and resolution and disconnects when closed", async () => {
  widgets.length = 0;
  const signals = new Map<string, () => boolean | void>();
  const window = {
    add: vi.fn(),
    connect: vi.fn((name: string, callback: () => boolean | void) => {
      signals.set(name, callback);
    }),
  };
  const prefs = new WallpaperPreferences({
    uuid: "test",
    name: "test",
    description: "test",
    "shell-version": ["50"],
  });
  await prefs.fillPreferencesWindow(window as never);
  expect(settings.bind).toHaveBeenCalledWith("market", expect.anything(), "text", 0);
  const resolution = defined(widgets.at(-1));
  resolution.selected = 1;
  resolution.signals.get("notify::selected")?.();
  expect(settings.set_string).toHaveBeenLastCalledWith("resolution", "1920x1080");
  resolution.selected = 0;
  resolution.signals.get("notify::selected")?.();
  expect(settings.set_string).toHaveBeenLastCalledWith("resolution", "UHD");
  expect(defined(signals.get("close-request"))()).toBe(false);
  expect(resolution.disconnect).toHaveBeenCalledWith(9);
  settings.get_string.mockReturnValueOnce("1920x1080");
  await prefs.fillPreferencesWindow(window as never);
  expect(defined(widgets.at(-1)).selected).toBe(1);
});
