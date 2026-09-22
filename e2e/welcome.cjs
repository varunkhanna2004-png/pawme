// Run (dev server up): node e2e/welcome.cjs
// The welcome screen's "What's on PAWME" section renders, and "Get started" stays
// the visible primary action on small phones — above the fold, and docked once
// the page is scrolled.
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const OUT = path.join(__dirname, 'shots');
fs.mkdirSync(OUT, { recursive: true });
const checks = [];
const check = (n, ok, x = '') => { checks.push(!!ok); console.log(ok ? 'PASS' : 'FAIL', n, x); };
(async () => {
  const browser = await chromium.launch();
  for (const [label, viewport] of [['iPhone 14 (390×844)', { width: 390, height: 844 }], ['small Android (360×640)', { width: 360, height: 640 }]]) {
    const page = await (await browser.newContext({ viewport, deviceScaleFactor: 2 })).newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('http://localhost:5173/');
    await page.waitForSelector('[data-testid=whats-on]');
    const cta = await page.locator('[data-testid=cta]').boundingBox();
    check(`${label}: "Get started" is fully above the fold without scrolling`, cta.y + cta.height <= viewport.height, `button bottom at ${Math.round(cta.y + cta.height)}px of ${viewport.height}`);
    const heading = await page.locator('#whats-on').boundingBox();
    check(`${label}: the section heading peeks in below the CTA (invites scrolling)`, heading.y > cta.y + cta.height && heading.y < viewport.height, `heading at ${Math.round(heading.y)}px`);
    check(`${label}: no docked CTA while the main one is visible`, (await page.locator('[data-testid=cta-docked]').count()) === 0);
    if (label.startsWith('iPhone')) await page.screenshot({ path: `${OUT}/w1-welcome-top.png` });
    const live = await page.locator('[data-testid=whats-on] ul').first().locator('li').allInnerTexts();
    const soon = await page.locator('[data-testid=whats-on] ul').nth(1).locator('li').allInnerTexts();
    check(`${label}: LIVE NOW lists the 7 working features`, live.length === 7 && /Swipe|Mutual|Realtime chat|Playdate|Report & block|Share|profile/i.test(live.join()), `${live.length} items`);
    check(`${label}: COMING SOON lists the 6 momentum items and nothing commercial`, soon.length === 6 && /Paw Friends|Communities|Events|Lost-pet|Push|beyond Makati/.test(soon.join()) && !/market|ads|insurance|premium/i.test(await page.locator('[data-testid=whats-on]').innerText()), `${soon.length} items`);
    await page.mouse.move(viewport.width / 2, viewport.height / 2); await page.mouse.wheel(0, 1400); await page.waitForTimeout(500);
    const docked = page.locator('[data-testid=cta-docked]');
    check(`${label}: once scrolled past the main CTA, a docked "Get started" appears at the bottom`, (await docked.count()) === 1 && (await docked.boundingBox()).y + (await docked.boundingBox()).height <= viewport.height + 1);
    if (label.startsWith('iPhone')) await page.screenshot({ path: `${OUT}/w2-welcome-scrolled.png` });
    await docked.click();
    await page.waitForSelector('#email');
    check(`${label}: docked CTA goes to the email step`, true);
    check(`${label}: no page errors`, errors.length === 0, errors.join(' | '));
    await page.context().close();
  }
  await browser.close();
  const failed = checks.filter((c) => !c).length;
  console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('E2E ERROR:', e.message.split('\n')[0]); process.exit(2); });
