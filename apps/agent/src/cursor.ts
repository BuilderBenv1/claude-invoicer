import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { CURSOR_PATH } from './config.js';

/** Per-file fingerprint used to skip unchanged transcripts between scans. */
export interface FileState {
  size: number;
  mtimeMs: number;
}

export type CursorMap = Record<string, FileState>;

export function loadCursor(): CursorMap {
  if (!existsSync(CURSOR_PATH)) return {};
  try {
    return JSON.parse(readFileSync(CURSOR_PATH, 'utf8')) as CursorMap;
  } catch {
    return {};
  }
}

export function saveCursor(c: CursorMap): void {
  mkdirSync(dirname(CURSOR_PATH), { recursive: true });
  writeFileSync(CURSOR_PATH, JSON.stringify(c), 'utf8');
}

export function clearCursor(): void {
  saveCursor({});
}
