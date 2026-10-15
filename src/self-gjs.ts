import Gio from "gi://Gio";
import GLib from "gi://GLib";
import GdkPixbuf from "gi://GdkPixbuf?version=2.0";
import { native, perform } from "./gjs";
import type { SelfFiles, SelfSelectionStore, Cancellation } from "./model";

const PAGE_SIZE = 64;
const DIRECTORY_MODE = 0o700;
export const selfPath = (): string =>
  GLib.build_filenamev([GLib.get_user_data_dir(), "gnome-wallpaper", "self"]);
const ensure = (path: string): void => {
  if (GLib.mkdir_with_parents(path, DIRECTORY_MODE) !== 0) {
    throw new Error(`Unable to create image folder: ${path}`);
  }
};

export const createSelfSelection = (settings: Gio.Settings): SelfSelectionStore => ({
  read: () => {
    const value: unknown = settings.get_value("self-selection").recursiveUnpack();
    if (
      !Array.isArray(value) ||
      value.length !== 2 ||
      typeof value[0] !== "string" ||
      typeof value[1] !== "string"
    ) {
      throw new Error("Invalid self selection");
    }
    return [value[0], value[1]];
  },
  write: (selection) => {
    if (!settings.set_value("self-selection", new GLib.Variant("(ss)", [...selection]))) {
      throw new Error("Unable to save self selection");
    }
  },
});

export const createSelfFiles = (path: string): SelfFiles => {
  const directory = Gio.File.new_for_path(path);
  return {
    uri: (name) => directory.get_child(name).get_uri(),
    list: async (cancellation) => {
      ensure(path);
      const enumerator = await perform(
        (callback) => {
          directory.enumerate_children_async(
            "standard::name,standard::type",
            Gio.FileQueryInfoFlags.NONE,
            GLib.PRIORITY_DEFAULT,
            native(cancellation),
            callback,
          );
        },
        (result) => directory.enumerate_children_finish(result),
      );
      const names: string[] = [];
      try {
        while (true) {
          const page = await perform(
            (callback) => {
              enumerator.next_files_async(
                PAGE_SIZE,
                GLib.PRIORITY_DEFAULT,
                native(cancellation),
                callback,
              );
            },
            (result) => enumerator.next_files_finish(result),
          );
          if (page.length === 0) {
            return names;
          }
          for (const info of page) {
            if (info.get_file_type() === Gio.FileType.REGULAR) {
              names.push(info.get_name());
            }
          }
        }
      } finally {
        await perform(
          (callback) => {
            enumerator.close_async(GLib.PRIORITY_DEFAULT, null, callback);
          },
          (result) => enumerator.close_finish(result),
        );
      }
    },
    valid: async (name, cancellation) => {
      try {
        const file = directory.get_child(name);
        const stream = await perform(
          (callback) => {
            file.read_async(GLib.PRIORITY_DEFAULT, native(cancellation), callback);
          },
          (result) => file.read_finish(result),
        );
        try {
          await perform(
            (callback) => {
              GdkPixbuf.Pixbuf.new_from_stream_at_scale_async(
                stream,
                1,
                1,
                true,
                native(cancellation),
                callback,
              );
            },
            (result) => GdkPixbuf.Pixbuf.new_from_stream_finish(result),
          );
          return true;
        } finally {
          await perform(
            (callback) => {
              stream.close_async(GLib.PRIORITY_DEFAULT, null, callback);
            },
            (result) => stream.close_finish(result),
          );
        }
      } catch (error) {
        if (cancellation.cancelled()) {
          throw error;
        }
        return false;
      }
    },
  };
};

export const openSelfFolder = async (path: string, cancellation: Cancellation): Promise<void> => {
  ensure(path);
  await perform(
    (callback) => {
      Gio.AppInfo.launch_default_for_uri_async(
        Gio.File.new_for_path(path).get_uri(),
        null,
        native(cancellation),
        callback,
      );
    },
    (result) => Gio.AppInfo.launch_default_for_uri_finish(result),
  );
};
