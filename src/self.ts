import { errorMessage } from "./core";
import type { ImageSource, SelfFiles, SelfSelectionStore } from "./model";

const PAD = 2;
export const selfDay = (now: number): string => {
  const date = new Date(now);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(PAD, "0")}-${String(date.getDate()).padStart(PAD, "0")}`;
};
export const nextSelfRefresh = (now: number): number => {
  const date = new Date(now);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime();
};

export const createSelfSource = (
  files: SelfFiles,
  selection: SelfSelectionStore,
  now: () => number,
): ImageSource => ({
  latest: async (_config, cancellation) => {
    try {
      const collator = new Intl.Collator(undefined, { numeric: true });
      const listed = await files.list(cancellation);
      const names = listed
        .filter((name) => /\.(?:jpe?g|png|webp)$/iu.test(name))
        .toSorted((a, b) => collator.compare(a, b) || (a < b ? -1 : 1));
      const [previous, day] = selection.read();
      const today = selfDay(now());
      const current = names.indexOf(previous);
      const start =
        current === -1 ? 0 : (current + (day !== "" && today > day ? 1 : 0)) % names.length;
      for (const name of [...names.slice(start), ...names.slice(0, start)]) {
        if (cancellation.cancelled()) {
          throw new Error("Cancelled");
        }
        if (await files.valid(name, cancellation)) {
          return {
            ok: true,
            value: {
              source: "self",
              title: name,
              copyright: "User-provided image",
              uri: files.uri(name),
              selection: [name, day > today ? day : today],
            },
          };
        }
      }
      return { ok: false, error: "No readable JPEG, PNG or WebP images in the self folder" };
    } catch (error) {
      return { ok: false, error: errorMessage(error) };
    }
  },
});
