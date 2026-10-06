import { defined } from "./helpers";
import { it, expect, vi, beforeEach } from "vite-plus/test";

import { createMenu } from "../src/ui";
import { buttons, items, setValidMenu } from "./mocks/shell";
import { panel } from "./mocks/main";

beforeEach(() => {
  items.length = 0;
  buttons.length = 0;
  vi.clearAllMocks();
});

it("displays image information and status, connects actions, and destroys the menu", () => {
  const refresh = vi.fn();
  const preferences = vi.fn();
  const menu = createMenu(refresh, preferences);
  expect(panel.addToStatusArea).toHaveBeenCalled();
  menu.render({ busy: false, image: null, error: null, nextAt: null });
  expect(defined(items[0]).label.text).toBe("No image yet");
  expect(defined(items[2]).label.text).toBe("Waiting for an update");
  const image = {
    id: "test",
    title: "Autumn mountains",
    copyright: "© Photographer",
    publishedAt: 0,
    infoUrl: "",
    url: "",
    fallbackUrl: "",
  };
  menu.render({ busy: true, image, error: null, nextAt: null });
  expect(defined(items[0]).label.text).toBe("Autumn mountains");
  expect(defined(items[1]).label.text).toBe("© Photographer");
  expect(defined(items[2]).label.text).toBe("Updating…");
  expect(defined(items[3]).setSensitive).toHaveBeenLastCalledWith(false);
  menu.render({ busy: false, image, error: "Network failure", nextAt: 0 });
  expect(defined(items[2]).label.text).toBe("Network failure");
  menu.render({ busy: false, image, error: null, nextAt: 0 });
  expect(defined(items[2]).label.text).toContain("Next check");
  defined(items[3]).signals.get("activate")?.();
  defined(items[4]).signals.get("activate")?.();
  expect(refresh).toHaveBeenCalledOnce();
  expect(preferences).toHaveBeenCalledOnce();
  menu.destroy();
  expect(defined(buttons[0]).destroy).toHaveBeenCalledOnce();
});

it("reports failure when the panel button cannot provide a menu", () => {
  setValidMenu(false);
  expect(() => createMenu(vi.fn(), vi.fn())).toThrow("menu");
  setValidMenu(true);
});
