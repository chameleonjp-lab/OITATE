# Public blank page incident

## Symptom

GitHub Pages deployment completed successfully, but the public URL could appear blank on iPhone Safari.

## What was confirmed

- Pages build type is GitHub Actions workflow.
- The deployed artifact contains generated `index.html`, CSS, and JavaScript assets.
- The deployed `index.html` references `./assets/...`, not `/src/main.ts`.
- Chromium CI had passed, but Safari/WebKit had not been part of the browser matrix.

## Corrective action

- Add a visible bootstrap status so module-load or initialization failures do not become a silent blank page.
- Add WebKit with an iPhone profile to Playwright browser coverage.
- Install WebKit in CI and run the existing browser suite against it.

## Acceptance

The incident is not closed only because Pages deployment succeeds. The browser workflow must pass Chromium and WebKit, the public URL must show either the game or an explicit bootstrap error, and iPhone Safari still requires manual confirmation.
