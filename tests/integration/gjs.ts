import Gio from "gi://Gio";
import GLib from "gi://GLib";
import System from "system";
import { createBingSource } from "../../src/bing";
import { createSelfSource } from "../../src/self";
import { createSelfFiles, createSelfSelection, selfPath } from "../../src/self-gjs";
import { createSource } from "../../src/sources";
import { createController } from "../../src/controller";
import {
  createBackground,
  createCancellation,
  createHttp,
  createStorage,
  schedule,
} from "../../src/gjs";
import type { Config, View, Wallpaper } from "../../src/model";

const assert = (condition: boolean, message: string): void => {
  if (!condition) {
    throw new Error(message);
  }
};
const unavailable = (): never => {
  throw new Error("Self accessed HTTP or online storage");
};
const verifySelf = async (): Promise<void> => {
  const settings = new Gio.Settings({ schema_id: "org.gnome.shell.extensions.gnome-wallpaper" });
  const state = createSelfSelection(settings);
  const files = createSelfFiles(selfPath());
  const token = createCancellation();
  assert(!(await files.valid("missing.jpg", token)), "Missing local image");
  assert(!(await files.valid("broken.jpg", token)), "Invalid local image");
  const listed = await files.list(token);
  assert(!listed.includes("ignored.jpg"), "No recursive scan");
  let now = new Date(2026, 9, 15, 12).getTime();
  const background = createBackground();
  const original = background.read();
  const errors: string[] = [];
  const ports = {
    selfSelection: state,
    source: createSource(
      unavailable,
      createSelfSource(files, state, () => now),
    ),
    download: unavailable,
    storage: {
      load: unavailable,
      save: unavailable,
      exists: unavailable,
      remove: unavailable,
      record: unavailable,
    },
    background,
    now: () => now,
    schedule,
    cancellation: createCancellation,
    render: () => {},
    log: (message: string) => {
      errors.push(message);
    },
  };
  let config: Config = { source: "self", market: "ja-JP", resolution: "UHD" };
  let controller = createController(ports, () => config);
  const check = (name: string, day: string) => {
    const expected = files.uri(name);
    assert(
      background.read().light === expected && background.read().dark === expected,
      "Direct local URI for both themes",
    );
    const saved = state.read();
    assert(saved[0] === name && saved[1] === day, "Native (ss) selection persistence");
    assert(errors.length === 0, errors.join(","));
  };
  await controller.refresh();
  check("image1.jpg", "2026-10-15");
  await controller.refresh();
  check("image1.jpg", "2026-10-15");
  controller.disable();
  controller = createController(ports, () => config);
  await controller.refresh();
  check("image1.jpg", "2026-10-15");
  config = { ...config, source: "bing" };
  await controller.reconfigure();
  assert(errors.pop() === "Self accessed HTTP or online storage", "Simulated offline Bing failure");
  assert(background.read().light === files.uri("image1.jpg"), "Failure retains local wallpaper");
  config = { ...config, source: "self" };
  await controller.reconfigure();
  check("image1.jpg", "2026-10-15");
  now = new Date(2026, 9, 16, 12).getTime();
  await controller.refresh();
  check("image2.png", "2026-10-16");
  now = new Date(2026, 9, 22, 12).getTime();
  await controller.refresh();
  check("image10.webp", "2026-10-22");
  now = new Date(2026, 9, 23, 12).getTime();
  await controller.refresh();
  check("image1.jpg", "2026-10-23");
  controller.disable();
  assert(
    background.read().light === original.light && background.read().dark === original.dark,
    "Self restoration",
  );
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
      url.includes("/feeds/")
        ? `${base}/nasa-feed`
        : url.includes("/wp-json/")
          ? `${base}/nasa-media`
          : url.includes("nasa.gov/wp-content/")
            ? `${base}/nasa-image`
            : url.includes("HPImageArchive")
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
    source: "bing",
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
  let config: Config = { source: "bing", market: "ja-JP", resolution: "UHD" };
  const controller = createController(
    {
      selfSelection: { read: () => ["", ""], write: () => {} },
      source: createSource(fetch, { latest: async () => ({ ok: false, error: "Not self" }) }),
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
    () => config,
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
  config = { ...config, source: "nasa-iotd" };
  await controller.reconfigure();
  const nasa = background.read();
  assert(
    nasa.light === nasa.dark && nasa.light !== applied.light,
    "NASA wallpaper applied to both themes",
  );
  const nasaEntries = await storage.load(token);
  assert(
    nasaEntries.some((item) => item.id === "nasa-iotd-3"),
    "NASA separate cache",
  );
  await controller.refresh();
  config = { ...config, source: "bing" };
  await controller.reconfigure();
  assert(background.read().light === applied.light, "Switch back reuses Bing cache");
  background.write({ light: "file:///manual", dark: applied.dark });
  controller.disable();
  assert(
    background.read().light === "file:///manual" && background.read().dark === original.dark,
    "Conditional restoration",
  );
  const invalid = await createBingSource((_url, cancellation) =>
    http.fetch(`${base}/invalid`, cancellation),
  ).latest({ source: "bing" as const, market: "ja-JP", resolution: "UHD" }, token);
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
  assert(preferences.get_string("source") === "bing", "Source default");
  assert(preferences.set_string("source", "nasa-iotd"), "Source write");
  assert(preferences.set_string("resolution", "1920x1080"), "Schema write");
  await verifySelf();
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
