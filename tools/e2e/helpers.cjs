// Shared steps for the browser checks: the club base is the main screen; everything else opens in windows.
const MENU_LABEL = { 市场: '签人' };

/** Closes open windows; the season summary may open by itself right after, so give it a moment. */
async function closeWindows(p) {
  for (let k = 0; k < 4 && (await p.locator('.win').count()); k++) await p.click('.win-close');
  await p.waitForTimeout(150);
  // Once the season is over its summary opens on its own; wait for it rather than racing it.
  if (await p.locator('.hud button:has-text("下一场")').isDisabled()) {
    try { await p.waitForSelector('button:has-text("进入第")', { timeout: 3000 }); } catch { /* closed earlier by the player */ }
  }
}

/**
 * True once the season has no matches left; then the "进入第 N 赛季" button is on screen.
 * The summary opens by itself only once, and closeWindows may have just closed it: the overview has the same button.
 */
async function seasonOver(p) {
  if (!(await p.locator('.hud button:has-text("下一场")').isDisabled())) return false;
  if (!(await p.locator('button:has-text("进入第")').count())) {
    await p.click('.menu-btn');
    await p.click('.menu-grid button:has-text("概况")');
  }
  await p.waitForSelector('button:has-text("进入第")', { timeout: 5000 });
  return true;
}

/** Opens a window from the menu ('主页' just goes back to the base). */
async function nav(p, label) {
  await closeWindows(p);
  if (label === '主页') return;
  await p.click('.menu-btn');
  await p.click(`.menu-grid button:has-text("${MENU_LABEL[label] ?? label}")`);
  await p.waitForTimeout(120);
}

/** On the match-day window: start the match, skip it and open the report. Returns the report headline, or null. */
async function playMatch(p) {
  try { await p.waitForSelector('.win button:has-text("开始比赛")', { timeout: 2500 }); } catch { return null; }
  await p.click('.win button:has-text("开始比赛")');
  await p.waitForSelector('.canvas-host canvas');
  await p.click('button:has-text("跳过")');
  await p.click('button:has-text("查看战报")');
  await p.waitForSelector('text=关键原因');
  return p.textContent('.report h2');
}

module.exports = { closeWindows, nav, playMatch, seasonOver };
