import { Buffer } from "node:buffer";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";

const ARTIFACT_DIR = resolve("artifacts/p8-gameplay-media");
const VIEWPORT = { width: 1280, height: 720 } as const;
const MAX_SCENE_BYTES = 2 * 1024 * 1024;
const MAX_TOTAL_BYTES = 6 * 1024 * 1024;

const MEDIA_SCENES = [
  {
    name: "position",
    stageId: 1,
    title: "1　接近圧力",
    center: "位置取りで動かす",
    objective: "臆病種6体を広い囲いへ収容する",
  },
  {
    name: "signal",
    stageId: 2,
    title: "2　誘導音と経路",
    center: "合図と地形を使う",
    objective: "誘導音を使い、速い経路を発見して追従種4体を収容する",
  },
  {
    name: "danger",
    stageId: 3,
    title: "3　危険管理",
    center: "危険種を先に隔離する",
    objective: "威嚇音を使い、危険種と保護対象を専用囲いへ収容する",
  },
] as const;

type MediaScene = (typeof MEDIA_SCENES)[number];
type P7State = ReturnType<Window["__OITATE_P7__"]["getState"]>;
type P5State = ReturnType<Window["__OITATE_P5__"]["getState"]>;

interface VisualSample {
  width: number;
  height: number;
  sampleCount: number;
  luminanceMin: number;
  luminanceMax: number;
  luminanceRange: number;
  distinctColors: number;
  nonDarkRatio: number;
}

interface SceneArtifact {
  scene: MediaScene["name"];
  filename: string;
  stage: {
    id: number;
    title: string;
    center: string;
    objective: string;
  };
  state: {
    p7: {
      stageId: P7State["stageId"];
      status: P7State["status"];
      menuVisible: P7State["menuVisible"];
      resultVisible: P7State["resultVisible"];
    };
    p5: {
      animals: Array<Pick<P5State["animals"][number], "id" | "type" | "phase" | "lifeState" | "route">>;
      lastEvent: P5State["lastEvent"];
    };
  };
  fileBytes: number;
  visualSample: VisualSample;
}

function readPngDimensions(png: Buffer): { width: number; height: number } {
  expect(png.length).toBeGreaterThanOrEqual(24);
  expect(png.subarray(0, 8).equals(Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]))).toBe(true);
  expect(png.readUInt32BE(8)).toBe(13);
  expect(png.subarray(12, 16).toString("ascii")).toBe("IHDR");
  return {
    width: png.readUInt32BE(16),
    height: png.readUInt32BE(20),
  };
}

async function getP7State(page: Page): Promise<P7State> {
  return page.evaluate(() => window.__OITATE_P7__.getState());
}

async function getP5State(page: Page): Promise<P5State> {
  return page.evaluate(() => window.__OITATE_P5__.getState());
}

async function sampleCanvas(page: Page, png: Buffer): Promise<VisualSample> {
  return page.evaluate(async (pngBase64) => {
    const image = new Image();
    const imageUrl = `data:image/png;base64,${pngBase64}`;
    await new Promise<void>((resolve, reject) => {
      image.addEventListener("load", () => resolve(), { once: true });
      image.addEventListener("error", () => reject(new Error("canvas screenshot could not be decoded")), { once: true });
      image.src = imageUrl;
    });

    const width = image.naturalWidth;
    const height = image.naturalHeight;
    const offscreen = document.createElement("canvas");
    offscreen.width = width;
    offscreen.height = height;
    const context = offscreen.getContext("2d");
    if (!context || width < 1 || height < 1) {
      throw new Error("canvas screenshot has no readable pixels");
    }
    context.drawImage(image, 0, 0);

    const columns = 16;
    const rows = 9;
    const pixels = context.getImageData(0, 0, width, height).data;
    const luminances: number[] = [];
    const colors = new Set<string>();
    let nonDarkCount = 0;
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const x = Math.min(width - 1, Math.floor((column + 0.5) * width / columns));
        const y = Math.min(height - 1, Math.floor((row + 0.5) * height / rows));
        const offset = (y * width + x) * 4;
        const red = pixels[offset] ?? 0;
        const green = pixels[offset + 1] ?? 0;
        const blue = pixels[offset + 2] ?? 0;
        const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
        luminances.push(luminance);
        colors.add(`${red},${green},${blue}`);
        if (luminance > 16) nonDarkCount += 1;
      }
    }

    const luminanceMin = Math.min(...luminances);
    const luminanceMax = Math.max(...luminances);
    return {
      width,
      height,
      sampleCount: luminances.length,
      luminanceMin,
      luminanceMax,
      luminanceRange: luminanceMax - luminanceMin,
      distinctColors: colors.size,
      nonDarkRatio: nonDarkCount / luminances.length,
    };
  }, png.toString("base64"));
}

function compactP5State(state: P5State): SceneArtifact["state"]["p5"] {
  return {
    animals: state.animals.map(({ id, type, phase, lifeState, route }) => ({
      id,
      type,
      phase,
      lifeState,
      route,
    })),
    lastEvent: state.lastEvent,
  };
}

