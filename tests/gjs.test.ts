import { defined } from "./helpers";
import { it, expect, vi, beforeEach } from "vite-plus/test";

import {
  createBackground,
  createCancellation,
  createHttp,
  createStorage,
  schedule,
} from "../src/gjs";
import { background, faults, files, ioError, values, writes } from "./mocks/gio";
import GLib, { timers } from "./mocks/glib";
import { response, session } from "./mocks/soup";

const image = {
  id: "ja-JP/UHD/%",
  publishedAt: 1,
  title: "Autumn",
  copyright: "Author",
  infoUrl: "https://www.bing.com/",
  url: "primary",
  fallbackUrl: "fallback",
};
beforeEach(() => {
  vi.clearAllMocks();
  files.clear();
  faults.clear();
  writes.length = 0;
  values.clear();
  timers.clear();
  Object.assign(response, { status: 200, error: null, valid: true, bytes: new Uint8Array([1]) });
  background.set_string.mockImplementation((key, value) => {
    values.set(key, value);
    return true;
  });
});

it("exposes native Cancellable state and cancels it", () => {
  const token = createCancellation();
  expect(token.cancelled()).toBe(false);
  token.cancel();
  expect(token.cancelled()).toBe(true);
});

it("downloads images with Soup and closes the session", async () => {
  const http = createHttp();
  await expect(http.fetch("https://example.com", createCancellation())).resolves.toStrictEqual(
    response.bytes,
  );
  http.close();
  expect(session.abort).toHaveBeenCalledOnce();
});

it.each([404, 500])("rejects HTTP %i", async (status) => {
  response.status = status;
  await expect(createHttp().fetch("https://example.com", createCancellation())).rejects.toThrow(
    `HTTP ${status}`,
  );
});

it("propagates Soup finish errors and invalid URLs", async () => {
  response.error = new Error("offline");
  await expect(createHttp().fetch("url", createCancellation())).rejects.toThrow("offline");
  response.valid = false;
  await expect(createHttp().fetch("bad", createCancellation())).rejects.toThrow("URL");
});

it("saves images and the index asynchronously and atomically, then reloads, checks, and removes them", async () => {
  const storage = createStorage("/data/wallpaper");
  const token = createCancellation();
  await expect(storage.load(token)).resolves.toStrictEqual([]);
  const entry = await storage.save(image, new Uint8Array([1]), token);
  expect(entry.uri).toBe("file:///data/wallpaper/ja-JP%2FUHD%2F%25.jpg");
  await storage.record([entry], token);
  await expect(storage.load(token)).resolves.toStrictEqual([entry]);
  await expect(storage.exists(entry.uri, token)).resolves.toBe(true);
  await storage.remove(entry, token);
  await expect(storage.exists(entry.uri, token)).resolves.toBe(false);
  expect(writes.every((write) => write.flags === 2)).toBe(true);
});

it("saves into an existing directory", async () => {
  faults.set("mkdir", ioError(2));
  await expect(
    createStorage("/data").save(image, new Uint8Array([1]), createCancellation()),
  ).resolves.toHaveProperty("id", image.id);
});

it.each(["load", "mkdir", "write", "exists", "delete"])(
  "propagates IO errors from %s",
  async (operation) => {
    faults.set(operation, new Error("disk error"));
    const storage = createStorage("/data");
    const token = createCancellation();
    const task =
      operation === "load"
        ? storage.load(token)
        : operation === "exists"
          ? storage.exists("uri", token)
          : operation === "delete"
            ? storage.remove(
                {
                  id: image.id,
                  publishedAt: 1,
                  uri: `file:///data/${encodeURIComponent(image.id)}.jpg`,
                },
                token,
              )
            : storage.save(image, new Uint8Array(), token);
    await expect(task).rejects.toThrow("disk error");
  },
);

it.each([
  "{",
  "{}",
  "[null]",
  '[{"id":"x","publishedAt":0,"uri":"file:///foreign"}]',
  '[{"id":"x","publishedAt":"0","uri":"file:///data/x.jpg"}]',
])("rejects corrupt indexes and unmanaged files", async (data) => {
  files.set("file:///data/index.json", new TextEncoder().encode(data));
  await expect(createStorage("/data").load(createCancellation())).rejects.toThrow(/Invalid|JSON/u);
});

it("rejects deletion of unmanaged images", async () => {
  await expect(
    createStorage("/data").remove(
      { id: "x", publishedAt: 0, uri: "foreign" },
      createCancellation(),
    ),
  ).rejects.toThrow("unmanaged");
});

it("delays both GSettings keys and reverts the transaction when either write is rejected", () => {
  const settings = createBackground();
  settings.write({ light: "a", dark: "b" });
  expect(settings.read()).toStrictEqual({ light: "a", dark: "b" });
  expect(background.apply).toHaveBeenCalledOnce();
  background.set_string.mockReturnValueOnce(false);
  expect(() => {
    settings.write({ light: "c", dark: "d" });
  }).toThrow("not writable");
  expect(background.revert).toHaveBeenCalledOnce();
  background.set_string.mockReturnValueOnce(true).mockReturnValueOnce(false);
  expect(() => {
    settings.write({ light: "c", dark: "d" });
  }).toThrow("not writable");
  background.set_string.mockImplementationOnce(() => {
    throw new Error("settings error");
  });
  expect(() => {
    settings.write({ light: "c", dark: "d" });
  }).toThrow("settings error");
});

it("runs and removes a timer at most once", () => {
  const callback = vi.fn();
  const stop = schedule(1.2, callback);
  expect(GLib.timeout_add).toHaveBeenLastCalledWith(0, 2, expect.any(Function));
  stop();
  stop();
  expect(GLib.Source.remove).toHaveBeenCalledOnce();
  const stop2 = schedule(1, callback);
  const fire = defined([...timers.values()].at(-1));
  expect(fire()).toBe(false);
  expect(callback).toHaveBeenCalledOnce();
  stop2();
  expect(GLib.Source.remove).toHaveBeenCalledOnce();
});

it("rejects invalid tokens and empty responses", async () => {
  const http = createHttp();
  await expect(http.fetch("url", { cancelled: () => false, cancel: () => {} })).rejects.toThrow(
    "cancellation token",
  );
  response.bytes = null;
  await expect(http.fetch("url", createCancellation())).rejects.toThrow("Empty response");
});
