// Staff decisions (P3, T31): the hired manager, coach and finance chief run their part of the
// club within the player's permissions. Every decision goes into the decision log; under
// "small things alone" anything above the deal limit, and under any level the sale of a
// protected core player or a spend beyond the money set aside, becomes a pending decision
// for the player (T32: approve, reject, or it expires). Skill scales mistakes and
// misjudgement; style decides what each one prefers.

import { hashString, rngFromState } from '../core/rng';
import { STAFF_ROLES, TACTICS, type GameData, type Player, type Role, type StaffMember, type StaffRole, type Tactic } from '../core/types';
import { missingRoles } from './advice';
import { acceptRenewal, expiringPlayers, marketValue, negotiationFor, renewalAsk, seasonWeeks } from './contracts';
import { facilityDef, facilityValue, nextFacilityLevel, sponsorStanding, upgradeFacility } from './facilities';
import { activeSponsor, bestSponsorFor, expectedWeeklyIncome, financeSummary, signSponsor, sponsorOffers, weeklyMoney } from './finance';
import { clubById, emergencySalaryCap, marketPlayers, playerOverall, recommendLineup, rosterOf, setLineup, signPlayer, weekOfSeason, type Result } from './game';
import { nextPlayerFixture } from './season';
import { postMessage } from './messages';
import { hiredStaff, mainSkill } from './staff';
import { PLAYER_CLUB_ID, type DecisionEntry, type GameState, type PendingDecision } from './state';
import { respondToOffer, transferWindowOpen } from './transfers';

/** A decision a staff member wants to carry out. `run` does it; the rest describes it for the log. */
interface Action {
  kind: string;
  text: string;
  reason: string;
  cost: number; // money it moves now (negative = spend)
  payload: Record<string, string | number>;
  big?: boolean; // always needs the player (selling a protected player)
  essential?: boolean; // keeps the club playable (short of five players): never held back by the budget
  ref?: string; // a player the result is about, filled in later
  run: () => Result<unknown>;
}

const weekOf = (state: GameState) => Math.floor(state.calendar.day / 7);
const ROLE_LABEL: Record<Role, string> = { TOP: '上单', JUNGLE: '打野', MID: '中单', ADC: '射手', SUPPORT: '辅助' };

/** The strongest starters, whom staff may not sell on their own. */
export function protectedPlayers(state: GameState): Set<string> {
  const n = state.delegation.protectTop;
  return new Set(rosterOf(state).sort((a, b) => playerOverall(b) - playerOverall(a) || a.id.localeCompare(b.id)).slice(0, n).map((p) => p.id));
}

function mistakeChance(data: GameData, s: StaffMember): number {
  return data.staff.decisions.mistakeAtZero * (1 - mainSkill(data, s) / 100);
}

/**
 * How good a player looks to this manager: true overall plus a misjudgement that shrinks with
 * skill. The misjudgement is his own fixed view of that player, so he does not change his mind
 * from one week to the next.
 */
function perceived(data: GameData, s: StaffMember, p: Player): number {
  const noise = data.staff.decisions.perceptionNoise * (1 - s.skills.scouting / 100);
  const view = (hashString(`${s.id}:${p.id}`) % 2001) / 1000 - 1;
  return playerOverall(p) + view * noise;
}

/** Weeks of running costs kept in the bank: the finance chief's style, else the manager's. */
function reserveWeeks(state: GameState, data: GameData): number {
  const f = hiredStaff(state, 'FINANCE') ?? hiredStaff(state, 'MANAGER');
  return data.staff.decisions.reserveWeeks[f?.style ?? 'CAUTIOUS'];
}

/** Money left after `spend` now and `extraWeekly` more per week, beyond the reserve. */
function spare(state: GameState, data: GameData, spend = 0, extraWeekly = 0): number {
  const m = weeklyMoney(state, data);
  const costs = m.salaries + m.training + m.upkeep + m.staff + extraWeekly;
  return state.funds - spend - costs * reserveWeeks(state, data);
}

