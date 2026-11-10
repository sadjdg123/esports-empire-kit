// Browser check (phone 390x844, V8): open Shooter and Card divisions, play several rounds,
// open Shooter and Card replays, verify pixel canvases render, click "重放" and "直接看结果",
// verify displayed scores and life bars match replay data 100%, and capture 4 mobile screenshots.
const fs = require('fs');
const { chromium } = require('playwright');
const helpers = require('./helpers.cjs');

const SHOTS = 'docs/reports/v8';
fs.mkdirSync(SHOTS, { recursive: true });

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const p = await ctx.newPage();
  const errs = [];
  const log = [];
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('console', (m) => {
    if (m.type() === 'error') errs.push(m.text());
  });
  const confirm = async () => {
    await p.click('.modal-back button.primary');
  };

  await p.goto('http://localhost:4173/');
  await p.fill('input', '书店电竞');
  await p.click('text=成立俱乐部');
  await p.waitForSelector('text=自由市场');
  await p.evaluate(() => {
    try {
      localStorage.setItem('esports-empire.tutorial.v1', '1');
    } catch {
      /* private mode */
    }
  });

  // Sign starting 5 MOBA players
  for (const role of ['上单', '打野', '中单', '射手', '辅助']) {
    await p.click(`.filters >> text=${role}`);
    await p
      .locator('table tbody tr')
      .filter({ has: p.locator(`td:nth-child(2) >> text=/^${role}/`) })
      .nth(2)
      .locator('button:has-text("签约")')
      .click();
  }
  await p.click('text=去设置阵容');
  await p.click('text=一键推荐');
  await p.click('text=保存阵容');
  await helpers.closeWindows(p);
  if (await p.locator('.event-dialog button:has-text("知道了")').count()) {
    await p.click('.event-dialog button:has-text("知道了")');
  }

  // Grant enough pre-season reputation and funds to open both FPS and CARD divisions in Season 1
  await p.evaluate(() => {
    const key = Object.keys(localStorage).find(
      (k) =>
        k.startsWith('esports') &&
        !k.includes('tutorial') &&
        !k.endsWith('.bak') &&
        !k.endsWith('.tmp'),
    );
    const save = JSON.parse(localStorage.getItem(key));
    save.game.funds = 500000;
    save.game.club.reputation = 65;
    localStorage.setItem(key, JSON.stringify(save));
  });
  await p.reload();
  await p.waitForSelector('.hud');
  if (await p.locator('.event-dialog button:has-text("知道了")').count()) {
    await p.click('.event-dialog button:has-text("知道了")');
  }

  // Open Group window and found Shooter division (射击分部)
  await helpers.nav(p, '集团');
  await p.locator('section.card:has-text("射击分部") button:has-text("开办")').click();
  await confirm();
  await p.waitForSelector('.tabs button:has-text("选手")');

  // Sign 1 player of each FPS role and save lineup
  await p.click('.tabs button:has-text("选手")');
  for (const roleName of ['突破', '狙击', '指挥', '支援', '自由人']) {
    await p.click(`.filters button:has-text("${roleName}")`);
    await p.locator('.staff-list button:has-text("签约")').first().click();
  }
  await p.click('.tabs button:has-text("阵容")');
  await p.click('button:has-text("一键推荐")');
  const saveFpsBtn = p.locator('button:has-text("保存阵容")');
  if ((await saveFpsBtn.count()) && !(await saveFpsBtn.isDisabled())) {
    await saveFpsBtn.click();
  }

  // Return to Group and found Card division (卡牌分部)
  await p.click('.tabs button:has-text("‹ 集团")');
  await p.locator('section.card:has-text("卡牌分部") button:has-text("开办")').click();
  await confirm();
  await p.waitForSelector('.tabs button:has-text("选手")');

  // Sign 3 card players and save lineup
  await p.click('.tabs button:has-text("选手")');
  for (let i = 0; i < 3; i++) {
    await p.locator('.staff-list button:has-text("签约")').first().click();
  }
  await p.click('.tabs button:has-text("阵容")');
  await p.click('button:has-text("一键推荐")');
  const saveCardBtn = p.locator('button:has-text("保存阵容")');
  if ((await saveCardBtn.count()) && !(await saveCardBtn.isDisabled())) {
    await saveCardBtn.click();
  }

  // Play 3 match weeks so both FPS and CARD divisions complete several league matches
  for (let round = 0; round < 3; round++) {
    await helpers.closeWindows(p);
    await p.click('.hud button:has-text("下一场")');
    await helpers.quickMatch(p);
  }

  // Read saved branch replay data from localStorage for exact comparison
  const savedReplays = await p.evaluate(() => {
    const key = Object.keys(localStorage).find(
      (k) =>
        k.startsWith('esports') &&
        !k.includes('tutorial') &&
        !k.endsWith('.bak') &&
        !k.endsWith('.tmp'),
    );
    const g = JSON.parse(localStorage.getItem(key)).game;
    const fpsR = g.branches.FPS.replay;
    const cardR = g.branches.CARD.replay;
    const lastFpsRound = fpsR.fps.rounds[fpsR.fps.rounds.length - 1];
    const allCardGames = cardR.card.series.flatMap((s) => s.games.map((gm, i) => ({ s, gm, i })));
    const lastCard = allCardGames[allCardGames.length - 1];
    const lastTurn = lastCard.gm.turns[lastCard.gm.turns.length - 1];
    return {
      fpsFinalScore: `${lastFpsRound.score.BLUE} : ${lastFpsRound.score.RED}`,
      fpsRoundCount: fpsR.fps.rounds.length,
      cardFinalScore: `${cardR.card.score.BLUE} : ${cardR.card.score.RED}`,
      cardFinalLife: `${lastTurn.life.BLUE}:${lastTurn.life.RED}`,
      cardGameCount: allCardGames.length,
    };
  });
  log.push(`saved replays: ${JSON.stringify(savedReplays)}`);

  // 1. Open Shooter (FPS) Replay on Phone (390x844)
  await helpers.nav(p, '集团');
  await p.click('button:has-text("进入射击分部")');
  await p.click('.tabs button:has-text("比赛")');
  await p.waitForSelector('.fps-replay-canvas');
  await p.waitForTimeout(300);

  const fpsCanvas = p.locator('.fps-replay-canvas');
  const fpsBox = await fpsCanvas.boundingBox();
  if (!fpsBox || fpsBox.width < 250 || fpsBox.height < 140) {
    errs.push(`fps canvas bounding box invalid: ${JSON.stringify(fpsBox)}`);
  }

  // Verify completed state score matches replay data
  const uiFpsScoreDone = (await p.textContent('.replay-score b')).trim();
  if (uiFpsScoreDone !== savedReplays.fpsFinalScore) {
    errs.push(`FPS done score mismatch: UI "${uiFpsScoreDone}" vs data "${savedReplays.fpsFinalScore}"`);
  }
  log.push(`FPS replay finished score verified: ${uiFpsScoreDone}`);
  await p.evaluate(() => { const wb = document.querySelector('.win-body'); if (wb) wb.scrollTop = 0; });
  await p.screenshot({ path: `${SHOTS}/02-fps-replay-done.png` });

  // Click "▶ 重放这一回合" and capture playing state
  const playFpsBtn = p.locator('button:has-text("▶ 重放这一回合")');
  await playFpsBtn.scrollIntoViewIfNeeded();
  await playFpsBtn.click();
  await p.waitForTimeout(850); // step = 1 in progress

  const fpsDoneDuringPlay = await fpsCanvas.getAttribute('data-done');
  const skipFpsBtn = p.locator('button:has-text("⏭ 直接看结果")');
  if (!(await skipFpsBtn.count())) {
    errs.push('FPS replay did not show "⏭ 直接看结果" button while playing');
  }
  await p.evaluate(() => { const wb = document.querySelector('.win-body'); if (wb) wb.scrollTop = 0; });
  await p.screenshot({ path: `${SHOTS}/01-fps-replay-playing.png` });
  log.push(`FPS replay playing state captured (data-done=${fpsDoneDuringPlay}, step=${await fpsCanvas.getAttribute('data-step')})`);

  // Click "⏭ 直接看结果" and verify it jumps to done and restores final score
  if (await skipFpsBtn.count()) {
    await skipFpsBtn.scrollIntoViewIfNeeded();
    await skipFpsBtn.click();
  }
  const fpsDoneAfterSkip = await fpsCanvas.getAttribute('data-done');
  const uiFpsScoreAfterSkip = (await p.textContent('.replay-score b')).trim();
  if (fpsDoneAfterSkip !== '1' || uiFpsScoreAfterSkip !== savedReplays.fpsFinalScore) {
    errs.push(`FPS skip failed: done=${fpsDoneAfterSkip}, score="${uiFpsScoreAfterSkip}"`);
  }

  const overflowFps = await p.evaluate(() => ({
    sw: document.documentElement.scrollWidth,
    w: window.innerWidth,
  }));
  if (overflowFps.sw > overflowFps.w + 1) {
    errs.push(`FPS replay horizontal overflow: ${overflowFps.sw} > ${overflowFps.w}`);
  }

  // 2. Open Card (卡牌分部) Replay on Phone (390x844)
  await p.evaluate(() => { const wb = document.querySelector('.win-body'); if (wb) wb.scrollTop = 0; });
  await p.click('.tabs button:has-text("‹ 集团")');
  await p.click('button:has-text("进入卡牌分部")');
  await p.click('.tabs button:has-text("比赛")');
  await p.waitForSelector('.card-replay-canvas');

  const cardCanvas = p.locator('.card-replay-canvas');
  const cardBox = await cardCanvas.boundingBox();
  if (!cardBox || cardBox.width < 250 || cardBox.height < 140) {
    errs.push(`card canvas bounding box invalid: ${JSON.stringify(cardBox)}`);
  }

  // Verify completed state score & life match replay data
  const uiCardScoreDone = (await p.textContent('.replay-score b')).trim();
  const canvasCardLifeDone = await cardCanvas.getAttribute('data-life');
  if (uiCardScoreDone !== savedReplays.cardFinalScore) {
    errs.push(`Card done score mismatch: UI "${uiCardScoreDone}" vs data "${savedReplays.cardFinalScore}"`);
  }
  if (canvasCardLifeDone !== savedReplays.cardFinalLife) {
    errs.push(`Card done life mismatch: UI "${canvasCardLifeDone}" vs data "${savedReplays.cardFinalLife}"`);
  }
  log.push(`Card replay finished score (${uiCardScoreDone}) and life (${canvasCardLifeDone}) verified`);
  await p.evaluate(() => { const wb = document.querySelector('.win-body'); if (wb) wb.scrollTop = 0; });
  await p.screenshot({ path: `${SHOTS}/04-card-replay-done.png` });

  // Click "▶ 重放这一局" and capture playing state
  const playCardBtn = p.locator('button:has-text("▶ 重放这一局")');
  await playCardBtn.scrollIntoViewIfNeeded();
  await playCardBtn.click();
  await p.waitForTimeout(800); // turn 1 in progress

  const cardDoneDuringPlay = await cardCanvas.getAttribute('data-done');
  const skipCardBtn = p.locator('button:has-text("⏭ 直接看结果")');
  if (!(await skipCardBtn.count())) {
    errs.push('Card replay did not show "⏭ 直接看结果" button while playing');
  }
  await p.evaluate(() => { const wb = document.querySelector('.win-body'); if (wb) wb.scrollTop = 0; });
  await p.screenshot({ path: `${SHOTS}/03-card-replay-playing.png` });
  log.push(`Card replay playing state captured (data-done=${cardDoneDuringPlay}, step=${await cardCanvas.getAttribute('data-step')})`);

  // Click "⏭ 直接看结果" and verify it jumps to done and restores final score & life
  if (await skipCardBtn.count()) {
    await skipCardBtn.scrollIntoViewIfNeeded();
    await skipCardBtn.click();
  }
  const cardDoneAfterSkip = await cardCanvas.getAttribute('data-done');
  const uiCardScoreAfterSkip = (await p.textContent('.replay-score b')).trim();
  const cardLifeAfterSkip = await cardCanvas.getAttribute('data-life');
  if (
    cardDoneAfterSkip !== '1' ||
    uiCardScoreAfterSkip !== savedReplays.cardFinalScore ||
    cardLifeAfterSkip !== savedReplays.cardFinalLife
  ) {
    errs.push(
      `Card skip failed: done=${cardDoneAfterSkip}, score="${uiCardScoreAfterSkip}", life="${cardLifeAfterSkip}"`,
    );
  }

  const overflowCard = await p.evaluate(() => ({
    sw: document.documentElement.scrollWidth,
    w: window.innerWidth,
  }));
  if (overflowCard.sw > overflowCard.w + 1) {
    errs.push(`Card replay horizontal overflow: ${overflowCard.sw} > ${overflowCard.w}`);
  }

  console.log(JSON.stringify({ log, errs }, null, 2));
  await b.close();
  process.exitCode = errs.length ? 1 : 0;
})();
