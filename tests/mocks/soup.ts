import { vi } from "vite-plus/test";

export const response = {
  bytes: new Uint8Array([1]) as Uint8Array | null,
  status: 200,
  error: null as unknown,
  valid: true,
};
export const message = { get_status: () => response.status };
export const session = {
  send_and_read_async: vi.fn(
    (
      _msg: unknown,
      _priority: number,
      _token: unknown,
      callback: (source: null, result: object) => void,
    ) => {
      callback(null, {});
    },
  ),
  send_and_read_finish: vi.fn(() => {
    if (response.error !== null) {
      throw response.error;
    }
    return { get_data: () => response.bytes };
  }),
  abort: vi.fn(),
};
export default {
  Message: { new: vi.fn(() => (response.valid ? message : null)) },
  Session: vi.fn(function mockSession() {
    return session;
  }),
};
