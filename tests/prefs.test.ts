import { defined } from "./helpers";
import { beforeEach, it, expect, vi } from "vite-plus/test";
import { setImmediate as flush } from "node:timers/promises";
import WallpaperPreferences from "../src/prefs";
import { widgets } from "./mocks/gtk";
import { settings } from "./mocks/extension";
import { faults } from "./mocks/gio";

const build = async () => {
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
  return signals;
};
const row = (title: string) => defined(widgets.find((widget) => widget.title === title));
beforeEach(() => {
  vi.clearAllMocks();
  widgets.length = 0;
  faults.clear();
  settings.get_string.mockImplementation((key) =>
    key === "market" ? "ja-JP" : key === "source" ? "bing" : "UHD",
  );
});

it("selects all three sources and shows only the self folder guide for My images", async () => {
  const signals = await build();
  const group = row("Bing images");
  const source = row("Source");
  const images = row("My images");
  expect(group.sensitive).toBe(true);
  expect(images.visible).toBe(false);
  for (const [index, id] of [
    [1, "nasa-iotd"],
    [2, "self"],
    [0, "bing"],
    [99, "bing"],
  ] as const) {
    source.selected = index;
    defined(source.signals.get("notify::selected"))();
    expect(settings.set_string).toHaveBeenLastCalledWith("source", id);
    expect(images.visible).toBe(index === 2);
  }
  settings.get_string.mockImplementation((key) => (key === "source" ? "self" : "1920x1080"));
  defined(settings.connect.mock.calls.at(-1))[1](undefined, "source");
  expect(source.selected).toBe(2);
  expect(group.sensitive).toBe(false);
  expect(settings.bind).toHaveBeenCalledWith("market", expect.anything(), "text", 0);
  const resolution = row("Resolution");
  for (const [index, value] of [
    [1, "1920x1080"],
    [0, "UHD"],
  ] as const) {
    resolution.selected = index;
    defined(resolution.signals.get("notify::selected"))();
    expect(settings.set_string).toHaveBeenLastCalledWith("resolution", value);
  }
  expect(defined(signals.get("close-request"))()).toBe(false);
  expect(resolution.disconnect).toHaveBeenCalledWith(9);
  await build();
  expect(defined(widgets.at(-1)).selected).toBe(1);
});

it("opens the folder and reports launch errors, but ignores cancellation on close", async () => {
  const signals = await build();
  const button = defined(widgets.find((widget) => widget.label === "Open folder"));
  defined(button.signals.get("clicked"))();
  await flush();
  faults.set("launch", new Error("File manager unavailable"));
  defined(button.signals.get("clicked"))();
  await flush();
  expect(defined(widgets.at(-1)).present).toHaveBeenCalledOnce();
  const count = widgets.length;
  defined(signals.get("close-request"))();
  defined(button.signals.get("clicked"))();
  await flush();
  expect(widgets).toHaveLength(count);
});
