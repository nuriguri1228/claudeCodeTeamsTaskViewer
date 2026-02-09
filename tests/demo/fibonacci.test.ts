import { describe, it, expect } from 'vitest';
import { fibonacci } from '../../src/demo/fibonacci.js';

describe('fibonacci', () => {
  it('should return 0 for n=0', () => {
    expect(fibonacci(0)).toBe(0);
  });

  it('should return 1 for n=1', () => {
    expect(fibonacci(1)).toBe(1);
  });

  it('should return 1 for n=2', () => {
    expect(fibonacci(2)).toBe(1);
  });

  it('should return correct values for small inputs', () => {
    expect(fibonacci(3)).toBe(2);
    expect(fibonacci(4)).toBe(3);
    expect(fibonacci(5)).toBe(5);
    expect(fibonacci(6)).toBe(8);
    expect(fibonacci(7)).toBe(13);
    expect(fibonacci(10)).toBe(55);
  });

  it('should handle larger inputs efficiently due to memoization', () => {
    expect(fibonacci(30)).toBe(832040);
    expect(fibonacci(40)).toBe(102334155);
  });

  it('should throw for negative input', () => {
    expect(() => fibonacci(-1)).toThrow("Input must be a non-negative integer");
    expect(() => fibonacci(-10)).toThrow("Input must be a non-negative integer");
  });
});
