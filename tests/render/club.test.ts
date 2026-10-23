import { describe, expect, it } from 'vitest';
import { loadGameData } from '../../src/core/config';
import { acceptRenewal, newGame, signValueSquad, type GameState } from '../../src/game';
import { activitySummary, clubActivities, TIRED_AT } from '../../src/render/club/activities';
import { postMessage } from '../../src/game/messages';
import { markersFor } from '../../src/render/club/markers';

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

describe('club base markers (furniture that needs the player)', () => {
  // Read all mail; keep the money low enough that no room upgrade is suggested (that has its own test).
  const calm = (s: GameState) => { for (const m of s.inbox) m.read = true; s.funds = 40000; return s; };

  it('a new club is pointed at the notice board (sign players) and the safe (no sponsor yet)', () => {
    const s = calm(newGame('空', '#3a7bd5', 1, data));
    expect(markersFor(s, data)).toEqual({ market: 'bang', finance: 'bang' });
  });

  it('a ready club with nothing pending shows no markers', () => {
    expect(markersFor(calm(club()), data)).toEqual({});
  });

  it('unread mail, a missing lineup and an expiring contract each light up their furniture', () => {
    const s = calm(club());
    postMessage(s, 'INFO', '测试', '一封未读邮件');
    s.lineup = null;
    s.players[s.club.roster[0]!]!.contractUntil = 1;
    expect(markersFor(s, data)).toEqual({ inbox: 'bang', lineup: 'bang', contracts: 'bang' });
    expect(acceptRenewal(s, data, s.club.roster[0]!, 1).ok).toBe(true);
    expect(markersFor(s, data).contracts).toBeUndefined();
  });

  it('in the pre-season, money to spare for a room upgrade puts a note on the toolbox (T22)', () => {
    const s = calm(club());
    expect(markersFor(s, data).facilities).toBeUndefined();
    s.funds = 400000;
    expect(markersFor(s, data).facilities).toBe('note');
    s.calendar.phase = 'REGULAR';
    expect(markersFor(s, data).facilities).toBeUndefined();
  });

  it('tired players make the training desks sweat, unless it is a rest week or training is automatic', () => {
    const s = calm(club());
    s.training = 'MECHANICS';
    s.players[s.club.roster[1]!]!.fatigue = TIRED_AT;
    expect(markersFor(s, data)).toEqual({ training: 'sweat' });
    s.training = 'REST';
    expect(markersFor(s, data)).toEqual({});
    s.training = 'AUTO'; // rests by itself
    expect(markersFor(s, data)).toEqual({});
  });
});
