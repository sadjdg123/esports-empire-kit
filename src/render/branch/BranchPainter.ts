// Pixel-art canvas painters for Shooter (FPS) and Card division replays (V8).
// Uses the project's original chibi pixel sprites (`src/render/pixel/chibi.ts`) and geometric
// pixel primitives (`src/render/pixel/raster.ts`). Zero external assets.

import type { BranchReplay } from '../../game';
import { chibi, lookFor, type ChibiFrame } from '../pixel/chibi';
import { shade } from '../pixel/raster';
import {
  CARD_CANVAS_H,
  CARD_CANVAS_W,
  FPS_CANVAS_H,
  FPS_CANVAS_W,
  type CardSceneState,
  type FpsSceneState,
  type FpsUnitPose,
} from './choreo';

const REASON_LABEL: Record<FpsSceneState['reason'], string> = {
  ELIMINATION: '全歼对手',
  EXPLODE: '爆破成功',
  DEFUSE: '拆除成功',
  TIMEOUT: '时间耗尽',
};

function pxRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  fill: string,
  outline?: string,
): void {
  const rx = Math.round(x);
  const ry = Math.round(y);
  const rw = Math.round(w);
  const rh = Math.round(h);
  if (outline) {
    ctx.fillStyle = outline;
    ctx.fillRect(rx - 1, ry - 1, rw + 2, rh + 2);
  }
  ctx.fillStyle = fill;
  ctx.fillRect(rx, ry, rw, rh);
}

