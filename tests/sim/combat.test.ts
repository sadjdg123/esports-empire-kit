import { describe, expect, it } from 'vitest';
import { armorFactor, structureAttackable } from '../../src/sim/combat';
import { runMatch, step } from '../../src/sim';
import { computeCoefficients } from '../../src/sim/units';
import { atNode, graphDistance } from '../../src/sim/map';
import { data, duel, mirrorInput } from './helpers';

describe('basic attacks', () => {
  it('deal attack x (tick / interval) x mechanics coefficient, reduced by armor', () => {
    const s = duel('RIV_TOP', [0], [0]);
    const blue = s.heroes[0]!;
    const red = s.heroes[5]!;
    const redHp = red.hp;
    const blueHp = blue.hp;
    step(s);
    const expectedOnRed = blue.attack * (1 / blue.hero.base.attackInterval) * blue.coef.damage * armorFactor(s, red.armor);
    const expectedOnBlue = red.attack * (1 / red.hero.base.attackInterval) * red.coef.damage * armorFactor(s, blue.armor);
    expect(redHp - red.hp).toBeCloseTo(expectedOnRed, 6);
    expect(blueHp - blue.hp).toBeCloseTo(expectedOnBlue, 6);
  });

  it('armor follows C / (C + armor)', () => {
    const s = duel('RIV_TOP', [0], [0]);
    expect(armorFactor(s, 0)).toBe(1);
    expect(armorFactor(s, 100)).toBeCloseTo(0.5, 9);
  });
});

describe('skills', () => {
  it('go on cooldown scaled by mastery after casting', () => {
    const s = duel('RIV_TOP', [2], [2]); // MID heroes
    const blue = s.heroes[2]!;
    blue.skillReadyAt = 0;
    step(s);
    expect(blue.skillReadyAt).toBeCloseTo(s.t + blue.hero.skill.cooldown * blue.coef.cooldownMult, 9);
    const readyAt = blue.skillReadyAt;
    step(s);
    expect(blue.skillReadyAt).toBe(readyAt); // not recast while on cooldown
  });

  it('a stunned hero does nothing', () => {
    const s = duel('RIV_TOP', [0], [0]);
    const blue = s.heroes[0]!;
    const red = s.heroes[5]!;
    red.stunnedUntil = 10;
    const blueHp = blue.hp;
    for (let i = 0; i < 5; i++) step(s);
    expect(blue.hp).toBe(blueHp);
    expect(red.hp).toBeLessThan(red.maxHp);
  });
});

describe('death and respawn', () => {
  it('a hero dies at 0 hp and respawns at base after 6 + 2 x level seconds', () => {
    const s = duel('RIV_TOP', [0], [0]);
    const red = s.heroes[5]!;
    red.hp = 1;
    step(s);
    expect(red.alive).toBe(false);
    expect(s.heroes[0]!.kills).toBe(1);
    const wait = data.match.hero.respawnBase + data.match.hero.respawnPerLevel * red.level;
    expect(red.respawnAt).toBe(s.t + wait);
    const kill = s.events.find((e) => e.type === 'KILL')!;
    expect(kill.actors).toEqual([s.heroes[0]!.player.id]);
    expect(kill.targets).toEqual([red.player.id]);
    while (s.t < red.respawnAt) step(s);
    expect(red.alive).toBe(true);
    // respawned at its base this tick (and may already have taken one step)
    expect(graphDistance(s.map, red.loc, atNode(s.map.bases.RED))).toBeLessThanOrEqual(red.hero.base.moveSpeed + 1e-9);
    expect(red.hp).toBe(red.maxHp);
  });
});

