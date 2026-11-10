import { describe, expect, it } from 'vitest';
import { loadGameData } from '../../src/core/config';
import {
  advanceDay,
  autoManage,
  branchMarket,
  branchRoster,
  commitMatchDay,
  newGame,
  openBranch,
  recommendBranchLineup,
  setBranchLineup,
  signBranchPlayer,
  type BranchKind,
  type GameState,
} from '../../src/game';
import {
  CARD_CANVAS_H,
  CARD_CANVAS_W,
  cardStartLife,
  computeCardSceneState,
  computeFpsSceneState,
  flattenCardGames,
  FPS_CANVAS_H,
  FPS_CANVAS_W,
} from '../../src/render/branch/choreo';
import { FPS_ROLES, type FpsEvent } from '../../src/sim-fps';

const data = loadGameData();

function setupBranches(seed = 42): GameState {
  const s = newGame('集团视觉测试', '#3a7bd5', seed, data);
  s.funds = 500000;
  s.club.reputation = 60;
  expect(autoManage(s, data, 'balanced').ok).toBe(true);

  const openAndFill = (kind: BranchKind) => {
    const r = openBranch(s, data, kind);
    if (!r.ok) throw new Error(r.error);
    const b = r.value;
    if (kind === 'FPS') {
      for (const role of FPS_ROLES) {
        const p = branchMarket(b).find((x) => x.primaryRole === role)!;
        expect(signBranchPlayer(s, data, kind, p.id).ok).toBe(true);
      }
    } else {
      for (let i = 0; i < data.branches.kinds.CARD.squad; i++) {
        expect(signBranchPlayer(s, data, kind, branchMarket(b)[0]!.id).ok).toBe(true);
      }
    }
    expect(setBranchLineup(s, data, kind, recommendBranchLineup(data, kind, branchRoster(b))!).ok).toBe(true);
  };

  openAndFill('FPS');
  openAndFill('CARD');

  for (let d = 0; d < 60 && (!s.branches.FPS?.replay || !s.branches.CARD?.replay); d++) {
    if (advanceDay(s, data).pause === 'MATCH_DAY') {
      const c = commitMatchDay(s, data);
      if (!c.ok) {
        autoManage(s, data, 'balanced');
        expect(commitMatchDay(s, data).ok).toBe(true);
      }
    }
  }
  expect(s.branches.FPS?.replay).toBeTruthy();
  expect(s.branches.CARD?.replay).toBeTruthy();
  return s;
}

