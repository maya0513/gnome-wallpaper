import { it, expect, describe, vi } from "vite-plus/test";

import { createController } from "../src/controller";
import type { CacheEntry, Cancellation, Config, Ports, View, Wallpaper } from "../src/model";

const image: Wallpaper = {
  id: "today",
  publishedAt: Date.UTC(2026, 9, 6),
  title: "Autumn",
  copyright: "Author",
  infoUrl: "https://www.bing.com/info",
  url: "primary",
  fallbackUrl: "fallback",
};
const before = { light: "file:///before-light", dark: "file:///before-dark" };
const entry: CacheEntry = {
  id: image.id,
  publishedAt: image.publishedAt,
  uri: "file:///today.jpg",
};
const settings: Config = { market: "ja-JP", resolution: "UHD" };
const deferred = <T>() => {
  let resolveValue!: (value: T) => void;
  let rejectValue!: (error: Error) => void;
  const promise = new Promise<T>((resolve, reject) => {
    resolveValue = resolve;
    rejectValue = reject;
  });
  return { promise, resolve: resolveValue, reject: rejectValue };
};
const setup = () => {
  let current = { ...before };
  let config = settings;
  const views: View[] = [];
  const timers: { callback: () => void; stop: ReturnType<typeof vi.fn<() => void>> }[] = [];
  const cancellations: Cancellation[] = [];
  const ports: Ports = {
    source: { latest: vi.fn(async () => ({ ok: true as const, value: image })) },
    download: vi.fn(async () => new Uint8Array([1, 2, 3])),
    storage: {
      load: vi.fn(async () => []),
      save: vi.fn(async () => entry),
      exists: vi.fn(async () => true),
      remove: vi.fn(async () => {}),
      record: vi.fn(async () => {}),
    },
    background: {
      read: vi.fn(() => current),
      write: vi.fn((value: typeof before) => {
        current = { ...value };
      }),
    },
    now: () => image.publishedAt,
    schedule: vi.fn((_delay: number, callback: () => void) => {
      const timer = { callback, stop: vi.fn() };
      timers.push(timer);
      return () => {
        timer.stop();
      };
    }),
    cancellation: () => {
      let cancelled = false;
      const token = {
        cancelled: () => cancelled,
        cancel: () => {
          cancelled = true;
        },
      };
      cancellations.push(token);
      return token;
    },
    render: vi.fn((view: View) => views.push(view)),
    log: vi.fn(),
  };
  const controller = createController(ports, () => config);
  return {
    ports,
    controller,
    views,
    timers,
    cancellations,
    current: () => current,
    change: (value: typeof before) => {
      current = value;
    },
    configure: (value: Config) => {
      config = value;
    },
  };
};

