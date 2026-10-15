import { createBingSource } from "./bing";
import { createNasaSource } from "./nasa";
import type { ImageSource, Ports } from "./model";

export const createSource = (fetch: Ports["download"], self: ImageSource): ImageSource => {
  const sources = { bing: createBingSource(fetch), "nasa-iotd": createNasaSource(fetch), self };
  return { latest: (config, cancellation) => sources[config.source].latest(config, cancellation) };
};
