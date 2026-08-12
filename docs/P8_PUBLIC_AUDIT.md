# P8公開前監査の使い方

P8-Cの監査は、公開候補版の技術情報をCIで同じ手順から再生成するための開発用機能です。実機確認、プレイテスト、画像、動画、公開判定を自動で済ませる機能ではありません。

## 実行

依存関係を入れた後、本番ビルドと監査を実行します。

\`\`\`bash
npm ci
npm run typecheck
npm test
npm run test:audit
npm run build
npm run audit:public
npm run e2e
npm run e2e:preview
\`\`\`

監査結果は次へ出ます。

- \`artifacts/p8-public-audit/report.json\`
- \`artifacts/p8-public-audit/report.md\`

このディレクトリはリポジトリへコミットしません。GitHub Actionsでは、同じ結果を\`p8-public-audit\`というartifactへ保存します。生成物が作られなければ、CIのartifact保存も失敗します。

## 確認内容

- Viteの\`dist/.vite/manifest.json\`をバンドル資産の正本として、ゲーム入口のimport・CSS・assetsを確認する。
- \`index.html\`と\`candidate.html\`から静的に到達できるファイルを追跡する。
- HTMLの\`src\`、\`href\`、\`srcset\`、\`poster\`、SVGの参照、CSSの\`@import\`と\`url()\`を確認する。
- 入口ごとの展開後容量とgzip換算容量を、15MiBの初回読み込み上限と比べる。dist全体値は参考情報として残す。
- npm ls --all --include=dev --jsonの終了コード、JSON、problems、宣言済み依存の欠落、実体のmanifest不整合を確認する。現在のOSに入らない任意のOS向け依存は、npmがoptionalとして示し、実体pathがない場合は「インストール済み」として記録しない。
- 実際にインストールされた直接依存・開発依存・推移依存のパッケージ名、版、ライセンスを記録する。
- source head SHAとtested merge SHAをCIから明示的に受け取り、分けて記録する。

Vite manifestがない、入口ごとのgzip換算容量が15MiBを超える、入口がない、ローカル参照が欠ける、依存ツリーが不完全、ライセンス情報が不明な場合は監査を失敗にします。

## E2Eの境界

通常の\`npm run e2e\`は開発用の既存E2Eを実行します。追加の\`npm run e2e:preview\`は本番ビルドを\`vite preview\`で配信し、要求失敗、4xx/5xx、画像の読み込み失敗、console error、page errorを確認します。これは実機のSafariやiPadの確認の代わりではありません。

## 証拠の境界

監査レポートは、容量、参照、依存権利、CI実行対象の確認記録です。iPhone 17 Pro、iPhone 11 Pro、iPad Pro 2018、PCでの画面、入力、音、振動、読み込み体感、性能は、P8公開候補確認票へ別に記録します。実ゲーム画面の画像3枚以上、15〜30秒の紹介映像、公開直前の依存ライセンス確認、ユーザーの公開承認も別に必要です。
