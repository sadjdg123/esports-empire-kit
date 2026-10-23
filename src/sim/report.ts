// Rule-based post-match report (zh-CN). Every key reason points at real
// events, and reasons tied to pre-match choices (tactic, hero mastery,
// positions, roster strength) are preferred.

import type { GameData, MatchEvent, MatchInput, MatchResult, Player, PlayerId, Side, Tactic } from '../core/types';
import { SIDE_NAME } from './events';
import { roleFitOf } from './units';

export interface MatchReport {
  headline: string;
  keyReasons: { text: string; eventRefs: number[] }[]; // 3 reasons; eventRefs index result.events
  mvp: PlayerId;
  ratings: { playerId: PlayerId; rating: number }[];
}

interface Candidate {
  key: string;
  theme: string; // used in the headline
  score: number;
  text: string;
  refs: number[];
}

const TACTIC_NAME: Record<Tactic, string> = {
  EARLY_AGGRO: '前期猛攻', STEADY_MACRO: '稳健运营', TEAMFIGHT_PUSH: '团战推进', SPLIT_PUSH: '分带牵制',
};

function teamName(data: GameData, input: MatchInput, side: Side, names?: Record<string, string>): string {
  const clubId = (side === 'BLUE' ? input.blue : input.red).lineup.clubId;
  return names?.[clubId] ?? data.clubs.find((c) => c.id === clubId)?.name ?? SIDE_NAME[side];
}

function avgAbility(players: Player[]): number {
  return players.reduce((a, p) => a + (p.attrs.mechanics + p.attrs.awareness + p.attrs.teamwork + p.attrs.mental) / 4, 0) / players.length;
}

function diffAt(result: MatchResult, t: number, side: Side): number {
  let best = result.goldDiffTimeline[0]!;
  for (const p of result.goldDiffTimeline) if (p.t <= t) best = p;
  return side === 'BLUE' ? best.diff : -best.diff;
}

function minutes(t: number): number {
  return Math.max(1, Math.round(t / 60));
}