export function addDecision(state: GameState, data: GameData, entry: Omit<DecisionEntry, 'id' | 'season' | 'day'>): DecisionEntry {
  const e: DecisionEntry = { id: state.nextDecisionId++, season: state.calendar.season, day: state.calendar.day, ...entry };
  const p = entry.ref ? state.players[entry.ref] : undefined;
  if (p) e.since = { played: p.stats?.played ?? 0, wins: p.stats?.wins ?? 0 };
  state.decisionLog.push(e);
  const max = data.staff.delegation.logMax;
  if (state.decisionLog.length > max) state.decisionLog = state.decisionLog.slice(-max);
  return e;
}

/** Carries out, proposes or only advises an action, depending on the role's permission. */
function decide(state: GameState, data: GameData, role: StaffRole, a: Action): void {
  const s = hiredStaff(state, role);
  if (!s) return;
  const slot = state.delegation.roles[role];
  const base = { role, staffName: s.name, kind: a.kind, text: a.text, reason: a.reason, cost: a.cost, ...(a.ref ? { ref: a.ref } : {}) };
  if (slot.authority === 'SELF') {
    // Advice only, once a week for the same suggestion.
    const week = weekOf(state);
    if (state.decisionLog.some((e) => e.status === 'ADVICE' && e.season === state.calendar.season && Math.floor(e.day / 7) === week && e.kind === a.kind && e.text === a.text)) return;
    addDecision(state, data, { ...base, status: 'ADVICE' });
    return;
  }
  // "Over budget": a spend that would eat into the money set aside for running costs.
  const overBudget = !a.essential && a.cost < 0 && spare(state, data, -a.cost) < 0;
  const big = !!a.big || overBudget;
  const needsYes = big || (slot.authority === 'SMALL' && Math.abs(a.cost) > state.delegation.limit);
  if (needsYes) {
    const key = JSON.stringify(a.payload);
    if (state.pending.some((p) => p.kind === a.kind && JSON.stringify(p.payload) === key)) return;
    const pd: PendingDecision = {
      id: state.nextDecisionId++, role, staffId: s.id, kind: a.kind, text: a.text, reason: a.reason, cost: a.cost,
      season: state.calendar.season, day: state.calendar.day, expiresDay: state.calendar.day + data.staff.delegation.pendingExpireWeeks * 7,
      payload: a.payload, big,
    };
    state.pending.push(pd);
    return;
  }
  const r = a.run();
  if (r.ok) addDecision(state, data, { ...base, status: 'DONE' });
}

/** Carries out a pending decision as it stands, without touching the queue. */
export function runPending(state: GameState, data: GameData, p: PendingDecision): Result<unknown> {
  const action = rebuild(state, data, p);
  if (!action) return { ok: false, error: '情况变了，这件事已经做不了' };
  return action.run();
}

/** Moves a pending decision from the queue into the log. */
function resolve(state: GameState, data: GameData, p: PendingDecision, status: DecisionEntry['status'], result?: string): void {
  state.pending = state.pending.filter((x) => x.id !== p.id);
  addDecision(state, data, {
    role: p.role, staffName: state.staff[p.staffId]?.name ?? '前任负责人', kind: p.kind, text: p.text, reason: p.reason, cost: p.cost, status,
    ...(typeof p.payload.playerId === 'string' ? { ref: p.payload.playerId } : {}), ...(result ? { result } : {}),
  });
}

/** The player says yes: the staff member carries it out. If it cannot be done any more, it is dropped. */
export function approvePending(state: GameState, data: GameData, id: number): Result<unknown> {
  const p = state.pending.find((x) => x.id === id);
  if (!p) return { ok: false, error: '这件事已经处理过了' };
  const action = rebuild(state, data, p);
  if (!action) { resolve(state, data, p, 'EXPIRED', '情况变了，没办成'); return { ok: false, error: '情况变了，这件事已经做不了' }; }
  const r = action.run();
  if (!r.ok) return r; // e.g. not enough money right now: stays in the queue
  resolve(state, data, p, 'APPROVED');
  return r;
}

/** The player says no. A bid the manager wanted to accept is turned down. */
export function rejectPending(state: GameState, data: GameData, id: number): Result<undefined> {
  const p = state.pending.find((x) => x.id === id);
  if (!p) return { ok: false, error: '这件事已经处理过了' };
  if (p.kind === 'SELL') respondToOffer(state, data, Number(p.payload.offerId), false);
  resolve(state, data, p, 'REJECTED');
  return { ok: true, value: undefined };
}

