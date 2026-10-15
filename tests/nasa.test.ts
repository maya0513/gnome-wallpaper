import { expect, it, vi } from "vite-plus/test";
import { createNasaSource, parseNasaFeed, selectNasaImage } from "../src/nasa";
import { createSource } from "../src/sources";
import { nasaFeed, nasaMetadata } from "./fixtures/nasa";
import { defined } from "./helpers";

const config = { source: "nasa-iotd" as const, market: "ja-JP", resolution: "UHD" as const };
const token = { cancelled: () => false, cancel: () => {} };
const bytes = (value: string) => new TextEncoder().encode(value);
const parsed = parseNasaFeed(nasaFeed);
if (!parsed.ok) {
  throw new Error(parsed.error);
}
const items = parsed.value;
const crew = defined(nasaMetadata[2]);
const crewItem = defined(items[1]);
const withDimensions = (media_details: unknown) => ({ ...crew, media_details });
const single = (item: string) => `<rss><channel>${item}</channel></rss>`;
const validItem = `<item><title>Photo &#169; NASA</title><link>https://www.nasa.gov/image-detail/crew/</link><pubDate>Thu, 08 Oct 2026 12:00 GMT</pubDate><enclosure url="${crew.source_url}" type="image/jpeg"/></item>`;

it("sorts by publication date, decodes XML text and CDATA, and selects the newest matching wide photo", () => {
  expect(items.map((item) => item.slug)).toStrictEqual(["portrait", "crew", "older"]);
  expect(selectNasaImage(items, nasaMetadata)).toStrictEqual({
    ok: true,
    value: {
      source: "nasa-iotd",
      id: "nasa-iotd-3",
      publishedAt: Date.UTC(2026, 9, 8, 12),
      title: "Crew returns & lands",
      copyright: "NASA/Photographer",
      infoUrl: crewItem.infoUrl,
      url: crew.source_url,
      fallbackUrl: null,
    },
  });
  const one = parseNasaFeed(single(validItem));
  expect(one.ok && one.value[0]?.title).toBe("Photo © NASA");
  expect(selectNasaImage(items, [nasaMetadata[0]])).toMatchObject({
    ok: true,
    value: { copyright: "NASA & ESA" },
  });
  const many = parseNasaFeed(single(validItem.repeat(21)));
  expect(many.ok && many.value).toHaveLength(20);
});

it.each([
  "<rss>",
  "<!DOCTYPE rss><rss/>",
  "<other/>",
  "<rss/>",
  "<rss><channel/></rss>",
  single(""),
  single("<item/>"),
  single(validItem.replace("<title>Photo &#169; NASA</title>", "")),
  single(validItem.replace("<link>https://www.nasa.gov/image-detail/crew/</link>", "")),
  single(validItem.replace("<pubDate>Thu, 08 Oct 2026 12:00 GMT</pubDate>", "")),
  single(validItem.replace(/<enclosure[^>]*\/>/u, "")),
  single(
    validItem.replace(
      "https://www.nasa.gov/image-detail/crew/",
      "https://www.nasa.gov.evil/image-detail/crew/",
    ),
  ),
  single(validItem.replace("Thu, 08 Oct 2026 12:00 GMT", "invalid")),
  single(validItem.replace(crew.source_url, "https://evil.example/crew.jpg")),
  single(validItem.replace(`url="${crew.source_url}"`, "")),
  single(validItem.replace("image/jpeg", "image/svg+xml")),
  single(validItem.replace("<title>Photo &#169; NASA</title>", "<title>A</title><title>B</title>")),
])("rejects malformed feeds and ignores invalid entries %#", (input) => {
  expect(parseNasaFeed(input).ok).toBe(false);
});

it("keeps valid items when a feed contains invalid items", () => {
  const result = parseNasaFeed(single(`<item/>${validItem}`));
  expect(result.ok && result.value).toHaveLength(1);
});

it.each([null, {}, "metadata"])("rejects invalid metadata %#", (input) => {
  expect(selectNasaImage(items, input)).toMatchObject({
    ok: false,
    error: "Invalid NASA image metadata",
  });
});

