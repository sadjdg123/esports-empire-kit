// Browser check (phone): the club base as the main screen. Players walk in, taps on furniture open
// the right windows, tapping a player opens the card, drawing stays cheap with a 4x slower CPU.
// Screenshots go to docs/reports/v1/. Run as full-season-desktop.cjs.
const { chromium } = require('playwright');
const helpers = require('./helpers.cjs');
const SHOTS = 'docs/reports/v1';
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const p = await ctx.newPage();
  const errs = []; const log = [];
  p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto('http://localhost:4173/');
  await p.fill('input', '书店电竞'); await p.click('text=成立俱乐部'); await p.waitForSelector('text=自由市场');
  for (const role of ['上单', '打野', '中单', '射手', '辅助', '上单']) {
    await p.click(`.filters >> text=${role}`);
    await p.locator('table tbody tr').filter({ has: p.locator(`td:nth-child(2) >> text=/^${role}/`) }).nth(2).locator('button:has-text("签约")').click();
  }
  await p.click('text=去设置阵容'); await p.click('text=一键推荐'); await p.click('text=保存阵容');
  await helpers.closeWindows(p);
  if (await p.locator('.event-dialog button:has-text("知道了")').count()) await p.click('.event-dialog button:has-text("知道了")');
  await p.waitForTimeout(6000); // everyone walks in
  await p.screenshot({ path: `${SHOTS}/10-base-training.png` });
  // Tap every part of the base on a grid and record which windows open.
  const box = await p.locator('.base-canvas').boundingBox();
  const opened = new Set();
  let card = false;
  for (let y = 0.12; y < 0.98; y += 0.035) {
    for (let x = 0.04; x < 0.98; x += 0.04) {
      await p.mouse.click(box.x + box.width * x, box.y + box.height * y);
      if (await p.locator('.player-card').count()) { card = true; await p.click('.player-card button:has-text("关闭")'); }
      if (await p.locator('.win').count()) { opened.add(await p.textContent('.win-title span')); await p.click('.win-close'); }
    }
  }
  log.push(`windows opened by tapping the base: ${[...opened].join('、')}`);
  log.push(`player card from a tap: ${card}`);
  for (const want of ['阵容', '训练', '收件箱', '签人', '合同转会', '赛程', '财务', '历史', '战报', '设施']) if (!opened.has(want)) errs.push(`no tap target opens ${want}`);

  // Touch drag & two-finger pinch-zoom check: must track 1:1 with fingers and NEVER expose viewport background.
  const gestureCheck = await p.evaluate(async () => {
    const vp = document.querySelector('.base-viewport');
    const canvas = document.querySelector('.base-canvas');
    const issues = [];
    const checkCoversViewport = (tag) => {
      const vr = vp.getBoundingClientRect();
      const cr = canvas.getBoundingClientRect();
      // Account for 3px border on .base-viewport
      const innerL = vr.left + 3;
      const innerR = vr.right - 3;
      const innerT = vr.top + 3;
      const innerB = vr.bottom - 3;
      if (cr.left > innerL + 1 || cr.right < innerR - 1 || cr.top > innerT + 1 || cr.bottom < innerB - 1) {
        issues.push(`${tag} exposed background: canvas(${cr.left.toFixed(1)},${cr.top.toFixed(1)}..${cr.right.toFixed(1)},${cr.bottom.toFixed(1)}) vs vp(${innerL.toFixed(1)},${innerT.toFixed(1)}..${innerR.toFixed(1)},${innerB.toFixed(1)})`);
      }
    };
    const mkTouch = (id, x, y) => new Touch({ identifier: id, target: vp, clientX: x, clientY: y, pageX: x, pageY: y });
    const fireTouch = (type, touches, changed = touches) => {
      vp.dispatchEvent(new TouchEvent(type, { bubbles: true, cancelable: true, touches, targetTouches: touches, changedTouches: changed }));
    };

    const vr = vp.getBoundingClientRect();
    const cx = vr.left + vr.width / 2;
    const cy = vr.top + vr.height / 2;
    checkCoversViewport('initial');

    // 1) Two-finger pinch-zoom in (distance 80 -> 144, 1.8x)
    const t0a = mkTouch(1, cx - 40, cy);
    const t1a = mkTouch(2, cx + 40, cy);
    fireTouch('touchstart', [t0a, t1a]);
    const t0b = mkTouch(1, cx - 72, cy);
    const t1b = mkTouch(2, cx + 72, cy);
    fireTouch('touchmove', [t0b, t1b]);
    fireTouch('touchend', [], [t0b, t1b]);
    checkCoversViewport('after-pinch-in');

    // 2) 1:1 single-finger drag check (move +18px right, +12px down)
    const beforeDrag = canvas.getBoundingClientRect();
    const d0 = mkTouch(1, cx, cy);
    fireTouch('touchstart', [d0]);
    const d1 = mkTouch(1, cx + 18, cy + 12);
    fireTouch('touchmove', [d1]);
    fireTouch('touchend', [], [d1]);
    const afterDrag = canvas.getBoundingClientRect();
    const actualDx = afterDrag.left - beforeDrag.left;
    const actualDy = afterDrag.top - beforeDrag.top;
    if (Math.abs(actualDx - 18) > 1.5 || Math.abs(actualDy - 12) > 1.5) {
      issues.push(`drag not 1:1: expected (+18,+12), got (${actualDx.toFixed(1)},${actualDy.toFixed(1)})`);
    }
    checkCoversViewport('after-1to1-drag');

    // 3) Extreme drag in all 4 directions (+300, -300) must clamp cleanly without exposing background
    for (const [dx, dy, label] of [[300, 200, 'drag-BR'], [-600, -400, 'drag-TL'], [600, -400, 'drag-TR'], [-600, 400, 'drag-BL']]) {
      const s0 = mkTouch(1, cx, cy);
      fireTouch('touchstart', [s0]);
      const s1 = mkTouch(1, cx + dx, cy + dy);
      fireTouch('touchmove', [s1]);
      fireTouch('touchend', [], [s1]);
      checkCoversViewport(label);
    }

    // 4) Pinch-zoom all the way out (distance 160 -> 40) and drag
    const p0a = mkTouch(1, cx - 80, cy);
    const p1a = mkTouch(2, cx + 80, cy);
    fireTouch('touchstart', [p0a, p1a]);
    const p0b = mkTouch(1, cx - 20, cy);
    const p1b = mkTouch(2, cx + 20, cy);
    fireTouch('touchmove', [p0b, p1b]);
    fireTouch('touchend', [], [p0b, p1b]);
    checkCoversViewport('after-pinch-out');

    return issues;
  });
  if (gestureCheck.length) errs.push(...gestureCheck);
  log.push(`touch drag & pinch-zoom bounds check: ${gestureCheck.length === 0 ? 'ok' : gestureCheck.join('; ')}`);
  await p.click('.cam-pill:has-text("全景")');
  await p.waitForTimeout(250);

  // Rest day: everyone goes upstairs by lift.
  await helpers.nav(p, '训练'); await p.click('.tactic:has-text("休息")'); await helpers.closeWindows(p);
  await p.waitForTimeout(9000);
  await p.screenshot({ path: `${SHOTS}/11-base-rest.png` });
  log.push(`frame ms: ${await p.getAttribute('.base-canvas', 'data-frame-ms')}`);
  const cdp = await ctx.newCDPSession(p);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await helpers.nav(p, '训练'); await p.click('.tactic:has-text("操作")'); await helpers.closeWindows(p);
  await p.waitForTimeout(5000);
  log.push(`frame ms at 4x slower CPU: ${await p.getAttribute('.base-canvas', 'data-frame-ms')}`);
  const fps = await p.evaluate(() => new Promise((res) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 2000) requestAnimationFrame(f); else res(n / 2); }; requestAnimationFrame(f); }));
  log.push(`page frames/s at 4x slower CPU: ${fps}`);
  const o = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, w: window.innerWidth }));
  if (o.sw > o.w + 1) errs.push(`overflow ${o.sw} > ${o.w}`);
  console.log(JSON.stringify({ log, errs }, null, 1));
  await b.close();
  process.exitCode = errs.length ? 1 : 0;
})();
