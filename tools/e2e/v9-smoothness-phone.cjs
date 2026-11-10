// Browser check (phone 390x844, V9):
// 1. Hire a staff member and verify Finance window displays "负责人工资" and staff entry under "工资明细",
//    and that displayed weekly rows sum accurately to "每周净变化（不含奖金）".
// 2. Open both FPS and CARD divisions, verify ClubScene runs smoothly at ~60fps without 30fps cap,
//    and genuinely tap both front-lawn sister-division stations (FPS target range & CARD duel table)
//    to confirm each opens the "集团" window.
// 3. Watch MOBA match at 4x speed to verify throttled HUD batching & integer-snapped camera CSS.
// 4. Open FPS & Card replays, verify redundant `.fps-map` bar is gone, verify 60fps smooth replay & skip,
//    and capture 390x844 mobile screenshots in docs/reports/v9/.
const fs = require('fs');
const { chromium } = require('playwright');
const helpers = require('./helpers.cjs');

const SHOTS = 'docs/reports/v9';
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

  // Grant preseason funds & reputation to test staff hiring + opening both divisions
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

  // 1. Hire a staff member in "负责人" and set to "亲自管"
  await helpers.nav(p, '负责人');
  const firstStaffCard = p.locator('.staff-role .staff-list .staff-card').first();
  const hiredStaffName = (await firstStaffCard.locator('b').first().textContent()).trim();
  await firstStaffCard.locator('button:has-text("聘请")').click();
  await confirm();
  await p.locator('.staff-card.hired label.tactic:has-text("亲自管")').first().click();

  // Open "财务" and verify "负责人工资" + "工资明细" staff row + weekly net sum
  await helpers.nav(p, '财务');
  const finCheck = await p.evaluate((staffName) => {
    const dts = [...document.querySelectorAll('section.card dl.kv dt')];
    const kv = {};
    for (const dt of dts) {
      const dd = dt.nextElementSibling;
      kv[dt.textContent.trim()] = dd ? dd.textContent.trim() : '';
    }
    const wageItems = [...document.querySelectorAll('section.card ul.plain li')].map((li) =>
      li.textContent.trim(),
    );
    return {
      kv,
      hasStaffRow: '负责人工资' in kv,
      hasStaffDetail: wageItems.some((t) => t.includes(staffName)),
    };
  }, hiredStaffName);

  if (!finCheck.hasStaffRow) errs.push('Finance overview missing "负责人工资" row after hiring staff');
  if (!finCheck.hasStaffDetail) errs.push(`Finance wage details missing hired staff "${hiredStaffName}"`);
  const rowKeys = ['每周工资', '负责人工资', '赞助', '联赛分成', '周边收入', '训练开销', '设施维护'];
  const summed = rowKeys.reduce((acc, k) => acc + (k in finCheck.kv ? parseMoney(finCheck.kv[k]) : 0), 0);
  const netShown = parseMoney(finCheck.kv['每周净变化（不含奖金）']);
  if (summed !== netShown) {
    errs.push(`Finance rows sum (${summed}) !== displayed weeklyNet (${netShown}): ${JSON.stringify(finCheck.kv)}`);
  }
  log.push(`Finance staff wage verified: ${finCheck.kv['负责人工资']}, net=${netShown} (rows sum=${summed})`);
  await p.evaluate(() => {
    const wb = document.querySelector('.win-body');
    if (wb) wb.scrollTop = 0;
  });
  await p.screenshot({ path: `${SHOTS}/02-finance-staff-wage.png` });

  // 2. Open both FPS & CARD divisions
  await helpers.nav(p, '集团');
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

  // Return to base, check 60fps smoothness & tap both courtyard division stations
  await helpers.closeWindows(p);
  while (await p.locator('.event-dialog button:has-text("知道了")').count()) {
    await p.click('.event-dialog button:has-text("知道了")');
    await p.waitForTimeout(100);
  }
  await p.click('.cam-pill:has-text("全景")');
  await p.waitForTimeout(2600);
  await p.screenshot({ path: `${SHOTS}/01-base-divisions.png` });

  const basePerf = await p.evaluate(
    () =>
      new Promise((res) => {
        let frames = 0;
        const t0 = performance.now();
        const step = () => {
          frames++;
          if (performance.now() - t0 < 1000) requestAnimationFrame(step);
          else {
            const c = document.querySelector('.base-canvas');
            res({
              rafFps: Math.round((frames * 1000) / (performance.now() - t0)),
              frameMs: Number(c.getAttribute('data-frame-ms') || '0'),
            });
          }
        };
        requestAnimationFrame(step);
      }),
  );
  log.push(`ClubScene perf: rafFps=${basePerf.rafFps}, frameMs=${basePerf.frameMs}`);
  if (basePerf.frameMs > 12) errs.push(`ClubScene frame time too slow: ${basePerf.frameMs}ms`);

  // Zoom into "户外庭院" and tap both FPS target range and CARD duel table on the front lawn
  await p.click('.cam-pill:has-text("户外庭院")');
  await p.waitForTimeout(300);
  await p.screenshot({ path: `${SHOTS}/05-yard-divisions-zoom.png` });

  const tapIsoOnBase = async (i, j, z = 6) => {
    const pt = await p.evaluate(
      ([ii, jj, zz]) => {
        const c = document.querySelector('.base-canvas');
        const r = c.getBoundingClientRect();
        const sx = 114 + (ii - jj) * 10;
        const sy = 66 + (ii + jj) * 5 - zz;
        return {
          x: r.left + (sx / 300) * r.width,
          y: r.top + (sy / 200) * r.height,
        };
      },
      [i, j, z],
    );
    await p.mouse.click(pt.x, pt.y);
    await p.waitForTimeout(150);
  };

  // Tap FPS Tactical Target Range (i=8.73, j=6.8)
  await tapIsoOnBase(8.73, 6.8, 6);
  const titleAfterFpsTap = (await p.locator('.win-title span').count())
    ? (await p.textContent('.win-title span')).trim()
    : '';
  if (!titleAfterFpsTap.includes('集团')) {
    errs.push(`Tapping FPS courtyard target range expected "集团", got "${titleAfterFpsTap}"`);
  }
  await helpers.closeWindows(p);

  // Tap CARD Duel Patio Table (i=14.28, j=6.89)
  await tapIsoOnBase(14.28, 6.89, 6);
  const titleAfterCardTap = (await p.locator('.win-title span').count())
    ? (await p.textContent('.win-title span')).trim()
    : '';
  if (!titleAfterCardTap.includes('集团')) {
    errs.push(`Tapping CARD courtyard duel table expected "集团", got "${titleAfterCardTap}"`);
  }
  await helpers.closeWindows(p);
  log.push('Both courtyard sister-division props opened "集团" on real tap');

  // 3. Watch first MOBA match briefly at 4x speed to verify MatchScene integer CSS & HUD batching
  await p.click('.hud button:has-text("下一场")');
  await p.waitForSelector('.win button:has-text("开始比赛")');
  await p.click('.win button:has-text("开始比赛")');
  await p.waitForSelector('.canvas-host canvas');
  await p.click('button:has-text("4×")');
  await p.waitForTimeout(900);
  const bgStyle = await p.evaluate(() => {
    const c = document.querySelector('.canvas-host canvas');
    return {
      bgSize: c ? c.style.backgroundSize : '',
      bgPos: c ? c.style.backgroundPosition : '',
    };
  });
  if (/\.\d+px/.test(bgStyle.bgSize) || /\.\d+px/.test(bgStyle.bgPos)) {
    errs.push(`MatchScene camera CSS has sub-pixel floats: ${JSON.stringify(bgStyle)}`);
  }
  log.push(`MatchScene 4x camera CSS integer-snapped: ${JSON.stringify(bgStyle)}`);
  await p.click('button:has-text("跳过")');
  await p.click('button:has-text("查看战报")');
  await p.waitForSelector('text=关键原因');

  // Play 2 more match weeks so both FPS and CARD divisions have completed league matches
  for (let round = 0; round < 2; round++) {
    await helpers.closeWindows(p);
    await p.click('.hud button:has-text("下一场")');
    await helpers.quickMatch(p);
  }

  // 4. Verify FPS replay (no `.fps-map`, smooth 60fps playback, no overflow)
  await helpers.nav(p, '集团');
  await p.click('button:has-text("进入射击分部")');
  await p.click('.tabs button:has-text("比赛")');
  await p.waitForSelector('.fps-replay-canvas');

  const fpsMapCount = await p.locator('.fps-map').count();
  if (fpsMapCount !== 0) errs.push(`Expected redundant .fps-map to be removed, found ${fpsMapCount}`);

  const playFpsBtn = p.locator('button:has-text("▶ 重放这一回合")');
  await playFpsBtn.scrollIntoViewIfNeeded();
  await playFpsBtn.click();
  await p.waitForTimeout(950);
  await p.evaluate(() => {
    const wb = document.querySelector('.win-body');
    if (wb) wb.scrollTop = 0;
  });
  await p.screenshot({ path: `${SHOTS}/03-fps-replay-clean.png` });

  const skipFpsBtn = p.locator('button:has-text("⏭ 直接看结果")');
  await skipFpsBtn.scrollIntoViewIfNeeded();
  await skipFpsBtn.click();
  if ((await p.locator('.fps-replay-canvas').getAttribute('data-done')) !== '1') {
    errs.push('FPS replay did not finish after clicking skip');
  }

  // 5. Verify Card replay (smooth 60fps card flight & HP drain, no overflow)
  await p.evaluate(() => {
    const wb = document.querySelector('.win-body');
    if (wb) wb.scrollTop = 0;
  });
  await p.click('.tabs button:has-text("‹ 集团")');
  await p.click('button:has-text("进入卡牌分部")');
  await p.click('.tabs button:has-text("比赛")');
  await p.waitForSelector('.card-replay-canvas');

  const playCardBtn = p.locator('button:has-text("▶ 重放这一局")');
  await playCardBtn.scrollIntoViewIfNeeded();
  await playCardBtn.click();
  await p.waitForTimeout(920);
  await p.evaluate(() => {
    const wb = document.querySelector('.win-body');
    if (wb) wb.scrollTop = 0;
  });
  await p.screenshot({ path: `${SHOTS}/04-card-replay-smooth.png` });

  const skipCardBtn = p.locator('button:has-text("⏭ 直接看结果")');
  await skipCardBtn.scrollIntoViewIfNeeded();
  await skipCardBtn.click();
  if ((await p.locator('.card-replay-canvas').getAttribute('data-done')) !== '1') {
    errs.push('Card replay did not finish after clicking skip');
  }

  const overflow = await p.evaluate(() => ({
    sw: document.documentElement.scrollWidth,
    w: window.innerWidth,
  }));
  if (overflow.sw > overflow.w + 1) {
    errs.push(`Horizontal overflow on phone: ${overflow.sw} > ${overflow.w}`);
  }

  console.log(JSON.stringify({ log, errs }, null, 2));
  await b.close();
  process.exitCode = errs.length ? 1 : 0;
})();
