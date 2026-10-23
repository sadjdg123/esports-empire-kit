import { describe, expect, it } from 'vitest';
import { loadGameData } from '../../src/core/config';
import { acceptRenewal, newGame, signValueSquad, type GameState } from '../../src/game';
import { activitySummary, clubActivities, TIRED_AT } from '../../src/render/club/activities';

const data = loadGameData();

function club(): GameState {
  const s = newGame('基地测试', '#3a7bd5', 3, data);
  expect(signValueSquad(s, data).ok).toBe(true);
  for (const id of s.club.roster) { const p = s.players[id]!; p.contractUntil = 2; p.fatigue = 0; p.morale = 70; p.form = 0; }
  return s;
}

describe('club scene activities', () => {
  it('everyone trains on a normal day', () => {
    const s = club();
    const list = clubActivities(s, data);
    expect(list).toHaveLength(s.club.roster.length);
    expect(list.every((a) => a.activity === 'TRAIN' && a.room === 'TRAINING')).toBe(true);
    expect(activitySummary(s, list)[0]).toContain('训练室');
  });

  it('a rest week sends everyone to the lounge; very tired players rest anyway', () => {
    const s = club();
    const tired = s.club.roster[0]!;
    s.players[tired]!.fatigue = TIRED_AT;
    expect(clubActivities(s, data).find((a) => a.playerId === tired)!.activity).toBe('REST');
    s.training = 'REST';
    expect(clubActivities(s, data).every((a) => a.room === 'LOUNGE')).toBe(true);
  });

  it('unhappy or out-of-form players stand around; an expiring contract means a talk in the office', () => {
    const s = club();
    const [a, b, c] = s.club.roster;
    s.players[a!]!.morale = 30;
    s.players[b!]!.form = -6;
    s.players[c!]!.contractUntil = 1;
    const list = clubActivities(s, data);
    expect(list.find((x) => x.playerId === a)!.activity).toBe('IDLE');
    expect(list.find((x) => x.playerId === b)!.activity).toBe('IDLE');
    expect(list.find((x) => x.playerId === c)!).toMatchObject({ activity: 'TALK', room: 'OFFICE' });
    expect(acceptRenewal(s, data, c!, 1).ok).toBe(true);
    expect(clubActivities(s, data).find((x) => x.playerId === c)!.activity).toBe('TRAIN');
  });

  it('an empty club says so', () => {
    const s = newGame('空', '#3a7bd5', 1, data);
    expect(clubActivities(s, data)).toEqual([]);
    expect(activitySummary(s, [])[0]).toContain('还没有选手');
  });
});
