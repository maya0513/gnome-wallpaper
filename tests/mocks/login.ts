import { vi } from "vite-plus/test";

export const login = {
  connect: vi.fn((_name: string, _callback: (_manager: unknown, sleeping: boolean) => void) => 8),
  disconnect: vi.fn(),
};
export const getLoginManager = () => login;
