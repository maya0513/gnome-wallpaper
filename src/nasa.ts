import { XMLParser } from "fast-xml-parser";
import { SyntaxValidator } from "fast-xml-validator";
import { decodeHTML } from "entities/decode";
import { errorMessage, isRecord, text } from "./core";
import type { ImageSource, Ports, Result, RemoteWallpaper } from "./model";

const FEED = "https://www.nasa.gov/feeds/iotd-feed/";
const MEDIA = "https://www.nasa.gov/wp-json/wp/v2/media";
const MAX_ITEMS = 20;
const MIN_WIDTH = 1920;
const MIN_HEIGHT = 1080;
const MIN_RATIO = 1.45;
const MAX_RATIO = 2.4;
const decode = (bytes: Uint8Array): string =>
  new TextDecoder("utf-8", { fatal: true }).decode(bytes);
type Item = Readonly<{
  title: string;
  infoUrl: string;
  url: string;
  slug: string;
  publishedAt: number;
  mime: string;
}>;
const imageUrl = (value: unknown): value is string =>
  text(value) &&
  /^https:\/\/www\.nasa\.gov\/wp-content\/uploads\/\d{4}\/\d{2}\/[^\s?#]+\.(?:jpe?g|png)$/iu.test(
    value,
  );
const mimeType = (value: unknown): value is string =>
  value === "image/jpeg" || value === "image/png";

const parseItem = (input: unknown): Item | null => {
  if (
    !isRecord(input) ||
    !text(input.title) ||
    !text(input.link) ||
    !text(input.pubDate) ||
    !isRecord(input.enclosure)
  ) {
    return null;
  }
  const slug = /^https:\/\/www\.nasa\.gov\/image-detail\/(?<slug>[\w-]+)\/?$/u.exec(input.link)
    ?.groups?.slug;
  const publishedAt = Date.parse(input.pubDate);
  if (
    slug === undefined ||
    !Number.isFinite(publishedAt) ||
    !imageUrl(input.enclosure["@_url"]) ||
    !mimeType(input.enclosure["@_type"])
  ) {
    return null;
  }
  return {
    title: decodeHTML(input.title).trim(),
    infoUrl: input.link,
    url: input.enclosure["@_url"],
    mime: input.enclosure["@_type"],
    slug,
    publishedAt,
  };
};

export const parseNasaFeed = (input: string): Result<readonly Item[]> => {
  // The public feed needs no DTD or custom entities.
  if (/<!DOCTYPE/iu.test(input)) {
    return { ok: false, error: "Invalid NASA RSS feed" };
  }
  try {
    SyntaxValidator.validate(input, { multipleRoots: false });
  } catch {
    return { ok: false, error: "Invalid NASA RSS feed" };
  }
  const data: unknown = new XMLParser({
    ignoreAttributes: false,
    parseTagValue: false,
    trimValues: true,
  }).parse(input);
  if (!isRecord(data) || !isRecord(data.rss) || !isRecord(data.rss.channel)) {
    return { ok: false, error: "Invalid NASA RSS channel" };
  }
  const { item } = data.rss.channel;
  const items: unknown[] = Array.isArray(item) ? item : [item];
  const valid = items
    .map((value) => parseItem(value))
    .filter((value) => value !== null)
    .toSorted((a, b) => b.publishedAt - a.publishedAt)
    .slice(0, MAX_ITEMS);
  return valid.length === 0
    ? { ok: false, error: "No valid NASA feed images" }
    : { ok: true, value: valid };
};

const wallpaper = (item: Item, media: unknown): RemoteWallpaper | null => {
  if (
    !isRecord(media) ||
    media.slug !== item.slug ||
    media.source_url !== item.url ||
    media.mime_type !== item.mime ||
    typeof media.id !== "number" ||
    !Number.isSafeInteger(media.id) ||
    media.id <= 0 ||
    !isRecord(media.media_details)
  ) {
    return null;
  }
  const { width, height, image_meta: meta } = media.media_details;
  if (
    typeof width !== "number" ||
    typeof height !== "number" ||
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < MIN_WIDTH ||
    height < MIN_HEIGHT ||
    width / height < MIN_RATIO ||
    width / height > MAX_RATIO
  ) {
    return null;
  }
  const credit = isRecord(meta) && text(meta.credit) ? decodeHTML(meta.credit).trim() : "";
  return {
    source: "nasa-iotd",
    id: `nasa-iotd-${media.id}`,
    publishedAt: item.publishedAt,
    title: item.title,
    copyright: credit.length > 0 ? credit : "See source page for individual credits",
    infoUrl: item.infoUrl,
    url: item.url,
    fallbackUrl: null,
  };
};

export const selectNasaImage = (
  items: readonly Item[],
  input: unknown,
): Result<RemoteWallpaper> => {
  if (!Array.isArray(input)) {
    return { ok: false, error: "Invalid NASA image metadata" };
  }
  const media: unknown[] = input;
  for (const item of items) {
    for (const candidate of media) {
      const image = wallpaper(item, candidate);
      if (image !== null) {
        return { ok: true, value: image };
      }
    }
  }
  return { ok: false, error: "No NASA wallpaper meets the wide Full HD image criteria" };
};

export const createNasaSource = (fetch: Ports["download"]): ImageSource => ({
  latest: async (_config, cancellation) => {
    try {
      const feed = parseNasaFeed(decode(await fetch(FEED, cancellation)));
      if (!feed.ok) {
        return feed;
      }
      if (cancellation.cancelled()) {
        return { ok: false, error: "Cancelled" };
      }
      const slugs = encodeURIComponent(feed.value.map((item) => item.slug).join(","));
      const bytes = await fetch(
        `${MEDIA}?slug=${slugs}&per_page=20&_fields=id,slug,source_url,mime_type,media_details`,
        cancellation,
      );
      const metadata: unknown = JSON.parse(decode(bytes));
      return selectNasaImage(feed.value, metadata);
    } catch (error) {
      return { ok: false, error: errorMessage(error) };
    }
  },
});
