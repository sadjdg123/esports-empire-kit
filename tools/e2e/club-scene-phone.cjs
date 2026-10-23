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
  for (const want of ['阵容', '训练', '收件箱', '签人', '合同转会', '赛程', '财务', '历史', '战报']) if (!opened.has(want)) errs.push(`no tap target opens ${want}`);
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