/** Pending decisions nobody answered in time are dropped. Returns how many. */
export function expirePending(state: GameState, data: GameData): number {
  const old = state.pending.filter((p) => state.calendar.day >= p.expiresDay || p.season !== state.calendar.season);
  for (const p of old) resolve(state, data, p, 'EXPIRED', '你没有回复，没做');
  return old.length;
}

/** Monday: one inbox line on what staff did last week and what waits for the player. */
export function postStaffWeekSummary(state: GameState, data: GameData): void {
  if (!STAFF_ROLES.some((r) => hiredStaff(state, r))) return;
  const since = state.calendar.day - data.season.daysPerWeek;
  const week = state.decisionLog.filter((e) => e.season === state.calendar.season && e.day > since);
  const done = week.filter((e) => e.status === 'DONE').length;
  const advice = week.filter((e) => e.status === 'ADVICE').length;
  const waiting = state.pending.length;
  if (done + advice + waiting === 0) return;
  const parts = [`本周负责人做了 ${done} 件事`, ...(advice > 0 ? [`提了 ${advice} 条建议`] : []), `待你批 ${waiting} 件`];
  postMessage(state, 'STAFF', parts.join('，'), waiting > 0 ? '到"负责人"里批准或驳回。不处理的话 2 周后自动作废。' : '到"负责人"里可以看到每件事的原因。', { pending: waiting });
}

/** Rebuilds the runnable action of a pending decision from its payload. */
function rebuild(state: GameState, data: GameData, p: PendingDecision): Action | null {
  const v = p.payload;
  const stub = { kind: p.kind, text: p.text, reason: p.reason, cost: p.cost, payload: v };
  switch (p.kind) {
    case 'SIGN': return { ...stub, run: () => signPlayer(state, data, String(v.playerId)) };
    case 'SELL': return { ...stub, run: () => respondToOffer(state, data, Number(v.offerId), true) };
    case 'RENEW': return { ...stub, run: () => acceptRenewal(state, data, String(v.playerId), data.economy.contracts.defaultYears) };
    case 'FACILITY': return { ...stub, run: () => upgradeFacility(state, data, String(v.room) as never) };
    case 'SPONSOR': return { ...stub, run: () => signSponsor(state, data, String(v.sponsorId), 1) };
    default: return null;
  }
}

// ---------------------------------------------------------------------------
// Coach: training, lineup and tactics

/** Monday: this week's training. A weaker coach sometimes keeps the squad training when it should rest. */
export function coachTraining(state: GameState, data: GameData): void {
  const s = hiredStaff(state, 'COACH');
  if (!s) return;
  const roster = rosterOf(state);
  if (roster.length === 0) return;
  const rng = rngFromState(state.rngState);
  const fatigue = roster.reduce((a, p) => a + (p.fatigue ?? 0), 0) / roster.length;
  const d = data.staff.decisions;
  const avg = (k: 'mechanics' | 'awareness' | 'teamwork' | 'mental') => roster.reduce((a, p) => a + p.attrs[k], 0) / roster.length;
  const ranked = (['MECHANICS', 'AWARENESS', 'TEAMWORK', 'MENTAL'] as const).map((f) => [f, avg(f.toLowerCase() as 'mechanics')] as const).sort((a, b) => a[1] - b[1]);
  const [weakest, low] = ranked[0]!;
  const strongest = ranked[ranked.length - 1]![0];
  // Mechanics wins games; another attribute only when it lags far behind.
  const lagging = avg('mechanics') - low >= d.trainLagGap;
  const focus = lagging ? weakest : 'MECHANICS';
  const tired = fatigue >= d.restFatigue;
  const slip = rng.chance(mistakeChance(data, s));
  state.rngState = rng.state();
  // A slip: training on although the squad is tired, or polishing what is already the best.
  const plan = tired ? (slip ? focus : 'REST') : slip ? strongest : focus;
  const reason = tired ? (slip ? `全队平均疲劳 ${Math.round(fatigue)}，本该休息，但他想多练一周` : `全队平均疲劳 ${Math.round(fatigue)}，该休息了`)
    : slip && plan !== focus ? `他想把全队最强的${FOCUS_LABEL[strongest]}练得更强，本该练${FOCUS_LABEL[focus]}`
    : lagging ? `全队${FOCUS_LABEL[weakest]}比操作低 ${Math.round(avg('mechanics') - low)} 分，先补短板` : '操作最影响比赛，主练操作';
  if (state.training === plan) return;
  decide(state, data, 'COACH', { kind: 'TRAINING', text: `本周训练：${FOCUS_LABEL[plan]}`, reason, cost: 0, payload: { plan }, run: () => { state.training = plan; return { ok: true, value: plan }; } });
}

