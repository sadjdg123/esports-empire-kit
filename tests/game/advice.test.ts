import { describe, expect, it } from 'vitest';
import { loadGameData } from '../../src/core/config';
import { marketPlayers, missingRoles, moneyOutlook, newGame, offRolePicks, playerOverall, recommendLineup, setLineup, signPlayer, signingAdvice, type GameState } from '../../src/game';

const data = loadGameData();
const fresh = () => newGame('提醒', '#3a7bd5', 1378102505, data);
const strongest = (s: GameState, role: string) => marketPlayers(s).filter((p) => p.primaryRole === role).sort((a, b) => playerOverall(b) - playerOverall(a))[0]!;

describe('squad advice (GATE-4 feedback)', () => {
  it('lists the roles nobody on the roster plays', () => {
    const s = fresh();
    expect(missingRoles(s)).toEqual(['TOP', 'JUNGLE', 'MID', 'ADC', 'SUPPORT']);
    signPlayer(s, data, strongest(s, 'TOP').id);
    expect(missingRoles(s)).toEqual(['JUNGLE', 'MID', 'ADC', 'SUPPORT']);
  });

  it('warns before a second player of a role while another role is still empty', () => {
    const s = fresh();
    const sup = marketPlayers(s).filter((p) => p.primaryRole === 'SUPPORT');
    signPlayer(s, data, sup[0]!.id);
    const second = signingAdvice(s, data, sup[1]!.id);
    expect(second.duplicate).toBe('SUPPORT');
    expect(second.missing).toContain('ADC');
    expect(signingAdvice(s, data, strongest(s, 'ADC').id).duplicate).toBeNull();
  });

  it('the squad of the playtest (two supports, no marksman) shows a player out of position', () => {
    const s = fresh();
    for (const id of ['fa_top_6', 'fa_jungle_4', 'fa_support_3', 'fa_mid_3', 'fa_support_1']) expect(signPlayer(s, data, id).ok).toBe(true);
    const lu = recommendLineup(s, data, 'EARLY_AGGRO');
    expect(lu.ok && setLineup(s, data, lu.value).ok).toBe(true);
    expect(missingRoles(s)).toEqual(['ADC']);
    expect(offRolePicks(s).map((x) => x.role)).toEqual(['ADC']);
  });

  it('tells how long the money lasts with an expensive squad, and that a cheap one pays its way', () => {
    const rich = fresh();
    for (const id of ['fa_top_6', 'fa_jungle_4', 'fa_support_3', 'fa_mid_3', 'fa_adc_6']) signPlayer(rich, data, id);
    const o = moneyOutlook(rich, data);
    expect(o.weeklyNet).toBeLessThan(0);
    expect(o.weeksLeft).toBe(Math.max(0, Math.floor(rich.funds / -o.weeklyNet)));
    const cheap = fresh();
    for (const role of ['TOP', 'JUNGLE', 'MID', 'ADC', 'SUPPORT']) {
      const p = marketPlayers(cheap).filter((x) => x.primaryRole === role).sort((a, b) => a.salaryPerWeek - b.salaryPerWeek)[0]!;
      signPlayer(cheap, data, p.id);
    }
    expect(moneyOutlook(cheap, data)).toMatchObject({ weeksLeft: null });
  });

  it('the signing outlook counts the new salary and the signing fee', () => {
    const s = fresh();
    const p = strongest(s, 'MID');
    const before = moneyOutlook(s, data);
    const after = signingAdvice(s, data, p.id).after;
    expect(after.weeklyNet).toBe(before.weeklyNet - p.salaryPerWeek - data.economy.finance.trainingCostPerPlayer);
  });
});
