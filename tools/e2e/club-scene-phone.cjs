// Browser check (phone): the club scene on the home page: activities, tap to open the player card,
// drawing time with a 4x slower CPU. Screenshots go to docs/reports/t19/. Run as full-season-desktop.cjs.
const { chromium } = require('playwright');
const SHOTS = '/home/user/esports-empire-kit/docs/reports/t19';
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
  await p.click('.nav button:has-text("主页")');
  await p.waitForTimeout(2500); // figures walk in
  await p.locator('.club-view').screenshot({ path: `${SHOTS}/01-preseason.png` });
  log.push(await p.textContent('.club-view ul'));
  // Play some weeks so people get tired, then switch to rest.
  for (let i = 0; i < 4; i++) {
    await p.click('.calendar-bar button:has-text("下一场")');
    await p.waitForSelector('.canvas-host canvas'); await p.click('button:has-text("跳过")'); await p.click('button:has-text("查看战报")'); await p.waitForSelector('text=关键原因');
  }
  await p.click('.nav button:has-text("主页")'); await p.waitForTimeout(3000);
  await p.locator('.club-view').screenshot({ path: `${SHOTS}/02-midseason.png` });
  log.push(await p.textContent('.club-view ul'));
  await p.click('.nav button:has-text("训练")'); await p.click('.tactic:has-text("休息")');
  await p.click('.nav button:has-text("主页")'); await p.waitForTimeout(4000);
  await p.locator('.club-view').screenshot({ path: `${SHOTS}/03-rest-day.png` });
  log.push(await p.textContent('.club-view ul'));
  await p.screenshot({ path: `${SHOTS}/04-home-phone.png` });
  // Tap a figure: find one through the scene's own hit test by scanning the canvas.
  const box = await p.locator('.club-canvas').boundingBox();
  let opened = false;
  for (let y = 0.3; y < 0.95 && !opened; y += 0.04) for (let x = 0.1; x < 0.95 && !opened; x += 0.03) {
    await p.mouse.click(box.x + box.width * x, box.y + box.height * y);
    if (await p.locator('.player-card').count()) opened = true;
  }
  log.push(`tap opened player card: ${opened}`);
  if (opened) { await p.screenshot({ path: `${SHOTS}/05-tap-card.png` }); await p.click('.player-card button:has-text("关闭")'); }
  await p.waitForTimeout(2000);
  log.push(`frame ms: ${await p.getAttribute('.club-canvas', 'data-frame-ms')}`);
  const cdp = await ctx.newCDPSession(p);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await p.click('.nav button:has-text("训练")'); await p.click('.tactic:has-text("操作")'); await p.click('.nav button:has-text("主页")');
  await p.waitForTimeout(5000);
  log.push(`frame ms at 4x slower CPU: ${await p.getAttribute('.club-canvas', 'data-frame-ms')}`);
  const fps = await p.evaluate(() => new Promise((res) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 2000) requestAnimationFrame(f); else res(n / 2); }; requestAnimationFrame(f); }));
  log.push(`page frames/s at 4x slower CPU: ${fps}`);
  const o = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, w: window.innerWidth }));
  if (o.sw > o.w + 1) errs.push(`overflow ${o.sw} > ${o.w}`);
  console.log(JSON.stringify({ log, errs }, null, 1));
  await b.close();
})();