describe('structures', () => {
  it('an inner tower cannot be damaged while the outer tower stands', () => {
    const s = duel('R_MID_T2', [0, 1, 2, 3, 4], []);
    const t2 = s.structures.find((st) => st.id === 'R_MID_T2')!;
    const t1 = s.structures.find((st) => st.id === 'R_MID_T1')!;
    expect(structureAttackable(s, t2)).toBe(false);
    for (let i = 0; i < 5; i++) { for (const h of s.heroes) if (h.side === 'BLUE') h.hp = h.maxHp; step(s); }
    expect(t2.hp).toBe(t2.maxHp);
    t1.alive = false;
    expect(structureAttackable(s, t2)).toBe(true);
  });

  it('the base becomes attackable once any inner tower falls', () => {
    const s = duel('RIV_TOP', [0], [0]);
    const base = s.structures.find((st) => st.kind === 'BASE' && st.side === 'RED')!;
    expect(structureAttackable(s, base)).toBe(false);
    s.structures.find((st) => st.id === 'R_BOT_T2')!.alive = false;
    expect(structureAttackable(s, base)).toBe(true);
  });

  it('towers shoot creeps before heroes', () => {
    const s = duel('B_MID_T1', [], [0]);
    s.nextWaveAt = 1; // spawn waves now
    step(s);
    const tower = s.structures.find((st) => st.id === 'B_MID_T1')!;
    expect(tower.alive).toBe(true);
    // the red hero standing in range is hit by the tower when no creeps are around
    const red = s.heroes[5]!;
    expect(red.hp).toBeLessThan(red.maxHp);
  });
});

describe('player coefficients', () => {
  const base = data.players[0]!;
  const hero = Object.keys(base.heroMastery)[0]!;
  it('mastery raises skill effect and lowers cooldown', () => {
    const hi = computeCoefficients(data.match, { ...base, heroMastery: { [hero]: 90 } }, base.primaryRole, hero);
    const lo = computeCoefficients(data.match, { ...base, heroMastery: { [hero]: 40 } }, base.primaryRole, hero);
    expect(hi.masteryEffect).toBeCloseTo(0.8 + 0.004 * 90, 9);
    expect(lo.masteryEffect).toBeCloseTo(0.8 + 0.004 * 40, 9);
    expect(hi.cooldownMult).toBeLessThan(lo.cooldownMult);
  });

  it('playing off-role scales performance by the role factors', () => {
    const roles = ['TOP', 'JUNGLE', 'MID', 'ADC', 'SUPPORT'] as const;
    const p = { ...base, primaryRole: 'MID' as const, secondaryRole: 'ADC' as const, form: 0 };
    const off = roles.find((r) => r !== 'MID' && r !== 'ADC')!;
    expect(computeCoefficients(data.match, p, 'MID', hero).performance).toBeCloseTo(1, 9);
    expect(computeCoefficients(data.match, p, 'ADC', hero).performance).toBeCloseTo(0.93, 9);
    expect(computeCoefficients(data.match, p, off, hero).performance).toBeCloseTo(0.82, 9);
    expect(computeCoefficients(data.match, p, off, hero).damage).toBeLessThan(computeCoefficients(data.match, p, 'MID', hero).damage);
  });
});

describe('simple-brain matches', () => {
  it('100 matches all end by base kill or the timeout rule', () => {
    for (let seed = 0; seed < 100; seed++) {
      const r = runMatch(mirrorInput(seed), data, { brain: 'simple' });
      const end = r.events[r.events.length - 1]!;
      expect(end.type).toBe('MATCH_END');
      expect(r.durationSec).toBeLessThanOrEqual(data.match.time.maxDurationSec);
      const baseKilled = r.events.some((e) => e.type === 'BASE_DESTROYED');
      const timeout = r.events.some((e) => e.reason === 'timeout');
      expect(baseKilled || timeout).toBe(true);
    }
  }, 60_000);
});


describe('gold and levels', () => {
  it('xp levels a hero up to the cap and gold converts into stats', async () => {
    const { grantGold, grantXp } = await import('../../src/sim/units');
    const s = duel('RIV_TOP', [0], [0]);
    const h = s.heroes[0]!;
    const atk = h.attack;
    const hp = h.maxHp;
    grantXp(data.match, h, data.match.hero.xpPerLevel[0]!);
    expect(h.level).toBe(2);
    expect(h.attack).toBeCloseTo(atk + h.hero.perLevel.attack, 9);
    grantXp(data.match, h, 1e6);
    expect(h.level).toBe(data.match.hero.maxLevel);
    const lvAtk = h.attack;
    grantGold(data.match, h, data.match.hero.goldStep * 4);
    expect(h.attack).toBeCloseTo(lvAtk * (1 + 4 * data.match.hero.goldStepBonus), 9);
    expect(h.maxHp).toBeGreaterThan(hp);
  });
});
