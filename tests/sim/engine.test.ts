import { describe, expect, it } from 'vitest';
import { createMatch, finalize, getSnapshot, isOver, runMatch, step } from '../../src/sim';
import { buildReport } from '../../src/sim/report';
import { clubTeam } from '../../src/sim/scenario';
import { data, mirrorInput } from './helpers';

describe('runMatch determinism', () => {
  it('the same seed and input give the same checksum and event log', () => {
    const input = mirrorInput(42, 'EARLY_AGGRO');
    const a = runMatch(input, data);
    const b = runMatch(structuredClone(input), data);
    expect(a.checksum).toBe(b.checksum);
    expect(a.events).toEqual(b.events);
    expect(a.players).toEqual(b.players);
  });

  it('a different seed gives a different match', () => {
    expect(runMatch(mirrorInput(1), data).checksum).not.toBe(runMatch({ ...mirrorInput(1), seed: 2 }, data).checksum);
  });

  it('stepping tick by tick (taking snapshots) equals runMatch', () => {
    const input = mirrorInput(7, 'TEAMFIGHT_PUSH');
    const direct = runMatch(input, data);
    const s = createMatch(structuredClone(input), data);
    let ticks = 0;
    let lastT = -1;
    while (!isOver(s)) {
      step(s);
      const snap = getSnapshot(s);
      expect(snap.t).toBeGreaterThan(lastT);
      lastT = snap.t;
      ticks++;
    }
    const stepped = finalize(s);
    expect(stepped.checksum).toBe(direct.checksum);
    expect(stepped.winner).toBe(direct.winner);
    expect(ticks).toBe(direct.durationSec);
  });

  it('input objects are not mutated by a match', () => {
    const input = mirrorInput(9);
    const copy = structuredClone(input);
    runMatch(input, data);
    expect(input).toEqual(copy);
  });
});

describe('match result', () => {
  const input = { seed: 5, blue: clubTeam(data, 'chaosheng', 'STEADY_MACRO'), red: clubTeam(data, 'jinyu', 'EARLY_AGGRO') };
  const r = runMatch(input, data);

  it('stats agree with the event log', () => {
    const kills = r.events.filter((e) => e.type === 'KILL');
    for (const p of r.players) {
      expect(p.kills).toBe(kills.filter((e) => e.actors[0] === p.playerId).length);
      expect(p.deaths).toBe(kills.filter((e) => e.targets?.[0] === p.playerId).length);
      expect(p.rating).toBeGreaterThanOrEqual(1);
      expect(p.rating).toBeLessThanOrEqual(10);
    }
    expect(r.players.find((p) => p.playerId === r.mvp)!.side).toBe(r.winner);
    expect(r.events[0]!.type).toBe('MATCH_START');
    expect(r.events[r.events.length - 1]!.type).toBe('MATCH_END');
  });

  it('records the gold difference every 30 seconds', () => {
    expect(r.goldDiffTimeline[0]).toEqual({ t: 0, diff: 0 });
    for (let i = 1; i < r.goldDiffTimeline.length; i++) expect(r.goldDiffTimeline[i]!.t - r.goldDiffTimeline[i - 1]!.t).toBe(30);
  });

  it('snapshots contain everything the renderer needs', () => {
    const s = createMatch(input, data);
    for (let i = 0; i < 90; i++) step(s);
    const snap = getSnapshot(s);
    expect(snap.units.filter((u) => u.kind === 'HERO')).toHaveLength(10);
    expect(snap.units.filter((u) => u.kind === 'TOWER')).toHaveLength(12);
    expect(snap.units.filter((u) => u.kind === 'BASE')).toHaveLength(2);
    expect(snap.units.some((u) => u.kind === 'CREEP')).toBe(true);
    // Jungle camps (V3): six of them, alive after the first spawn, with the ids hero attacks use.
    const camps = snap.units.filter((u) => u.kind === 'CAMP');
    expect(camps).toHaveLength(data.match.map.nodes.filter((n) => n.type === 'JUNGLE').length);
    expect(camps.some((c) => c.alive && c.hp > 0 && c.hp <= c.maxHp)).toBe(true);
    for (const c of camps) expect(c.id).toMatch(/^CAMP:/);
    for (const u of snap.units) {
      expect(Number.isFinite(u.x) && Number.isFinite(u.y)).toBe(true);
    }
  });
});

describe('buildReport', () => {
  it('always gives a headline and 3 key reasons whose eventRefs point at real events (60 matches)', () => {
    const pairs = [['tianshu', 'huiyan'], ['wugang', 'jinyu'], ['chaosheng', 'tianshu']] as const;
    for (let seed = 0; seed < 60; seed++) {
      const [b, red] = pairs[seed % pairs.length]!;
      const tactics = ['EARLY_AGGRO', 'STEADY_MACRO', 'TEAMFIGHT_PUSH', 'SPLIT_PUSH'] as const;
      const input = { seed, blue: clubTeam(data, b, tactics[seed % 4]!), red: clubTeam(data, red, tactics[(seed + 1) % 4]!) };
      const r = runMatch(input, data);
      const rep = buildReport(r, input, data);
      expect(rep.headline.length).toBeGreaterThan(5);
      expect(rep.keyReasons).toHaveLength(3);
      for (const reason of rep.keyReasons) {
        expect(reason.text.length).toBeGreaterThan(5);
        expect(reason.eventRefs.length).toBeGreaterThan(0);
        for (const ref of reason.eventRefs) {
          expect(Number.isInteger(ref)).toBe(true);
          expect(r.events[ref]).toBeDefined();
        }
      }
      expect(rep.ratings).toHaveLength(10);
      expect(rep.mvp).toBe(r.mvp);
    }
  }, 60_000);
});
