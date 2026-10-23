import { describe, expect, it } from 'vitest';
import { loadGameData } from '../../src/core/config';
import type { RenderSnapshot, SnapshotUnit } from '../../src/core/types';
import { CAST_MS, COMBAT_MS, DOWN_MS, heroPose, updateHeroAnims, type HeroAnim } from '../../src/render/heroAnim';
import { HERO_ART_IDS, HERO_FRAMES, HERO_H, HERO_W, heroPalette, heroRows, rotateCW } from '../../src/render/pixel/heroArt';
import { MatchPlayer } from '../../src/render/player';
import { clubTeam } from '../../src/sim/scenario';

const data = loadGameData();

describe('hero sprites', () => {
  it('every hero has its own art, and every frame is complete', () => {
    expect([...HERO_ART_IDS].sort()).toEqual(data.heroes.map((h) => h.id).sort());
    for (const h of data.heroes) {
      const pal = heroPalette(h.id, '#3a7bd5');
      for (const f of HERO_FRAMES) {
        const rows = heroRows(h.id, f);
        expect(rows, `${h.id} ${f}`).toHaveLength(HERO_H);
        for (const r of rows) {
          expect(r, `${h.id} ${f}`).toHaveLength(HERO_W);
          for (const ch of r) if (ch !== '.') expect(pal[ch], `${h.id} ${f} uses '${ch}'`).toBeDefined();
        }
        // Feet on the bottom row, so the sprite stands where the hero is.
        expect(rows[HERO_H - 1], `${h.id} ${f}`).toMatch(/[^.]/);
      }
    }
  });

  it('the ten heroes look different, and so do their poses', () => {
    const stands = data.heroes.map((h) => heroRows(h.id, 'stand').join('\n'));
    expect(new Set(stands).size).toBe(data.heroes.length);
    for (const h of data.heroes) {
      const frame = (f: (typeof HERO_FRAMES)[number]) => heroRows(h.id, f).join('\n');
      expect(new Set(HERO_FRAMES.map(frame)).size, h.id).toBe(HERO_FRAMES.length);
    }
  });

  it('the body stays in the middle of the frame, so facing left is a plain mirror', () => {
    for (const h of data.heroes) {
      // The eyes sit either side of the middle (weapons stick out, so the outline is not symmetric).
      const eyes = heroRows(h.id, 'stand').find((r) => r.includes('e'))!;
      expect((eyes.indexOf('e') + eyes.lastIndexOf('e') + 1) / 2, h.id).toBe(HERO_W / 2);
    }
  });

  it('the outfit takes the team colour; a hero without art falls back to its type', () => {
    expect(heroPalette('panyue', '#3a7bd5').c).toBe('#3a7bd5');
    expect(heroPalette('panyue', '#e84a4a').c).toBe('#e84a4a');
    expect(heroRows('someone-new', 'stand', 'MARKSMAN')).toEqual(heroRows('zhufeng', 'stand'));
  });

  it('turning a grid four quarters gives it back', () => {
    const g = ['ab.', 'c.d'];
    let r = { rows: g, p: [0, 0] as [number, number] };
    for (let i = 0; i < 4; i++) r = rotateCW(r.rows, r.p);
    expect(r.rows).toEqual(g);
  });
});

function hero(id: string, x: number, extra: Partial<SnapshotUnit> = {}): SnapshotUnit {
  return { id, kind: 'HERO', side: 'BLUE', x, y: 500, hp: 100, maxHp: 100, alive: true, heroId: 'panyue', ...extra };
}
function snap(units: SnapshotUnit[], attacks: RenderSnapshot['attacks'] = []): RenderSnapshot {
  return { t: 0, over: false, winner: null, units, attacks, kills: { BLUE: 0, RED: 0 }, gold: { BLUE: 0, RED: 0 }, towersStanding: { BLUE: 0, RED: 0 }, newEvents: [] };
}

