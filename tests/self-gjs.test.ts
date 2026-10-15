import { beforeEach, expect, it, vi } from "vite-plus/test";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import { createSelfFiles, createSelfSelection, openSelfFolder, selfPath } from "../src/self-gjs";
import { createCancellation } from "../src/gjs";
import { closes, directoryEntries, files, faults, selection, launch } from "./mocks/gio";
import { pixbuf } from "./mocks/pixbuf";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(GLib.mkdir_with_parents).mockReturnValue(0);
  directoryEntries.length = 0;
  files.clear();
  faults.clear();
  pixbuf.error = null;
  selection.value = ["", ""];
  selection.accepted = true;
});

it("uses the XDG data directory and enumerates only regular direct children over multiple pages", async () => {
  expect(selfPath()).toBe("/data/gnome-wallpaper/self");
  for (let i = 0; i < 65; i++) {
    directoryEntries.push({ name: `photo${i}.png`, type: 1 });
  }
  directoryEntries.push({ name: "subfolder", type: 2 });
  const images = createSelfFiles("/self");
  const result = await images.list(createCancellation());
  expect(result).toHaveLength(65);
  expect(result).not.toContain("subfolder");
  expect(closes.enumerator).toHaveBeenCalledOnce();
  expect(images.uri("photo1.png")).toBe("file:///self/photo1.png");
});

it("validates by reading and decoding without changing the image", async () => {
  const bytes = new Uint8Array([1, 2]);
  files.set("file:///self/photo.png", bytes);
  await expect(createSelfFiles("/self").valid("photo.png", createCancellation())).resolves.toBe(
    true,
  );
  expect(files.get("file:///self/photo.png")).toBe(bytes);
  expect(closes.stream).toHaveBeenCalledOnce();
  await expect(createSelfFiles("/self").valid("missing.png", createCancellation())).resolves.toBe(
    false,
  );
  pixbuf.error = new Error("corrupt");
  await expect(createSelfFiles("/self").valid("photo.png", createCancellation())).resolves.toBe(
    false,
  );
});

it("closes native resources on failures and propagates cancellation", async () => {
  const images = createSelfFiles("/self");
  faults.set("next", new Error("enumeration failed"));
  await expect(images.list(createCancellation())).rejects.toThrow("enumeration failed");
  expect(closes.enumerator).toHaveBeenCalledOnce();
  files.set("file:///self/photo.png", new Uint8Array([1]));
  const token = createCancellation();
  token.cancel();
  pixbuf.error = new Error("cancelled");
  await expect(images.valid("photo.png", token)).rejects.toThrow("cancelled");
  expect(closes.stream).toHaveBeenCalledOnce();
});

it("reports directory creation failure and opens the folder asynchronously", async () => {
  vi.mocked(GLib.mkdir_with_parents).mockReturnValue(-1);
  await expect(createSelfFiles("/self").list(createCancellation())).rejects.toThrow(
    "Unable to create image folder",
  );
  vi.mocked(GLib.mkdir_with_parents).mockReturnValue(0);
  await openSelfFolder("/self", createCancellation());
  expect(launch.launch_default_for_uri_async).toHaveBeenCalledWith(
    "file:///self",
    null,
    expect.anything(),
    expect.any(Function),
  );
});

it("persists only the filename and last applied day", () => {
  const state = createSelfSelection(new Gio.Settings({ schema_id: "test" }));
  expect(state.read()).toStrictEqual(["", ""]);
  state.write(["photo.png", "2026-10-15"]);
  expect(state.read()).toStrictEqual(["photo.png", "2026-10-15"]);
  selection.accepted = false;
  expect(() => {
    state.write(["photo.png", "2026-10-16"]);
  }).toThrow("Unable to save self selection");
});

it.each([null, [], ["one"], [12, "date"], ["name", 12]])(
  "rejects invalid selection state %#",
  (value) => {
    selection.value = value;
    expect(() => createSelfSelection(new Gio.Settings({ schema_id: "test" })).read()).toThrow(
      "Invalid self selection",
    );
  },
);
