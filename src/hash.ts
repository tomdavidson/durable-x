// src/hash.ts

export const sortKeys = (obj: unknown): unknown =>
  Array.isArray(obj)
    ? obj.map(sortKeys)
    : obj && typeof obj === 'object'
      ? Object.keys(obj as Record<string, unknown>)
          .sort()
          .reduce<Record<string, unknown>>(
            (acc, k) => ({
              ...acc,
              [k]: sortKeys((obj as Record<string, unknown>)[k]),
            }),
            {},
          )
      : obj;

export const hash = (input: unknown): string =>
  Array.from(JSON.stringify(sortKeys(input)))
    .reduce((h, c) => ((h << 5) - h + c.charCodeAt(0)) | 0, 0)
    .toString(36);

