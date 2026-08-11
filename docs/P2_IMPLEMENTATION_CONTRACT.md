# P2 面白さ試作 実装契約

- 文書版：1.0
- 対象仕様：`docs/P2_FORMAL_SPEC.md`
- 基準実装：`src/game/p2-cowardly-simulation.ts`
- 状態：P2基準実装に対する追跡契約

## 1. 実装対応表

| 契約 | 実装・検査 |
|---|---|
| 3体の初期状態と安定ID | `createP2Simulation()`、`coward-1`〜`coward-3` |
| 圧力帯と予備反応 | `getPressureBand()`、`stepP2Simulation()` |
| 入口予約 | `penReservedAnimalId`と入口候補の再調停 |
| 全身収容 | `isFullBodyInsidePen()`と0.35秒の保持 |
| 柵・入口の身体半径 | `constrainCircleAgainstPenRails()` |
| P1 60Hz / P2 20Hz接続 | `src/main.ts`の固定更新と判断蓄積 |
| 再挑戦 | P2完了オーバーレイのretryハンドラ |
| 自動回帰 | `src/game/p2-cowardly-simulation.test.ts`、P1/P2 E2E回帰 |

## 2. 不変条件

- `captured`は以後の圧力、移動、入口予約、動物間間隔処理から除外する。
- 同一判断更新で入口予約を持つ動物は一体以下である。
- 入口が閉じた状態で、動物の中心だけが開口をすり抜ける結果を作らない。
- 動物間の最低距離を、同一点や非有限値で満たしたことにしない。
- `deltaSeconds <= 0`、非有限の時間差、非有限の入力では状態を進めない。
- 合図入力はP1回帰確認用であり、P2動物の状態を変更しない。
- 開発用E2Eフックは本番ビルドへ公開しない。

## 3. 受入証拠

P2の自動検査証拠は、型検査、単体テスト、ビルド、ブラウザ回帰の結果をDraft PRへ記録する。初見プレイ、iPhone実機、公開前の主要ブラウザ確認は別証拠であり、未実施のまま合格扱いにしない。

## 4. 変更履歴

| 版 | 内容 |
|---|---|
| 1.0 | P2基準実装の正式仕様と実装対応を固定 |