function buildReport(
  generatedAt: string,
  sourceHeadSha: string | null,
  testedMergeSha: string | null,
  scenes: SceneArtifact[],
): string {
  const sceneRows = scenes.map((scene) => {
    const visual = scene.visualSample;
    return `| ${scene.scene} | ${scene.filename} | ${scene.stage.id} ${scene.stage.title} | ${scene.fileBytes} | ${visual.luminanceRange.toFixed(1)} | ${visual.distinctColors} | ${visual.nonDarkRatio.toFixed(3)} |`;
  });
  return [
    "# P8 gameplay media capture",
    "",
    `- generatedAt: ${generatedAt}`,
    "- capture: Chromium / Playwright / dev / P7-e2e",
    "- viewport: 1280x720, DPR 1",
    `- sourceHeadSha: ${sourceHeadSha ?? "null"}`,
    `- testedMergeSha: ${testedMergeSha ?? "null"}`,
    "",
    "All three scenes were captured sequentially in one Playwright test. P7 state was checked for stage/status/menu/result, while animal phase and event assertions used the P5 public state.",
    "",
    "| Scene | File | Stage | Bytes | Luminance range | Distinct colors | Non-dark ratio |",
    "| --- | --- | --- | ---: | ---: | ---: | ---: |",
    ...sceneRows,
    "",
  ].join("\n");
}

test("captures the three P8 gameplay media scenes", async ({ page }) => {
  await rm(ARTIFACT_DIR, { recursive: true, force: true });
  await mkdir(ARTIFACT_DIR, { recursive: true });
  await page.setViewportSize(VIEWPORT);

  const generatedAt = new Date().toISOString();
  const sourceHeadSha = process.env.P8_SOURCE_HEAD_SHA || null;
  const testedMergeSha = process.env.P8_TESTED_MERGE_SHA || process.env.GITHUB_SHA || null;
  const sceneArtifacts: SceneArtifact[] = [];

  for (const scene of MEDIA_SCENES) {
    await page.goto("/?p7=1&p7-e2e=1");
    await expect(page.locator("#app")).toHaveAttribute("data-ready", "true");
    await expect(page.locator(".game-canvas")).toBeVisible();
    await expect.poll(() => page.evaluate(() => typeof window.__OITATE_P7__.e2e?.prepareMediaScene)).toBe("function");

    await page.evaluate((sceneName) => {
      window.__OITATE_P7__.e2e?.prepareMediaScene(sceneName);
    }, scene.name);

    const p7State = await getP7State(page);
    const p5State = await getP5State(page);
    expect(p7State.stageId).toBe(scene.stageId);
    expect(p7State.status).toBe("active");
    expect(p7State.menuVisible).toBe(false);
    expect(p7State.resultVisible).toBe(false);
    expect(p7State).not.toHaveProperty("animals");
    await expect(page.locator("#p7-stage-menu-overlay")).toBeHidden();
    await expect(page.locator("#p7-result-overlay")).toBeHidden();
    await expect(page.locator("#p7-stage-center")).toContainText(scene.title);
    await expect(page.locator("#p7-stage-center")).toContainText(scene.center);
    await expect(page.locator("#p7-stage-objective")).toHaveText(scene.objective);

    if (scene.name === "position") {
      expect(p5State.animals.filter((animal) => animal.type === "coward" && animal.phase === "fleeing").length).toBeGreaterThanOrEqual(1);
    } else if (scene.name === "signal") {
      expect(p5State.animals.filter((animal) => animal.type === "follower" && animal.phase === "following").length).toBeGreaterThanOrEqual(1);
      expect(p5State.lastEvent?.type).toBe("animalStartedFollowing");
    } else {
      expect(p5State.animals.filter((animal) => animal.type === "predator" && animal.phase === "aim").length).toBeGreaterThanOrEqual(1);
      expect(p5State.lastEvent?.type).toBe("predatorAimStarted");
    }

    const canvasPng = await page.locator(".game-canvas").screenshot();
    const visualSample = await sampleCanvas(page, Buffer.from(canvasPng));
    expect(visualSample.sampleCount).toBe(16 * 9);
    expect(visualSample.luminanceRange).toBeGreaterThan(12);
    expect(visualSample.distinctColors).toBeGreaterThan(4);
    expect(visualSample.nonDarkRatio).toBeGreaterThan(0.15);

    const filename = `gameplay-${scene.name}.png`;
    const screenshotPath = resolve(ARTIFACT_DIR, filename);
    const screenshot = Buffer.from(await page.screenshot({ path: screenshotPath }));
    expect(readPngDimensions(screenshot)).toEqual(VIEWPORT);
    const fileBytes = (await stat(screenshotPath)).size;
    expect(fileBytes).toBe(screenshot.byteLength);
    expect(fileBytes).toBeLessThanOrEqual(MAX_SCENE_BYTES);

    sceneArtifacts.push({
      scene: scene.name,
      filename,
      stage: {
        id: scene.stageId,
        title: scene.title,
        center: scene.center,
        objective: scene.objective,
      },
      state: {
        p7: {
          stageId: p7State.stageId,
          status: p7State.status,
          menuVisible: p7State.menuVisible,
          resultVisible: p7State.resultVisible,
        },
        p5: compactP5State(p5State),
      },
      fileBytes,
      visualSample,
    });
  }

  const totalBytes = sceneArtifacts.reduce((total, scene) => total + scene.fileBytes, 0);
  expect(totalBytes).toBeLessThanOrEqual(MAX_TOTAL_BYTES);

  const metadata = {
    schemaVersion: 1,
    generatedAt,
    capture: {
      browser: "Chromium",
      runner: "Playwright",
      server: "dev",
      mode: "P7-e2e",
      query: "?p7=1&p7-e2e=1",
      viewport: VIEWPORT,
      devicePixelRatio: 1,
    },
    sourceHeadSha,
    testedMergeSha,
    scenes: sceneArtifacts,
  };
  await writeFile(
    resolve(ARTIFACT_DIR, "metadata.json"),
    `${JSON.stringify(metadata, null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    resolve(ARTIFACT_DIR, "report.md"),
    buildReport(generatedAt, sourceHeadSha, testedMergeSha, sceneArtifacts),
    "utf8",
  );
});
