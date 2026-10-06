import type { CacheEntry, Config, Result, Wallpaper, Background } from "./model";

const DAY = 86_400_000;
const PUBLISH_MARGIN = 300_000;
const STALE_RECHECK = 3_600_000;
const RETRY_INITIAL = 900_000;
const RETRY_MAX = 21_600_000;
const RETENTION_DAYS = 7;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === "string" && value.length > 0;

export const imageKey = (config: Config, base: string): string =>
  `${config.market}-${config.resolution}-${encodeURIComponent(base)}`;

export const parseBing = (input: unknown, config: Config): Result<Wallpaper> => {
  if (!isRecord(input) || !Array.isArray(input.images)) {
    return { ok: false, error: "Invalid Bing image information" };
  }
  const image: unknown = input.images[0];
  if (
    !isRecord(image) ||
    !text(image.fullstartdate) ||
    !text(image.urlbase) ||
    !text(image.url) ||
    !text(image.copyright) ||
    !text(image.copyrightlink)
  ) {
    return { ok: false, error: "Incomplete Bing image information" };
  }
  const stamp = image.fullstartdate;
  if (
    !/^\d{14}$/u.test(stamp) ||
    !image.urlbase.startsWith("/th?id=OHR.") ||
    !image.url.startsWith("/th?id=OHR.") ||
    !image.copyrightlink.startsWith("https://www.bing.com/")
  ) {
    return { ok: false, error: "Invalid Bing date or URL" };
  }
  const iso = stamp.replace(
    /^(?<year>\d{4})(?<month>\d{2})(?<day>\d{2})(?<hour>\d{2})(?<minute>\d{2})(?<second>\d{2})$/u,
    "$<year>-$<month>-$<day>T$<hour>:$<minute>:$<second>.000Z",
  );
  const publishedAt = Date.parse(iso);
  if (!Number.isFinite(publishedAt) || new Date(publishedAt).toISOString() !== iso) {
    return { ok: false, error: "Invalid Bing date" };
  }
  return {
    ok: true,
    value: {
      id: imageKey(config, image.urlbase),
      publishedAt,
      title: text(image.title) ? image.title : image.copyright,
      copyright: image.copyright,
      infoUrl: image.copyrightlink,
      url: `https://www.bing.com${image.urlbase}_${config.resolution}.jpg&qlt=100`,
      fallbackUrl: `https://www.bing.com${image.url}`,
    },
  };
};

export const nextRefresh = (publishedAt: number, now: number): number => {
  const due = publishedAt + DAY + PUBLISH_MARGIN;
  return due > now ? due : now + STALE_RECHECK;
};
export const retryDelay = (failures: number): number =>
  Math.min(RETRY_INITIAL * 2 ** failures, RETRY_MAX);
export const expiredImages = (
  entries: readonly CacheEntry[],
  now: number,
  protectedUris: readonly string[],
): readonly CacheEntry[] =>
  entries.filter(
    (entry) => entry.publishedAt < now - RETENTION_DAYS * DAY && !protectedUris.includes(entry.uri),
  );
export const restoration = (
  original: Background,
  current: Background,
  owned: string | null,
): Background => ({
  light: current.light === owned ? original.light : current.light,
  dark: current.dark === owned ? original.dark : current.dark,
});

export const errorMessage = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);
