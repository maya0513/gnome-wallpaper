import Gio from "gi://Gio";
import GLib from "gi://GLib";
import System from "system";
import { createBingSource } from "../../src/bing";
import { createController } from "../../src/controller";
import {
  createBackground,
  createCancellation,
  createHttp,
  createStorage,
  schedule,
} from "../../src/gjs";
import type { View, Wallpaper } from "../../src/model";

const assert = (condition: boolean, message: string): void => {
  if (!condition) {
    throw new Error(message);
  }
};
const run = async (): Promise<void> => {
  assert(new RegExp(RegExp.escape("a.b"), "u").test("a.b"), "ES2025 RegExp.escape");
  assert(new Set([1, 2]).intersection(new Set([2, 3])).has(2), "ES2025 Set methods");
  assert(
    Iterator.from([1, 2])
      .map((value) => value * 2)
      .toArray()
      .join(",") === "2,4",
    "ES2025 iterator helpers",
  );
  assert(await Promise.try(() => true), "ES2025 Promise.try");
  assert(new Float16Array([1.5])[0] === 1.5, "ES2025 Float16Array");
  const [base, path] = ARGV;
  assert(base !== undefined && path !== undefined, "Arguments");
  const http = createHttp();
  const storage = createStorage(`${path}/images`);
  const token = createCancellation();
  const fetch = (url: string, cancellation: typeof token) =>
    http.fetch(
      url.includes("HPImageArchive")
        ? `${base}/archive`
        : url.includes("_UHD")
          ? `${base}/uhd`
          : `${base}/image`,
      cancellation,
    );
  const background = createBackground();
  const original = { light: "file:///original-light", dark: "file:///original-dark" };
  background.write(original);
  const initial = await storage.load(token);
  assert(initial.length === 0, "Initial index");
  const old: Wallpaper = {
    id: "old",
    publishedAt: 0,
    title: "Old image",
    copyright: "Author",
    infoUrl: "",
    url: "",
    fallbackUrl: "",
  };
  const oldEntry = await storage.save(old, new Uint8Array([255, 216, 255, 217]), token);
  const protectedEntry = await storage.save(
    { ...old, id: "protected" },
    new Uint8Array([255, 216, 255, 217]),
    token,
  );
  await storage.record([oldEntry, protectedEntry], token);
  background.write({ light: protectedEntry.uri, dark: original.dark });
  let view: View | null = null;
  const errors: string[] = [];
  const controller = createController(
    {
      source: createBingSource(fetch),
      download: fetch,
      storage,
      background,
      now: () => Date.UTC(2026, 9, 6),
      schedule,
      cancellation: createCancellation,
      render: (value) => {
        view = value;
      },
      log: (message) => errors.push(message),
    },
    () => ({ market: "ja-JP", resolution: "UHD" }),
  );
  await controller.refresh();
  assert(errors.length === 0, `Update failed: ${errors.join(",")}`);
  const applied = background.read();
  assert(
    applied.light === applied.dark && applied.light !== protectedEntry.uri,
    "Applied to both themes",
  );
  assert(await storage.exists(applied.light, token), "Image file");
  assert(!(await storage.exists(oldEntry.uri, token)), "Expired image removal");
  assert(await storage.exists(protectedEntry.uri, token), "Restoration image protection");
  const loaded = await storage.load(token);
  assert(loaded.length === 2, "Atomic index");
  await controller.refresh();
  background.write({ light: "file:///manual", dark: applied.dark });
  controller.disable();
  assert(
    background.read().light === "file:///manual" && background.read().dark === original.dark,
    "Conditional restoration",
  );
  const invalid = await createBingSource((_url, cancellation) =>
    http.fetch(`${base}/invalid`, cancellation),
  ).latest({ market: "ja-JP", resolution: "UHD" }, token);
  assert(!invalid.ok, "Invalid response");
  let failed = false;
  try {
    await http.fetch(`${base}/error`, token);
  } catch {
    failed = true;
  }
  assert(failed, "HTTP error");
  const cancelled = createCancellation();
  const pending = http.fetch(`${base}/slow`, cancelled);
  cancelled.cancel();
  failed = false;
  try {
    await pending;
  } catch {
    failed = true;
  }
  assert(failed, "Native HTTP cancellation");
  failed = false;
  try {
    await storage.save(old, new Uint8Array([1]), cancelled);
  } catch {
    failed = true;
  }
  assert(failed, "Native storage cancellation");
  const preferences = new Gio.Settings({ schema_id: "org.gnome.shell.extensions.gnome-wallpaper" });
  assert(preferences.get_string("market") === "ja-JP", "Schema default");
  assert(preferences.set_string("resolution", "1920x1080"), "Schema write");
  http.close();
  print(JSON.stringify({ ok: true, entries: loaded.length, view }));
};
const loop = new GLib.MainLoop(null, false);
run()
  .then(() => {
    loop.quit();
  })
  .catch((error: unknown) => {
    console.error(error);
    System.exit(1);
  });
loop.run();
