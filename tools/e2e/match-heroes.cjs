// Browser check: the match view with pixel heroes (V2) and the pixel map (V3). Watches part of a match at 1x and 4x,
// takes screenshots, reads the frame rate (also with a 4x slower CPU on a phone) and checks that
// watching still ends with a report. Screenshots go to docs/reports/v2/. Run as full-season-desktop.cjs.
const { chromium } = require('playwright');
const helpers = require('./helpers.cjs');
const SHOTS = process.env.SHOTS ?? 'docs/reports/v2'; // SHOTS=docs/reports/v3 for later tasks

async function newClub(p, shots = false) {
  await p.goto('http://localhost:4173/');
  await p.evaluate(() => localStorage.setItem('esports-empire.tutorial.v1', '1'));
  await p.fill('input', '书店电竞'); await p.click('text=成立俱乐部'); await p.waitForSelector('text=自由市场');
  for (const role of ['上单', '打野', '中单', '射手', '辅助']) {
    await p.click(`.filters >> text=${role}`);
    await p.locator('table tbody tr').filter({ has: p.locator(`td:nth-child(2) >> text=/^${role}/`) }).nth(2).locator('button:has-text("签约")').click();
  }
  await p.click('text=去设置阵容'); await p.click('text=一键推荐'); await p.click('text=保存阵容');
  if (shots) {
    // Each pick shows the hero's sprite; a player's card shows the player's own portrait.
    await helpers.nav(p, '阵容');
    if ((await p.locator('.win .hero-sprite').count()) !== 5) throw new Error('lineup should show 5 hero sprites');
    await p.locator('.win').screenshot({ path: `${SHOTS}/00-lineup.png` });
    await helpers.nav(p, '合同转会');
    await p.locator('.win button.link.name').first().click();
    await p.waitForSelector('.player-card .portrait');
    await p.locator('.player-card').screenshot({ path: `${SHOTS}/00-player-card.png` });
    await p.click('.player-card button:has-text("关闭")');
  }
  await helpers.closeWindows(p);
  await p.click('.hud button:has-text("下一场")');
  await p.waitForSelector('.win button:has-text("开始比赛")');
  await p.click('.win button:has-text("开始比赛")');
  await p.waitForSelector('.canvas-host canvas');
}

const fps = async (p) => Number((await p.textContent('.controls .dim'))?.match(/(\d+)/)?.[1] ?? 0);

(async () => {
  const b = await chromium.launch();
  const errs = []; const log = [];
  const watch = (p) => { p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); }); };

  // Desktop: screenshots while the match runs.
  const desk = await (await b.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 })).newPage();
  watch(desk);
  await newClub(desk, true);
  await desk.waitForTimeout(4000);
  // V3: the painted ground is the canvas background (not redrawn every frame).
  if (!(await desk.evaluate(() => document.querySelector('.canvas-host canvas').style.backgroundImage)).startsWith('url("data:image/png')) errs.push('map ground missing');
  await desk.locator('.canvas-host').screenshot({ path: `${SHOTS}/01-lanes.png` });
  await desk.click('.controls button:has-text("4×")');
  for (let i = 0; i < 5; i++) {
    await desk.waitForTimeout(5000);
    await desk.locator('.canvas-host').screenshot({ path: `${SHOTS}/0${i + 2}-match-${i + 1}.png` });
  }
  log.push(`desktop fps at 4x: ${await fps(desk)}`);
  await desk.click('button:has-text("跳过")');
  await desk.click('button:has-text("查看战报")');
  await desk.waitForSelector('text=关键原因');
  log.push(`report after watching: ${await desk.textContent('.report h2')}`);

  // Phone with a 4x slower CPU: the frame rate must hold up with ten sprites.
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const phone = await ctx.newPage();
  watch(phone);
  await newClub(phone);
  const cdp = await ctx.newCDPSession(phone);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await phone.click('.controls button:has-text("4×")');
  await phone.waitForTimeout(8000);
  const slow = await fps(phone);
  log.push(`phone fps at 4x speed with a 4x slower CPU: ${slow}`);
  // Before V2 the same check gave about 22 (desktop 45): the sprites must not make it worse.
  if (slow < 18) errs.push(`phone frame rate too low: ${slow}`);
  await phone.screenshot({ path: `${SHOTS}/07-phone.png` });

  console.log(JSON.stringify({ log, errs }, null, 1));
  await b.close();
  if (errs.length) process.exit(1);
})();