const FOCUS_LABEL: Record<string, string> = { MECHANICS: '操作', AWARENESS: '意识', TEAMWORK: '配合', MENTAL: '心态', REST: '休息', MASTERY: '英雄' };

/** Match day: the lineup and a tactic against the opponent's usual one. A weaker coach may misread it. */
export function coachMatchDay(state: GameState, data: GameData): void {
  const s = hiredStaff(state, 'COACH');
  if (!s || rosterOf(state).length < 5) return;
  const next = nextPlayerFixture(state, data);
  if (!next) return;
  const opp = clubById(state, next.opponent);
  const d = data.staff.decisions;
  const rng = rngFromState(state.rngState);
  const slip = rng.chance(mistakeChance(data, s));
  const known = opp.style !== 'RANDOM' && opp.style !== 'PLAYER';
  const counter = known ? d.tacticCounter[opp.style as Tactic] : undefined;
  const right: Tactic = counter ?? d.defaultTactic;
  const tactic: Tactic = slip ? rng.pick(TACTICS) : right;
  state.rngState = rng.state();
  const lu = recommendLineup(state, data, tactic);
  if (!lu.ok) return;
  const same = JSON.stringify(state.lineup) === JSON.stringify(lu.value);
  if (same) return;
  const name = (t: Tactic) => `「${data.match.tactics[t].name}」`;
  const usual = known ? `${opp.name}惯用${name(opp.style as Tactic)}` : `${opp.name}的打法不固定`;
  const plan = counter ? `，用${name(right)}克制` : `，用最稳的${name(right)}`;
  const reason = usual + (slip && tactic !== right ? `${plan.replace('，用', '，本该用')}，他没看准，改打${name(tactic)}` : plan);
  decide(state, data, 'COACH', {
    kind: 'TACTIC', text: `对阵${opp.name}：「${data.match.tactics[tactic].name}」，按位置和熟练度排首发`, reason, cost: 0, payload: { tactic, opponent: opp.id },
    run: () => setLineup(state, data, lu.value),
  });
}

// ---------------------------------------------------------------------------
// Manager: signings, renewals, bids

function managerScore(data: GameData, s: StaffMember, p: Player): number {
  const d = data.staff.decisions;
  const look = perceived(data, s, p);
  if (s.style === 'CAUTIOUS') return look - (p.salaryPerWeek / 1000) * d.cautiousSalaryWeight; // ability first, cheaper when close
  if (s.style === 'YOUTH' && p.age <= d.youthAgeMax) return look + Math.max(0, (p.potential ?? look) - playerOverall(p)) * d.youthPotentialWeight;
  return look;
}

