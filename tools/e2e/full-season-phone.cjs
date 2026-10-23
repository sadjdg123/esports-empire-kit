// Browser check (phone 390x844): signing with contract years, sponsor, training, a transfer, the
// calendar clock, renewals, playoffs, season 2; fails on page errors or sideways scrolling.
// Screenshots go to docs/reports/t18/. Run as full-season-desktop.cjs.
const { chromium } = require('playwright');
const SHOTS = '/home/user/esports-empire-kit/docs/reports/t18';
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const p = await ctx.newPage();
  const errs = []; const log = [];
  p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  const toast = async () => { try { return await p.textContent('.toast', { timeout: 1500 }); } catch { return ''; } };
  const confirm = async () => { await p.click('.modal-back button.primary'); };
  const nav = async (label) => { await p.click(`.nav button:has-text("${label}")`); await p.waitForTimeout(150); };
  const overflow = async (name) => {
    const o = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, w: window.innerWidth }));
    if (o.sw > o.w + 1) errs.push(`horizontal overflow on ${name}: ${o.sw} > ${o.w}`);
  };
  const shot = async (name) => { await overflow(name); await p.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false }); };

  await p.goto('http://localhost:4173/');
  await p.fill('input', '书店电竞'); await p.click('text=成立俱乐部'); await p.waitForSelector('text=自由市场');
  await p.selectOption('select[aria-label="合同年限"]', '1');
  for (const role of ['上单', '打野', '中单', '射手', '辅助']) {
    await p.click(`.filters >> text=${role}`);
    await p.locator('table tbody tr').filter({ has: p.locator(`td:nth-child(2) >> text=/^${role}/`) }).nth(3).locator('button:has-text("签约")').click();
    log.push(await toast());
  }
  await shot('01-market');
  await p.click('text=去设置阵容'); await p.click('text=一键推荐'); await p.click('text=保存阵容');
  await nav('训练'); await p.click('.tactic:has-text("意识")'); await shot('02-training');
  await nav('财务'); await p.locator('.sponsors li button:has-text("签约")').first().click(); await confirm(); log.push(await toast()); await shot('03-finance');
  // Buy a cheap player from an AI club during the pre-season window.
  await nav('合同转会');
  const rows = p.locator('table').nth(1).locator('tbody tr');
  const n = await rows.count();
  let bought = false;
  for (let i = n - 1; i >= n - 6 && !bought; i--) {
    const row = rows.nth(i);
    const input = row.locator('input[aria-label="报价"]');
    const v = Number(await input.inputValue());
    await input.fill(String(Math.round(v * 1.4 / 500) * 500));
    await row.locator('button:has-text("报价")').click(); await confirm();
    const t = await toast(); log.push(t); bought = t.includes('成交');
  }
  log.push(`bought: ${bought}`);
  await shot('04-contracts');
  // Player card
  await p.locator('button.link.name').first().click(); await p.waitForSelector('.player-card'); await shot('05-player-card'); await p.click('.player-card button:has-text("关闭")');
  // Let the clock run at 4x until it stops by itself on match day.
  await p.click('.calendar-bar button:has-text("4×")');
  for (let i = 0; i < 6; i++) {
    if (await p.locator('canvas').count()) break;
    if (await p.locator('.calendar-bar button:has-text("开始")').count()) await p.click('.calendar-bar button:has-text("开始")');
    try { await p.waitForSelector('canvas', { timeout: 15000 }); } catch { log.push(`clock stopped: ${await toast()}`); }
  }
  log.push(`clock reached match: ${await p.locator('canvas').count() > 0}`);
  await p.waitForTimeout(1500); await shot('06-match');
  await p.click('button:has-text("跳过")'); await p.click('button:has-text("查看战报")'); await p.waitForSelector('text=关键原因'); await shot('07-report');
  log.push(await p.textContent('.report h2'));
  // Renewals: accept two, counter one, the rest accept.
  await nav('合同转会');
  for (let k = 0; k < 8; k++) {
    const r = p.locator('.renewal').first();
    if (!(await r.count())) break;
    if (k === 1) { await r.locator('input').fill('100'); await r.locator('button:has-text("还价")').click(); log.push(`counter: ${await toast()}`); continue; }
    await r.locator('button:has-text("接受开价")').click(); log.push(await toast());
  }
  await shot('08-renewed');
  await nav('收件箱'); await shot('09-inbox');
  log.push(`inbox items: ${await p.locator('.messages li').count()}`);
  // Play on with the skip button to the end of the season.
  for (let i = 0; i < 30; i++) {
    await nav('主页');
    if (await p.locator('button:has-text("进入第 2 赛季")').count()) break;
    await p.click('.calendar-bar button:has-text("下一场")');
    if (!(await p.locator('canvas').count())) { try { await p.waitForSelector('canvas', { timeout: 2000 }); } catch { continue; } }
    await p.click('button:has-text("跳过")'); await p.click('button:has-text("查看战报")'); await p.waitForSelector('text=关键原因');
    log.push(await p.textContent('.report h2'));
  }
  await nav('赛程'); await shot('10-schedule');
  await nav('主页'); await shot('11-season-end');
  log.push((await p.textContent('.hero-card')).slice(0, 120));
  await p.click('button:has-text("进入第 2 赛季")');
  await nav('历史'); await shot('12-history');
  await nav('合同转会'); log.push(`season 2 roster rows: ${await p.locator('table').first().locator('tbody tr').count()}`);
  for (const [label, name] of [['主页', '13-home-s2'], ['阵容', '14-lineup'], ['市场', '15-market-s2'], ['设置', '16-settings']]) { await nav(label); await shot(name); }
  console.log(JSON.stringify({ log, errs }, null, 1));
  await b.close();
})();
