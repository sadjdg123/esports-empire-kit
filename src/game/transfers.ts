// Transfers between clubs (P1, GDD 10). Only in the pre-season window.
// Every fee moves from the buyer's funds to the seller's: money is conserved.

import { rngFromState } from '../core/rng';
import type { ClubId, GameData, Player, PlayerId } from '../core/types';
import { autoLineup } from '../sim/scenario';
import { marketValue } from './contracts';
import { addLedger, clubById, playerOverall, rosterOf, weekOfSeason, type Result } from './game';
import { postMessage } from './messages';
import { PLAYER_CLUB_ID, type ClubState, type GameState, type TransferOffer } from './state';

const ok = <T>(value: T): Result<T> => ({ ok: true, value });
const fail = (error: string): Result<never> => ({ ok: false, error });

export function transferWindowOpen(state: GameState): boolean {
  return state.calendar.phase === 'PRESEASON';
}

function starterIds(state: GameState, data: GameData, clubId: ClubId): Set<PlayerId> {
  const roster = rosterOf(state, clubId);
  if (roster.length < 5) return new Set(roster.map((p) => p.id));
  return new Set(autoLineup(data, clubId, roster, 'STEADY_MACRO').picks.map((pk) => pk.playerId));
}

export function payroll(state: GameState, clubId: ClubId): number {
  return rosterOf(state, clubId).reduce((a, p) => a + p.salaryPerWeek, 0);
}

/** The lowest fee an AI club takes for one of its players. */
export function askingPrice(state: GameState, data: GameData, playerId: PlayerId): number {
  const p = state.players[playerId]!;
  const k = data.economy.contracts;
  const mult = p.clubId && starterIds(state, data, p.clubId).has(playerId) ? k.aiSellCoreMult : k.aiSellMult;
  return Math.round((marketValue(data, p) * mult) / 500) * 500;
}

/** Moves a player and the fee. The contract (salary, length) goes with the player. */
export function completeTransfer(state: GameState, playerId: PlayerId, seller: ClubState, buyer: ClubState, fee: number): void {
  const p = state.players[playerId]!;
  seller.roster = seller.roster.filter((id) => id !== playerId);
  buyer.roster.push(playerId);
  p.clubId = buyer.id;
  const week = weekOfSeason(state);
  if (buyer.id === PLAYER_CLUB_ID) addLedger(state, { week, kind: 'TRANSFER', amount: -fee, note: `从${seller.name}买入 ${p.name}` });
  else buyer.funds -= fee;
  if (seller.id === PLAYER_CLUB_ID) {
    addLedger(state, { week, kind: 'TRANSFER', amount: fee, note: `把 ${p.name} 卖给${buyer.name}` });
    if (state.lineup?.picks.some((pk) => pk.playerId === playerId)) state.lineup = null;
  } else seller.funds += fee;
}

/** The player bids for an AI club's player. AI clubs answer at once. */
export function bidForPlayer(state: GameState, data: GameData, playerId: PlayerId, fee: number): Result<{ accepted: boolean; reason: string }> {
  const p = state.players[playerId];
  if (!transferWindowOpen(state)) return fail('转会窗口只在休赛期开放');
  if (!p || !p.clubId || p.clubId === PLAYER_CLUB_ID) return fail('只能向其他俱乐部的选手报价');
  if (!Number.isFinite(fee) || fee <= 0) return fail('报价要大于 0');
  if (state.club.roster.length >= data.economy.maxRoster) return fail(`队伍已满（最多 ${data.economy.maxRoster} 人）`);
  if (state.funds < 0) return fail('资金为负，暂时不能买人');
  if (state.funds < fee) return fail(`资金不足：报价 ${fee}，当前资金 ${Math.round(state.funds)}`);
  const seller = clubById(state, p.clubId);
  const id = state.offers.length + 1;
  const offer: TransferOffer = { id, season: state.calendar.season, day: state.calendar.day, buyer: PLAYER_CLUB_ID, seller: seller.id, playerId, fee, status: 'REJECTED' };
  state.offers.push(offer);
  if (seller.roster.length <= data.economy.minRoster) return ok({ accepted: false, reason: `${seller.name} 只剩 ${seller.roster.length} 人，不卖` });
  const price = askingPrice(state, data, playerId);
  if (fee < price) return ok({ accepted: false, reason: `${seller.name} 觉得报价太低` });
  offer.status = 'ACCEPTED';
  completeTransfer(state, playerId, seller, state.club, fee);
  postMessage(state, 'OFFER', `买入 ${p.name}`, `从${seller.name}以 ${fee} 买入 ${p.name}，合同照旧（周薪 ${p.salaryPerWeek}，到第 ${p.contractUntil} 赛季）。`);
  return ok({ accepted: true, reason: '成交' });
}

