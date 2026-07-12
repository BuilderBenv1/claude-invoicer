import { randomUUID } from 'crypto';

/** Short, URL-safe, collision-resistant id. */
export function newId(): string {
  return randomUUID().replace(/-/g, '').slice(0, 20);
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function clampNum(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}