/** Fills missing roles, renews the players worth keeping, upgrades a weak starter, answers bids. */
export function managerWeek(state: GameState, data: GameData): void {
  const s = hiredStaff(state, 'MANAGER');
  if (!s) return;
  const d = data.staff.decisions;
  // 1) Bids from AI clubs for our players.
  if (transferWindowOpen(state)) {
    const keep = protectedPlayers(state);
    const starters = new Set(state.lineup?.picks.map((pk) => pk.playerId) ?? []);
    for (const o of state.offers.filter((x) => x.status === 'PENDING' && x.seller === PLAYER_CLUB_ID)) {
      const p = state.players[o.playerId];
      if (!p) continue;
      const value = marketValue(data, p);
      const good = o.fee >= value * d.sellOverValue && state.club.roster.length > data.economy.minRoster;
      const buyer = clubById(state, o.buyer).name;
      if (good) {
        decide(state, data, 'MANAGER', {
          kind: 'SELL', text: `把 ${p.name} 以 ${o.fee} 卖给${buyer}`, reason: `报价是身价（约 ${value}）的 ${(o.fee / value).toFixed(1)} 倍${starters.has(p.id) ? '，他是首发，卖了要补人' : ''}`,
          cost: o.fee, payload: { offerId: o.id }, big: keep.has(p.id), run: () => respondToOffer(state, data, o.id, true),
        });
      } else if (!keep.has(p.id) || state.delegation.roles.MANAGER.authority !== 'SELF') {
        decide(state, data, 'MANAGER', { kind: 'REJECT', text: `拒绝${buyer}对 ${p.name} 的 ${o.fee} 报价`, reason: `报价不到身价（约 ${value}）的 ${d.sellOverValue} 倍`, cost: 0, payload: { offerId: o.id }, run: () => respondToOffer(state, data, o.id, false) });
      }
    }
  }
  // 2) A missing role: sign the best this manager sees (and the club can afford).
  for (const role of missingRoles(state)) signFor(state, data, s, role, `队里没有${ROLE_LABEL[role]}`);
  // 3) Renewals in the last season of a contract.
  if (state.calendar.phase === 'REGULAR' || state.calendar.phase === 'PLAYOFFS') {
    const ranked = rosterOf(state).sort((a, b) => managerScore(data, s, b) - managerScore(data, s, a) || a.id.localeCompare(b.id));
    const wanted = new Set(ranked.slice(0, d.rosterTarget).map((p) => p.id));
    // Players staying next season without a renewal; below a full team, renewals ignore the reserve.
    const expiring = expiringPlayers(state);
    let staying = state.club.roster.length - expiring.length;
    for (const p of ranked.filter((x) => expiring.includes(x))) {
      if (p.retiring || !wanted.has(p.id)) continue;
      if (negotiationFor(state, p.id)) { staying++; continue; }
      const ask = renewalAsk(data, p, facilityValue(state, data, PLAYER_CLUB_ID, 'OFFICE'));
      const extra = ask - p.salaryPerWeek;
      // Within the salary cap and the reserve; short of a team, any renewal the bank can carry.
      const needed = staying < data.economy.minRoster;
      const affordable = spare(state, data, 0, Math.max(0, extra)) >= 0;
      if (!(needed ? affordable || ask <= salaryCap(state, data, s) : affordable && ask <= salaryCap(state, data, s))) continue;
      staying++;
      decide(state, data, 'MANAGER', {
        kind: 'RENEW', text: `和 ${p.name} 续约，周薪 ${ask}`,
        reason: `他是队里最值得留的 ${d.rosterTarget} 个人之一（经理评估能力 ${Math.round(perceived(data, s, p))}，现周薪 ${p.salaryPerWeek} → ${ask}）`,
        cost: -ask * data.economy.signingFeeWeeks,
        payload: { playerId: p.id }, ref: p.id, essential: needed, run: () => acceptRenewal(state, data, p.id, data.economy.contracts.defaultYears),
      });
    }
  }
  // 4) Pre-season: a clearly better player for the weakest starter, if there is money for it.
  if (state.calendar.phase === 'PRESEASON' && state.club.roster.length < data.economy.maxRoster && state.lineup) {
    const weakest = state.lineup.picks.map((pk) => ({ pk, p: state.players[pk.playerId]! })).sort((a, b) => playerOverall(a.p) - playerOverall(b.p))[0];
    if (weakest) {
      const role = weakest.pk.role;
      const now = perceived(data, s, weakest.p);
      signFor(state, data, s, role, `首发${ROLE_LABEL[role]} ${weakest.p.name} 是队里最弱的`, now + d.upgradeMargin);
    }
  }
}

/** Highest weekly salary this manager pays: a fifth of a typical week's income, scaled by style. */
function salaryCap(state: GameState, data: GameData, s: StaffMember): number {
  return (expectedWeeklyIncome(state, data) / data.economy.minRoster) * data.staff.decisions.salaryCap[s.style];
}

/**
 * Signs for a role. Filling an empty role (`atLeast` unset) only needs the fee and a salary
 * within the style's cap; an upgrade must also leave the reserve untouched.
 */
