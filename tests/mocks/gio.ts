import { vi } from "vite-plus/test";
import { GiError } from "./glib";

export const files = new Map<string, Uint8Array>();
export const faults = new Map<string, unknown>();
export const directoryEntries: { name: string; type: number }[] = [];
export const closes = { enumerator: vi.fn(), stream: vi.fn() };
const finish = (operation: string) => {
  if (faults.has(operation)) {
    throw faults.get(operation);
  }
};
export const ioError = (code: number) => new GiError(code);
type Callback = (source: null, result: object) => void;
const makeFile = (uri: string) => ({
  get_uri: () => uri,
  get_child: (name: string) => makeFile(`${uri}/${name}`),
  enumerate_children_async: (
    _attributes: string,
    _flags: number,
    _priority: number,
    _token: unknown,
    cb: Callback,
  ) => {
    cb(null, {});
  },
  enumerate_children_finish: () => {
    finish("enumerate");
    let index = 0;
    return {
      next_files_async: (_count: number, _priority: number, _token: unknown, cb: Callback) => {
        cb(null, {});
      },
      next_files_finish: () => {
        finish("next");
        const page = directoryEntries.slice(index, index + 64);
        index += page.length;
        return page.map((info) => ({ get_name: () => info.name, get_file_type: () => info.type }));
      },
      close_async: (_priority: number, _token: unknown, cb: Callback) => {
        closes.enumerator();
        cb(null, {});
      },
      close_finish: () => {
        finish("enumerator-close");
        return true;
      },
    };
  },
  read_async: (_priority: number, _token: unknown, cb: Callback) => {
    cb(null, {});
  },
  read_finish: () => {
    finish("read");
    if (!files.has(uri)) {
      throw ioError(1);
    }
    return {
      close_async: (_priority: number, _token: unknown, cb: Callback) => {
        closes.stream();
        cb(null, {});
      },
      close_finish: () => {
        finish("stream-close");
        return true;
      },
    };
  },
  make_directory_async: (_priority: number, _token: unknown, cb: Callback) => {
    cb(null, {});
  },
  make_directory_finish: () => {
    finish("mkdir");
    return true;
  },
  load_contents_async: (_token: unknown, cb: Callback) => {
    cb(null, {});
  },
  load_contents_finish: () => {
    finish("load");
    if (!files.has(uri)) {
      throw ioError(1);
    }
    return [true, files.get(uri), ""];
  },
  replace_contents_async: (
    bytes: Uint8Array,
    _etag: unknown,
    _backup: boolean,
    flags: number,
    _token: unknown,
    cb: Callback,
  ) => {
    writes.push({ uri, flags });
    if (!faults.has("write")) {
      files.set(uri, bytes);
    }
    cb(null, {});
  },
  replace_contents_finish: () => {
    finish("write");
    return [true, ""];
  },
  query_info_async: (
    _attributes: string,
    _flags: number,
    _priority: number,
    _token: unknown,
    cb: Callback,
  ) => {
    cb(null, {});
  },
  query_info_finish: () => {
    finish("exists");
    if (!files.has(uri)) {
      throw ioError(1);
    }
    return {};
  },
  delete_async: (_priority: number, _token: unknown, cb: Callback) => {
    cb(null, {});
  },
  delete_finish: () => {
    finish("delete");
    files.delete(uri);
    return true;
  },
});
export const File = {
  new_for_path: (path: string) => makeFile(`file://${path}`),
  new_for_uri: makeFile,
};
export const writes: { uri: string; flags: number }[] = [];
export const Settings = vi.fn(function mockSettings() {
  return background;
});
export const background = {
  get_value: vi.fn(() => ({ recursiveUnpack: () => selection.value })),
  set_value: vi.fn((_key: string, value: Readonly<{ recursiveUnpack: () => unknown }>) => {
    selection.value = value.recursiveUnpack();
    return selection.accepted;
  }),
  get_string: vi.fn((key: string) => values.get(key) ?? ""),
  set_string: vi.fn((key: string, value: string) => {
    values.set(key, value);
    return true;
  }),
  delay: vi.fn(),
  apply: vi.fn(),
  revert: vi.fn(),
};
export const values = new Map<string, string>();
export const selection = { value: ["", ""] as unknown, accepted: true };
export const launch = {
  launch_default_for_uri_async: vi.fn(
    (_uri: string, _context: unknown, _token: unknown, cb: Callback) => {
      cb(null, {});
    },
  ),
  launch_default_for_uri_finish: () => {
    finish("launch");
    return true;
  },
};
export class Cancellable {
  private cancelled = false;
  is_cancelled(): boolean {
    return this.cancelled;
  }
  cancel(): void {
    this.cancelled = true;
  }
}
export default {
  File,
  AppInfo: launch,
  FileType: { REGULAR: 1, DIRECTORY: 2 },
  Settings,
  Cancellable,
  IOErrorEnum: { NOT_FOUND: 1, EXISTS: 2 },
  io_error_quark: () => 42,
  FileCreateFlags: { REPLACE_DESTINATION: 2 },
  FileQueryInfoFlags: { NONE: 0 },
  SettingsBindFlags: { DEFAULT: 0 },
};