/** Once a week in the window, AI clubs may bid for the player's players who would start for them. */
export function generateAiOffers(state: GameState, data: GameData): TransferOffer[] {
  if (!transferWindowOpen(state)) return [];
  const k = data.economy.contracts;
  const rng = rngFromState(state.rngState);
  const made: TransferOffer[] = [];
  for (const club of state.aiClubs) {
    if (!rng.chance(k.aiOfferChancePerWeek)) continue;
    const mine = rosterOf(state, club.id);
    const best = (role: Player['primaryRole']) => Math.max(0, ...mine.filter((p) => p.primaryRole === role).map(playerOverall));
    const pending = new Set(state.offers.filter((o) => o.status === 'PENDING').map((o) => o.playerId));
    const reserve = (payroll(state, club.id)) * k.aiReserveWeeks;
    const targets = rosterOf(state).filter((p) => !pending.has(p.id) && playerOverall(p) >= best(p.primaryRole) + k.aiOfferMinGain)
      .sort((a, b) => playerOverall(b) - playerOverall(a) || a.id.localeCompare(b.id));
    for (const p of targets) {
      const fee = Math.round((marketValue(data, p) * (k.aiOfferMin + rng.next() * (k.aiOfferMax - k.aiOfferMin))) / 500) * 500;
      if (club.funds - fee < reserve + p.salaryPerWeek * k.aiReserveWeeks) continue;
      const offer: TransferOffer = { id: state.offers.length + 1, season: state.calendar.season, day: state.calendar.day, buyer: club.id, seller: PLAYER_CLUB_ID, playerId: p.id, fee, status: 'PENDING' };
      state.offers.push(offer);
      made.push(offer);
      postMessage(state, 'OFFER', `${club.name} 想买 ${p.name}`, `报价 ${fee}（身价约 ${marketValue(data, p)}）。休赛期结束前有效。`, { offerId: offer.id });
      break;
    }
  }
  state.rngState = rng.state();
  return made;
}

/** The player's answer to an AI bid. */
export function respondToOffer(state: GameState, data: GameData, offerId: number, accept: boolean): Result {
  const offer = state.offers.find((o) => o.id === offerId);
  if (!offer || offer.seller !== PLAYER_CLUB_ID) return fail('找不到这个报价');
  if (offer.status !== 'PENDING') return fail('这个报价已经处理过了');
  if (!transferWindowOpen(state)) { offer.status = 'EXPIRED'; return fail('转会窗口已关闭，报价失效'); }
  if (!accept) { offer.status = 'REJECTED'; return ok(undefined); }
  const buyer = clubById(state, offer.buyer);
  if (!state.club.roster.includes(offer.playerId)) { offer.status = 'EXPIRED'; return fail('这名选手已经不在你的队伍里'); }
  if (buyer.funds < offer.fee) { offer.status = 'EXPIRED'; return fail(`${buyer.name} 的钱已经不够了`); }
  if (buyer.roster.length >= data.economy.maxRoster) { offer.status = 'EXPIRED'; return fail(`${buyer.name} 的队伍已满`); }
  offer.status = 'ACCEPTED';
  completeTransfer(state, offer.playerId, state.club, buyer, offer.fee);
  return ok(undefined);
}

/** Pending bids lapse when the window closes. */
export function expireOffers(state: GameState): void {
  for (const o of state.offers) if (o.status === 'PENDING') o.status = 'EXPIRED';
}