function signFor(state: GameState, data: GameData, s: StaffMember, role: Role, why: string, atLeast = -Infinity): void {
  const cap = salaryCap(state, data, s);
  const upgrade = atLeast > -Infinity;
  // Short of a full team the club may sign cheap players even without money (the game's emergency rule).
  const emergency = !upgrade && state.club.roster.length < data.economy.minRoster ? emergencySalaryCap(state, data) : -1;
  const pool = marketPlayers(state).filter((p) => p.primaryRole === role && !p.retiring
    && ((p.signingFee <= state.funds && state.funds >= 0 && p.salaryPerWeek <= cap) || p.salaryPerWeek <= emergency)
    && (!upgrade || spare(state, data, p.signingFee, p.salaryPerWeek) >= 0));
  const scored = pool.map((p) => ({ p, score: managerScore(data, s, p), look: perceived(data, s, p) })).sort((a, b) => b.score - a.score || a.p.id.localeCompare(b.p.id));
  const pick = scored.find((x) => x.look >= atLeast);
  if (!pick) return;
  const p = pick.p;
  const style = data.staff.styles[s.style].name;
  const detail = s.style === 'YOUTH' && p.age <= data.staff.decisions.youthAgeMax
    ? `（${p.age} 岁潜力 ${p.potential ?? Math.round(pick.look)}）`
    : s.style === 'CAUTIOUS'
      ? `（周薪 ${p.salaryPerWeek} 性价比高）`
      : '';
  decide(state, data, 'MANAGER', {
    kind: 'SIGN', text: `签下${ROLE_LABEL[role]} ${p.name}（能力 ${Math.round(playerOverall(p))}，周薪 ${p.salaryPerWeek}）`,
    reason: `${why}；${style}型经理看他能力约 ${Math.round(pick.look)}${detail}`, cost: -p.signingFee, payload: { playerId: p.id }, ref: p.id,
    essential: !upgrade && state.club.roster.length < data.economy.minRoster, run: () => signPlayer(state, data, p.id),
  });
}

// ---------------------------------------------------------------------------
// Finance: sponsor, rescue, rooms

export function financeWeek(state: GameState, data: GameData): void {
  const s = hiredStaff(state, 'FINANCE');
  if (!s) return;
  const d = data.staff.decisions;
  const rng = rngFromState(state.rngState);
  try {
    const slip = () => rng.chance(mistakeChance(data, s));
    // 1) No sponsor: the best offer (a weaker finance chief may take the second best).
    if (!activeSponsor(state) && state.calendar.phase !== 'FINISHED') {
      const offers = sponsorOffers(state, data).filter((o) => o.id !== data.economy.finance.emergencySponsor.id);
      const best = bestSponsorFor(data, sponsorStanding(state, data));
      const other = offers.find((o) => o.id !== best.id);
      const pick = slip() && other ? other : best;
      decide(state, data, 'FINANCE', {
        kind: 'SPONSOR', text: `签赞助：${pick.name}（每周 ${pick.weekly}）`,
        reason: `${pick === best ? '能签到的最划算的一家' : '他更看好这家的长期合作'}（每胜奖金 ${pick.winBonus}）`,
        cost: pick.signingBonus, payload: { sponsorId: pick.id }, run: () => signSponsor(state, data, pick.id, 1),
      });
    }
    // 2) Money below the warning line: the emergency deal.
    const em = data.economy.finance.emergencySponsor;
    // Only when the cash now outweighs the sponsor money it gives up for the rest of the season.
    const current = activeSponsor(state)?.weekly ?? 0;
    const lost = Math.max(0, current - em.weekly) * Math.max(0, seasonWeeks(state, data) - weekOfSeason(state));
    if (financeSummary(state, data).lowFunds && state.funds < 0 && state.sponsor?.sponsorId !== em.id && lost < em.signingBonus) {
      decide(state, data, 'FINANCE', {
        kind: 'RESCUE', text: `接应急赞助"${em.name}"，立即到账 ${em.signingBonus}`, reason: `资金已经是 ${Math.round(state.funds)}`,
        cost: em.signingBonus, payload: { sponsorId: em.id }, run: () => signSponsor(state, data, em.id, 1),
      });
    }
    // 3) Pre-season, with a full team: one room upgrade from the spare money, in this style's order.
    if (state.calendar.phase === 'PRESEASON' && missingRoles(state).length === 0) {
      const free = spare(state, data);
      const careless = slip(); // a weaker one sometimes spends all the spare money, not just a share
      for (const room of d.facilityOrder[s.style]) {
        const next = nextFacilityLevel(data, state.club, room);
        if (!next) continue;
        const ok = careless ? next.cost <= free : next.cost <= free * d.facilityShare;
        if (!ok) continue;
        const def = facilityDef(data, room);
        decide(state, data, 'FINANCE', {
          kind: 'FACILITY', text: `把${def.name}升一级（${next.cost}）`,
          reason: `${careless ? '他觉得现在不升就晚了，把余钱都花了' : `留够 ${reserveWeeks(state, data)} 周开销后还有余钱`}（${def.name}：${def.effect}）`,
          cost: -next.cost, payload: { room }, run: () => upgradeFacility(state, data, room),
        });
        break;
      }
    }
  } finally {
    state.rngState = rng.state();
  }
}

