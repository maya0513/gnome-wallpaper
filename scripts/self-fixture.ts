import assert from "node:assert/strict";
import { copyFile, mkdir, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

const fixture = "tests/fixtures/self";
const directory = (data: string) => join(data, "gnome-wallpaper/self");
export const prepareSelfFixture = async (data: string): Promise<void> => {
  const target = directory(data);
  await mkdir(join(target, "nested"), { recursive: true });
  const names = await readdir(fixture);
  await Promise.all(
    names.map(async (name) => {
      await copyFile(join(fixture, name), join(target, name));
    }),
  );
  await copyFile(join(fixture, "image1.jpg"), join(target, "nested/ignored.jpg"));
};
export const verifySelfFixture = async (data: string): Promise<void> => {
  const names = await readdir(fixture);
  const actual = await readdir(directory(data));
  assert.deepEqual(actual.toSorted(), [...names, "nested"].toSorted());
  await Promise.all(
    names.map(async (name) => {
      assert.deepEqual(
        await readFile(join(directory(data), name)),
        await readFile(join(fixture, name)),
        `Original image changed: ${name}`,
      );
    }),
  );
};
