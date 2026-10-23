// Browser check (desktop): sign 5, play a full season through the playoffs into season 2.
// Run: npm run build && npx vite preview --port 4173, then: NODE_PATH=$(npm root -g) node tools/e2e/full-season-desktop.cjs
const { chromium } = require('playwright');
const { closeWindows, playMatch } = require('./helpers.cjs');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1280, height: 900 } }); const errs = [];
  p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto('http://localhost:4173/');
  await p.fill('input', '赛季测试'); await p.click('text=成立俱乐部'); await p.waitForSelector('text=自由市场');
  for (const role of ['上单', '打野', '中单', '射手', '辅助']) {
    await p.click(`.filters >> text=${role}`);
    await p.locator('table tbody tr').filter({ has: p.locator(`td:nth-child(2) >> text=/^${role}/`) }).locator('button:has-text("签约"):not([disabled])').first().click();
  }
  await p.click('text=去设置阵容'); await p.click('text=一键推荐'); await p.click('text=保存阵容');
  const log = [];
  for (let i = 0; i < 30; i++) {
    if (await p.locator('button:has-text("进入第 2 赛季")').count()) break;
    await closeWindows(p);
    if (await p.locator('button:has-text("进入第 2 赛季")').count()) break;
    log.push(await p.textContent('.hud-date'));
    await p.click('.hud button:has-text("下一场")');
    const h = await playMatch(p);
    if (h) log.push(h);
  }
  const end = await p.textContent('.win .hero-card'); console.log('LOG', JSON.stringify(log), end);
  await p.click('button:has-text("进入第 2 赛季")');
  await closeWindows(p);
  const s2 = await p.textContent('.hud-date');
  console.log(JSON.stringify({ log: log.slice(-6), end, s2, errs }, null, 1)); await b.close();
})();
