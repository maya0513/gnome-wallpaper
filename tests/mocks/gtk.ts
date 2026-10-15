import { vi } from "vite-plus/test";

const createWidget = (props: Readonly<{ selected?: number; title?: string; label?: string }>) => {
  const signals = new Map<string, () => boolean | void>();
  const object = {
    add: vi.fn(),
    add_suffix: vi.fn(),
    ...props,
    selected: props.selected ?? 0,
    sensitive: true,
    visible: true,
    add_response: vi.fn(),
    present: vi.fn(),
    signals,
    connect: vi.fn((name: string, callback: () => boolean | void) => {
      signals.set(name, callback);
      return 9;
    }),
    disconnect: vi.fn(),
  };
  return object;
};
export const widgets: ReturnType<typeof createWidget>[] = [];
const widget = vi.fn(function mockWidget(
  props: Readonly<{ selected?: number; title?: string; label?: string }>,
) {
  const object = createWidget(props);
  widgets.push(object);
  return object;
});
export default {
  Align: { CENTER: 3 },
  PreferencesPage: widget,
  PreferencesGroup: widget,
  ActionRow: widget,
  ComboRow: widget,
  Entry: widget,
  Button: widget,
  AlertDialog: widget,
  StringList: { new: vi.fn((strings: string[]) => strings) },
};
