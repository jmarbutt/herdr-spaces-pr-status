import { runCmd } from './exec.js';

export function openerFor(platform = process.platform) {
  return platform === 'darwin' ? 'open' : 'xdg-open';
}

export function openUrl(url, { exec = runCmd, platform = process.platform } = {}) {
  if (!url) return false;
  return exec(openerFor(platform), [url], { stdio: 'ignore' }).status === 0;
}