/** `names` optionally maps club ids to display names (e.g. the player's own club). */
export function buildReport(result: MatchResult, input: MatchInput, data: GameData, names?: Record<string, string>): MatchReport {
  const winner = result.winner;
  const loser: Side = winner === 'BLUE' ? 'RED' : 'BLUE';
  const W = winner === 'BLUE' ? input.blue : input.red;
  const L = winner === 'BLUE' ? input.red : input.blue;
  const wName = teamName(data, input, winner, names);
  const lName = teamName(data, input, loser, names);
  const wTactic = W.lineup.tactic;
  const lTactic = L.lineup.tactic;
  const ev = result.events;
  const idx = (pred: (e: MatchEvent) => boolean): number[] => ev.flatMap((e, i) => (pred(e) ? [i] : []));
  const players = new Map<string, Player>([...W.players, ...L.players].map((p) => [p.id, p]));
  const pickOf = new Map([...W.lineup.picks, ...L.lineup.picks].map((p) => [p.playerId, p]));
  const heroName = (id: string) => data.heroById[id]?.name ?? id;
  const pname = (id: string) => players.get(id)?.name ?? id;
  const cands: Candidate[] = [];
  const add = (c: Candidate) => { if (c.refs.length > 0) cands.push({ ...c, refs: c.refs.slice(0, 8) }); };

  // 1. Early lead (tactic-linked when the winner played EARLY_AGGRO).
  const lead12 = diffAt(result, 720, winner);
  if (lead12 >= 1000) {
    const refs = idx((e) => e.t < 720 && e.side === winner && (e.type === 'GANK' || e.type === 'KILL' || e.type === 'OBJECTIVE_TAKEN'));
    const ganks = refs.filter((i) => ev[i]!.type === 'GANK').length;
    const tactic = wTactic === 'EARLY_AGGRO';
    add({
      key: 'early', theme: '前期压制', score: (tactic ? 3.2 : 2) + lead12 / 2000, refs,
      text: tactic
        ? `「${TACTIC_NAME[wTactic]}」战术奏效：前 12 分钟抓人 ${ganks} 次，建立 ${Math.round(lead12)} 经济领先。`
        : `前 12 分钟打出 ${Math.round(lead12)} 经济领先，开局就掌握了主动。`,
    });
  }

  // 2. Comeback / late game.
  const lead15 = diffAt(result, 900, winner);
  if (lead15 <= -800) {
    const refs = idx((e) => e.t >= 900 && e.side === winner && (e.type === 'TEAMFIGHT_END' || e.type === 'TOWER_DESTROYED' || e.type === 'OBJECTIVE_TAKEN'));
    const tactic = wTactic === 'STEADY_MACRO';
    add({
      key: 'comeback', theme: '后期翻盘', score: (tactic ? 3.4 : 2.6) + -lead15 / 3000, refs,
      text: tactic
        ? `「${TACTIC_NAME[wTactic]}」稳住了局面：15 分钟时落后 ${Math.round(-lead15)} 经济，后期靠发育和运营翻盘。`
        : `15 分钟时一度落后 ${Math.round(-lead15)} 经济，后期打出关键团战完成翻盘。`,
    });
  }

  // 3. Teamfights.
  const tfWon = idx((e) => e.type === 'TEAMFIGHT_END' && e.side === winner);
  const tfLost = idx((e) => e.type === 'TEAMFIGHT_END' && e.side === loser);
  if (tfWon.length > tfLost.length) {
    const tactic = wTactic === 'TEAMFIGHT_PUSH';
    add({
      key: 'teamfight', theme: '团战优势', score: (tactic ? 2.8 : 1.8) + (tfWon.length - tfLost.length) * 0.4, refs: tfWon,
      text: `${tactic ? `「${TACTIC_NAME[wTactic]}」打法下` : ''}团战 ${tfWon.length} 胜 ${tfLost.length} 负，抱团时的配合明显更好。`,
    });
  }

  // 4. Split pushing.
  const splitTowers = idx((e) => e.type === 'TOWER_DESTROYED' && e.side === winner && (e.reason ?? '').includes('split'));
  if (splitTowers.length > 0) {
    const splitEvents = idx((e) => e.type === 'SPLIT_PUSH' && e.side === winner);
    const tactic = wTactic === 'SPLIT_PUSH';
    add({
      key: 'split', theme: '分带牵制', score: (tactic ? 3 : 2) + splitTowers.length * 0.4, refs: [...splitTowers, ...splitEvents],
      text: `${tactic ? `「${TACTIC_NAME[wTactic]}」战术见效：` : ''}边路单带拆掉 ${splitTowers.length} 座塔，${lName}顾此失彼。`,
    });
  }

  // 5. Objectives.
  const objW = idx((e) => e.type === 'OBJECTIVE_TAKEN' && e.side === winner);
  const objL = idx((e) => e.type === 'OBJECTIVE_TAKEN' && e.side === loser);
  if (objW.length >= objL.length + 2) {
    add({
      key: 'objective', theme: '资源控制', score: 1.5 + (objW.length - objL.length) * 0.3, refs: objW,
      text: `中立资源拿下 ${objW.length} 次（对手 ${objL.length} 次），增益期间压着对手打。`,
    });
  }

  // 6. Hero mastery (winner's signature heroes, loser's unfamiliar heroes).
  const keySkills = new Map<string, number[]>();
  ev.forEach((e, i) => {
    if (e.type !== 'SKILL_KEY' || e.side !== winner || Number(e.detail?.mastery ?? 0) < 75) return;
    const list = keySkills.get(e.actors[0]!) ?? [];
    list.push(i);
    keySkills.set(e.actors[0]!, list);
  });
  let star: [string, number[]] | null = null;
  for (const entry of keySkills) if (!star || entry[1].length > star[1].length) star = entry;
  if (star && star[1].length >= 2) {
    const [pid, refs] = star;
    const pick = pickOf.get(pid)!;
    const mastery = players.get(pid)?.heroMastery[pick.heroId] ?? 0;
    add({
      key: 'mastery', theme: '招牌英雄', score: 2.2 + refs.length * 0.3, refs,
      text: `${pname(pid)} 拿出招牌英雄${heroName(pick.heroId)}（熟练度 ${mastery}），「${data.heroById[pick.heroId]?.skill.name}」关键命中 ${refs.length} 次。`,
    });
  }
  const lowMastery = L.lineup.picks.filter((p) => (players.get(p.playerId)?.heroMastery[p.heroId] ?? 20) <= 45);
  if (lowMastery.length >= 2) {
    const ids = new Set(lowMastery.map((p) => p.playerId));
    const refs = idx((e) => e.type === 'KILL' && ids.has(e.targets?.[0] ?? ''));
    add({
      key: 'lowmastery', theme: '英雄选择', score: 2.4 + lowMastery.length * 0.3, refs,
      text: `${lName}有 ${lowMastery.length} 名选手用了不熟练的英雄（${lowMastery.map((p) => `${pname(p.playerId)}·${heroName(p.heroId)}`).join('、')}），对拼时吃亏。`,
    });
  }

  // 7. Off-role players on the losing side.
  const offrole = L.lineup.picks.filter((p) => { const pl = players.get(p.playerId); return pl && roleFitOf(pl, p.role) === 'off'; });
  if (offrole.length > 0) {
    const ids = new Set(offrole.map((p) => p.playerId));
    const refs = idx((e) => e.type === 'KILL' && ids.has(e.targets?.[0] ?? ''));
    add({
      key: 'offrole', theme: '位置优势', score: 2.6 + offrole.length * 0.4, refs,
      text: `${lName}有 ${offrole.length} 名选手打不熟悉的位置（${offrole.map((p) => pname(p.playerId)).join('、')}），合计被击杀 ${refs.length} 次。`,
    });
  }

  // 8. Roster strength.
  const gap = avgAbility(W.players.filter((p) => pickOf.has(p.id))) - avgAbility(L.players.filter((p) => pickOf.has(p.id)));
  if (gap >= 6) {
    const refs = idx((e) => e.type === 'KILL' && e.side === winner);
    add({
      key: 'ability', theme: '实力优势', score: 2 + gap / 8, refs,
      text: `首发平均能力高出 ${gap.toFixed(0)} 分，个人对拼占优，全场击杀 ${refs.length} 次。`,
    });
  } else if (gap <= -6) {
    const refs = idx((e) => (e.type === 'TEAMFIGHT_END' || e.type === 'OBJECTIVE_TAKEN' || e.type === 'TOWER_DESTROYED') && e.side === winner);
    add({
      key: 'upset', theme: '以弱胜强', score: 3 + -gap / 8, refs,
      text: `首发平均能力比对手低 ${(-gap).toFixed(0)} 分，靠「${TACTIC_NAME[wTactic]}」的打法和关键节点的执行爆冷取胜。`,
    });
  }

  // 9. Tactic matchup (when tactics differ).
  if (wTactic !== lTactic) {
    const refs = idx((e) => e.side === winner && (e.type === 'GANK' || e.type === 'SPLIT_PUSH' || e.type === 'TEAMFIGHT_END' || e.type === 'OBJECTIVE_TAKEN') && (e.reason ?? '').includes(`tactic:${wTactic}`));
    add({
      key: 'tactic', theme: '战术克制', score: 1.6, refs,
      text: `「${TACTIC_NAME[wTactic]}」对上「${TACTIC_NAME[lTactic]}」占了上风。`,
    });
  }

  // Fallbacks (always available).
  const mvp = result.mvp;
  const mvpStats = result.players.find((p) => p.playerId === mvp)!;
  add({
    key: 'mvp', theme: '核心发挥', score: 1 + mvpStats.kills * 0.1, refs: idx((e) => e.type === 'KILL' && e.actors[0] === mvp),
    text: `MVP ${pname(mvp)}（${heroName(mvpStats.heroId)}）打出 ${mvpStats.kills}/${mvpStats.deaths}/${mvpStats.assists} 的数据。`,
  });
  const towersW = idx((e) => e.type === 'TOWER_DESTROYED' && e.side === winner);
  add({ key: 'towers', theme: '推进', score: 0.6, refs: towersW, text: `全场推掉 ${towersW.length} 座防御塔，对手只推掉 ${idx((e) => e.type === 'TOWER_DESTROYED' && e.side === loser).length} 座。` });
  const baseHits = idx((e) => e.type === 'BASE_DAMAGED' && e.side === winner);
  if (baseHits.length > 0) {
    add({ key: 'basehit', theme: '抢先破门', score: 0.4, refs: baseHits, text: `第 ${minutes(ev[baseHits[0]!]!.t)} 分钟起抢先打到对方基地，比对手快了一步。` });
  }
  add({ key: 'objective-any', theme: '资源控制', score: 0.3, refs: objW, text: `拿下 ${objW.length} 次中立资源，增益期间打出了优势。` });
  add({ key: 'kills-any', theme: '个人对拼', score: 0.2, refs: idx((e) => e.type === 'KILL' && e.side === winner), text: `关键时刻打出 ${idx((e) => e.type === 'KILL' && e.side === winner).length} 次击杀。` });
  add({ key: 'end', theme: '收官', score: 0.1, refs: idx((e) => e.type === 'BASE_DESTROYED' || e.type === 'MATCH_END'), text: `${minutes(result.durationSec)} 分钟时${ev.some((e) => e.reason === 'timeout') ? '按超时规则判定' : '攻破对方基地'}，结束比赛。` });

  cands.sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));
  const chosen = cands.slice(0, 3);
  // Last resort so a report always has three reasons backed by events.
  if (chosen.length < 3) chosen.push({ key: 'start', theme: '稳定发挥', score: 0, refs: [0], text: `赛前选择的「${TACTIC_NAME[wTactic]}」打法贯彻到底。` });
  while (chosen.length < 3) chosen.push({ key: 'start2', theme: '稳定发挥', score: 0, refs: [ev.length - 1], text: '整场比赛没有出现大的失误。' });
  const theme = chosen[0]?.theme ?? '稳定发挥';
  return {
    headline: `${wName}凭借${theme}，在 ${minutes(result.durationSec)} 分钟击败${lName}`,
    keyReasons: chosen.map((c) => ({ text: c.text, eventRefs: c.refs })),
    mvp,
    ratings: result.players.map((p) => ({ playerId: p.playerId, rating: p.rating })),
  };
}
