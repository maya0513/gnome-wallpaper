export type Result<T> = Readonly<{ ok: true; value: T } | { ok: false; error: string }>;
export const SOURCE_IDS = ["bing", "nasa-iotd", "self"] as const;
export type SourceId = (typeof SOURCE_IDS)[number];
export const SOURCE_NAMES = {
  bing: "Bing",
  "nasa-iotd": "NASA Image of the Day",
  self: "My images",
} as const;
export type Config = Readonly<{
  source: SourceId;
  market: string;
  resolution: "UHD" | "1920x1080";
}>;
export type RemoteWallpaper = Readonly<{
  source: "bing" | "nasa-iotd";
  id: string;
  publishedAt: number;
  title: string;
  copyright: string;
  infoUrl: string;
  url: string;
  fallbackUrl: string | null;
}>;
export type SelfSelection = readonly [filename: string, day: string];
export type SelfWallpaper = Readonly<{
  source: "self";
  title: string;
  copyright: string;
  uri: string;
  selection: SelfSelection;
}>;
export type Wallpaper = RemoteWallpaper | SelfWallpaper;
export type SelfFiles = Readonly<{
  list: (cancellation: Cancellation) => Promise<readonly string[]>;
  valid: (name: string, cancellation: Cancellation) => Promise<boolean>;
  uri: (name: string) => string;
}>;
export type SelfSelectionStore = Readonly<{
  read: () => SelfSelection;
  write: (selection: SelfSelection) => void;
}>;
export type CacheEntry = Readonly<{ id: string; publishedAt: number; uri: string }>;
export type Background = Readonly<{ light: string; dark: string }>;
export type Cancellation = Readonly<{
  cancelled: () => boolean;
  cancel: () => void;
}>;
export type ImageSource = Readonly<{
  latest: (config: Config, cancellation: Cancellation) => Promise<Result<Wallpaper>>;
}>;
export type View = Readonly<{
  busy: boolean;
  image: Wallpaper | null;
  error: string | null;
  nextAt: number | null;
}>;
export type Storage = Readonly<{
  load: (cancellation: Cancellation) => Promise<readonly CacheEntry[]>;
  save: (
    image: RemoteWallpaper,
    bytes: Uint8Array,
    cancellation: Cancellation,
  ) => Promise<CacheEntry>;
  exists: (uri: string, cancellation: Cancellation) => Promise<boolean>;
  remove: (entry: CacheEntry, cancellation: Cancellation) => Promise<void>;
  record: (entries: readonly CacheEntry[], cancellation: Cancellation) => Promise<void>;
}>;
export type Ports = Readonly<{
  source: ImageSource;
  selfSelection: SelfSelectionStore;
  download: (url: string, cancellation: Cancellation) => Promise<Uint8Array>;
  storage: Storage;
  background: Readonly<{ read: () => Background; write: (value: Background) => void }>;
  now: () => number;
  schedule: (delay: number, callback: () => void) => () => void;
  cancellation: () => Cancellation;
  render: (view: View) => void;
  log: (message: string) => void;
}>;

export type Controller = Readonly<{
  refresh: () => Promise<void>;
  reconfigure: () => Promise<void>;
  disable: () => void;
}>;
