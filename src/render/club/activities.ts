// What each of the player's club members is doing today, for the club scene.
// Pure: reads the game state only (no DOM), so it is tested in Node.

import type { GameData, Player } from '../../core/types';
import { PLAYER_CLUB_ID, expiringPlayers, negotiationFor, rosterOf, trainingFocusOf, type GameState } from '../../game';
import type { TrainingFocus } from '../../core/types';

export type Room = 'TRAINING' | 'LOUNGE' | 'OFFICE';
export type Activity = 'TRAIN' | 'REST' | 'IDLE' | 'TALK';

export interface ClubActivity {
  playerId: string;
  activity: Activity;
  room: Room;
  reason: string;
  focus?: TrainingFocus; // what a training player is practising
}

const FOCUS_WORD: Record<TrainingFocus, string> = {
  MECHANICS: '操作', AWARENESS: '意识', TEAMWORK: '配合', MENTAL: '心态', MASTERY: '英雄', REST: '休息',
};

export const TIRED_AT = 70;
const LOW_MORALE = 45;
const BAD_FORM = -5;

export function clubActivities(state: GameState, data: GameData): ClubActivity[] {
  const talking = state.calendar.phase === 'FINISHED' ? undefined
    : expiringPlayers(state).find((p) => (negotiationFor(state, p.id)?.status ?? 'OPEN') === 'OPEN');
  const roster = rosterOf(state).sort((a, b) => a.id.localeCompare(b.id));
  const focus = trainingFocusOf(state, data, PLAYER_CLUB_ID);
  return roster.map((p: Player): ClubActivity => {
    if (talking?.id === p.id) return { playerId: p.id, activity: 'TALK', room: 'OFFICE', reason: '合同快到期，在办公室谈续约' };
    if (focus === 'REST') return { playerId: p.id, activity: 'REST', room: 'LOUNGE', reason: '今天全队休息' };
    if ((p.fatigue ?? 0) >= TIRED_AT) return { playerId: p.id, activity: 'REST', room: 'LOUNGE', reason: `太累了（疲劳 ${Math.round(p.fatigue ?? 0)}），在休息室躺着` };
    if ((p.morale ?? data.growth.moraleNeutral) < LOW_MORALE || p.form <= BAD_FORM) return { playerId: p.id, activity: 'IDLE', room: 'LOUNGE', reason: '状态不好，在发呆' };
    return { playerId: p.id, activity: 'TRAIN', room: 'TRAINING', reason: `在训练室练${FOCUS_WORD[focus]}`, focus };
  });
}

/** One line per room for the caption under the scene. */
export function activitySummary(state: GameState, list: ClubActivity[]): string[] {
  const names = (f: (a: ClubActivity) => boolean) => list.filter(f).map((a) => state.players[a.playerId]!.name);
  const lines: string[] = [];
  const train = names((a) => a.activity === 'TRAIN');
  const rest = names((a) => a.activity === 'REST');
  const idle = names((a) => a.activity === 'IDLE');
  const talk = names((a) => a.activity === 'TALK');
  const focus = list.find((a) => a.focus)?.focus;
  if (train.length && focus) lines.push(`训练室：${train.join('、')} 在练${FOCUS_WORD[focus]}`);
  if (rest.length) lines.push(`休息室：${rest.join('、')} 在休息`);
  if (idle.length) lines.push(`${idle.join('、')} 状态不好，在发呆`);
  if (talk.length) lines.push(`办公室：${talk.join('、')} 在谈续约`);
  if (!lines.length) lines.push('基地里还没有选手，先去市场签人吧');
  return lines;
}
