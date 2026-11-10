import { describe, expect, it } from 'vitest';
import { loadGameData } from '../../src/core/config';
import type { HeroDef, RenderSnapshot, SnapshotUnit } from '../../src/core/types';
import { FIGHT_ZOOM, approachCam, cameraTarget, groundBox } from '../../src/render/camera';
import { LABEL_H, MAX_OFFSET, SPACING, approach, formationOffsets, labelOffsets, type FormUnit, type LabelBox } from '../../src/render/formation';
import { NumberBatcher, matchFx, skillStyle } from '../../src/render/matchFx';
import { DIGIT_CHARS, DIGIT_H, DIGIT_W, digitStrip } from '../../src/render/pixel/digits';
import { MatchPlayer } from '../../src/render/player';
import { clubTeam } from '../../src/sim/scenario';

const data = loadGameData();

describe('formation (where heroes are drawn)', () => {
  const drawn = (us: FormUnit[]) => {
    const off = formationOffsets(us);
    return us.map((u) => ({ ...u, x: u.x + off.get(u.id)!.dx, y: u.y + off.get(u.id)!.dy }));
  };

  it('heroes on the same spot are spread out, never far from where they really are', () => {
    const us: FormUnit[] = ['a', 'b', 'c', 'd', 'e'].map((id, i) => ({ id, side: 'BLUE', x: 400, y: 600, melee: i < 2 }));
    const d = drawn(us);
    for (let i = 0; i < d.length; i++) for (let j = i + 1; j < d.length; j++) expect(Math.hypot(d[i]!.x - d[j]!.x, d[i]!.y - d[j]!.y)).toBeGreaterThan(SPACING * 0.6);
    for (const [, o] of formationOffsets(us)) expect(Math.hypot(o.dx, o.dy)).toBeLessThanOrEqual(MAX_OFFSET + 1e-9);
    expect(formationOffsets([...us].reverse())).toEqual(formationOffsets(us)); // order does not matter
  });

  it('a lone hero is drawn exactly where it is', () => {
    expect(formationOffsets([{ id: 'a', side: 'RED', x: 100, y: 100, melee: true }, { id: 'b', side: 'BLUE', x: 900, y: 900, melee: true }]).get('a')).toEqual({ dx: 0, dy: 0 });
  });

  it('in a fight each team stands on its own side, ranged heroes behind melee ones', () => {
    const us: FormUnit[] = [
      { id: 'b1', side: 'BLUE', x: 500, y: 500, melee: true }, { id: 'b2', side: 'BLUE', x: 500, y: 500, melee: false },
      { id: 'r1', side: 'RED', x: 500, y: 500, melee: true }, { id: 'r2', side: 'RED', x: 500, y: 500, melee: false },
    ];
    const d = new Map(drawn(us).map((u) => [u.id, u]));
    // Along the line from the blue base (bottom left) to the red base (top right).
    const along = (id: string) => (d.get(id)!.x - d.get(id)!.y) / Math.SQRT2;
    expect(along('b2')).toBeLessThan(along('b1'));
    expect(along('b1')).toBeLessThan(along('r1'));
    expect(along('r1')).toBeLessThan(along('r2'));
  });

  it('drawn positions glide towards their targets', () => {
    let o = { dx: 0, dy: 0 };
    for (let i = 0; i < 120; i++) o = approach(o, { dx: 30, dy: -10 }, 1 / 60);
    expect(o.dx).toBeCloseTo(30, 1);
    expect(o.dy).toBeCloseTo(-10, 1);
  });

  it('nearby hero name labels nudge or stack so they never overlap', () => {
    const labels: LabelBox[] = [
      { id: 'a', x: 300, y: 200, w: 38 }, // e.g. "8 惊蛰"
      { id: 'b', x: 320, y: 202, w: 94 }, // e.g. "8 Lanternfish"
      { id: 'c', x: 310, y: 201, w: 48 },
    ];
    const off = labelOffsets(labels);
    const placed = labels.map((l) => ({ ...l, x: l.x + off.get(l.id)!.dx, y: l.y + off.get(l.id)!.dy }));
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        const a = placed[i]!;
        const b = placed[j]!;
        const overlapX = Math.abs(a.x - b.x) < (a.w + b.w) / 2;
        const overlapY = Math.abs(a.y - b.y) < LABEL_H;
        expect(overlapX && overlapY).toBe(false);
      }
    }
    expect(labelOffsets([...labels].reverse())).toEqual(off);
  });
});

function hero(id: string, heroId: string, extra: Partial<SnapshotUnit> = {}): SnapshotUnit {
  return { id, kind: 'HERO', side: 'BLUE', x: 500, y: 500, hp: 500, maxHp: 500, alive: true, heroId, ...extra };
}
function snap(units: SnapshotUnit[], attacks: RenderSnapshot['attacks'] = []): RenderSnapshot {
  return { t: 0, over: false, winner: null, units, attacks, kills: { BLUE: 0, RED: 0 }, gold: { BLUE: 0, RED: 0 }, towersStanding: { BLUE: 0, RED: 0 }, newEvents: [] };
}

