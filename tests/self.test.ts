import { expect, it, vi } from "vite-plus/test";
import { createSelfSource, nextSelfRefresh } from "../src/self";
import type { SelfSelection } from "../src/model";

const config = { source: "self" as const, market: "ja-JP", resolution: "UHD" as const };
const token = { cancelled: () => false, cancel: () => {} };
const setup = (selection: SelfSelection = ["", ""]) => {
  const files = {
    list: vi.fn(async () => ["image10.png", "image2.png", "image1.jpg", "notes.txt"]),
    valid: vi.fn(async (_name: string) => true),
    uri: (name: string) => `file:///self/${name}`,
  };
  let now = new Date(2026, 9, 15, 12).getTime();
  const state = { read: () => selection, write: vi.fn() };
  return {
    files,
    state,
    source: createSelfSource(files, state, () => now),
    time: (value: number) => {
      now = value;
    },
  };
};

it.each([
  [["", ""], "image1.jpg"],
  [["image2.png", "2026-10-15"], "image2.png"],
  [["image2.png", "2026-10-14"], "image10.png"],
  [["image2.png", "2026-10-01"], "image10.png"],
  [["image10.png", "2026-10-14"], "image1.jpg"],
  [["removed.png", "2026-10-15"], "image1.jpg"],
  [["image2.png", "2026-10-16"], "image2.png"],
] as const)("selects %j -> %s without persisting before application", async (selection, name) => {
  const s = setup(selection);
  await expect(s.source.latest(config, token)).resolves.toMatchObject({
    ok: true,
    value: { source: "self", title: name, uri: `file:///self/${name}` },
  });
  expect(s.state.write).not.toHaveBeenCalled();
});

it("rescans additions, skips unreadable files and wraps through the entire folder", async () => {
  const s = setup(["image2.png", "2026-10-15"]);
  s.files.valid.mockImplementation(async (name) => name === "image1.jpg");
  await expect(s.source.latest(config, token)).resolves.toMatchObject({
    ok: true,
    value: { title: "image1.jpg" },
  });
  s.files.list.mockResolvedValue(["added.WEBP"]);
  s.files.valid.mockResolvedValue(true);
  await expect(s.source.latest(config, token)).resolves.toMatchObject({
    ok: true,
    value: { title: "added.WEBP" },
  });
  s.files.valid.mockResolvedValue(true);
  s.time(new Date(2026, 9, 16, 12).getTime());
  await expect(s.source.latest(config, token)).resolves.toMatchObject({
    ok: true,
    value: { title: "added.WEBP" },
  });
});

it("uses a stable name tie-break and accepts one small or portrait image", async () => {
  const s = setup();
  s.files.list.mockResolvedValue(["image1.png", "image01.png", "日本語.jpeg"]);
  await expect(s.source.latest(config, token)).resolves.toMatchObject({
    ok: true,
    value: { title: "image01.png" },
  });
  s.files.list.mockResolvedValue(["image01.png", "image1.png", "日本語.jpeg"]);
  await expect(s.source.latest(config, token)).resolves.toMatchObject({
    ok: true,
    value: { title: "image01.png" },
  });
  s.files.list.mockResolvedValue(["portrait.png"]);
  await expect(s.source.latest(config, token)).resolves.toMatchObject({
    ok: true,
    value: { title: "portrait.png" },
  });
});

it("reports empty, invalid and cancelled folders", async () => {
  const s = setup();
  s.files.list.mockResolvedValue([]);
  await expect(s.source.latest(config, token)).resolves.toMatchObject({ ok: false });
  s.files.list.mockResolvedValue(["bad.jpg"]);
  s.files.valid.mockResolvedValue(false);
  await expect(s.source.latest(config, token)).resolves.toMatchObject({ ok: false });
  await expect(s.source.latest(config, { ...token, cancelled: () => true })).resolves.toMatchObject(
    { ok: false, error: "Cancelled" },
  );
  s.files.list.mockRejectedValue(new Error("unreadable folder"));
  await expect(s.source.latest(config, token)).resolves.toStrictEqual({
    ok: false,
    error: "unreadable folder",
  });
});

it("schedules the next local midnight across month and year boundaries", () => {
  expect(nextSelfRefresh(new Date(2026, 9, 15, 12).getTime())).toBe(
    new Date(2026, 9, 16).getTime(),
  );
  expect(nextSelfRefresh(new Date(2026, 11, 31, 23).getTime())).toBe(
    new Date(2027, 0, 1).getTime(),
  );
});