function drawPixelLabel(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  bg: string,
  fg: string,
  border?: string,
  fontSize = 9,
): void {
  ctx.save();
  ctx.font = `bold ${fontSize}px "PingFang SC", "Microsoft YaHei", sans-serif`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  const w = Math.ceil(ctx.measureText(text).width) + 8;
  const h = fontSize + 5;
  const rx = Math.max(2, Math.min(ctx.canvas.width - w - 2, Math.round(x - w / 2)));
  const ry = Math.max(2, Math.min(ctx.canvas.height - h - 2, Math.round(y - h / 2)));
  if (border) {
    ctx.fillStyle = border;
    ctx.fillRect(rx - 1, ry - 1, w + 2, h + 2);
  }
  ctx.fillStyle = bg;
  ctx.fillRect(rx, ry, w, h);
  ctx.fillStyle = fg;
  ctx.fillText(text, rx + w / 2, ry + h / 2 + 0.5);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// 1. Shooter (FPS) Tactical Arena Painter

export function paintFpsScene(
  ctx: CanvasRenderingContext2D,
  replay: BranchReplay,
  state: FpsSceneState,
  animPhase: number,
): void {
  ctx.save();
  ctx.imageSmoothingEnabled = false;

  // Base tactical ground (warm sandstone & slate tiles)
  ctx.fillStyle = '#c8ba9e';
  ctx.fillRect(0, 0, FPS_CANVAS_W, FPS_CANVAS_H);

  // Subtle pixel grid tiles on ground
  for (let y = 16; y < FPS_CANVAS_H - 16; y += 12) {
    for (let x = 0; x < FPS_CANVAS_W; x += 16) {
      ctx.fillStyle = ((x / 16 + y / 12) % 2 === 0) ? '#cfc2a6' : '#c3b496';
      ctx.fillRect(x, y, 15, 11);
    }
  }

  // Three tactical lanes: Top (A Lane), Centre (Mid Corridor), Bottom (B Lane)
  // Top A Lane path
  pxRect(ctx, 32, 22, 196, 32, '#dfd3b8', '#8c7a5b');
  // Mid Lane path
  pxRect(ctx, 32, 68, 196, 30, '#bfc7d1', '#6e7885');
  // Bottom B Lane path
  pxRect(ctx, 32, 112, 196, 30, '#d8c5b0', '#8c7258');

  // Connector alleys between A <-> Mid and Mid <-> B
  ctx.fillStyle = '#cabfa8';
  ctx.fillRect(88, 52, 22, 18);
  ctx.fillRect(150, 52, 22, 18);
  ctx.fillRect(88, 96, 22, 18);
  ctx.fillRect(150, 96, 22, 18);

  // Left Spawn (BLUE) & Right Spawn (RED) zones
  const blueCol = replay.teams.BLUE.color;
  const redCol = replay.teams.RED.color;
  pxRect(ctx, 6, 22, 28, 120, shade(blueCol, 0.55), '#2a1a14');
  pxRect(ctx, 8, 24, 24, 116, shade(blueCol, 0.85));
  pxRect(ctx, FPS_CANVAS_W - 34, 22, 28, 120, shade(redCol, 0.55), '#2a1a14');
  pxRect(ctx, FPS_CANVAS_W - 32, 24, 24, 116, shade(redCol, 0.85));

  // Tactical cover walls & crates
  const drawCrate = (cx: number, cy: number, w = 12, h = 10) => {
    pxRect(ctx, cx, cy, w, h, '#b87d44', '#3b2310');
    pxRect(ctx, cx + 2, cy + 2, w - 4, h - 4, '#d1975a');
  };
  drawCrate(70, 26, 12, 10);
  drawCrate(178, 38, 12, 10);
  drawCrate(124, 77, 12, 12); // Mid center cover box
  drawCrate(72, 122, 12, 10);
  drawCrate(176, 116, 12, 10);

  // Bomb Site A (Top Centre, x = 112..152, y = 24..52)
  const aTarget = state.targetSite === 'A';
  const aPlanted = state.bomb.state === 'PLANTED' && state.bomb.site === 'A';
  pxRect(
    ctx,
    112,
    24,
    40,
    28,
    aPlanted ? '#f6b8b0' : aTarget ? '#f7e3a8' : '#e6d8bc',
    aPlanted ? '#d92b2b' : aTarget ? '#d98218' : '#7a684b',
  );
  drawPixelLabel(ctx, 'A 点', 132, 31, aTarget ? '#d96b18' : '#5e4930', '#fff', undefined, 8);

  // Mid label
  drawPixelLabel(ctx, '中路', 130, 69, '#4c5666', '#e8eef7', undefined, 8);

  // Bomb Site B (Bottom Centre, x = 112..152, y = 114..140)
  const bTarget = state.targetSite === 'B';
  const bPlanted = state.bomb.state === 'PLANTED' && state.bomb.site === 'B';
  pxRect(
    ctx,
    112,
    114,
    40,
    26,
    bPlanted ? '#f6b8b0' : bTarget ? '#f7e3a8' : '#e6d8bc',
    bPlanted ? '#d92b2b' : bTarget ? '#d98218' : '#7a684b',
  );
  drawPixelLabel(ctx, 'B 点', 132, 121, bTarget ? '#d96b18' : '#5e4930', '#fff', undefined, 8);

  // Fake attack decoy smoke effect if active
  if (state.fakeBanner) {
    const fy = state.fakeBanner.site === 'A' ? 38 : 127;
    ctx.fillStyle = 'rgba(225, 232, 240, 0.78)';
    ctx.beginPath();
    ctx.arc(118, fy, 9 + Math.sin(animPhase * 4) * 1.5, 0, Math.PI * 2);
    ctx.arc(126, fy - 3, 7, 0, Math.PI * 2);
    ctx.fill();
  }

  // Bomb device rendering on site (PLANTED / DEFUSED / EXPLODED)
  if (state.bomb.state !== 'CARRIED') {
    const bx = state.bomb.x;
    const by = state.bomb.y + 5;
    if (state.bomb.state === 'PLANTED') {
      const pulse = (animPhase * 3) % 1;
      ctx.strokeStyle = `rgba(230, 45, 35, ${1 - pulse})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(bx, by, 4 + pulse * 14, 0, Math.PI * 2);
      ctx.stroke();
      pxRect(ctx, bx - 4, by - 3, 8, 6, '#2b2d38', '#000');
      ctx.fillStyle = Math.floor(animPhase * 6) % 2 === 0 ? '#ff2e2e' : '#ffe047';
      ctx.fillRect(bx - 1, by - 2, 3, 3);
    } else if (state.bomb.state === 'DEFUSED') {
      ctx.strokeStyle = '#25a85a';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(bx, by, 10, 0, Math.PI * 2);
      ctx.stroke();
      pxRect(ctx, bx - 4, by - 3, 8, 6, '#25a85a', '#104a26');
    } else if (state.bomb.state === 'EXPLODED') {
      const r1 = 16 + Math.sin(animPhase * 8) * 3;
      ctx.fillStyle = 'rgba(235, 75, 35, 0.85)';
      ctx.beginPath();
      ctx.arc(bx, by, r1, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffcf40';
      ctx.beginPath();
      ctx.arc(bx, by, r1 * 0.62, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff9d6';
      ctx.beginPath();
      ctx.arc(bx, by, r1 * 0.3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Sort 10 players by y coordinate for proper painter's order
  const sortedUnits = [...state.units].sort((a, b) => a.y - b.y);
  for (const u of sortedUnits) {
    drawFpsUnit(ctx, u, replay.teams[u.side].color, animPhase);
  }

  // Active gunfire tracer & muzzle flash
  if (state.shot && !state.done) {
    const s = state.shot;
    const prog = s.progress ?? 1;
    const head = prog >= 0.98 ? 1 : Math.min(1, prog * 2.5);
    const tail = prog >= 0.98 ? 0 : Math.max(0, head - 0.55);
    const x0 = s.fromX + (s.toX - s.fromX) * tail;
    const y0 = s.fromY + (s.toY - s.fromY) * tail;
    const x1 = s.fromX + (s.toX - s.fromX) * head;
    const y1 = s.fromY + (s.toY - s.fromY) * head;

    ctx.save();
    ctx.strokeStyle = '#fff3a1';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();

    ctx.strokeStyle = s.color;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();

    // Muzzle flash star at shooter
    if (prog < 0.45 || prog >= 0.98) {
      pxRect(ctx, s.fromX - 3, s.fromY - 3, 6, 6, '#ffe45e', '#d96b18');
    }
    // Bullet head spark while in flight
    if (head < 1) {
      pxRect(ctx, x1 - 2, y1 - 2, 4, 4, '#ffffff', '#ffcf40');
    }
    // Hit burst at victim once tracer arrives
    if (head >= 0.85) {
      pxRect(ctx, s.toX - 4, s.toY - 4, 8, 8, '#ff4d3d', '#fff');
    }
    drawPixelLabel(
      ctx,
      s.tag,
      (s.fromX + s.toX) / 2,
      Math.min(s.fromY, s.toY) - 10,
      '#2b190d',
      '#ffe46b',
      '#f2a62c',
      8,
    );
    ctx.restore();
  }

  // Top HUD bar inside canvas
  pxRect(ctx, 0, 0, FPS_CANVAS_W, 15, '#3b2412');
  ctx.fillStyle = '#d9a45b';
  ctx.fillRect(0, 15, FPS_CANVAS_W, 1);

  const atkName = replay.teams[state.attackers].name;
  drawPixelLabel(
    ctx,
    `R${state.roundNumber} · ${atkName}攻${state.targetSite}点`,
    64,
    7.5,
    '#241408',
    '#ffe9ba',
    undefined,
    8,
  );
  drawPixelLabel(
    ctx,
    `${state.score.BLUE} : ${state.score.RED}`,
    158,
    7.5,
    '#1c1008',
    '#ffd84d',
    '#b58338',
    9,
  );
  const bombBadge =
    state.bomb.state === 'PLANTED'
      ? `💣 ${state.bomb.site}点已下包`
      : state.bomb.state === 'DEFUSED'
        ? '🔧 已拆除'
        : state.bomb.state === 'EXPLODED'
          ? '💥 已引爆'
          : state.done
            ? '🏁 回合结束'
            : '⏱️ 交战中';
  drawPixelLabel(
    ctx,
    bombBadge,
    222,
    7.5,
    state.bomb.state === 'PLANTED' ? '#b8251e' : '#241408',
    '#fff',
    undefined,
    8,
  );

  // Bottom event / round winner banner
  const bottomText = state.done
    ? `🏆 ${replay.teams[state.winner].name} 赢下第 ${state.roundNumber} 回合（${REASON_LABEL[state.reason]}）`
    : state.activeBanner ?? `第 ${state.roundNumber} 回合开始 · 双方进入战术位置`;
  pxRect(ctx, 0, FPS_CANVAS_H - 16, FPS_CANVAS_W, 16, state.done ? '#2d5e36' : '#3b2412');
  ctx.fillStyle = '#d9a45b';
  ctx.fillRect(0, FPS_CANVAS_H - 16, FPS_CANVAS_W, 1);
  drawPixelLabel(
    ctx,
    bottomText,
    FPS_CANVAS_W / 2,
    FPS_CANVAS_H - 8,
    state.done ? '#1e4425' : '#26160a',
    '#fff8e2',
    undefined,
    8.5,
  );

  ctx.restore();
}

function drawFpsUnit(
  ctx: CanvasRenderingContext2D,
  u: FpsUnitPose,
  teamColor: string,
  animPhase: number,
): void {
  const look = lookFor(u.id, teamColor);
  const flip = u.facing === 'left';

  if (!u.alive) {
    // Fallen player: horizontal sleep/down sprite + compact pixel X badge (avoids obscuring alive players)
    const downSprite = chibi(look, 'sleep', flip);
    ctx.save();
    ctx.globalAlpha = 0.62;
    ctx.drawImage(downSprite, Math.round(u.x - downSprite.width / 2), Math.round(u.y - 5));
    ctx.restore();
    pxRect(ctx, u.x - 4, u.y - 11, 8, 8, 'rgba(30, 16, 12, 0.85)', teamColor);
    ctx.fillStyle = '#ff6b5e';
    ctx.font = 'bold 7px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('✕', Math.round(u.x), Math.round(u.y - 6.5));
    return;
  }

  // Team foot marker
  ctx.fillStyle = teamColor;
  ctx.fillRect(Math.round(u.x - 5), Math.round(u.y - 2), 10, 3);
  ctx.strokeStyle = '#1f1209';
  ctx.lineWidth = 1;
  ctx.strokeRect(Math.round(u.x - 5.5), Math.round(u.y - 2.5), 11, 4);

  let frame: ChibiFrame = 'stand';
  if (u.pose === 'cheer') {
    frame = 'cheer';
  } else if (u.pose === 'walk' || u.pose === 'shoot') {
    frame = Math.floor(animPhase * 6) % 2 === 0 ? 'walkA' : 'walkB';
  }

  const sprite = chibi(look, frame, flip);
  const sx = Math.round(u.x - sprite.width / 2);
  const sy = Math.round(u.y - sprite.height);
  ctx.drawImage(sprite, sx, sy);

  // Pixel weapon held in front of chibi
  const dir = flip ? -1 : 1;
  const wx = Math.round(u.x + dir * 3);
  const wy = Math.round(u.y - 7);
  if (u.role === 'AWP') {
    // Long sniper rifle + scope
    pxRect(ctx, dir > 0 ? wx : wx - 9, wy, 9, 2, '#2b303c', '#000');
    ctx.fillStyle = '#7ec8ff';
    ctx.fillRect(Math.round(u.x + dir * 5), wy - 2, 2, 1);
  } else {
    // Compact assault rifle / SMG
    pxRect(ctx, dir > 0 ? wx : wx - 6, wy, 6, 2, '#3a3f4d', '#000');
  }

  // Bomb carrier icon or defuse wrench icon
  if (u.hasBomb) {
    pxRect(ctx, u.x - 2, u.y - 20, 4, 3, '#ff3b30', '#ffe066');
  } else if (u.pose === 'defuse') {
    pxRect(ctx, u.x - 2, u.y - 20, 5, 4, '#2ecc71', '#fff');
  }

  // Crisp player name badge above head
  drawPixelLabel(
    ctx,
    u.name.slice(0, 5),
    u.x,
    sy - 4,
    'rgba(32, 18, 8, 0.85)',
    '#fff7e0',
    teamColor,
    7.5,
  );
}

// ---------------------------------------------------------------------------
// 2. Card Division Duel Table Painter

export function paintCardScene(
  ctx: CanvasRenderingContext2D,
  replay: BranchReplay,
  state: CardSceneState,
  animPhase: number,
): void {
  ctx.save();
  ctx.imageSmoothingEnabled = false;

  // Warm Kairosoft wood stage floor
  for (let y = 16; y < CARD_CANVAS_H - 16; y += 10) {
    ctx.fillStyle = (y / 10) % 2 === 0 ? '#cfa068' : '#c29158';
    ctx.fillRect(0, y, CARD_CANVAS_W, 10);
    ctx.fillStyle = '#a87943';
    ctx.fillRect(0, y + 9, CARD_CANVAS_W, 1);
  }

  // Velvet tournament carpet under the duel table
  pxRect(ctx, 20, 46, CARD_CANVAS_W - 40, 82, '#8f2c24', '#3d1610');
  pxRect(ctx, 24, 50, CARD_CANVAS_W - 48, 74, '#a8382f', '#f0b942');

  const blueCol = replay.teams.BLUE.color;
  const redCol = replay.teams.RED.color;

  // Left (BLUE) and Right (RED) player pro chairs & seated pixel chibis
  const leftX = 44;
  const rightX = CARD_CANVAS_W - 44;
  const seatY = 98;

  // Pro gaming chairs behind players
  pxRect(ctx, leftX - 11, seatY - 22, 8, 22, shade(blueCol, 0.75), '#2a1a14');
  pxRect(ctx, rightX + 3, seatY - 22, 8, 22, shade(redCol, 0.75), '#2a1a14');

  // Blue Player Chibi
  const blueLook = lookFor(state.bluePlayer.id, blueCol);
  const blueFrame: ChibiFrame = state.done && state.winner === 'BLUE'
    ? 'cheer'
    : !state.done && state.activeSide === 'BLUE' && state.turnNumber > 0
      ? (Math.floor(animPhase * 5) % 2 === 0 ? 'walkA' : 'stand')
      : 'stand';
  const blueSprite = chibi(blueLook, blueFrame, false);
  const blueHitShake = !state.done && state.activeSide === 'RED' && state.damage > 0
    ? Math.round(Math.sin(animPhase * 28) * 2)
    : 0;
  ctx.drawImage(
    blueSprite,
    Math.round(leftX - blueSprite.width / 2 + blueHitShake),
    Math.round(seatY - blueSprite.height),
  );

  // Red Player Chibi
  const redLook = lookFor(state.redPlayer.id, redCol);
  const redFrame: ChibiFrame = state.done && state.winner === 'RED'
    ? 'cheer'
    : !state.done && state.activeSide === 'RED' && state.turnNumber > 0
      ? (Math.floor(animPhase * 5) % 2 === 0 ? 'walkA' : 'stand')
      : 'stand';
  const redSprite = chibi(redLook, redFrame, true);
  const redHitShake = !state.done && state.activeSide === 'BLUE' && state.damage > 0
    ? Math.round(Math.sin(animPhase * 28) * 2)
    : 0;
  ctx.drawImage(
    redSprite,
    Math.round(rightX - redSprite.width / 2 + redHitShake),
    Math.round(seatY - redSprite.height),
  );

  // Central Kairosoft Card Duel Table (x = 68..192, y = 58..116)
  pxRect(ctx, 66, 58, 128, 56, '#6e4124', '#2a1a14'); // Carved wood outer table
  pxRect(ctx, 72, 63, 116, 46, '#236e42', '#e8b448'); // Emerald felt surface with gold trim
  // Center duel line & emblem on felt
  ctx.fillStyle = 'rgba(255, 230, 140, 0.35)';
  ctx.fillRect(129, 65, 2, 42);
  pxRect(ctx, 123, 80, 14, 12, '#1c5734', '#d9a441');

  // Deck draw piles & fanned hand cards on left & right of table
  drawCardBack(ctx, 76, 68);
  drawCardBack(ctx, 77, 94);
  drawCardBack(ctx, 174, 68);
  drawCardBack(ctx, 173, 94);

  // Played cards & Turn effects on the center of the table
  if (state.turnNumber > 0) {
    const sub = state.subProgress ?? 1;
    const isBlueTurn = state.activeSide === 'BLUE';
    const cardCount = state.notes.includes('COMBO') ? 3 : state.damage >= 6 ? 2 : 1;
    const baseX = isBlueTurn ? 102 : 144;
    const handX = isBlueTurn ? leftX + 14 : rightX - 14;
    const handY = seatY - 12;
    const cardProg = Math.min(1, sub / 0.36);
    const cardEase = 1 - (1 - cardProg) * (1 - cardProg);

    for (let c = 0; c < cardCount; c++) {
      const targetX = baseX + (c - (cardCount - 1) / 2) * 14;
      const targetY = 76 + (c % 2) * 4;
      const cx = handX + (targetX - handX) * cardEase;
      const cy = handY + (targetY - handY) * cardEase;
      drawPlayedCard(ctx, cx, cy, isBlueTurn ? blueCol : redCol, state.notes.includes('COMBO'));
    }

    // Attack projectile / slash across the table when damage > 0
    if (state.damage > 0 && sub >= 0.16) {
      const fromX = isBlueTurn ? 112 : 148;
      const toX = isBlueTurn ? rightX - 6 : leftX + 6;
      const targetY = seatY - 12;
      const atkProg = sub >= 0.98 ? 1 : Math.min(1, (sub - 0.16) / 0.42);
      const curX = fromX + (toX - fromX) * atkProg;
      const curY = 86 + (targetY - 86) * atkProg;

      ctx.save();
      ctx.strokeStyle = state.notes.includes('LETHAL') ? '#ff2a2a' : '#ffe055';
      ctx.lineWidth = state.notes.includes('LETHAL') ? 3.5 : 2;
      ctx.beginPath();
      ctx.moveTo(fromX, 86);
      ctx.lineTo(curX, curY);
      ctx.stroke();

      if (atkProg < 1) {
        pxRect(ctx, curX - 3, curY - 3, 6, 6, '#fff8c4', '#ff5a36');
      }
      if (atkProg >= 0.8) {
        // Impact star on target player
        pxRect(ctx, toX - 5, targetY - 5, 10, 10, '#ff4238', '#ffe875');

        // Floating damage number badge rising over target player
        const floatLift = Math.round(Math.min(1, (sub - 0.45) / 0.5) * 6);
        drawPixelLabel(
          ctx,
          `-${state.damage}`,
          isBlueTurn ? rightX : leftX,
          seatY - 28 - floatLift,
          '#c9251e',
          '#fff9d2',
          '#ffe066',
          10,
        );
      }
      ctx.restore();
    }

    // Heal sparkles & floating +HP number when healed > 0
    if (state.healed > 0 && sub >= 0.2) {
      const hx = isBlueTurn ? leftX : rightX;
      const lift = Math.round(Math.min(1, (sub - 0.2) / 0.6) * 5);
      pxRect(ctx, hx - 12, seatY - 16 - lift, 4, 4, '#2ecc71', '#fff');
      pxRect(ctx, hx + 9, seatY - 20 - lift, 4, 4, '#2ecc71', '#fff');
      drawPixelLabel(
        ctx,
        `+${state.healed}`,
        hx,
        seatY - 28 - lift,
        '#1f7a3f',
        '#e8fff0',
        '#7ef5a5',
        9.5,
      );
    }

    // Distinct Special Effects for CardNote (MISPLAY / READ / STABILIZE / COMBO / COMBO_STOPPED / LETHAL)
    const actorX = isBlueTurn ? leftX : rightX;
    const defenderX = isBlueTurn ? rightX : leftX;

    if (state.notes.includes('COMBO')) {
      // Golden triangle lightning linking the 3 combo cards + center burst
      ctx.strokeStyle = '#ffe552';
      ctx.lineWidth = 2;
      ctx.strokeRect(94, 70, 72, 28);
      drawPixelLabel(ctx, '✨ 组合技爆发!!', 130, 62, '#d98218', '#fffbe0', '#ffe875', 9);
    }
    if (state.notes.includes('COMBO_STOPPED')) {
      drawPixelLabel(ctx, '🚫 组合技被拦!', 130, 62, '#8f2424', '#fff', '#ff948a', 9);
    }
    if (state.notes.includes('READ')) {
      // Cyan shield barrier in front of defender
      pxRect(ctx, defenderX + (isBlueTurn ? -16 : 12), seatY - 22, 4, 20, '#5ce1e6', '#18647a');
      drawPixelLabel(ctx, '👁️ 读牌识破!', defenderX, seatY - 42, '#18647a', '#e6ffff', '#5ce1e6', 8.5);
    }
    if (state.notes.includes('MISPLAY')) {
      // Sweat drop & misplay badge above actor
      pxRect(ctx, actorX + 8, seatY - 24, 3, 5, '#5ab0ee', '#1d4e7a');
      drawPixelLabel(ctx, '💦 出牌失误!', actorX, seatY - 42, '#5c347a', '#f7e8ff', '#d29eff', 8.5);
    }
    if (state.notes.includes('STABILIZE')) {
      drawPixelLabel(ctx, '🛡️ 稳住阵脚!', actorX, seatY - 42, '#1f6e3c', '#eafff0', '#68e394', 8.5);
    }
    if (state.notes.includes('LETHAL')) {
      drawPixelLabel(ctx, '⚔️ 致命斩杀!!', 130, 62, '#b81d18', '#fff5b8', '#ffd84d', 9.5);
    }
  }

  // Player Nameplates, Deck Tags & Pixel HP Bars (Top-Left for BLUE, Top-Right for RED)
  drawCardPlayerHud(ctx, 6, 19, state.bluePlayer, state.displayBlueLife ?? state.bluePlayer.life, blueCol, true);
  drawCardPlayerHud(ctx, CARD_CANVAS_W - 110, 19, state.redPlayer, state.displayRedLife ?? state.redPlayer.life, redCol, false);

  // Top Header Bar
  pxRect(ctx, 0, 0, CARD_CANVAS_W, 15, '#3b2412');
  ctx.fillStyle = '#d9a45b';
  ctx.fillRect(0, 15, CARD_CANVAS_W, 1);
  drawPixelLabel(
    ctx,
    `第 ${state.seatNumber} 台 · 第 ${state.gameNumber} 局`,
    56,
    7.5,
    '#241408',
    '#ffe9ba',
    undefined,
    8,
  );
  drawPixelLabel(
    ctx,
    `大比分 ${state.seriesScore.BLUE} : ${state.seriesScore.RED}`,
    152,
    7.5,
    '#1c1008',
    '#ffd84d',
    '#b58338',
    8.5,
  );
  drawPixelLabel(
    ctx,
    state.done ? '🏁 本局结束' : `回合 ${state.turnNumber}`,
    228,
    7.5,
    '#241408',
    '#fff',
    undefined,
    8,
  );

  // Bottom Turn / Winner Banner
  const bottomMsg = state.done
    ? `🏆 ${state.winner === 'BLUE' ? state.bluePlayer.name : state.redPlayer.name} 赢下本局${state.byTime ? '（回合上限血量胜）' : ''}`
    : state.bannerText ?? '牌局开始 · 双方选手抽起手牌';
  const bottomBg = state.done
    ? '#2d5e36'
    : state.bannerTone === 'lethal'
      ? '#8f1d18'
      : state.bannerTone === 'combo'
        ? '#9c5a14'
        : '#3b2412';
  pxRect(ctx, 0, CARD_CANVAS_H - 16, CARD_CANVAS_W, 16, bottomBg);
  ctx.fillStyle = '#d9a45b';
  ctx.fillRect(0, CARD_CANVAS_H - 16, CARD_CANVAS_W, 1);
  drawPixelLabel(
    ctx,
    bottomMsg,
    CARD_CANVAS_W / 2,
    CARD_CANVAS_H - 8,
    'rgba(24, 12, 4, 0.75)',
    '#fff8e2',
    undefined,
    8.5,
  );

  ctx.restore();
}

function drawCardBack(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  pxRect(ctx, x, y, 8, 11, '#d98a2b', '#2a1a14');
  pxRect(ctx, x + 2, y + 2, 4, 7, '#f5c86c');
}

function drawPlayedCard(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  color: string,
  golden: boolean,
): void {
  pxRect(ctx, x - 6, y - 8, 12, 16, '#fffdf5', golden ? '#ffd84d' : '#2a1a14');
  pxRect(ctx, x - 4, y - 6, 8, 6, color);
  pxRect(ctx, x - 4, y + 2, 8, 4, golden ? '#ffe066' : '#d8ceb8');
}

function drawCardPlayerHud(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  player: CardSceneState['bluePlayer'],
  displayLife: number,
  color: string,
  alignLeft: boolean,
): void {
  pxRect(ctx, x, y, 104, 24, 'rgba(38, 22, 10, 0.9)', '#b58338');
  ctx.fillStyle = '#fff8e6';
  ctx.font = 'bold 8.5px "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.textBaseline = 'top';
  ctx.textAlign = alignLeft ? 'left' : 'right';
  const textX = alignLeft ? x + 5 : x + 99;
  ctx.fillText(`${player.name.slice(0, 5)} · ${player.deckName}`, textX, y + 3);

  // Pixel HP bar with smooth chip drain
  const barX = x + 5;
  const barY = y + 14;
  const barW = 68;
  const barH = 6;
  pxRect(ctx, barX, barY, barW, barH, '#261409', '#6e4826');
  const maxL = Math.max(1, player.maxLife);
  const chipRatio = Math.max(0, Math.min(1, displayLife / maxL));
  const targetRatio = Math.max(0, Math.min(1, player.life / maxL));
  if (chipRatio > targetRatio) {
    ctx.fillStyle = '#ffe9a8';
    ctx.fillRect(barX, barY, Math.max(2, Math.round(barW * chipRatio)), barH);
  }
  const mainRatio = Math.min(chipRatio, targetRatio);
  if (mainRatio > 0) {
    ctx.fillStyle = color;
    ctx.fillRect(barX, barY, Math.max(2, Math.round(barW * mainRatio)), barH);
  }
  ctx.fillStyle = '#ffe580';
  ctx.font = 'bold 8.5px "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText(`♥${Math.round(displayLife)}`, x + 100, y + 12);
}
