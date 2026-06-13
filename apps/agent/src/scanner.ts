import { readdirSync, statSync, readFileSync, type Dirent, type Stats } from 'node:fs';
import { join, basename, extname } from 'node:path';
import { computeIntervals, type ActivityInterval } from '@claude-invoicer/core';
import { parseTranscript } from './transcript.js';
import { loadCursor, saveCursor, type CursorMap } from './cursor.js';

export interface ScanResult {
  intervals: ActivityInterval[];
  filesTotal: number;
  filesChanged: number;
  parseErrors: number;
}

export interface ScanOptions {
  projectsDir: string;
  idleCapMs: number;
  /** Re-read every file regardless of the cursor. */
  force?: boolean;
  /** Whether to persist the updated cursor (off for dry runs). */
  persistCursor?: boolean;
}

function walkJsonl(dir: string): string[] {
  const out: string[] = [];
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walkJsonl(p));
    else if (e.isFile() && extname(e.name) === '.jsonl') out.push(p);
  }
  return out;
}

/**
 * Scan all transcripts and recompute activity intervals. Only files whose size
 * or mtime changed since the last scan are re-read; changed files are recomputed
 * in full so cross-scan gaps stay correct. The interval key (sessionId, startMs)
 * is stable, so re-uploading recomputed intervals is an idempotent upsert.
 */
export function scan(opts: ScanOptions): ScanResult {
  const persist = opts.persistCursor ?? true;
  const cursor: CursorMap = opts.force ? {} : loadCursor();
  const files = walkJsonl(opts.projectsDir);
  const intervals: ActivityInterval[] = [];
  let filesChanged = 0;
  let parseErrors = 0;

  for (const file of files) {
    let st: Stats;
    try {
      st = statSync(file);
    } catch {
      continue;
    }
    const prev = cursor[file];
    if (prev && prev.size === st.size && prev.mtimeMs === st.mtimeMs) continue;

    filesChanged++;
    let content: string;
    try {
      content = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    const sessionId = basename(file, '.jsonl');
    const { events, errors } = parseTranscript(content, sessionId);
    parseErrors += errors;
    intervals.push(...computeIntervals(events, { idleCapMs: opts.idleCapMs }));
    cursor[file] = { size: st.size, mtimeMs: st.mtimeMs };
  }

  if (persist) saveCursor(cursor);
  return { intervals, filesTotal: files.length, filesChanged, parseErrors };
}
