// Browser check (phone 390x844, F6):
// 1. Genuinely tap top-bar HUD funds (.hud-money) -> opens "财务", and tap HUD reputation (.hud-rep) -> opens "目标".
// 2. Upgrade "直播间" (STREAM) in "设施" and verify net weekly money increases (no longer losing money after upkeep).
// 3. Open both FPS (+8%) and CARD (+6%) divisions, select "AUTO" ("自动轮换") training in division overview,
//    and verify "本周：..." hint appears cleanly.
// 4. Verify "集团" header & cards explicitly display "+14%" / "+8%" / "+6%" sponsor bonus, and "财务" displays
//    "(含分部加成 +14%)" AND its 4-week forecast expense includes facility upkeep + staff wages.
// 5. Check 390x844 mobile layout for zero horizontal overflow and capture screenshots in docs/reports/f6/.
const fs = require('fs');
const { chromium } = require('playwright');
const helpers = require('./helpers.cjs');

const SHOTS = 'docs/reports/f6';
fs.mkdirSync(SHOTS, { recursive: true });

const parseMoney = (s) => {
  const m = String(s || '').replace(/[¥,]/g, '').match(/-?\d+/);
  return m ? Number(m[0]) : 0;
};

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
  const checkNoHorizOverflow = async (label) => {
    const over = await p.evaluate(() => ({
      docW: document.documentElement.scrollWidth,
      winW: window.innerWidth,
    }));
    if (over.docW > over.winW + 1) {
      errs.push(`${label}: horizontal overflow ${over.docW} > ${over.winW}`);
    }
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

  // Grant funds & reputation for testing upgrades, staff, and both divisions
  await p.evaluate(() => {
    const key = Object.keys(localStorage).find(
      (k) =>
        k.startsWith('esports') &&
        !k.includes('tutorial') &&
        !k.endsWith('.bak') &&
        !k.endsWith('.tmp'),
    );
    const save = JSON.parse(localStorage.getItem(key));
    save.game.funds = 550000;
    save.game.club.reputation = 65;
    localStorage.setItem(key, JSON.stringify(save));
  });
  await p.reload();
  await p.waitForSelector('.hud');
  if (await p.locator('.event-dialog button:has-text("知道了")').count()) {
    await p.click('.event-dialog button:has-text("知道了")');
  }
  await checkNoHorizOverflow('base-hud');

  // 1. Genuinely tap HUD funds (.hud-money) -> opens Finance, and HUD reputation (.hud-rep) -> opens Goals
  await p.click('.hud-money');
  await p.waitForSelector('.win');
  const finTitle = (await p.textContent('.win-title')).trim();
  if (!finTitle.includes('财务')) {
    errs.push(`Expected tapping .hud-money to open 财务, got "${finTitle}"`);
  }
  // Sign a sponsor while in Finance
  await p.locator('ul.sponsors li button:has-text("签约")').first().click();
  await confirm();
  const netBeforeStream = parseMoney(
    await p.locator('dl.kv dt:has-text("每周净变化") + dd').textContent(),
  );
  await helpers.closeWindows(p);

  await p.click('.hud-rep');
  await p.waitForSelector('.win');
  const goalsTitle = (await p.textContent('.win-title')).trim();
  if (!goalsTitle.includes('目标')) {
    errs.push(`Expected tapping .hud-rep to open 目标, got "${goalsTitle}"`);
  }
  await checkNoHorizOverflow('goals-window');
  await p.screenshot({ path: `${SHOTS}/01-hud-goals.png` });
  log.push(`HUD shortcuts verified: .hud-money -> "${finTitle}", .hud-rep -> "${goalsTitle}"`);
  await helpers.closeWindows(p);

  // 2. Upgrade STREAM ("直播间") to Lv3 in "设施" and verify net weekly money improved
  await helpers.nav(p, '设施');
  const streamCard = p.locator('.facility:has(b:has-text("直播间"))');
  await streamCard.locator('button:has-text("升级")').click();
  await confirm();
  await streamCard.locator('button:has-text("升级")').click();
  await confirm();
  const streamText = await streamCard.textContent();
  if (!streamText.includes('已经是最高级')) {
    errs.push(`Expected 直播间 at 已经是最高级, got: ${streamText}`);
  }
  await checkNoHorizOverflow('facilities-stream');
  await p.screenshot({ path: `${SHOTS}/02-facilities-stream.png` });

  // Hire 1 staff member so m.staff > 0 as well
  await helpers.nav(p, '负责人');
  await p.locator('.staff-role .staff-list .staff-card button:has-text("聘请")').first().click();
  await confirm();
  await p.locator('.staff-card.hired label.tactic:has-text("亲自管")').first().click();
  await helpers.closeWindows(p);

  // Check net after STREAM Lv3 (adjusting for staff salary) via Finance
  await p.click('.hud-money');
  const staffWage = Math.abs(
    parseMoney(await p.locator('dl.kv dt:has-text("负责人工资") + dd').textContent()),
  );
  const netAfterStreamAndStaff = parseMoney(
    await p.locator('dl.kv dt:has-text("每周净变化") + dd').textContent(),
  );
  const streamNetDelta = netAfterStreamAndStaff + staffWage - netBeforeStream;
  if (streamNetDelta <= 0) {
    errs.push(`Expected STREAM Lv3 to yield positive weekly net gain, got delta=${streamNetDelta}`);
  }
  log.push(`STREAM Lv3 weekly net gain verified: +¥${streamNetDelta}/wk`);

  // 3. Open both FPS & CARD divisions and switch training to AUTO
  await helpers.nav(p, '集团');
  const unopenedText = await p.locator('.win-body').textContent();
  if (!unopenedText.includes('+8%') || !unopenedText.includes('+6%')) {
    errs.push('Unopened division cards did not mention +8% / +6% sponsor bonus');
  }
  await p.locator('section.card:has-text("射击分部") button:has-text("开办")').click();
  await confirm();
  await p.click('.tabs button:has-text("选手")');
  for (const roleName of ['突破', '狙击', '指挥', '支援', '自由人']) {
    await p.click(`.filters button:has-text("${roleName}")`);
    await p.locator('.staff-list button:has-text("签约")').first().click();
  }
  await p.click('.tabs button:has-text("阵容")');
  await p.click('button:has-text("一键推荐")');
  const saveFpsBtn = p.locator('button:has-text("保存阵容")');
  if ((await saveFpsBtn.count()) && !(await saveFpsBtn.isDisabled())) await saveFpsBtn.click();
  await p.click('.tabs button:has-text("概况")');
  await p.locator('label:has-text("本周训练") select').selectOption('AUTO');

  await p.click('.tabs button:has-text("‹ 集团")');
  await p.locator('section.card:has-text("卡牌分部") button:has-text("开办")').click();
  await confirm();
  await p.click('.tabs button:has-text("选手")');
  for (let i = 0; i < 3; i++) {
    await p.locator('.staff-list button:has-text("签约")').first().click();
  }
  await p.click('.tabs button:has-text("阵容")');
  await p.click('button:has-text("一键推荐")');
  const saveCardBtn = p.locator('button:has-text("保存阵容")');
  if ((await saveCardBtn.count()) && !(await saveCardBtn.isDisabled())) await saveCardBtn.click();
  await p.click('.tabs button:has-text("概况")');
  await p.locator('label:has-text("本周训练") select').selectOption('AUTO');
  const cardHomeText = await p.locator('.win-body').textContent();
  if (!cardHomeText.includes('本周：')) {
    errs.push(`Expected AUTO training hint "（本周：...）" in CARD overview, got: ${cardHomeText}`);
  }
  await checkNoHorizOverflow('branch-auto-training');
  await p.screenshot({ path: `${SHOTS}/03-branch-auto-training.png` });
  log.push('FPS & CARD AUTO training selection verified');

  // 4. Verify Group page shows +14% total sponsor bonus and +8% / +6% on division cards
  await p.click('.tabs button:has-text("‹ 集团")');
  const groupText = await p.locator('.win-body').textContent();
  if (!groupText.includes('+14%') || !groupText.includes('+8%') || !groupText.includes('+6%')) {
    errs.push(`Group page missing +14% / +8% / +6% sponsor bonus display: ${groupText}`);
  }
  await checkNoHorizOverflow('group-sponsor-bonus');
  await p.screenshot({ path: `${SHOTS}/04-group-sponsor-bonus.png` });
  log.push('Group +14% (+8% / +6%) sponsor bonus display verified');

  // 5. Advance into regular season so 4-week forecast has league matches, then tap HUD money to check Finance
  await helpers.closeWindows(p);
  await p.click('.hud button:has-text("下一场")');
  await helpers.closeWindows(p);
  await p.click('.hud-money');
  await p.waitForSelector('section.card:has-text("财务概况")');
  const finBody = await p.locator('.win-body').textContent();
  if (!finBody.includes('含分部加成 +14%') || !finBody.includes('分部加成后实收')) {
    errs.push(`Finance page missing sister-division sponsor bonus note: ${finBody}`);
  }

  // Verify 4-week forecast expense matches -(salaries + staff + training + upkeep)
  const forecastCheck = await p.evaluate(() => {
    const kv = {};
    for (const dt of document.querySelectorAll('section.card dl.kv dt')) {
      kv[dt.textContent.trim()] = dt.nextElementSibling?.textContent.trim() || '';
    }
    const firstRowTds = [...document.querySelectorAll('section.card table tbody tr:first-child td')].map(
      (td) => td.textContent.trim(),
    );
    return { kv, firstRowTds };
  });
  const expectedExpense =
    parseMoney(forecastCheck.kv['每周工资']) +
    parseMoney(forecastCheck.kv['负责人工资']) +
    parseMoney(forecastCheck.kv['训练开销']) +
    parseMoney(forecastCheck.kv['设施维护']);
  const forecastExpense = parseMoney(forecastCheck.firstRowTds[3]);
  if (forecastExpense !== expectedExpense) {
    errs.push(
      `Forecast weekly expense (${forecastExpense}) !== sum of salaries+staff+training+upkeep (${expectedExpense})`,
    );
  }
  await checkNoHorizOverflow('finance-bonus-forecast');
  await p.evaluate(() => {
    const wb = document.querySelector('.win-body');
    if (wb) wb.scrollTop = 0;
  });
  await p.screenshot({ path: `${SHOTS}/05-finance-bonus-forecast.png` });
  log.push(
    `Finance forecast verified: expense=${forecastExpense} matches salaries+staff+training+upkeep=${expectedExpense}`,
  );

  await b.close();
  console.log({ log, errs });
  if (errs.length) process.exit(1);
})();
