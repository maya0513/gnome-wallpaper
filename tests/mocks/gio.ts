import { vi } from "vite-plus/test";
import { GiError } from "./glib";

export const files = new Map<string, Uint8Array>();
export const faults = new Map<string, unknown>();
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
  Settings,
  Cancellable,
  IOErrorEnum: { NOT_FOUND: 1, EXISTS: 2 },
  io_error_quark: () => 42,
  FileCreateFlags: { REPLACE_DESTINATION: 2 },
  FileQueryInfoFlags: { NONE: 0 },
  SettingsBindFlags: { DEFAULT: 0 },
};
