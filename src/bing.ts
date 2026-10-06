import { errorMessage, parseBing } from "./core";
import type { ImageSource, Ports } from "./model";

export const createBingSource = (fetch: Ports["download"]): ImageSource => ({
  latest: async (config, cancellation) => {
    try {
      const bytes = await fetch(
        `https://www.bing.com/HPImageArchive.aspx?format=js&idx=0&n=1&mkt=${encodeURIComponent(config.market)}`,
        cancellation,
      );
      const data: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
      return parseBing(data, config);
    } catch (error) {
      return { ok: false, error: errorMessage(error) };
    }
  },
});
