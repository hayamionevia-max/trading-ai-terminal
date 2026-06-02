const { test, expect } = require('@playwright/test');

test('FX real data endpoints and chart page', async ({ page }) => {
  const tickerRes = await page.goto('http://127.0.0.1:8001/v1/ticker?symbol=USDJPY&tf=5m');
  expect(tickerRes.status()).toBe(200);

  const tickerText = await page.textContent('body');
  const tickerJson = JSON.parse(tickerText);

  expect(Array.isArray(tickerJson)).toBeTruthy();
  expect(tickerJson.length).toBeGreaterThan(0);
  expect(tickerJson[0]).toHaveProperty('time');
  expect(tickerJson[0]).toHaveProperty('open');
  expect(tickerJson[0]).toHaveProperty('high');
  expect(tickerJson[0]).toHaveProperty('low');
  expect(tickerJson[0]).toHaveProperty('close');

  const rateRes = await page.goto('http://127.0.0.1:8001/v1/rate?symbol=USDJPY');
  expect(rateRes.status()).toBe(200);

  const rateText = await page.textContent('body');
  const rateJson = JSON.parse(rateText);

  expect(rateJson).toHaveProperty('price');

  await page.goto('http://127.0.0.1:8001/chart.html?v=force3');
  await page.waitForTimeout(10000);

  const pageText = await page.textContent('body');
  expect(pageText).not.toContain('実データの取得に失敗しました');

  await page.screenshot({ path: 'chart-check.png', fullPage: true });
});