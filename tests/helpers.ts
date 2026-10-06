export const defined = <T>(value: T | undefined): T => {
  if (value === undefined) {
    throw new Error("Missing test setup");
  }
  return value;
};
