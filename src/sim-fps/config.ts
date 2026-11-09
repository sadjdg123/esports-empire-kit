// Loads fps.json. The numbers are checked the simple way: every one must be a finite number.
import raw from '../data/fps.json';
import { FPS_ATTRS, FPS_ROLES, FPS_TACTICS, type FpsConfig } from './types';

export function checkFpsConfig(c: FpsConfig): string[] {
  const issues: string[] = [];
  const walk = (v: unknown, path: string) => {
    if (typeof v === 'number') { if (!Number.isFinite(v)) issues.push(`${path}: not a number`); }
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`);
  };
  walk(c, 'fps.json');
  for (const r of FPS_ROLES) if (!c.roles?.[r] || !c.power?.roleFocus?.[r]) issues.push(`fps.json: role ${r} missing`);
  for (const a of FPS_ATTRS) if (typeof c.power?.weights?.[a] !== 'number' || !c.attrs?.[a]) issues.push(`fps.json: attribute ${a} missing`);
  for (const t of FPS_TACTICS) if (!c.tactics?.[t]) issues.push(`fps.json: tactic ${t} missing`);
  if (!(c.economy?.loadouts?.length > 0) || c.economy.loadouts[0]!.cost !== 0) issues.push('fps.json: the first loadout must be free');
  if (!(c.roundsToWin > c.halfRounds)) issues.push('fps.json: roundsToWin must be more than halfRounds');
  return issues;
}

export const fpsConfig = raw as unknown as FpsConfig;
const problems = checkFpsConfig(fpsConfig);
if (problems.length > 0) throw new Error(`fps.json:\n  - ${problems.join('\n  - ')}`);
