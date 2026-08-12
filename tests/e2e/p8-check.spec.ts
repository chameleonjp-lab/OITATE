import { expect, test } from "@playwright/test";

test("keeps the P8 diagnostic export development-only and serializable", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 720 });
  await page.goto("/?p7=1");
  expect(await page.evaluate(() => window.__OITATE_P8__)).toBeUndefined();

  await page.goto("/?p7=1&p8-check=1");
  await expect(page.getByTestId("p8-diagnostic-tools")).toBeVisible();
  await expect(page.getByRole("button", { name: "診断JSONを保存" })).toBeVisible();

  const report = await page.evaluate(() => window.__OITATE_P8__?.getReport());
  expect(report?.schemaVersion).toBe(1);
  expect(report?.mode).toBe("p7");
  expect(report?.environment.viewport).toEqual({ width: 1024, height: 720 });
  expect(report?.performance.sampleCount).toBeGreaterThan(0);
  expect(report?.events.some((event) => event.type === "boot")).toBe(true);
  expect(JSON.stringify(report)).not.toContain("undefined");

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "診断JSONを保存" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^oitate-p8-diagnostics-.*\.json$/);
  await expect(page.getByText("診断JSONを保存しました。端末・性能の確認記録に添付できます")).toBeVisible();
});
