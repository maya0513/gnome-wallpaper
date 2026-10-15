import { beforeEach, expect, it, vi } from "vite-plus/test";
import { cleanupEnvironment, stopGroup } from "../scripts/gnome-environment";

const io = vi.hoisted(() => ({
  list: vi.fn(async () => [] as string[]),
  read: vi.fn(async () => ""),
  remove: vi.fn(async () => {}),
  execute: vi.fn(
    (
      _command: string,
      _args: readonly string[],
      _options: unknown,
      callback: (error: Error | null) => void,
    ) => {
      callback(null);
    },
  ),
}));
// eslint-disable-next-line vitest/prefer-import-in-mock -- Model only the Node overload used by this script.
vi.mock("node:fs/promises", () => ({
  readFile: io.read,
  readdir: io.list,
  rm: io.remove,
  mkdtemp: vi.fn(),
}));
// eslint-disable-next-line vitest/prefer-import-in-mock -- Model only the Node overload used by this script.
vi.mock("node:child_process", () => ({ execFile: io.execute }));
beforeEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  io.list.mockResolvedValue([]);
  io.read.mockResolvedValue("");
  io.execute.mockImplementation((_command, _args, _options, callback) => {
    callback(null);
  });
});

it("never unmounts the host or a different session", async () => {
  io.read.mockResolvedValue(
    "1 0 0:1 / /run/user/1000/doc rw - fuse.portal portal rw\n2 0 0:2 / /tmp/other/runtime/doc rw - fuse.portal portal rw",
  );
  await cleanupEnvironment("/tmp/test");
  expect(io.execute).not.toHaveBeenCalled();
  expect(io.remove).toHaveBeenCalledWith("/tmp/test", { recursive: true, force: true });
});

it("unmounts only the run's portal and GVfs before deleting its directories", async () => {
  io.read.mockResolvedValue(
    "1 0 0:1 / /tmp/test/runtime/doc rw - fuse.portal portal rw\n2 0 0:2 / /tmp/test/runtime/gvfs rw - fuse.gvfsd-fuse gvfsd rw",
  );
  await cleanupEnvironment("/tmp/test");
  expect(io.execute).toHaveBeenCalledWith(
    "fusermount3",
    ["-u", "/tmp/test/runtime/doc"],
    { timeout: 5000 },
    expect.any(Function),
  );
  expect(io.execute).toHaveBeenCalledWith(
    "fusermount3",
    ["-u", "/tmp/test/runtime/gvfs"],
    { timeout: 5000 },
    expect.any(Function),
  );
  expect(io.execute.mock.invocationCallOrder[1]).toBeLessThan(
    io.remove.mock.invocationCallOrder[0] ?? 0,
  );
});

it("reports an unmount failure instead of recursively deleting a mounted filesystem", async () => {
  io.read.mockResolvedValue("1 0 0:1 / /tmp/test/runtime/doc rw - fuse.portal portal rw");
  io.execute.mockImplementation((_command, _args, _options, callback) => {
    callback(new Error("busy"));
  });
  await expect(cleanupEnvironment("/tmp/test")).rejects.toThrow("busy");
  expect(io.remove).not.toHaveBeenCalled();
});

it("tolerates denied signals only when the private group has no live members", async () => {
  const denied = Object.assign(new Error("denied"), { code: "EACCES" });
  const signal = vi.spyOn(process, "kill").mockReturnValue(true);
  signal.mockImplementation((_pid, name) => {
    if (name === "SIGKILL") {
      throw denied;
    }
    return true;
  });
  io.list.mockResolvedValue(["123", "self", "456"]);
  io.read.mockResolvedValue("123 (test) Z 1 123 0");
  await expect(stopGroup({ pid: 123 })).resolves.toBeUndefined();
  io.read.mockResolvedValue("456 (test) S 1 123 0");
  await expect(stopGroup({ pid: 123 })).rejects.toThrow("denied");
});
