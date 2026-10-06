export type Result<T> = Readonly<{ ok: true; value: T } | { ok: false; error: string }>;
export type Config = Readonly<{ market: string; resolution: "UHD" | "1920x1080" }>;
export type Wallpaper = Readonly<{
  id: string;
  publishedAt: number;
  title: string;
  copyright: string;
  infoUrl: string;
  url: string;
  fallbackUrl: string;
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
  save: (image: Wallpaper, bytes: Uint8Array, cancellation: Cancellation) => Promise<CacheEntry>;
  exists: (uri: string, cancellation: Cancellation) => Promise<boolean>;
  remove: (entry: CacheEntry, cancellation: Cancellation) => Promise<void>;
  record: (entries: readonly CacheEntry[], cancellation: Cancellation) => Promise<void>;
}>;
export type Ports = Readonly<{
  source: ImageSource;
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
