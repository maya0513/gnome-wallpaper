import Gio from "gi://Gio";
import GLib from "gi://GLib";
import Soup from "gi://Soup?version=3.0";
import type { Background, CacheEntry, Cancellation, Ports, Storage } from "./model";

const tokens = new WeakMap<Cancellation, Gio.Cancellable>();
const native = (token: Cancellation): Gio.Cancellable => {
  const cancellable = tokens.get(token);
  if (cancellable === undefined) {
    throw new Error("Invalid cancellation token");
  }
  return cancellable;
};
const perform = <T>(
  start: (callback: (source: unknown, result: Gio.AsyncResult) => void) => void,
  finish: (result: Gio.AsyncResult) => T,
): Promise<T> =>
  new Promise((resolve, reject) => {
    start((_source, result) => {
      try {
        resolve(finish(result));
      } catch (error) {
        reject(error);
      }
    });
  });
const matches = (cause: unknown, code: number): boolean =>
  cause instanceof GLib.Error && cause.matches(Gio.io_error_quark(), code);
export const createCancellation = (): Cancellation => {
  const token = new Gio.Cancellable();
  const cancellation: Cancellation = {
    cancelled: () => token.is_cancelled(),
    cancel: () => {
      token.cancel();
    },
  };
  tokens.set(cancellation, token);
  return cancellation;
};
export const createHttp = (): Readonly<{ fetch: Ports["download"]; close: () => void }> => {
  const session = new Soup.Session({ timeout: 30, user_agent: "gnome-wallpaper/0.1" });
  const HTTP_OK = 200;
  const HTTP_REDIRECT = 300;
  const fetch: Ports["download"] = async (url, token) => {
    const message = Soup.Message.new("GET", url);
    if (message === null) {
      throw new Error("Invalid URL");
    }
    const bytes = await perform(
      (callback) => {
        session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, native(token), callback);
      },
      (result) => session.send_and_read_finish(result),
    );
    const status: number = message.get_status();
    if (status < HTTP_OK || status >= HTTP_REDIRECT) {
      throw new Error(`HTTP ${status}`);
    }
    const data = bytes.get_data();
    if (data === null) {
      throw new Error("Empty response");
    }
    return data;
  };
  return {
    fetch,
    close: () => {
      session.abort();
    },
  };
};
export const createStorage = (path: string): Storage => {
  const directory = Gio.File.new_for_path(path);
  const index = directory.get_child("index.json");
  const uriFor = (id: string) => directory.get_child(`${encodeURIComponent(id)}.jpg`).get_uri();
  const ensure = async (token: Cancellation) => {
    try {
      await perform(
        (callback) => {
          directory.make_directory_async(GLib.PRIORITY_DEFAULT, native(token), callback);
        },
        (result) => directory.make_directory_finish(result),
      );
    } catch (error) {
      if (!matches(error, Gio.IOErrorEnum.EXISTS)) {
        throw error;
      }
    }
  };
  const write = async (file: Gio.File, bytes: Uint8Array, token: Cancellation) => {
    await ensure(token);
    await perform(
      (callback) => {
        file.replace_contents_async(
          bytes,
          null,
          false,
          Gio.FileCreateFlags.REPLACE_DESTINATION,
          native(token),
          callback,
        );
      },
      (result) => file.replace_contents_finish(result),
    );
  };
  const isEntry = (item: unknown): item is CacheEntry =>
    typeof item === "object" &&
    item !== null &&
    "id" in item &&
    typeof item.id === "string" &&
    "publishedAt" in item &&
    typeof item.publishedAt === "number" &&
    Number.isFinite(item.publishedAt) &&
    "uri" in item &&
    item.uri === uriFor(item.id);
  return {
    load: async (token) => {
      let bytes: Uint8Array;
      try {
        [, bytes] = await perform(
          (callback) => {
            index.load_contents_async(native(token), callback);
          },
          (result) => index.load_contents_finish(result),
        );
      } catch (error) {
        if (matches(error, Gio.IOErrorEnum.NOT_FOUND)) {
          return [];
        }
        throw error;
      }
      const data: unknown = JSON.parse(new TextDecoder().decode(bytes));
      if (!Array.isArray(data) || !data.every((item: unknown) => isEntry(item))) {
        throw new Error("Invalid storage index");
      }
      return data;
    },
    save: async (image, bytes, token) => {
      const uri = uriFor(image.id);
      await write(Gio.File.new_for_uri(uri), bytes, token);
      return { id: image.id, publishedAt: image.publishedAt, uri };
    },
    record: async (entries, token) => {
      await write(index, new TextEncoder().encode(JSON.stringify(entries)), token);
    },
    exists: async (uri, token) => {
      const file = Gio.File.new_for_uri(uri);
      try {
        await perform(
          (callback) => {
            file.query_info_async(
              "standard::type",
              Gio.FileQueryInfoFlags.NONE,
              GLib.PRIORITY_DEFAULT,
              native(token),
              callback,
            );
          },
          (result) => file.query_info_finish(result),
        );
        return true;
      } catch (error) {
        if (matches(error, Gio.IOErrorEnum.NOT_FOUND)) {
          return false;
        }
        throw error;
      }
    },
    remove: async (entry, token) => {
      if (entry.uri !== uriFor(entry.id)) {
        throw new Error("Cannot remove an unmanaged image");
      }
      const file = Gio.File.new_for_uri(entry.uri);
      await perform(
        (callback) => {
          file.delete_async(GLib.PRIORITY_DEFAULT, native(token), callback);
        },
        (result) => file.delete_finish(result),
      );
    },
  };
};
export const createBackground = (): Ports["background"] => {
  const settings = new Gio.Settings({ schema_id: "org.gnome.desktop.background" });
  return {
    read: (): Background => ({
      light: settings.get_string("picture-uri"),
      dark: settings.get_string("picture-uri-dark"),
    }),
    write: (value: Background) => {
      settings.delay();
      try {
        if (
          !settings.set_string("picture-uri", value.light) ||
          !settings.set_string("picture-uri-dark", value.dark)
        ) {
          throw new Error("Wallpaper settings are not writable");
        }
        settings.apply();
      } catch (error) {
        settings.revert();
        throw error;
      }
    },
  };
};
export const schedule: Ports["schedule"] = (delay, callback) => {
  let pending = true;
  const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, Math.ceil(delay), () => {
    pending = false;
    callback();
    return GLib.SOURCE_REMOVE;
  });
  return () => {
    if (pending) {
      pending = false;
      GLib.Source.remove(id);
    }
  };
};
