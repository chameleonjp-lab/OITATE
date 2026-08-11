# P3 最初に遊べる版 実装契約

- 文書版：1.0
- 対象仕様：`docs/P3_FORMAL_SPEC.md`
- 基準実装：`src/game/p3-cowardly-simulation.ts`

## 1. 実装対応表

| 契約 | 実装・検査 |
|---|---|
| 六体の初期群れ | `createP3Simulation()`、`P3_TUNING.animalCount` |
| 群れの中心・spread・分裂遅延 | `updateFlockMetrics()` |
| 緊張とヒステリシス | `updateTension()` |
| 混乱中の安全規則 | `desiredFleeDirection()`と柵・間隔処理 |
| 入口の一体予約 | `reconcileEntrance()`、`penReservedAnimalId` |
| 待機・後退・復帰 | `updateWaiting()`、`updateBackingOff()`、進展監視 |
| 収容確定 | `updateEntering()`と0.35秒保持 |
| P1との接続 | `src/main.ts`の60Hz入力・20Hz P3判断分離 |
| 開発E2E | `?p3-e2e=1`（旧`?p2-e2e=1`も回帰互換） |
| 自動検査 | `src/game/p3-cowardly-simulation.test.ts`と既存E2E回帰 |

## 2. 不変条件

- `captured`は外部の圧力、群れ、間隔、入口予約から除外し、囲い内に表示だけ残す。
- `penReservedAnimalId`は存在する個体または`null`であり、同時に複数の`enteringPen`を作らない。
- 後続が予約済み入口の喉へ入った場合、入口外へ戻して待機させる。
- 待機、後退、進入のタイマーは有限値で、上限を超えた個体は復帰経路を持つ。
- 全ての個体位置は世界境界内かつ柵の衝突処理後に有限である。
- 動物間の最低距離を、同一点やNaNで満たしたことにしない。
- `deltaSeconds <= 0`または非有限の時間差は状態を進めない。
- P1の合図入力はP3の動物状態へ影響しない。
- P3のE2Eフックは開発モードだけで利用でき、本番環境へ公開しない。

## 3. 画面とAPIの互換境界

画面の表示と正式な開発APIはP3を示す。既存P2回帰を壊さないため、DOMの`p2-*`セレクター、`window.__OITATE_P2__`、P1公開状態の`p2`キーは互換別名として残す。新しい検査や実装は`window.__OITATE_P3__`とP3の仕様を基準にする。

## 4. 受入証拠と未確認事項

Draft PRへ、型検査、63件の単体テスト、ビルド、E2E実行結果を記録する。P3の初見プレイ、5回再現性、20回中の詰まり率、混乱原因の説明、P1 iPhone実機、P2初見プレイは自動検査と別であり、未実施のまま合格扱いにしない。

## 5. 変更履歴

| 版 | 内容 |
|---|---|
| 1.0 | P3の初回実装範囲、境界、不変条件を固定 |
