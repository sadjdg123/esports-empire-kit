// Browser check (phone 390x844), the P1 acceptance flow: new game -> pre-season signings, sponsor,
// a transfer -> regular season -> playoffs -> season 2 renewals and transfers -> end of season 2.
// Reloads the page at several points and checks the game is exactly where it was.
// Run as full-season-desktop.cjs. Screenshots go to docs/reports/t20/.
const { chromium } = require('playwright');
const helpers = require('./helpers.cjs');
const SHOTS = 'docs/reports/v1';
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const p = await ctx.newPage();
  const errs = []; const log = [];
  p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  const toast = async () => { try { return await p.textContent('.toast', { timeout: 1500 }); } catch { return ''; } };
  const confirm = async () => { await p.click('.modal-back button.primary'); };
  const nav = (label) => helpers.nav(p, label);
  const fingerprint = async () => p.evaluate(() => {
    const raw = localStorage.getItem(Object.keys(localStorage).find((k) => !k.endsWith('.bak') && !k.endsWith('.tmp') && !k.endsWith('.unreadable')));
    const g = JSON.parse(raw).game;
    return JSON.stringify({ cal: g.calendar, funds: g.funds, roster: g.club.roster, week: g.week, results: g.results.length, history: g.history.length, inbox: g.inbox.length });
  });
  const reloadCheck = async (when) => {
    const before = await fingerprint();
    const bar = await p.textContent('.hud-date');
    await p.reload(); await p.waitForSelector('.hud');
    const after = await fingerprint();
    const bar2 = await p.textContent('.hud-date');
    log.push(`reload at ${when}: ${before === after && bar === bar2 ? 'same' : 'DIFFERENT'}`);
    if (before !== after || bar !== bar2) errs.push(`reload changed the game at ${when}: ${before} vs ${after}`);
  };
  const playMatch = () => helpers.playMatch(p);
  const buyOne = async () => {
    await nav('合同转会');
    const rows = p.locator('table').nth(1).locator('tbody tr');
    const n = await rows.count();
    for (let i = n - 1; i >= Math.max(0, n - 10); i--) {
      const row = rows.nth(i);
      const input = row.locator('input[aria-label="报价"]');
      if (!(await input.count()) || await row.locator('button:has-text("报价")').isDisabled()) continue;
      const v = Number(await input.inputValue());
      await input.fill(String(Math.round((v * 1.4) / 500) * 500));
      await row.locator('button:has-text("报价")').click(); await confirm();
      const t = await toast();
      if (t.includes('成交')) return t;
    }
    return 'no purchase';
  };
  const renewAll = async () => {
    await nav('合同转会');
    const out = [];
    for (let k = 0; k < 8; k++) {
      const r = p.locator('.renewal').first();
      if (!(await r.count())) break;
      await r.locator('button:has-text("接受开价")').click(); out.push(await toast());
    }
    return out;
  };
  const playSeason = async (season) => {
    for (let i = 0; i < 30; i++) {
      await helpers.closeWindows(p);
      if (await helpers.seasonOver(p)) return;
      if (i === 3) await reloadCheck(`season ${season} round 3`);
      await p.click('.hud button:has-text("下一场")');
      const h = await playMatch();
      if (!h) continue;
      log.push(h);
      if (h.includes('半决赛') || h.includes('总决赛')) await reloadCheck(`season ${season} ${h.slice(0, 3)}`);
    }
    errs.push(`season ${season} did not finish`);
  };

  await p.goto('http://localhost:4173/');
  await p.fill('input', '书店电竞'); await p.click('text=成立俱乐部'); await p.waitForSelector('text=自由市场');
  await p.evaluate(() => { try { localStorage.setItem('esports-empire.tutorial.v1', '1'); } catch { /* private mode */ } });
  await p.selectOption('select[aria-label="合同年限"]', '1');
  for (const role of ['上单', '打野', '中单', '射手', '辅助']) {
    await p.click(`.filters >> text=${role}`);
    await p.locator('table tbody tr').filter({ has: p.locator(`td:nth-child(2) >> text=/^${role}/`) }).nth(3).locator('button:has-text("签约")').click();
  }
  await p.click('text=去设置阵容'); await p.click('text=一键推荐'); await p.click('text=保存阵容');
  await nav('财务'); await p.locator('.sponsors li button:has-text("签约")').first().click(); await confirm();
  log.push(`S1 buy: ${await buyOne()}`);
  await reloadCheck('season 1 pre-season');
  log.push(`S1 renewals: ${(await renewAll()).length}`);
  await nav('阵容'); await p.click('text=一键推荐'); await p.click('text=保存阵容');
  await playSeason(1);
  log.push((await p.textContent('.win .hero-card')).slice(0, 90));
  await p.screenshot({ path: `${SHOTS}/01-season1-end.png` });
  await p.click('button:has-text("进入第 2 赛季")');
  // Season 2 pre-season: offers, renewals, a transfer, sponsor if needed.
  await nav('收件箱'); log.push(`S2 inbox: ${await p.locator('.messages li').count()} messages, ${await p.locator('.messages button:has-text("拒绝")').count()} open offers`);
  if (await p.locator('.messages button:has-text("拒绝")').count()) await p.locator('.messages button:has-text("拒绝")').first().click();
  log.push(`S2 renewals: ${(await renewAll()).length}`);
  log.push(`S2 buy: ${await buyOne()}`);
  await nav('财务');
  if (await p.locator('.sponsors li button.primary:not([disabled])').count()) { await p.locator('.sponsors li button.primary:not([disabled])').first().click(); await confirm(); }
  await nav('阵容'); await p.click('text=一键推荐'); await p.click('text=保存阵容');
  await nav('训练'); await p.click('.tactic:has-text("配合")');
  await reloadCheck('season 2 pre-season');
  await playSeason(2);
  log.push((await p.textContent('.win .hero-card')).slice(0, 90));
  await p.screenshot({ path: `${SHOTS}/02-season2-end.png` });
  await nav('历史'); log.push(`history rows: ${await p.locator('table').first().locator('tbody tr').count()}`);
  await p.screenshot({ path: `${SHOTS}/03-history.png` });
  await nav('财务'); await p.screenshot({ path: `${SHOTS}/04-finance.png` });
  console.log(JSON.stringify({ log, errs }, null, 1));
  await b.close();
  process.exitCode = errs.length ? 1 : 0;
})();
