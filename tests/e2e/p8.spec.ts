import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 720 });
  await page.goto("/candidate.html");
});

test("renders the P8 candidate page without external media", async ({ page }) => {
  await expect(page).toHaveTitle(/OITATE.*公開候補版/);
  await expect(page.locator("#hero-title")).toContainText("動物を直接命令せず、");
  await expect(page.locator("#hero-title")).toContainText("立ち位置と合図で導く。");
  await expect(page.getByRole("link", { name: /ゲームを始める/ }).first()).toHaveAttribute("href", "./?p7=1");
  await expect(page.locator("img")).toHaveCount(4);
  const imageSources = await page.locator("img").evaluateAll((images) => images.map((image) => image.getAttribute("src")));
  expect(imageSources.every((source) => source?.startsWith("./media/"))).toBe(true);
  await expect(page.getByRole("heading", { name: "公開前の確認事項" })).toBeVisible();
});

test("keeps the candidate page usable on a narrow viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  const dimensions = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
  }));
  expect(dimensions.documentWidth).toBeLessThanOrEqual(dimensions.viewportWidth + 1);
  await page.getByRole("link", { name: "遊び方を見る" }).click();
  await expect(page.getByRole("heading", { name: "三つのことを覚えれば始められます。" })).toBeInViewport();
});

