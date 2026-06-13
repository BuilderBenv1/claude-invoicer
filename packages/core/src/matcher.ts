import type { FolderMapping } from './types.js';

/**
 * Normalize a filesystem path for matching: backslashes -> forward slashes,
 * collapse repeated slashes, drop a trailing slash, lowercase (Windows paths
 * are case-insensitive). Drive letters are preserved (lowercased).
 */
export function normalizePath(p: string): string {
  if (!p) return '';
  let s = p.trim().replace(/\\/g, '/').replace(/\/+/g, '/');
  if (s.length > 1 && s.endsWith('/')) s = s.slice(0, -1);
  return s.toLowerCase();
}

/** True if `cwd` is `folder` or sits anywhere beneath it. */
export function isUnder(cwd: string, folder: string): boolean {
  const c = normalizePath(cwd);
  const f = normalizePath(folder);
  if (!f) return false;
  return c === f || c.startsWith(f + '/');
}

/**
 * Resolve a cwd to a client id via longest-prefix folder matching.
 * Returns null when no mapping owns the folder (unassigned -> never billed).
 */
export function matchClientId(cwd: string, mappings: FolderMapping[]): string | null {
  const c = normalizePath(cwd);
  let bestLen = -1;
  let bestClient: string | null = null;
  for (const m of mappings) {
    const f = normalizePath(m.path);
    if (c === f || c.startsWith(f + '/')) {
      if (f.length > bestLen) {
        bestLen = f.length;
        bestClient = m.clientId;
      }
    }
  }
  return bestClient;
}

/** The most specific mapping owning `cwd`, or null. */
export function matchMapping(cwd: string, mappings: FolderMapping[]): FolderMapping | null {
  const c = normalizePath(cwd);
  let bestLen = -1;
  let best: FolderMapping | null = null;
  for (const m of mappings) {
    const f = normalizePath(m.path);
    if (c === f || c.startsWith(f + '/')) {
      if (f.length > bestLen) {
        bestLen = f.length;
        best = m;
      }
    }
  }
  return best;
}

/** Last path segment of a normalized path. */
export function basename(p: string): string {
  const n = normalizePath(p);
  const i = n.lastIndexOf('/');
  return i >= 0 ? n.slice(i + 1) : n;
}
