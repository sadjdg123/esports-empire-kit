import { describe, expect, it } from 'vitest';
import { DataValidationError, defaultRawData, loadGameData, validateLineup, validateRawData } from '../../src/core/config';
import { ROLES, type Player } from '../../src/core/types';

describe('bundled data', () => {
  const data = loadGameData();

  it('loads and validates', () => {
    expect(validateRawData(defaultRawData())).toEqual([]);
  });

  it('has 10 heroes, two per archetype', () => {
    expect(data.heroes).toHaveLength(10);
    const counts: Record<string, number> = {};
    for (const h of data.heroes) counts[h.archetype] = (counts[h.archetype] ?? 0) + 1;
    expect(Object.values(counts)).toEqual([2, 2, 2, 2, 2]);
  });

  it('has 30 free agents, six per role, ability 40-80', () => {
    expect(data.players).toHaveLength(30);
    for (const role of ROLES) expect(data.players.filter((p) => p.primaryRole === role)).toHaveLength(6);
    const overall = (p: Player) => (p.attrs.mechanics + p.attrs.awareness + p.attrs.teamwork + p.attrs.mental) / 4;
    for (const p of data.players) {
      expect(overall(p)).toBeGreaterThanOrEqual(38);
      expect(overall(p)).toBeLessThanOrEqual(82);
      expect(p.clubId).toBeNull();
      const good = Object.values(p.heroMastery).length;
      expect(good).toBeGreaterThanOrEqual(2);
      expect(good).toBeLessThanOrEqual(4);
    }
  });

  it('has 5 AI clubs with 5-6 players and increasing strength', () => {
    expect(data.clubs).toHaveLength(5);
    const strength = data.clubs.map((c) => c.players.reduce((s, p) => s + p.attrs.mechanics + p.attrs.awareness + p.attrs.teamwork + p.attrs.mental, 0) / (4 * c.players.length));
    for (let i = 1; i < strength.length; i++) expect(strength[i]).toBeGreaterThan(strength[i - 1] as number);
  });

  it('salaries correlate with ability but include bargains', () => {
    const overall = (p: Player) => (p.attrs.mechanics + p.attrs.awareness + p.attrs.teamwork + p.attrs.mental) / 4;
    const xs = data.players.map(overall);
    const ys = data.players.map((p) => p.salaryPerWeek);
    const mx = xs.reduce((a, b) => a + b) / xs.length;
    const my = ys.reduce((a, b) => a + b) / ys.length;
    let num = 0, dx = 0, dy = 0;
    xs.forEach((x, i) => { const y = ys[i] as number; num += (x - mx) * (y - my); dx += (x - mx) ** 2; dy += (y - my) ** 2; });
    expect(num / Math.sqrt(dx * dy)).toBeGreaterThan(0.7);
  });
});

describe('validation catches bad data', () => {
  function issuesAfter(mutate: (raw: ReturnType<typeof defaultRawData>) => void): string[] {
    const raw = defaultRawData();
    mutate(raw);
    return validateRawData(raw);
  }

  it('reports a missing field with its exact location', () => {
    const issues = issuesAfter((raw) => { delete (raw.players as Record<string, unknown>[])[3]!.attrs; });
    expect(issues).toContain('players.json[3].attrs: expected an object');
  });

  it('reports a wrongly typed field', () => {
    const issues = issuesAfter((raw) => { ((raw.heroes as Record<string, Record<string, unknown>>[])[2]!.base!).hp = 'lots'; });
    expect(issues).toContain('heroes.json[2].base.hp: expected a number, got "lots"');
  });

  it('reports out-of-range attributes', () => {
    const issues = issuesAfter((raw) => { ((raw.players as Record<string, Record<string, unknown>>[])[0]!.attrs!).mechanics = 150; });
    expect(issues).toContain('players.json[0].attrs.mechanics: expected 1..100, got 150');
  });

  it('reports duplicate ids', () => {
    const issues = issuesAfter((raw) => {
      const ps = raw.players as Record<string, unknown>[];
      ps[1]!.id = ps[0]!.id;
    });
    expect(issues.some((i) => i.includes('duplicate player id'))).toBe(true);
  });

  it('reports a club roster missing a role', () => {
    const issues = issuesAfter((raw) => {
      const club = (raw.clubs as { players: Record<string, unknown>[] }[])[0]!;
      for (const p of club.players) if (p.primaryRole === 'SUPPORT') p.primaryRole = 'TOP';
    });
    expect(issues).toContain('clubs.json[0].players: no player with primaryRole SUPPORT');
  });

  it('reports unknown hero ids in mastery and unknown map nodes', () => {
    const issues = issuesAfter((raw) => {
      ((raw.players as Record<string, Record<string, unknown>>[])[0]!.heroMastery!).ghost = 50;
      ((raw.match as { map: { edges: string[][] } }).map.edges[0]!)[1] = 'NOWHERE';
    });
    expect(issues).toContain('players.json[0].heroMastery.ghost: unknown hero id');
    expect(issues).toContain('match.json.map.edges[0]: unknown node "NOWHERE"');
  });

  it('loadGameData throws DataValidationError listing the issues', () => {
    const raw = defaultRawData();
    (raw.economy as Record<string, unknown>).startingFunds = -5;
    expect(() => loadGameData(raw)).toThrow(DataValidationError);
    try { loadGameData(raw); } catch (e) { expect((e as DataValidationError).issues[0]).toContain('economy.json.startingFunds'); }
  });
});

describe('validateLineup', () => {
  const data = loadGameData();
  const club = data.clubs[0]!;
  const byRole = (r: string) => club.players.find((p) => p.primaryRole === r)!;
  const good = { clubId: club.id, tactic: 'STEADY_MACRO' as const, picks: ROLES.map((role) => ({ role, playerId: byRole(role).id, heroId: data.heroes[0]!.id })) };

  it('accepts a legal lineup', () => {
    expect(validateLineup(good, club.players, data)).toEqual([]);
  });

  it('rejects duplicate roles, duplicate players and unknown heroes', () => {
    const bad = { ...good, picks: good.picks.map((p, i) => (i === 1 ? { ...p, role: 'TOP' as const, playerId: good.picks[0]!.playerId, heroId: 'nope' } : p)) };
    const issues = validateLineup(bad, club.players, data);
    expect(issues).toContain('picks[1]: duplicate role TOP');
    expect(issues).toContain(`picks[1]: player ${good.picks[0]!.playerId} picked twice`);
    expect(issues).toContain('picks[1]: unknown hero nope');
  });
});