/** Explains why a pending decision requires the player's approval and its immediate impact. */
export function describePendingContext(state: GameState, data: GameData, p: PendingDecision): { trigger: string; fundsAfter: number; detail?: string } {
  const offerPlayerId = p.kind === 'SELL' ? state.offers.find((o) => o.id === Number(p.payload.offerId))?.playerId : undefined;
  const targetPlayerId = typeof p.payload.playerId === 'string' ? p.payload.playerId : offerPlayerId;
  const isProtectedSale = p.kind === 'SELL' && !!targetPlayerId && protectedPlayers(state).has(targetPlayerId);
  const trigger = isProtectedSale
    ? `触发原因：要卖的是受保护的核心主力（前 ${state.delegation.protectTop} 名），必须你本人点头`
    : p.big
      ? `触发原因：这笔开销会动用安全备用金（需预留 ${reserveWeeks(state, data)} 周运营开销）`
      : `触发原因：单笔金额超过授权额度（${state.delegation.limit}）`;
  const fundsAfter = Math.round(state.funds + p.cost);
  let detail: string | undefined;
  if (targetPlayerId && state.players[targetPlayerId]) {
    const pl = state.players[targetPlayerId]!;
    detail = `${ROLE_LABEL[pl.primaryRole]} · ${pl.age} 岁 · 能力 ${Math.round(playerOverall(pl))}（潜力 ${pl.potential ?? Math.round(playerOverall(pl))}）· 周薪 ${pl.salaryPerWeek}`;
  } else if (p.kind === 'FACILITY' && typeof p.payload.room === 'string') {
    const def = facilityDef(data, p.payload.room as never);
    detail = `房间效果：${def.effect}`;
  }
  return { trigger, fundsAfter, detail };
}

/** All staff decisions of a pay day (the coach's training runs earlier). True if something big now waits for the player. */
export function staffWeek(state: GameState, data: GameData): boolean {
  const before = new Set(state.pending.map((p) => p.id));
  managerWeek(state, data); // the team first, then what is left for the finance chief
  financeWeek(state, data);
  return state.pending.some((p) => p.big && !before.has(p.id));
}

/** End of season: how the signings of this season worked out. */
export function settleDecisionResults(state: GameState): void {
  for (const e of state.decisionLog) {
    if (e.result || e.status !== 'DONE' || e.season !== state.calendar.season || !e.ref) continue;
    const p = state.players[e.ref];
    const c = p?.career?.find((x) => x.season === e.season);
    if (e.kind === 'SIGN' || e.kind === 'RENEW') e.result = c ? `本季 ${c.played} 场 ${c.wins} 胜${c.champion ? '，拿了冠军' : ''}` : '本季没有上场';
  }
}

/** After the player's match: did the coach's plan work? */
export function settleMatchDecision(state: GameState, won: boolean): void {
  const e = [...state.decisionLog].reverse().find((x) => x.kind === 'TACTIC' && x.season === state.calendar.season && !x.result && x.status === 'DONE');
  if (e && state.calendar.day - e.day <= 7) e.result = won ? '赢了' : '输了';
}

