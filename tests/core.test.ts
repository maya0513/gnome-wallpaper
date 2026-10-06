import { it, expect, describe } from "vite-plus/test";

import {
  parseBing,
  nextRefresh,
  retryDelay,
  expiredImages,
  restoration,
  imageKey,
  errorMessage,
} from "../src/core";

export const config = { market: "ja-JP", resolution: "UHD" as const };
export const payload = {
  images: [
    {
      fullstartdate: "20261006000000",
      title: "Autumn scenery",
      copyright: "Author © Example",
      copyrightlink: "https://www.bing.com/search?q=autumn",
      urlbase: "/th?id=OHR.Autumn_JA-JP123",
      url: "/th?id=OHR.Autumn_JA-JP123_1920x1080.jpg",
    },
  ],
};
export const publishedAt = Date.UTC(2026, 9, 6);

describe("Bing image information", () => {
  it("produces pure values with market and resolution in image identifiers", () => {
    const result = parseBing(payload, config);
    expect(result).toStrictEqual({
      ok: true,
      value: {
        id: imageKey(config, "/th?id=OHR.Autumn_JA-JP123"),
        publishedAt,
        title: "Autumn scenery",
        copyright: "Author © Example",
        infoUrl: "https://www.bing.com/search?q=autumn",
        url: "https://www.bing.com/th?id=OHR.Autumn_JA-JP123_UHD.jpg&qlt=100",
        fallbackUrl: "https://www.bing.com/th?id=OHR.Autumn_JA-JP123_1920x1080.jpg",
      },
    });
    expect(payload.images[0]?.title).toBe("Autumn scenery");
  });

  it("handles normal resolution and missing titles", () => {
    const image = { ...payload.images[0], title: undefined };
    const result = parseBing({ images: [image] }, { ...config, resolution: "1920x1080" });
    expect(result.ok && result.value.title).toBe("Author © Example");
    expect(result.ok && result.value.url).toContain("_1920x1080.jpg");
  });

  it.each([
    null,
    [],
    42,
    {},
    { images: [] },
    { images: null },
    { images: [null] },
    { images: [[]] },
    ...["fullstartdate", "urlbase", "url", "copyright", "copyrightlink"].flatMap((key) =>
      [undefined, 12, ""].map((value) => ({ images: [{ ...payload.images[0], [key]: value }] })),
    ),
    ...["20260231000000", "20261301000000", "x20261006000000", "20261006250000"].map(
      (fullstartdate) => ({ images: [{ ...payload.images[0], fullstartdate }] }),
    ),
    { images: [{ ...payload.images[0], urlbase: "https://evil.example/image" }] },
    { images: [{ ...payload.images[0], url: "//evil.example/image" }] },
    { images: [{ ...payload.images[0], copyrightlink: "javascript:alert(1)" }] },
  ])("rejects invalid information %#", (input) => {
    expect(parseBing(input, config).ok).toBe(false);
  });
});

describe("update and storage decisions", () => {
  it("converts exceptions and arbitrary error values for display", () => {
    expect(errorMessage(new Error("Failure"))).toBe("Failure");
    expect(errorMessage("failure")).toBe("failure");
  });

  it("schedules the next UTC day plus five minutes or rechecks an old image after one hour", () => {
    expect(nextRefresh(publishedAt, publishedAt)).toBe(publishedAt + 86_400_000 + 300_000);
    expect(nextRefresh(publishedAt, publishedAt + 172_800_000)).toBe(
      publishedAt + 172_800_000 + 3_600_000,
    );
    const leap = Date.UTC(2024, 1, 28);
    expect(nextRefresh(leap, leap)).toBe(Date.UTC(2024, 1, 29, 0, 5));
  });

  it("increases retries from fifteen minutes to a maximum of six hours", () => {
    expect([0, 1, 2, 8].map((attempt) => retryDelay(attempt))).toStrictEqual([
      900_000, 1_800_000, 3_600_000, 21_600_000,
    ]);
  });

  it("removes images older than seven days and protects current and restoration images", () => {
    const now = publishedAt;
    const entries = [
      { id: "old", publishedAt: now - 8 * 86_400_000, uri: "file:///old.jpg" },
      { id: "current", publishedAt: now - 10 * 86_400_000, uri: "file:///current.jpg" },
      { id: "original", publishedAt: now - 12 * 86_400_000, uri: "file:///original.jpg" },
      { id: "boundary", publishedAt: now - 7 * 86_400_000, uri: "file:///boundary.jpg" },
      { id: "new", publishedAt: now, uri: "file:///new.jpg" },
    ];
    expect(
      expiredImages(entries, now, ["file:///current.jpg", "file:///original.jpg"]),
    ).toStrictEqual([entries[0]]);
    expect(entries).toHaveLength(5);
  });

  it("restores only extension-owned settings and preserves manual changes", () => {
    const original = { light: "before-light", dark: "before-dark" };
    expect(restoration(original, { light: "ours", dark: "ours" }, "ours")).toStrictEqual(original);
    expect(restoration(original, { light: "manual", dark: "ours" }, "ours")).toStrictEqual({
      light: "manual",
      dark: "before-dark",
    });
    expect(restoration(original, original, null)).toStrictEqual(original);
    expect(restoration(original, { light: "ours", dark: "manual" }, "ours")).toStrictEqual({
      light: "before-light",
      dark: "manual",
    });
  });
});
