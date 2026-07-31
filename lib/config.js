import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { STYLES } from './tokens.js';

export const NOTIFY_CLASSES = ['checks_failed', 'review', 'merged'];

export const DEFAULTS = Object.freeze({
  pollSeconds: 90,
  style: 'emoji',
  skipDefaultBranch: true,
  repos: null,
  notify: ['checks_failed', 'review'],
  noPrCacheSeconds: 180,
  terminalCacheMinutes: 1440,
  openPrLimit: 100,
  ghPath: 'gh',
  tokenTtlMs: 360000,
});

const POLL_MIN = 15;
const POLL_MAX = 3600;
const HERDR_TTL_MAX_MS = 86400000;

function num(value, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function bool(value, fallback) {
  return typeof value === 'boolean' ? value : fallback;
}

function stringList(value) {
  if (typeof value === 'string' && value.trim()) return [value.trim()];
  if (!Array.isArray(value)) return null;
  const list = value.filter((v) => typeof v === 'string' && v.trim()).map((v) => v.trim());
  return list.length > 0 ? list : null;
}

function readRaw(configDir) {
  if (!configDir) return {};
  try {
    const parsed = JSON.parse(readFileSync(join(configDir, 'config.json'), 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    // A broken or absent config must never take the sidebar down with it.
    return {};
  }
}

export function loadConfig(configDir) {
  const raw = readRaw(configDir);
  const pollSeconds = num(raw.pollSeconds, DEFAULTS.pollSeconds, { min: POLL_MIN, max: POLL_MAX });
  const notify = Array.isArray(raw.notify)
    ? raw.notify.filter((n) => NOTIFY_CLASSES.includes(n))
    : raw.notify === undefined
      ? [...DEFAULTS.notify]
      : [];

  return {
    pollSeconds,
    style: STYLES.includes(raw.style) ? raw.style : DEFAULTS.style,
    skipDefaultBranch: bool(raw.skipDefaultBranch, DEFAULTS.skipDefaultBranch),
    repos: stringList(raw.repos),
    notify,
    noPrCacheSeconds: num(raw.noPrCacheSeconds, DEFAULTS.noPrCacheSeconds, { min: 0, max: 86400 }),
    terminalCacheMinutes: num(raw.terminalCacheMinutes, DEFAULTS.terminalCacheMinutes, {
      min: 0,
      max: 10080,
    }),
    openPrLimit: num(raw.openPrLimit, DEFAULTS.openPrLimit, { min: 1, max: 1000 }),
    ghPath: typeof raw.ghPath === 'string' && raw.ghPath.trim() ? raw.ghPath.trim() : DEFAULTS.ghPath,
    // Tokens carry a TTL a few cycles long so that a daemon which dies takes
    // its stale PR status with it instead of leaving a lie in the sidebar.
    tokenTtlMs: Math.min(HERDR_TTL_MAX_MS, pollSeconds * 4 * 1000),
  };
}