describe("wallpaper update lifecycle", () => {
  it("applies both themes after downloading, saving, and recording and schedules the next update", async () => {
    const s = setup();
    await s.controller.refresh();
    expect(s.current()).toStrictEqual({ light: entry.uri, dark: entry.uri });
    expect(s.ports.storage.record).toHaveBeenCalledWith([entry], expect.anything());
    expect(s.ports.schedule).toHaveBeenCalledWith(86_700_000, expect.any(Function));
    expect(s.views.at(-1)).toStrictEqual({
      busy: false,
      image,
      error: null,
      nextAt: image.publishedAt + 86_700_000,
    });
    expect(s.views[0]?.busy).toBe(true);
    s.controller.disable();
    expect(s.current()).toStrictEqual(before);
    expect(s.timers[0]?.stop).toHaveBeenCalledOnce();
    expect(s.cancellations[0]?.cancelled()).toBe(true);
    s.controller.disable();
    expect(s.ports.background.write).toHaveBeenCalledTimes(2);
  });

  it("reuses the same image and downloads again only when the cached file is missing", async () => {
    const s = setup();
    vi.mocked(s.ports.storage.load).mockResolvedValue([entry]);
    await s.controller.refresh();
    expect(s.ports.download).not.toHaveBeenCalled();
    vi.mocked(s.ports.storage.exists).mockResolvedValue(false);
    await s.controller.refresh();
    expect(s.ports.download).toHaveBeenCalledOnce();
    expect(s.ports.storage.record).toHaveBeenLastCalledWith([entry], expect.anything());
  });

  it("falls back to the provided URL when UHD is unavailable", async () => {
    const s = setup();
    vi.mocked(s.ports.download).mockRejectedValueOnce(new Error("UHD unavailable"));
    await s.controller.refresh();
    expect(s.ports.download).toHaveBeenNthCalledWith(2, "fallback", expect.anything());
    expect(s.views.at(-1)?.error).toBeNull();
  });

  it("retries download failures at normal resolution", async () => {
    const s = setup();
    s.configure({ ...settings, resolution: "1920x1080" });
    vi.mocked(s.ports.download).mockRejectedValue("offline");
    await s.controller.refresh();
    expect(s.ports.download).toHaveBeenCalledOnce();
    expect(s.current()).toStrictEqual(before);
    expect(s.views.at(-1)?.error).toBe("offline");
  });

  it("retries source failures and resets the delay on success", async () => {
    const s = setup();
    vi.mocked(s.ports.source.latest)
      .mockResolvedValueOnce({ ok: false, error: "offline" })
      .mockResolvedValueOnce({ ok: false, error: "offline" });
    await s.controller.refresh();
    expect(s.views.at(-1)?.nextAt).toBe(image.publishedAt + 900_000);
    await s.controller.refresh();
    expect(s.views.at(-1)?.nextAt).toBe(image.publishedAt + 1_800_000);
    await s.controller.refresh();
    vi.mocked(s.ports.source.latest).mockResolvedValueOnce({ ok: false, error: "offline" });
    await s.controller.refresh();
    expect(s.views.at(-1)?.nextAt).toBe(image.publishedAt + 900_000);
    expect(s.views.at(-1)?.image).toStrictEqual(image);
  });

  it.each(["load", "save", "record"] as const)(
    "preserves the original wallpaper when storage operation %s fails",
    async (operation) => {
      const s = setup();
      vi.mocked(s.ports.storage[operation]).mockRejectedValue(new Error("disk error"));
      await s.controller.refresh();
      expect(s.current()).toStrictEqual(before);
      expect(s.views.at(-1)?.error).toBe("disk error");
    },
  );

  it("preserves the original wallpaper when both image downloads fail", async () => {
    const s = setup();
    vi.mocked(s.ports.download).mockRejectedValue(new Error("offline"));
    await s.controller.refresh();
    expect(s.current()).toStrictEqual(before);
    expect(s.views.at(-1)?.error).toBe("offline");
  });

  it("logs application and restoration failures", async () => {
    const s = setup();
    vi.mocked(s.ports.background.write).mockImplementationOnce(() => {
      throw new Error("settings locked");
    });
    await s.controller.refresh();
    expect(s.views.at(-1)?.error).toBe("settings locked");
    await s.controller.refresh();
    vi.mocked(s.ports.background.write).mockImplementationOnce(() => {
      throw new Error("restore error");
    });
    s.controller.disable();
    expect(s.ports.log).toHaveBeenLastCalledWith("restore error");
  });

  it("preserves manual changes and restores only extension-owned keys", async () => {
    const s = setup();
    await s.controller.refresh();
    s.change({ light: "manual", dark: entry.uri });
    s.controller.disable();
    expect(s.current()).toStrictEqual({ light: "manual", dark: before.dark });
  });

  it("leaves settings untouched on disable when no image has been applied", async () => {
    const s = setup();
    s.controller.disable();
    await s.controller.refresh();
    await s.controller.reconfigure();
    expect(s.ports.background.write).not.toHaveBeenCalled();
    expect(s.ports.source.latest).not.toHaveBeenCalled();
  });

  it("protects current and restoration images while removing old images and updating the index", async () => {
    const s = setup();
    const old = {
      ...entry,
      id: "old",
      publishedAt: image.publishedAt - 8 * 86_400_000,
      uri: "file:///old.jpg",
    };
    const original = { ...old, id: "original", uri: before.light };
    vi.mocked(s.ports.storage.load).mockResolvedValue([old, original]);
    await s.controller.refresh();
    expect(s.ports.storage.remove).toHaveBeenCalledExactlyOnceWith(old, expect.anything());
    expect(s.ports.storage.record).toHaveBeenLastCalledWith([original, entry], expect.anything());
  });

  it("keeps the new wallpaper after cleanup failure and shows an error and retry", async () => {
    const s = setup();
    vi.mocked(s.ports.storage.load).mockResolvedValue([
      { ...entry, id: "old", publishedAt: 0, uri: "old" },
    ]);
    vi.mocked(s.ports.storage.remove).mockRejectedValue(new Error("delete error"));
    await s.controller.refresh();
    expect(s.current().light).toBe(entry.uri);
    expect(s.views.at(-1)?.error).toBe("delete error");
  });

  it("deduplicates manual updates during a request and runs scheduled updates", async () => {
    const s = setup();
    const pending = deferred<readonly CacheEntry[]>();
    vi.mocked(s.ports.storage.load).mockReturnValueOnce(pending.promise);
    const first = s.controller.refresh();
    await s.controller.refresh();
    expect(s.ports.storage.load).toHaveBeenCalledOnce();
    pending.resolve([]);
    await first;
    s.timers[0]?.callback();
    await vi.waitFor(() => {
      expect(s.ports.source.latest).toHaveBeenCalledTimes(2);
    });
  });

  it.each(["load", "source", "download", "save", "record", "remove", "prune", "exists"] as const)(
    "stops effects when %s completes after disable",
    async (stage) => {
      const s = setup();
      const pending = deferred<void>();
      const after = async <T>(value: T): Promise<T> => {
        await pending.promise;
        return value;
      };
      const old = { ...entry, id: "old", publishedAt: 0, uri: "old" };
      switch (stage) {
        case "source": {
          vi.mocked(s.ports.source.latest).mockReturnValueOnce(after({ ok: true, value: image }));
          break;
        }
        case "download": {
          vi.mocked(s.ports.download).mockReturnValueOnce(after(new Uint8Array([1])));
          break;
        }
        case "save": {
          vi.mocked(s.ports.storage.save).mockReturnValueOnce(after(entry));
          break;
        }
        case "record": {
          vi.mocked(s.ports.storage.record).mockReturnValueOnce(after(undefined));
          break;
        }
        case "remove": {
          vi.mocked(s.ports.storage.load).mockResolvedValue([old]);
          vi.mocked(s.ports.storage.remove).mockReturnValueOnce(after(undefined));
          break;
        }
        case "exists": {
          vi.mocked(s.ports.storage.load).mockResolvedValue([entry]);
          vi.mocked(s.ports.storage.exists).mockReturnValueOnce(after(true));
          break;
        }
        case "prune": {
          vi.mocked(s.ports.storage.load).mockResolvedValue([old]);
          vi.mocked(s.ports.storage.record)
            .mockResolvedValueOnce()
            .mockReturnValueOnce(after(undefined));
          break;
        }
        case "load": {
          vi.mocked(s.ports.storage.load).mockReturnValueOnce(after([]));
          break;
        }
      }
      const update = s.controller.refresh();
      await vi.waitFor(() => {
        expect(
          stage === "source"
            ? s.ports.source.latest
            : stage === "download"
              ? s.ports.download
              : stage === "prune"
                ? s.ports.storage.remove
                : s.ports.storage[stage],
        ).toHaveBeenCalled();
      });
      s.controller.disable();
      const calls = vi.mocked(s.ports.background.write).mock.calls.length;
      const renders = s.views.length;
      pending.resolve();
      await update;
      expect(s.ports.background.write).toHaveBeenCalledTimes(calls);
      expect(s.views).toHaveLength(renders);
      expect(s.ports.schedule).not.toHaveBeenCalled();
    },
  );

  it("ignores cancellation errors and avoids a fallback download", async () => {
    const s = setup();
    const pending = deferred<Uint8Array>();
    vi.mocked(s.ports.download).mockReturnValue(pending.promise);
    const update = s.controller.refresh();
    await vi.waitFor(() => {
      expect(s.ports.download).toHaveBeenCalled();
    });
    s.controller.disable();
    pending.reject(new Error("cancelled"));
    await update;
    expect(s.ports.download).toHaveBeenCalledOnce();
    expect(s.ports.log).not.toHaveBeenCalled();
  });

  it("cancels old requests on configuration changes without overwriting the new view", async () => {
    const s = setup();
    const pending =
      deferred<ReturnType<Ports["source"]["latest"]> extends Promise<infer T> ? T : never>();
    vi.mocked(s.ports.source.latest).mockReturnValueOnce(pending.promise);
    const old = s.controller.refresh();
    await vi.waitFor(() => {
      expect(s.ports.source.latest).toHaveBeenCalled();
    });
    s.configure({ ...settings, market: "en-US" });
    await s.controller.reconfigure();
    const renders = s.views.length;
    pending.resolve({ ok: false, error: "old response" });
    await old;
    expect(s.ports.source.latest).toHaveBeenLastCalledWith(
      { ...settings, market: "en-US" },
      expect.anything(),
    );
    expect(s.views).toHaveLength(renders);
    expect(s.views.at(-1)?.error).toBeNull();
  });
});