describe('match effects', () => {
  it('damage, healing, deaths and respawns come from health changes', () => {
    const before = snap([hero('a', 'panyue'), hero('b', 'panyue'), hero('c', 'panyue', { alive: false, hp: 0 }), hero('d', 'panyue', { hp: 300 })]);
    const after = snap([hero('a', 'panyue', { hp: 380 }), hero('b', 'panyue', { alive: false, hp: 0 }), hero('c', 'panyue'), hero('d', 'panyue', { hp: 360 })]);
    const fx = matchFx(before, after, data);
    expect(fx).toContainEqual({ kind: 'hurt', id: 'a', amount: 120 });
    expect(fx).toContainEqual({ kind: 'hurt', id: 'b', amount: 500 });
    expect(fx).toContainEqual({ kind: 'death', id: 'b' });
    expect(fx).toContainEqual({ kind: 'respawn', id: 'c' });
    expect(fx).toContainEqual({ kind: 'heal', id: 'd', amount: 60 });
    expect(fx.some((f) => f.kind === 'hurt' && f.id === 'c')).toBe(false); // a respawn is not healing
  });

  it('archers shoot arrows, mages throw orbs, melee heroes swing, towers fire', () => {
    const units = [hero('m', 'zhufeng'), hero('g', 'xingzhu'), hero('t', 'panyue'), { ...hero('x', 'panyue'), id: 'T1', kind: 'TOWER' as const, heroId: undefined }];
    const s = snap(units, [{ from: 'm', to: 't', kind: 'BASIC' }, { from: 'g', to: 't', kind: 'BASIC' }, { from: 't', to: 'm', kind: 'BASIC' }, { from: 'T1', to: 'm', kind: 'BASIC' }]);
    const fx = matchFx(snap(units), s, data);
    expect(fx).toContainEqual({ kind: 'shot', style: 'arrow', from: 'm', to: 't', heroId: 'zhufeng' });
    expect(fx).toContainEqual({ kind: 'shot', style: 'orb', from: 'g', to: 't', heroId: 'xingzhu' });
    expect(fx).toContainEqual({ kind: 'slash', from: 't', to: 'm', heroId: 'panyue' });
    expect(fx).toContainEqual({ kind: 'shot', style: 'fire', from: 'T1', to: 'm' });
  });

  it('every hero has a skill look, and a new hero gets one from its skill', () => {
    expect(new Set(data.heroes.map(skillStyle)).size).toBe(data.heroes.length);
    const healer = { ...data.heroById.qingluo!, id: 'new', skill: { ...data.heroById.qingluo!.skill, id: 'new-skill' } } as HeroDef;
    expect(skillStyle(healer)).toBe('bloom');
  });

  it('numbers are added up and shown at most every few hundred milliseconds', () => {
    const b = new NumberBatcher(300);
    b.add('a', 40, 0, 0);
    b.add('a', 25.4, 0, 100);
    b.add('a', 0, 12, 200);
    expect(b.flush(250)).toEqual([]);
    expect(b.flush(300)).toEqual([{ id: 'a', value: 65, heal: false }, { id: 'a', value: 12, heal: true }]);
    expect(b.flush(1000)).toEqual([]);
  });

  it('a whole match shows every kind of effect and every skill picked', () => {
    const input = { seed: 9, blue: clubTeam(data, 'chaosheng', 'TEAMFIGHT_PUSH'), red: clubTeam(data, 'tianshu', 'TEAMFIGHT_PUSH') };
    const p = new MatchPlayer(input, data);
    const kinds = new Set<string>();
    const skills = new Set<string>();
    let prev = p.cur;
    while (!p.over) {
      const cur = p.tick();
      for (const f of matchFx(prev, cur, data)) { kinds.add(f.kind === 'shot' ? `shot:${f.style}` : f.kind); if (f.kind === 'skill') skills.add(f.heroId); }
      prev = cur;
    }
    for (const k of ['hurt', 'heal', 'death', 'respawn', 'slash', 'skill', 'shot:fire']) expect(kinds, k).toContain(k);
    const picked = [...input.blue.lineup.picks, ...input.red.lineup.picks].map((x) => x.heroId);
    for (const h of picked) expect(skills, h).toContain(h);
  }, 60_000);
});

describe('camera', () => {
  it('shows the whole map unless following a fight; never looks past the map edge', () => {
    expect(cameraTarget(720, null, true)).toEqual({ zoom: 1, x: 360, y: 360 });
    expect(cameraTarget(720, { x: 300, y: 300 }, false)).toEqual({ zoom: 1, x: 360, y: 360 });
    const corner = cameraTarget(720, { x: 10, y: 700 }, true);
    expect(corner.zoom).toBe(FIGHT_ZOOM);
    const half = 720 / (2 * FIGHT_ZOOM);
    expect(corner.x).toBeCloseTo(half);
    expect(corner.y).toBeCloseTo(720 - half);
  });

  it('moves smoothly and settles on the target', () => {
    let c = { zoom: 1, x: 360, y: 360 };
    const t = cameraTarget(720, { x: 300, y: 400 }, true);
    for (let i = 0; i < 300; i++) c = approachCam(c, t, 1 / 60, 720);
    expect(c).toEqual(t);
  });

  it('the painted ground moves and scales with the camera', () => {
    expect(groundBox({ zoom: 1, x: 360, y: 360 }, 720, 360)).toEqual({ size: 360, x: 0, y: 0 });
    expect(groundBox({ zoom: 2, x: 360, y: 360 }, 720, 360)).toEqual({ size: 720, x: -180, y: -180 });
  });
});

describe('number font', () => {
  it('has every character, all different', () => {
    const rows = digitStrip();
    expect(rows).toHaveLength(DIGIT_H);
    expect(rows[0]).toHaveLength(DIGIT_CHARS.length * DIGIT_W);
    const cells = [...DIGIT_CHARS].map((_, i) => rows.map((r) => r.slice(i * DIGIT_W, (i + 1) * DIGIT_W)).join('|'));
    expect(new Set(cells).size).toBe(DIGIT_CHARS.length);
  });
});
