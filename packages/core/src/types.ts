/** A single timestamped event extracted from a Claude session transcript. */
export interface SessionEvent {
  sessionId: string;
  /** Real absolute working directory recorded on the transcript record. */
  cwd: string;
  /** Event time in epoch milliseconds (UTC). */
  timestampMs: number;
}

/**
 * A contiguous run of active work within a single (session, cwd).
 *
 * Engine invariant: `activeMs === endMs - startMs`. Runs are broken by an idle
 * gap (longer than the idle cap) or by a cwd change, so idle time is excluded by
 * construction.
 */
export interface ActivityInterval {
  sessionId: string;
  cwd: string;
  startMs: number;
  endMs: number;
  activeMs: number;
}

/** Maps a folder (and everything beneath it) to a client. */
export interface FolderMapping {
  clientId: string;
  /** Absolute folder path; normalized internally before matching. */
  path: string;
  /** Optional display label for invoice line grouping. */
  label?: string;
  /** Optional per-folder hourly rate; falls back to the client default. */
  ratePerHour?: number;
  /** Optional "bill from" cutoff (epoch ms): this folder's time before it is excluded. */
  billFromMs?: number;
}
