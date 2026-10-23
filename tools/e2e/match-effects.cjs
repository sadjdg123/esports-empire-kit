// Browser check (V4): match effects and camera. Watches a match until a teamfight, checks the
// camera closes in (the painted ground scales with it), takes screenshots, switches to the whole
// map, and measures the frame rate on a phone with a 4x slower CPU. Screenshots go to docs/reports/v4/.
// Run as full-season-desktop.cjs.
const { chromium } = require('playwright');
const helpers = require('./helpers.cjs');
const SHOTS = 'docs/reports/v4';

async function newMatch(p) {
  await p.goto('http://localhost:4173/');
  await p.evaluate(() => localStorage.setItem('esports-empire.tutorial.v1', '1'));
  await p.fill('input', '书店电竞'); await p.click('text=成立俱乐部'); await p.waitForSelector('text=自由市场');
  for (const role of ['上单', '打野', '中单', '射手', '辅助']) {
    await p.click(`.filters >> text=${role}`);
    await p.locator('table tbody tr').filter({ has: p.locator(`td:nth-child(2) >> text=/^${role}/`) }).nth(2).locator('button:has-text("签约")').click();
  }
  await p.click('text=去设置阵容'); await p.click('text=一键推荐'); await p.click('text=保存阵容');
  await helpers.closeWindows(p);
  await p.click('.hud button:has-text("下一场")');
  await p.waitForSelector('.win button:has-text("开始比赛")');
  await p.click('.win button:has-text("开始比赛")');
  await p.waitForSelector('.canvas-host canvas');
}

/** How far the camera is zoomed in, from the painted ground's size against the canvas. */
const zoom = (p) => p.evaluate(() => {
  const c = document.querySelector('.canvas-host canvas');
  return Number.parseFloat(c.style.backgroundSize || '0') / (c.clientWidth || 1);
});
const fps = async (p) => Number((await p.textContent('.controls .dim'))?.match(/(\d+)/)?.[1] ?? 0);

(async () => {
  const b = await chromium.launch();
  const errs = []; const log = [];
  const watch = (p) => { p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); }); };

  const desk = await (await b.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 })).newPage();
  watch(desk);
  await newMatch(desk);
  await desk.waitForTimeout(3000);
  await desk.locator('.canvas-host').screenshot({ path: `${SHOTS}/01-early.png` });
  await desk.click('.controls button:has-text("2×")');
  // Wait for the first teamfight: the camera closes in.
  let z = 1;
  for (let i = 0; i < 400 && z < 1.3; i++) { await desk.waitForTimeout(250); z = await zoom(desk); }
  log.push(`camera zoom in the first teamfight: ${z.toFixed(2)}`);
  if (z < 1.3) errs.push('camera never closed in on a teamfight');
  await desk.click('.controls button:has-text("1×")');
  for (let i = 0; i < 4; i++) {
    await desk.waitForTimeout(700);
    await desk.locator('.canvas-host').screenshot({ path: `${SHOTS}/0${i + 2}-teamfight-${i + 1}.png` });
  }
  // Whole map: the camera goes back out and stays out.
  await desk.click('.controls button:has-text("跟随团战")');
  await desk.waitForTimeout(2500);
  const out = await zoom(desk);
  log.push(`zoom after switching to the whole map: ${out.toFixed(2)}`);
  if (Math.abs(out - 1) > 0.02) errs.push(`whole-map view still zoomed: ${out}`);
  await desk.locator('.canvas-host').screenshot({ path: `${SHOTS}/06-whole-map.png` });
  await desk.click('.controls button:has-text("4×")');
  await desk.waitForTimeout(6000);
  log.push(`desktop fps at 4x: ${await fps(desk)}`);
  await desk.click('button:has-text("跳过")');
  await desk.click('button:has-text("查看战报")');
  await desk.waitForSelector('text=关键原因');
  log.push(`report after watching: ${await desk.textContent('.report h2')}`);

  // Phone with a 4x slower CPU.
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const phone = await ctx.newPage();
  watch(phone);
  await newMatch(phone);
  const cdp = await ctx.newCDPSession(phone);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await phone.click('.controls button:has-text("4×")');
  await phone.waitForTimeout(10000);
  const slow = await fps(phone);
  log.push(`phone fps at 4x speed with a 4x slower CPU: ${slow}`);
  // V3 gave 23-26 on the same check.
  if (slow < 18) errs.push(`phone frame rate too low: ${slow}`);
  await phone.screenshot({ path: `${SHOTS}/07-phone.png` });

  console.log(JSON.stringify({ log, errs }, null, 1));
  await b.close();
  if (errs.length) process.exit(1);
})();
