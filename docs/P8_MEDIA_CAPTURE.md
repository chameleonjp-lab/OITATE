# P8実ゲーム画面の撮影手順

この手順は、候補ページへ掲載する3枚の実ゲーム画面を、同じ条件で再生成するためのものです。ここで取得する画像は、Chromiumの開発実行画面です。iPhone、iPad、PCの実機スクリーンショットや、実機の表示・性能・入力確認の代わりにはしません。

## 撮影条件

- コマンド：`npm run capture:p8-media`
- 実行環境：Vite開発サーバー、Playwright、Chromium
- URL：`?p7=1&p7-e2e=1`
- 表示領域：1280×720、表示倍率1
- 出力先：`artifacts/p8-gameplay-media/`
- 画像：PNG、1枚2MiB以下、3枚合計6MiB以下

開発用の`p7-e2e`入口は、通常の本番入口へ公開しません。撮影用の準備処理も、既存のP7/P5シミュレーション、UI、Three.js描画を使います。撮影専用の画像合成や偽の画面は使いません。

## 3場面

| ファイル | 面 | 準備する状態 | 自動確認 |
|---|---|---|---|
| `gameplay-position.png` | 1 接近圧力 | 臆病種が接近に反応して逃走中 | 臆病種の`fleeing` |
| `gameplay-signal.png` | 2 誘導音と経路 | 追従種が誘導音を受け、橋の経路を使う状態 | 追従種の`following`、`animalStartedFollowing` |
| `gameplay-danger.png` | 3 危険管理 | 危険種が保護対象を狙い、攻撃前の予告中 | 危険種の`aim`、`predatorAimStarted` |

## 出力と証跡

撮影テストは、各PNGの寸法、空画像でないこと、ファイル容量を確認します。完了すると、同じディレクトリへ次を出力します。

- `metadata.json`：撮影条件、source head SHA、tested merge SHA、各場面の状態、寸法、容量、画面の簡易検査値
- `report.md`：人が確認しやすい一覧

GitHub Actionsでは、これらを`p8-gameplay-media` artifactへ保存します。artifactは再生成の証拠であり、候補ページが参照する配信素材ではありません。候補ページへコミットしたPNGを配信正本として扱います。

## 実機確認との境界

この手順が完了しても、次は完了しません。

- iPhone 17 Pro、iPhone 11 Pro、iPad Pro 2018、PCでの表示・性能・入力確認
- 目標端末で撮影した実機スクリーンショット3枚以上
- P4〜P7の手動受入、初見テスト
- 15〜30秒の紹介映像
- 公開直前の推移依存を含むライセンス確認
- GitHub Pagesの一般公開、検索掲載、一般共有
