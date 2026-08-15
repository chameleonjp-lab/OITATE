# GitHub Pages 公開手順

## 目的

OITATEを`https://chameleonjp-lab.github.io/oitate/`で公開する。

これまでのPages設定は`main`ブランチのルートをそのまま配信する方式だったため、開発用`index.html`が`/src/main.ts`を直接参照し、完成したViteビルドを配信できていなかった。

## 正式な公開方式

GitHub Actionsで次の順に公開する。

1. `npm ci`
2. `npm run typecheck`
3. `npm test`
4. `npm run build`
5. `dist`をGitHub Pages artifactとしてアップロード
6. `actions/deploy-pages`で公開

Viteの`base`は`/oitate/`とし、JS/CSS/画像などの生成物がプロジェクトPages配下を正しく参照するようにする。

## GitHub側で必要な設定

この変更を`main`へマージした後、GitHubのリポジトリ画面で次を設定する。

1. `Settings`
2. `Pages`
3. `Build and deployment`
4. `Source`を`GitHub Actions`へ変更

その後、`Actions`の`Deploy GitHub Pages`を実行する。`main`へのpushでも自動実行される。

## 公開URL

`https://chameleonjp-lab.github.io/oitate/`

## 成功条件

- Deploy GitHub Pages workflowが成功する。
- 公開URLのHTMLが`/src/main.ts`ではなく`dist`内の生成済みassetを参照する。
- iPhone Safariでゲームの初期画面が表示される。
- JavaScript/CSS/画像に404がない。
- P8-F/P8-Gの実機確認は、この公開URLと確認対象commitを記録して実施する。
