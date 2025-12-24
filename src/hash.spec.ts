import { test, expect, describe } from 'bun:test';
import {sortKeys, hash} from './hash';

describe('sortKeys', () => {
  test('sorts object keys recursively', () => {
    const input = { z: 1, a: { y: 2, b: 3 } };
    const expected = { a: { b: 3, y: 2 }, z: 1 };
    expect(sortKeys(input)).toEqual(expected);
  });

  test('handles arrays', () => {
    const input = [{ z: 1 }, { a: 2 }];
    const expected = [{ z: 1 }, { a: 2 }];
    expect(sortKeys(input)).toEqual(expected);
  });

  test('handles primitives', () => {
    expect(sortKeys(42)).toBe(42);
    expect(sortKeys('hello')).toBe('hello');
    expect(sortKeys(null)).toBe(null);
  });

  test('handles undefined', () => {
    expect(sortKeys(undefined)).toBe(undefined);
  });
});

describe('hash', () => {
  test('produces stable hashes for same input', () => {
    const input = { b: 2, a: 1 };
    const hash1 = hash(input);
    const hash2 = hash({ a: 1, b: 2 });
    expect(hash1).toBe(hash2);
  });

  test('produces different hashes for different inputs', () => {
    const hash1 = hash({ a: 1 });
    const hash2 = hash({ a: 2 });
    expect(hash1).not.toBe(hash2);
  });

  test('handles nested objects', () => {
    const input1 = { a: { b: { c: 1 } } };
    const input2 = { a: { b: { c: 1 } } };
    expect(hash(input1)).toBe(hash(input2));
  });

  test('handles arrays', () => {
    const hash1 = hash([1, 2, 3]);
    const hash2 = hash([1, 2, 3]);
    expect(hash1).toBe(hash2);
  });

  test('handles primitives', () => {
    const h1 = hash(42);
    const h2 = hash(42);
    expect(h1).toBe(h2);
  });
});
