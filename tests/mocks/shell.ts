import { vi } from "vite-plus/test";

const createItem = (label: string) => {
  const signals = new Map<string, () => void>();
  return {
    label: { text: label },
    signals,
    connect: vi.fn((name: string, callback: () => void) => {
      signals.set(name, callback);
      return 1;
    }),
    setSensitive: vi.fn(),
  };
};
let validMenu = true;
export const setValidMenu = (value: boolean): void => {
  validMenu = value;
};
const createButton = () => ({
  menu: validMenu ? { addMenuItem: vi.fn() } : {},
  add_child: vi.fn(),
  destroy: vi.fn(),
});
export const items: ReturnType<typeof createItem>[] = [];
export const buttons: ReturnType<typeof createButton>[] = [];
export const PopupMenuItem = vi.fn(function mockItem(label: string) {
  const item = createItem(label);
  items.push(item);
  return item;
});
export const Button = vi.fn(function mockButton() {
  const button = createButton();
  buttons.push(button);
  return button;
});
export default {
  Icon: vi.fn(function mockIcon(props: unknown) {
    return props;
  }),
};
