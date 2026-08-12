# P8公開前監査の使い方

P8-Cの監査は、公開候補版の技術情報をCIで同じ手順から再生成するための開発用機能です。実機確認、プレイテスト、画像、動画、公開判定を自動で済ませる機能ではありません。

## 実行

依存関係を入れた後、本番ビルドと監査を実行します。

```bash
npm ci
npm run typecheck
npm test
npm run test:audit
npm run build
npm run audit:public
```

監査結果は次へ出ます。

- `artifacts/p8-public-audit/report.json`
- `artifacts/p8-public-audit/report.md`

このディレクトリはリポジトリへコミットしません。GitHub Actionsでは、同じ結果を`p8-public-audit`というartifactへ保存します。

## 確認内容

- `index.html`と`candidate.html`から静的に到達できるファイル。
- 公開ビルド全体の展開後容量とgzip換算容量。
- HTML、CSS、JavaScriptから参照されるローカルファイルの欠落。
- 実際にインストールされた直接依存・開発依存・推移依存のパッケージ名、版、ライセンス。

gzip換算容量が15MiBを超える、入口がない、ローカル参照が欠ける、ライセンス情報が不明な場合は監査を失敗にします。

## 証拠の境界

監査レポートは、容量と権利情報の確認記録です。iPhone 17 Pro、iPhone 11 Pro、iPad Pro 2018、PCでの画面、入力、音、振動、読み込み体感、性能は、P8公開候補確認票へ別に記録します。実ゲーム画面の画像3枚以上、15〜30秒の紹介映像、公開直前の依存ライセンス確認、ユーザーの公開承認も別に必要です。
