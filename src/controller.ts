import { errorMessage, expiredImages, nextRefresh, restoration, retryDelay } from "./core";
import type { CacheEntry, Cancellation, Config, Controller, Ports, View } from "./model";

export const createController = (ports: Ports, config: () => Config): Controller => {
  const original = ports.background.read();
  let active = true;
  let generation = 0;
  let busy = false;
  let failures = 0;
  let owned: string | null = null;
  let cancellation: Cancellation | null = null;
  let timer: (() => void) | null = null;
  let view: View = { busy: false, image: null, error: null, nextAt: null };
  const publish = (patch: Partial<View>) => {
    view = { ...view, ...patch };
    ports.render(view);
  };
  const stop = () => {
    cancellation?.cancel();
    timer?.();
    timer = null;
  };
  const schedule = (nextAt: number) => {
    timer = ports.schedule(Math.max(0, nextAt - ports.now()), () => {
      timer = null;
      void refresh();
    });
    publish({ busy: false, nextAt });
  };

  const refresh = async (): Promise<void> => {
    if (!active || busy) {
      return;
    }
    stop();
    busy = true;
    const ticket = ++generation;
    const token = ports.cancellation();
    cancellation = token;
    const stale = () => !active || ticket !== generation || token.cancelled();
    publish({ busy: true, error: null, nextAt: null });
    try {
      const settings = config();
      const entries = await ports.storage.load(token);
      if (stale()) {
        return;
      }
      const result = await ports.source.latest(settings, token);
      if (stale()) {
        return;
      }
      if (!result.ok) {
        throw new Error(result.error);
      }
      const image = result.value;
      const cached = entries.find((item) => item.id === image.id);
      let entry: CacheEntry;
      const exists = cached && (await ports.storage.exists(cached.uri, token));
      if (stale()) {
        return;
      }
      if (exists === true) {
        entry = cached;
      } else {
        let bytes: Uint8Array;
        try {
          bytes = await ports.download(image.url, token);
        } catch (error) {
          if (settings.resolution !== "UHD" || stale()) {
            throw error;
          }
          bytes = await ports.download(image.fallbackUrl, token);
        }
        if (stale()) {
          return;
        }
        entry = await ports.storage.save(image, bytes, token);
      }
      if (stale()) {
        return;
      }
      const updated = [...entries.filter((item) => item.id !== entry.id), entry];
      await ports.storage.record(updated, token);
      if (stale()) {
        return;
      }
      ports.background.write({ light: entry.uri, dark: entry.uri });
      owned = entry.uri;
      publish({ image });
      const current = ports.background.read();
      const expired = expiredImages(updated, ports.now(), [
        original.light,
        original.dark,
        current.light,
        current.dark,
      ]);
      for (const item of expired) {
        await ports.storage.remove(item, token);
        if (stale()) {
          return;
        }
      }
      if (expired.length > 0) {
        await ports.storage.record(
          updated.filter((item) => !expired.includes(item)),
          token,
        );
      }
      if (stale()) {
        return;
      }
      failures = 0;
      schedule(nextRefresh(image.publishedAt, ports.now()));
    } catch (error) {
      if (stale()) {
        return;
      }
      const message = errorMessage(error);
      ports.log(message);
      publish({ error: message });
      schedule(ports.now() + retryDelay(failures++));
    } finally {
      if (ticket === generation) {
        busy = false;
      }
    }
  };

  return {
    refresh,
    reconfigure: async () => {
      if (!active) {
        return;
      }
      stop();
      generation++;
      busy = false;
      await refresh();
    },
    disable: () => {
      if (!active) {
        return;
      }
      active = false;
      generation++;
      stop();
      if (owned !== null) {
        try {
          ports.background.write(restoration(original, ports.background.read(), owned));
        } catch (error) {
          ports.log(errorMessage(error));
        }
      }
    },
  };
};
