export const pixbuf = { error: null as unknown };
export default {
  Pixbuf: {
    new_from_stream_at_scale_async: (
      _stream: unknown,
      _width: number,
      _height: number,
      _aspect: boolean,
      _cancellable: unknown,
      callback: (source: null, result: object) => void,
    ) => {
      callback(null, {});
    },
    new_from_stream_finish: () => {
      if (pixbuf.error !== null) {
        throw pixbuf.error;
      }
      return {};
    },
  },
};
