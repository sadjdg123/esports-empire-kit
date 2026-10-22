// Structured event log plus a readable zh-CN rendering for logs and debugging.

import type { HeroDef, MatchEvent, MatchInput, Player, Side } from '../core/types';
import type { MatchState } from './state';

export function emit(state: MatchState, ev: MatchEvent): number {
  state.events.push(ev);
  return state.events.length - 1;
}

export const SIDE_NAME: Record<Side, string> = { BLUE: '蓝方', RED: '红方' };

const ACTION_NAME: Record<string, string> = {
  FARM_LANE: '对线发育', FARM_JUNGLE: '打野发育', GANK: '抓人', DEFEND: '回防', PUSH: '推塔', GROUP: '集合',
  CONTEST_OBJECTIVE: '争资源', SPLIT: '分带', RETREAT: '撤退', RECALL: '回城', LANE: '对线', IDLE: '待命',
};

export function actionName(action: string): string {
  return ACTION_NAME[action] ?? action;
}

export function formatTime(t: number): string {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export interface NameBook {
  player(id: string): string;
  heroOf(id: string): string;
}

export function nameBook(input: MatchInput, heroes: readonly HeroDef[]): NameBook {
  const players = new Map<string, Player>();
  const heroOfPlayer = new Map<string, string>();
  for (const team of [input.blue, input.red]) {
    for (const p of team.players) players.set(p.id, p);
    for (const pick of team.lineup.picks) heroOfPlayer.set(pick.playerId, pick.heroId);
  }
  const heroName = new Map(heroes.map((h) => [h.id, h.name]));
  return {
    player: (id) => players.get(id)?.name ?? id,
    heroOf: (id) => heroName.get(heroOfPlayer.get(id) ?? '') ?? '?',
  };
}

function who(book: NameBook, ids: readonly string[] | undefined): string {
  if (!ids || ids.length === 0) return '';
  return ids.map((id) => `${book.player(id)}(${book.heroOf(id)})`).join('、');
}

const REASON_NAME: Record<string, string> = {
  'tactic:EARLY_AGGRO': '前期猛攻战术', 'tactic:STEADY_MACRO': '稳健运营战术', 'tactic:TEAMFIGHT_PUSH': '团战推进战术', 'tactic:SPLIT_PUSH': '分带牵制战术',
  mastery_high: '英雄熟练度高', mastery_low: '英雄熟练度低', offrole: '打非擅长位置', gank: '被抓', teamfight: '团战', timeout: '超时判定',
  sudden_death: '决胜阶段', overtime: '加时', group: '抱团推进', split: '分带', role: '位置职责', tower: '防御塔', solo: '单挑', executed: '被防御塔/小兵击杀',
};

export function reasonName(reason: string | undefined): string {
  if (!reason) return '';
  return reason.split('|').map((r) => REASON_NAME[r] ?? (r.startsWith('role:') ? '位置职责' : r)).join('，');
}

/** One-line zh-CN description of an event, for logs. */
export function describeEvent(ev: MatchEvent, book: NameBook): string {
  const side = ev.side ? SIDE_NAME[ev.side] : '';
  const actors = who(book, ev.actors);
  const targets = who(book, ev.targets);
  const why = ev.reason ? `〔${reasonName(ev.reason)}〕` : '';
  const d = ev.detail ?? {};
  let text: string;
  switch (ev.type) {
    case 'MATCH_START': text = '比赛开始'; break;
    case 'KILL': text = actors ? `${side} ${actors} 击杀了 ${targets}${d.assists ? `（助攻：${d.assistNames}）` : ''}` : `${targets} 阵亡`; break;
    case 'ASSIST': text = `${actors} 助攻`; break;
    case 'DEATH': text = `${targets} 阵亡`; break;
    case 'GANK': text = `${side} ${actors} 来到 ${targets} 身边抓人`; break;
    case 'TEAMFIGHT_START': text = `${side ? side + ' ' : ''}团战爆发（${d.blue ?? '?'} 对 ${d.red ?? '?'}）`; break;
    case 'TEAMFIGHT_END': text = `团战结束：蓝方击杀 ${d.blueKills}，红方击杀 ${d.redKills}${d.winner ? `，${SIDE_NAME[d.winner as Side]}获胜` : '，不分胜负'}`; break;
    case 'TOWER_DESTROYED': text = `${side} 摧毁了 ${d.towerName}`; break;
    case 'OBJECTIVE_TAKEN': text = `${side} 拿下了 ${d.objectiveName}`; break;
    case 'BASE_DAMAGED': text = `${side === '蓝方' ? '红方' : '蓝方'}基地受到攻击，剩余 ${d.hpPercent}%`; break;
    case 'BASE_DESTROYED': text = `${side} 摧毁了对方基地`; break;
    case 'SKILL_KEY': text = `${actors} 的「${d.skillName}」命中 ${d.hits} 人${d.kills ? `，击杀 ${d.kills} 人` : ''}`; break;
    case 'SPLIT_PUSH': text = `${side} ${actors} 前往${d.laneName}单带`; break;
    case 'RECALL': text = `${actors} 回城`; break;
    case 'OVERTIME': text = String(d.message ?? '比赛进入加时'); break;
    case 'MATCH_END': text = `${side} 获胜`; break;
    default: text = ev.type;
  }
  return `[${formatTime(ev.t)}] ${text}${why}`;
}