describe('hero animation', () => {
  it('walks while moving and faces the way it goes', () => {
    const anims = new Map<string, HeroAnim>();
    updateHeroAnims(anims, snap([hero('a', 100)]), snap([hero('a', 110)]), 0);
    const p = heroPose(anims.get('a')!, 10);
    expect(['walkA', 'walkB']).toContain(p.frame);
    expect(p.flip).toBe(false);
    updateHeroAnims(anims, snap([hero('a', 110)]), snap([hero('a', 100)]), 100);
    expect(heroPose(anims.get('a')!, 110).flip).toBe(true);
    // Standing still again.
    updateHeroAnims(anims, snap([hero('a', 100)]), snap([hero('a', 100)]), 200);
    expect(heroPose(anims.get('a')!, 210).frame).toBe('stand');
  });

  it('a respawn is a jump, not a walk', () => {
    const anims = new Map<string, HeroAnim>();
    updateHeroAnims(anims, snap([hero('a', 900)]), snap([hero('a', 50)]), 0);
    expect(heroPose(anims.get('a')!, 0).frame).toBe('stand');
  });

  it('swings at its target while fighting, casts for a skill, then stops', () => {
    const anims = new Map<string, HeroAnim>();
    const units = [hero('a', 500), hero('b', 400, { side: 'RED' })];
    updateHeroAnims(anims, snap(units), snap(units, [{ from: 'a', to: 'b', kind: 'BASIC' }]), 1000);
    const frames = new Set<string>();
    for (let t = 1000; t < 1000 + COMBAT_MS; t += 10) frames.add(heroPose(anims.get('a')!, t).frame);
    expect(frames).toEqual(new Set(['attack', 'stand']));
    expect(heroPose(anims.get('a')!, 1000).flip).toBe(true); // the target is to the left
    expect(heroPose(anims.get('a')!, 1000 + COMBAT_MS).frame).toBe('stand');
    updateHeroAnims(anims, snap(units), snap(units, [{ from: 'a', to: 'b', kind: 'SKILL' }]), 2000);
    expect(heroPose(anims.get('a')!, 2000 + CAST_MS - 1).frame).toBe('cast');
    expect(heroPose(anims.get('a')!, 2000 + CAST_MS).frame).toBe('stand');
  });

  it('lies down when killed, fades out, and is back on its feet after the respawn', () => {
    const anims = new Map<string, HeroAnim>();
    updateHeroAnims(anims, snap([hero('a', 500)]), snap([hero('a', 500, { alive: false, hp: 0 })]), 0);
    expect(heroPose(anims.get('a')!, 100)).toMatchObject({ frame: 'down', alpha: 1 });
    expect(heroPose(anims.get('a')!, DOWN_MS - 100).alpha).toBeLessThan(1);
    expect(heroPose(anims.get('a')!, DOWN_MS).alpha).toBe(0);
    updateHeroAnims(anims, snap([hero('a', 500, { alive: false })]), snap([hero('a', 50)]), 5000);
    expect(heroPose(anims.get('a')!, 5000)).toMatchObject({ frame: 'stand', alpha: 1 });
  });

  it('over a real match every pose shows up, and the snapshots are only read', () => {
    const input = { seed: 5, blue: clubTeam(data, 'chaosheng', 'EARLY_AGGRO'), red: clubTeam(data, 'tianshu', 'TEAMFIGHT_PUSH') };
    const p = new MatchPlayer(input, data);
    const anims = new Map<string, HeroAnim>();
    const seen = new Set<string>();
    let now = 0;
    let prev = p.cur;
    while (!p.over) {
      const cur = p.tick();
      const frozen = JSON.stringify(cur);
      updateHeroAnims(anims, prev, cur, now);
      expect(JSON.stringify(cur)).toBe(frozen);
      for (let k = 0; k < 4; k++) { now += 30; for (const a of anims.values()) seen.add(heroPose(a, now).frame); }
      prev = cur;
    }
    expect(seen).toEqual(new Set(HERO_FRAMES));
    expect(anims.size).toBe(10);
  }, 60_000);
});