describe('Branch replay pixel choreography (V8)', () => {
  const state = setupBranches(42);
  const fpsReplay = state.branches.FPS!.replay!;
  const cardReplay = state.branches.CARD!.replay!;

  it('FPS scene state matches round scores, kills, bomb state, and winners across all steps', () => {
    const rounds = fpsReplay.fps!.rounds;
    expect(rounds.length).toBeGreaterThan(0);

    rounds.forEach((round, roundIdx) => {
      const prevScore = roundIdx > 0 ? rounds[roundIdx - 1]!.score : { BLUE: 0, RED: 0 };

      // Step 0: start of round
      const s0 = computeFpsSceneState(fpsReplay, roundIdx, 0);
      expect(s0.roundNumber).toBe(round.n);
      expect(s0.targetSite).toBe(round.site);
      expect(s0.attackers).toBe(round.attackers);
      expect(s0.score).toEqual(round.events.length === 0 ? round.score : prevScore);
      expect(s0.units).toHaveLength(10);
      expect(s0.units.filter((u) => u.side === 'BLUE')).toHaveLength(5);
      expect(s0.units.filter((u) => u.side === 'RED')).toHaveLength(5);
      expect(s0.units.every((u) => u.alive)).toBe(true);
      expect(s0.units.every((u) => u.x >= 18 && u.x <= FPS_CANVAS_W - 18 && u.y >= 24 && u.y <= FPS_CANVAS_H - 18)).toBe(true);

      // Walk through every event step
      const expectedDead = new Set<string>();
      for (let step = 1; step <= round.events.length; step++) {
        const ev: FpsEvent = round.events[step - 1]!;
        if (ev.type === 'KILL') expectedDead.add(ev.victim);

        const st = computeFpsSceneState(fpsReplay, roundIdx, step);
        for (const u of st.units) {
          expect(u.alive).toBe(!expectedDead.has(u.id));
        }
        if (ev.type === 'KILL') {
          expect(st.shot).not.toBeNull();
          expect(st.activeBanner).toContain(fpsReplay.names[ev.killer] ?? ev.killer);
          expect(st.activeBanner).toContain(fpsReplay.names[ev.victim] ?? ev.victim);
        } else if (ev.type === 'PLANT') {
          expect(st.bomb.state).toBe('PLANTED');
          expect(st.bomb.site).toBe(ev.site);
        } else if (ev.type === 'DEFUSE') {
          expect(st.bomb.state).toBe('DEFUSED');
        } else if (ev.type === 'EXPLODE') {
          expect(st.bomb.state).toBe('EXPLODED');
        }
      }

      // Final step: round finished
      const end = computeFpsSceneState(fpsReplay, roundIdx, round.events.length);
      expect(end.done).toBe(true);
      expect(end.score).toEqual(round.score);
      expect(end.winner).toBe(round.winner);
      expect(end.reason).toBe(round.reason);
    });
  });

  it('Card scene state matches turn life bars, damage, heal, notes, and series score across all games', () => {
    const games = flattenCardGames(cardReplay.card!.series);
    expect(games.length).toBeGreaterThan(0);

    games.forEach(({ s, g, i }, flatIdx) => {
      const start = computeCardSceneState(cardReplay, data, flatIdx, 0);
      const initLife = cardStartLife(g, data);
      expect(start.seatNumber).toBe(s.seat + 1);
      expect(start.gameNumber).toBe(i + 1);
      expect(start.bluePlayer.life).toBe(initLife.BLUE);
      expect(start.redPlayer.life).toBe(initLife.RED);
      expect(start.done).toBe(g.turns.length === 0);
      expect(CARD_CANVAS_W).toBe(260);
      expect(CARD_CANVAS_H).toBe(156);

      for (let step = 1; step <= g.turns.length; step++) {
        const turn = g.turns[step - 1]!;
        const st = computeCardSceneState(cardReplay, data, flatIdx, step);
        expect(st.turnNumber).toBe(turn.turn);
        expect(st.activeSide).toBe(turn.side);
        expect(st.damage).toBe(turn.damage);
        expect(st.healed).toBe(turn.healed);
        expect(st.notes).toEqual(turn.notes);
        expect(st.bluePlayer.life).toBe(turn.life.BLUE);
        expect(st.redPlayer.life).toBe(turn.life.RED);
        expect(st.bannerText).toBeTruthy();
      }

      const end = computeCardSceneState(cardReplay, data, flatIdx, g.turns.length);
      expect(end.done).toBe(true);
      expect(end.winner).toBe(g.winner);
      expect(end.byTime).toBe(g.byTime);
    });
  });

  it('FPS and Card subProgress (V9) smoothly interpolates positions, tracers, and HP bars without altering scores or outcomes', () => {
    const fpsRound = fpsReplay.fps!.rounds[0]!;
    expect(fpsRound.events.length).toBeGreaterThan(0);

    for (let step = 1; step <= fpsRound.events.length; step++) {
      const prev = computeFpsSceneState(fpsReplay, 0, step - 1, 1);
      const s0 = computeFpsSceneState(fpsReplay, 0, step, 0);
      const sMid = computeFpsSceneState(fpsReplay, 0, step, 0.5);
      const s1 = computeFpsSceneState(fpsReplay, 0, step, 1);
      const sDefault = computeFpsSceneState(fpsReplay, 0, step);

      expect(s1).toEqual(sDefault);
      expect(s0.score).toEqual(s1.score);
      expect(sMid.score).toEqual(s1.score);
      expect(sMid.winner).toBe(s1.winner);

      if (s1.shot) {
        expect(s0.shot?.progress).toBe(0);
        expect(sMid.shot?.progress).toBe(0.5);
        expect(s1.shot?.progress).toBe(1);
      }

      for (const u1 of s1.units) {
        const uPrev = prev.units.find((u) => u.id === u1.id)!;
        const uMid = sMid.units.find((u) => u.id === u1.id)!;
        expect(uMid.alive).toBe(u1.alive);
        expect(uMid.x).toBeGreaterThanOrEqual(Math.min(uPrev.x, u1.x));
        expect(uMid.x).toBeLessThanOrEqual(Math.max(uPrev.x, u1.x));
        expect(uMid.y).toBeGreaterThanOrEqual(Math.min(uPrev.y, u1.y));
        expect(uMid.y).toBeLessThanOrEqual(Math.max(uPrev.y, u1.y));
      }
    }

    const games = flattenCardGames(cardReplay.card!.series);
    const { g } = games[0]!;
    expect(g.turns.length).toBeGreaterThan(0);
    const initLife = cardStartLife(g, data);

    for (let step = 1; step <= g.turns.length; step++) {
      const prevLife = step >= 2 ? g.turns[step - 2]!.life : initLife;
      const curLife = g.turns[step - 1]!.life;
      const c0 = computeCardSceneState(cardReplay, data, 0, step, 0);
      const cMid = computeCardSceneState(cardReplay, data, 0, step, 0.5);
      const c1 = computeCardSceneState(cardReplay, data, 0, step, 1);

      // Integer life values stay exact regardless of subProgress
      expect(c0.bluePlayer.life).toBe(curLife.BLUE);
      expect(cMid.bluePlayer.life).toBe(curLife.BLUE);
      expect(c0.redPlayer.life).toBe(curLife.RED);
      expect(cMid.redPlayer.life).toBe(curLife.RED);

      // Display life interpolates smoothly from prevLife to curLife
      expect(c0.displayBlueLife).toBeCloseTo(prevLife.BLUE, 6);
      expect(c0.displayRedLife).toBeCloseTo(prevLife.RED, 6);
      expect(c1.displayBlueLife).toBeCloseTo(curLife.BLUE, 6);
      expect(c1.displayRedLife).toBeCloseTo(curLife.RED, 6);
      expect(cMid.displayBlueLife).toBeGreaterThanOrEqual(Math.min(prevLife.BLUE, curLife.BLUE) - 1e-9);
      expect(cMid.displayBlueLife).toBeLessThanOrEqual(Math.max(prevLife.BLUE, curLife.BLUE) + 1e-9);
      expect(cMid.displayRedLife).toBeGreaterThanOrEqual(Math.min(prevLife.RED, curLife.RED) - 1e-9);
      expect(cMid.displayRedLife).toBeLessThanOrEqual(Math.max(prevLife.RED, curLife.RED) + 1e-9);
    }
  });
});
