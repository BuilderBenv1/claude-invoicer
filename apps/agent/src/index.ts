import { existsSync } from 'node:fs';
import { loadConfig, CONFIG_PATH, type AgentConfig } from './config.js';
import { clearCursor, saveCursor } from './cursor.js';
import { scan, type ScanResult } from './scanner.js';
import { uploadIntervals } from './uploader.js';

const MIN = 60_000;

function ts(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}
function log(msg: string): void {
  console.log(`[${ts()}] ${msg}`);
}
function fmtDuration(ms: number): string {
  const totalMin = Math.round(ms / MIN);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function printDrySummary(result: ScanResult): void {
  const byCwd = new Map<string, number>();
  for (const it of result.intervals) {
    byCwd.set(it.cwd, (byCwd.get(it.cwd) ?? 0) + it.activeMs);
  }
  const rows = [...byCwd.entries()].sort((a, b) => b[1] - a[1]);
  const total = rows.reduce((s, [, ms]) => s + ms, 0);

  console.log('');
  console.log(`Scanned ${result.filesTotal} transcript(s), ${result.parseErrors} bad line(s).`);
  console.log(`Active time per folder (idle-capped):`);
  console.log('─'.repeat(72));
  for (const [cwd, ms] of rows) {
    if (ms === 0) continue;
    console.log(`${fmtDuration(ms).padStart(8)}   ${cwd}`);
  }
  console.log('─'.repeat(72));
  console.log(`${fmtDuration(total).padStart(8)}   TOTAL across ${rows.length} folder(s)`);
  console.log('');
  console.log('(dry run — nothing uploaded, cursor untouched)');
}

async function runOnce(cfg: AgentConfig, opts: { dryRun: boolean; resync?: boolean }): Promise<void> {
  const idleCapMs = cfg.idleCapMin * MIN;

  if (!existsSync(cfg.claudeProjectsDir)) {
    log(`WARNING: Claude projects dir not found: ${cfg.claudeProjectsDir}`);
    return;
  }

  if (opts.dryRun) {
    const result = scan({ projectsDir: cfg.claudeProjectsDir, idleCapMs, force: true });
    printDrySummary(result);
    return;
  }

  if (opts.resync) {
    log('resync: recomputing all transcripts and replacing server data...');
    const result = scan({ projectsDir: cfg.claudeProjectsDir, idleCapMs, force: true });
    const resp = await uploadIntervals(cfg.apiBaseUrl, cfg.deviceToken, result.intervals, true);
    // Persist the cursor only now that the upload succeeded.
    saveCursor(result.cursor);
    log(`resync complete: replaced with ${resp.accepted} interval(s)`);
    return;
  }

  const result = scan({ projectsDir: cfg.claudeProjectsDir, idleCapMs });
  if (result.intervals.length === 0) {
    log(`scan: ${result.filesChanged}/${result.filesTotal} changed, nothing new to upload`);
    saveCursor(result.cursor); // safe: no intervals to lose
    return;
  }
  log(`scan: ${result.filesChanged}/${result.filesTotal} changed -> ${result.intervals.length} intervals, uploading...`);
  const resp = await uploadIntervals(cfg.apiBaseUrl, cfg.deviceToken, result.intervals);
  // Only advance the cursor after a successful upload, so a failed upload
  // re-sends these intervals next time instead of skipping them forever.
  saveCursor(result.cursor);
  log(`uploaded ${resp.accepted} interval(s)`);
  if (resp.resync) {
    log('server requested resync — clearing cursor, next scan re-reads everything');
    clearCursor();
  }
}

function requireServerConfig(cfg: AgentConfig): void {
  const missing: string[] = [];
  if (!cfg.apiBaseUrl) missing.push('apiBaseUrl (INVOICER_API_URL)');
  if (!cfg.deviceToken) missing.push('deviceToken (INVOICER_TOKEN)');
  if (missing.length) {
    console.error(`Missing config: ${missing.join(', ')}`);
    console.error(`Create ${CONFIG_PATH} or set env vars. See SETUP.md.`);
    console.error('Tip: run "npm run agent:once -- --dry-run" to preview tracked time without a server.');
    process.exit(1);
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes('--dry-run');
  const resync = argv.includes('--resync');
  const once = argv.includes('--once') || dryRun || resync;

  const cfg = loadConfig();
  if (!dryRun) requireServerConfig(cfg);

  log(`claude-invoicer agent starting (idleCap=${cfg.idleCapMin}m, scanEvery=${cfg.scanIntervalMin}m)`);
  log(`projects: ${cfg.claudeProjectsDir}`);

  if (once) {
    await runOnce(cfg, { dryRun, resync });
    return;
  }

  // continuous loop
  const tick = async () => {
    try {
      await runOnce(cfg, { dryRun: false });
    } catch (e) {
      log(`ERROR: ${(e as Error).message}`);
    }
  };
  await tick();
  setInterval(tick, cfg.scanIntervalMin * MIN);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
