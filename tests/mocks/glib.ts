import { vi } from "vite-plus/test";

export const timers = new Map<number, () => boolean>();
let index = 0;
export class GiError extends Error {
  private readonly code: number;
  constructor(code: number) {
    super(`IO ${code}`);
    this.name = "GiError";
    this.code = code;
  }
  matches(_domain: number, actual: number): boolean {
    return actual === this.code;
  }
}
const remove = vi.fn((id: number) => timers.delete(id));
export default {
  mkdir_with_parents: vi.fn(() => 0),
  Variant: class Variant {
    private readonly value: unknown;
    constructor(_signature: string, value: unknown) {
      this.value = value;
    }
    recursiveUnpack(): unknown {
      return this.value;
    }
  },
  Error: GiError,
  PRIORITY_DEFAULT: 0,
  SOURCE_REMOVE: false,
  timeout_add: vi.fn((_priority: number, _delay: number, callback: () => boolean) => {
    const id = ++index;
    timers.set(id, callback);
    return id;
  }),
  Source: { remove },
  get_user_data_dir: () => "/data",
  build_filenamev: (paths: string[]) => paths.join("/"),
};
