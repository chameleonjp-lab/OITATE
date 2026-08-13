import { expect, test, type Page } from "@playwright/test";

function observeRuntime(page: Page): string[] {
  const failures: string[] = [];
  page.on("requestfailed", (request) => {
    failures.push("request failed: " + request.url() + " (" + (request.failure()?.errorText ?? "unknown") + ")");
  });
  page.on("response", (response) => {
    if (response.status() >= 400) {
      failures.push("HTTP " + response.status() + ": " + response.url());
    }
  });
  page.on("console", (message) => {
    if (message.type() === "error") failures.push("console error: " + message.text());
  });
  page.on("pageerror", (error) => {
    failures.push("page error: " + error.message);
  });
  return failures;
}

async function expectHealthy(page: Page, failures: string[]): Promise<void> {
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(300);
  expect(failures, failures.join("\n")).toEqual([]);
}

test("candidate page serves all local media in Vite preview", async ({ page }) => {
  const failures = observeRuntime(page);
  await page.goto("/candidate.html", { waitUntil: "domcontentloaded" });
  await expect(page).toHaveTitle(/OITATE.*公開候補版/);
  await expect(page.locator("#hero-title")).toBeVisible();
  const imageStates = await page.locator("img").evaluateAll((images) =>
    images.map((image) => {
      const element = image as HTMLImageElement;
      return {
        src: element.getAttribute("src"),
        complete: element.complete,
        naturalWidth: element.naturalWidth,
      };
    }),
  );
  expect(imageStates).toHaveLength(4);
  expect(imageStates.every((image) => image.complete && image.naturalWidth > 0)).toBe(true);
  await expectHealthy(page, failures);
});

test("game entry serves without preview errors", async ({ page }) => {
  const failures = observeRuntime(page);
  await page.goto("/?p7=1", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#app")).toHaveAttribute("data-ready", "true", { timeout: 15_000 });
  await expectHealthy(page, failures);
});
