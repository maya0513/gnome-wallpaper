import { vi } from "vite-plus/test";

export const settings = {
  get_string: vi.fn((key: string): string => (key === "market" ? "ja-JP" : "UHD")),
  set_string: vi.fn(() => true),
  connect: vi.fn((_name: string, _callback: () => void) => 7),
  disconnect: vi.fn(),
  bind: vi.fn(),
};
export class Extension {
  getSettings() {
    return settings;
  }
  openPreferences = vi.fn();
}
export class ExtensionPreferences {
  getSettings() {
    return settings;
  }
}
