import type { createController } from "../src/controller";
import type { createMenu } from "../src/ui";
import { defined } from "./helpers";
import { it, expect, vi, beforeEach } from "vite-plus/test";

import WallpaperExtension from "../src/extension";
import { settings } from "./mocks/extension";

const boundary = vi.hoisted(() => ({
  refresh: vi.fn(async () => {}),
  reconfigure: vi.fn(async () => {}),
  disable: vi.fn(),
  close: vi.fn(),
  render: vi.fn(),
  destroy: vi.fn(),
  create: vi.fn<typeof createController>(),
  menu: vi.fn<typeof createMenu>(),
}));
vi.mock(import("../src/controller"), () => ({ createController: boundary.create }));
vi.mock(import("../src/gjs"), () => ({
  createHttp: () => ({ fetch: vi.fn(), close: boundary.close }),
  createBackground: vi.fn(),
  createStorage: vi.fn(),
  createCancellation: vi.fn(),
  schedule: vi.fn(),
}));
vi.mock(import("../src/ui"), () => ({ createMenu: boundary.menu }));
beforeEach(() => {
  vi.clearAllMocks();
  settings.get_string.mockImplementation((key) => (key === "market" ? "ja-JP" : "UHD"));
  boundary.create.mockReturnValue(boundary);
  boundary.menu.mockReturnValue(boundary);
});

it("wires entry-point dependencies and disconnects settings signals and UI actions", async () => {
  const extension = new WallpaperExtension({
    uuid: "test",
    name: "test",
    description: "test",
    "shell-version": ["50"],
  });
  const preferencesSpy = vi.spyOn(extension, "openPreferences");
  extension.disable();
  extension.enable();
  const [ports, config] = defined(boundary.create.mock.calls[0]);
  expect(config()).toStrictEqual({ market: "ja-JP", resolution: "UHD" });
  settings.get_string.mockReturnValue("1920x1080");
  expect(config().resolution).toBe("1920x1080");
  expect(ports.now()).toBeTypeOf("number");
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  ports.log("failed");
  expect(log).toHaveBeenCalledWith("failed");
  log.mockRestore();
  const [refresh, preferences] = defined(boundary.menu.mock.calls[0]);
  refresh();
  preferences();
  expect(preferencesSpy).toHaveBeenCalledOnce();
  defined(settings.connect.mock.calls[0])[1]();
  expect(boundary.reconfigure).toHaveBeenCalledOnce();
  extension.enable();
  expect(settings.disconnect).toHaveBeenCalledWith(7);
  expect(boundary.disable).toHaveBeenCalledOnce();
  expect(boundary.destroy).toHaveBeenCalledOnce();
  expect(boundary.close).toHaveBeenCalledOnce();
  extension.disable();
  extension.disable();
  expect(boundary.disable).toHaveBeenCalledTimes(2);
});
