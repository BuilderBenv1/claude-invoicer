import { homedir } from 'node:os';
import { join } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';

export interface AgentConfig {
  /** Base URL of the deployed dashboard, e.g. https://claude-invoicer.vercel.app */
  apiBaseUrl: string;
  /** Shared secret matching AGENT_TOKEN on the server. */
  deviceToken: string;
  /** Idle cap in minutes (gaps longer than this are not billed). */
  idleCapMin: number;
  /** How often to scan, in minutes. */
  scanIntervalMin: number;
  /** Where Claude stores session transcripts. */
  claudeProjectsDir: string;
}

export const CONFIG_DIR = join(homedir(), '.claude-invoicer');
export const CONFIG_PATH = join(CONFIG_DIR, 'agent.json');
export const CURSOR_PATH = join(CONFIG_DIR, 'cursor.json');

const DEFAULTS = {
  idleCapMin: 5,
  scanIntervalMin: 5,
  claudeProjectsDir: join(homedir(), '.claude', 'projects'),
};

/** Load config from ~/.claude-invoicer/agent.json, with env-var overrides. */
export function loadConfig(): AgentConfig {
  let file: Partial<AgentConfig> = {};
  if (existsSync(CONFIG_PATH)) {
    try {
      file = JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) as Partial<AgentConfig>;
    } catch (e) {
      throw new Error(`Could not parse ${CONFIG_PATH}: ${(e as Error).message}`);
    }
  }
  const env = process.env;
  const num = (v: string | undefined, fallback: number) =>
    v !== undefined && v !== '' && !Number.isNaN(Number(v)) ? Number(v) : fallback;

  return {
    apiBaseUrl: (env.INVOICER_API_URL ?? file.apiBaseUrl ?? '').replace(/\/+$/, ''),
    deviceToken: env.INVOICER_TOKEN ?? file.deviceToken ?? '',
    idleCapMin: num(env.INVOICER_IDLE_CAP_MIN, file.idleCapMin ?? DEFAULTS.idleCapMin),
    scanIntervalMin: num(env.INVOICER_SCAN_INTERVAL_MIN, file.scanIntervalMin ?? DEFAULTS.scanIntervalMin),
    claudeProjectsDir: env.INVOICER_PROJECTS_DIR ?? file.claudeProjectsDir ?? DEFAULTS.claudeProjectsDir,
  };
}