it.each([
  null,
  {},
  { ...crew, slug: "wrong" },
  { ...crew, source_url: "https://evil.example/image.jpg" },
  { ...crew, mime_type: "image/svg+xml" },
  { ...crew, id: "3" },
  { ...crew, id: 1.5 },
  { ...crew, id: -1 },
  { ...crew, id: 0 },
  { ...crew, media_details: null },
  ...[
    { width: "4000", height: 2667 },
    { width: 4000, height: "2667" },
    { width: 4000.5, height: 2667 },
    { width: 4000, height: 2667.5 },
    { width: 1919, height: 1080 },
    { width: 1920, height: 1079 },
    { width: 4000, height: 4000 },
    { width: 4000, height: 5000 },
    { width: 4801, height: 2000 },
  ].map((value) => withDimensions(value)),
])("excludes unmatched, invalid or unsuitable metadata %#", (input) => {
  expect(selectNasaImage([crewItem], [input])).toMatchObject({
    ok: false,
    error: "No NASA wallpaper meets the wide Full HD image criteria",
  });
});

it.each([
  { width: 1920, height: 1080 },
  { width: 2900, height: 2000 },
  { width: 4800, height: 2000 },
])("includes the size and ratio boundaries %o", (dimensions) => {
  expect(selectNasaImage([crewItem], [{ ...crew, media_details: dimensions }]).ok).toBe(true);
});

it.each([undefined, null, {}, { credit: "" }, { credit: "   " }, { credit: 12 }])(
  "handles absent individual credits %#",
  (image_meta) => {
    expect(
      selectNasaImage(
        [crewItem],
        [{ ...crew, media_details: { ...crew.media_details, image_meta } }],
      ),
    ).toMatchObject({ ok: true, value: { copyright: "See source page for individual credits" } });
  },
);

it("fetches metadata in one request, preserves cancellation tokens and routes both sources", async () => {
  const bing = {
    images: [
      {
        fullstartdate: "20261006000000",
        copyright: "Author",
        copyrightlink: "https://www.bing.com/search",
        urlbase: "/th?id=OHR.Test",
        url: "/th?id=OHR.Test.jpg",
      },
    ],
  };
  const fetch = vi.fn(async (url: string) =>
    url.includes("HPImageArchive")
      ? bytes(JSON.stringify(bing))
      : url.includes("/feeds/")
        ? bytes(nasaFeed)
        : bytes(JSON.stringify(nasaMetadata)),
  );
  const source = createSource(fetch, { latest: async () => ({ ok: false, error: "Not self" }) });
  await expect(source.latest(config, token)).resolves.toMatchObject({
    ok: true,
    value: { source: "nasa-iotd" },
  });
  expect(fetch).toHaveBeenNthCalledWith(
    2,
    "https://www.nasa.gov/wp-json/wp/v2/media?slug=portrait%2Ccrew%2Colder&per_page=20&_fields=id,slug,source_url,mime_type,media_details",
    token,
  );
  await expect(source.latest({ ...config, source: "bing" }, token)).resolves.toMatchObject({
    ok: true,
    value: { source: "bing" },
  });
  const second = await source.latest(
    { ...config, market: "en-US", resolution: "1920x1080" },
    token,
  );
  expect(second.ok && second.value.source !== "self" && second.value.id).toBe("nasa-iotd-3");
});

it.each([new Uint8Array([255]), bytes("<rss>"), bytes(single(""))])(
  "reports invalid feed responses without requesting metadata %#",
  async (input) => {
    const fetch = vi.fn(async () => input);
    const result = await createNasaSource(fetch).latest(config, token);
    expect(result.ok).toBe(false);
    expect(fetch).toHaveBeenCalledOnce();
  },
);

it("reports invalid metadata JSON, network failures and cancellation", async () => {
  const fetch = vi
    .fn(async () => bytes(nasaFeed))
    .mockResolvedValueOnce(bytes(nasaFeed))
    .mockResolvedValueOnce(bytes("{"));
  const result = await createNasaSource(fetch).latest(config, token);
  expect(result.ok).toBe(false);
  fetch.mockRejectedValue(new Error("offline"));
  await expect(createNasaSource(fetch).latest(config, token)).resolves.toStrictEqual({
    ok: false,
    error: "offline",
  });
  fetch.mockResolvedValue(bytes(nasaFeed));
  fetch.mockClear();
  await expect(
    createNasaSource(fetch).latest(config, { ...token, cancelled: () => true }),
  ).resolves.toStrictEqual({ ok: false, error: "Cancelled" });
  expect(fetch).toHaveBeenCalledOnce();
});
