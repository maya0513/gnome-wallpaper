import { it, expect, vi } from "vite-plus/test";

import { createBingSource } from "../src/bing";

const token = { cancelled: () => false, cancel: () => {} };
const config = { market: "ja-JP", resolution: "UHD" as const };

it("encodes the market and parses Bing information with a pure function", async () => {
  const fetch = vi.fn(async () =>
    new TextEncoder().encode(
      JSON.stringify({
        images: [
          {
            fullstartdate: "20261006000000",
            urlbase: "/th?id=OHR.Test",
            url: "/th?id=OHR.Test_1920x1080.jpg",
            copyright: "Author",
            copyrightlink: "https://www.bing.com/search",
          },
        ],
      }),
    ),
  );
  const source = createBingSource(fetch);
  const result = await source.latest(config, token);
  expect(result.ok).toBe(true);
  expect(fetch).toHaveBeenCalledWith(
    "https://www.bing.com/HPImageArchive.aspx?format=js&idx=0&n=1&mkt=ja-JP",
    token,
  );
});

it.each([new Uint8Array([255]), new TextEncoder().encode("{"), new TextEncoder().encode("{}")])(
  "returns invalid responses as Results",
  async (bytes) => {
    const result = await createBingSource(async () => bytes).latest(config, token);
    expect(result.ok).toBe(false);
  },
);

it("returns network failures as Results", async () => {
  await expect(
    createBingSource(async () => {
      throw new Error("offline");
    }).latest(config, token),
  ).resolves.toStrictEqual({ ok: false, error: "offline" });
});
