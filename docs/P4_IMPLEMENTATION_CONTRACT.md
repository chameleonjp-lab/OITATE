# P4 危険検証版 実装契約

- 文書版：1.0
- 対象仕様：`docs/P4_FORMAL_SPEC.md`
- 基準実装：`src/game/p4-danger-simulation.ts`
- 開発画面：`?p4=1`

## 1. 実装対応表

| 契約 | 実装・検査 |
|---|---|
| 危険種の攻撃段階 | `P4PredatorState.attackPhase`、`stepP4Simulation()` |
| 主人公追跡 | `threatSeconds`、`intent = chasePlayer` |
| 攻撃対象の有効条件 | `canSeeVictim()`、`canAttackVictim()` |
| 狙いの予告と中断 | `aimSeconds`、威嚇音の固定更新処理 |
| 飛びかかり | `lungeSeconds`、接触判定 |
| 救助待ち | `P4VictimState.lifeState`、`rescueSeconds` |
| 救助成功・失敗 | `rescueOverrideUsed`、`failureReason` |
| 専用囲い | `P4_TUNING.pen`、内部保持と主人公の外側判定 |
| 開発E2E | `?p4=1&p4-e2e=1`の`window.__OITATE_P4__.e2e` |
| 自動検査 | `src/game/p4-danger-simulation.test.ts`とP4 E2E |

## 2. 不変条件

- `captured`、`rescuePending`、`failureLocked`の対象は、通常の攻撃対象として選ばない。
- `aim`は1.2秒未満で`lunge`へ進まない。
- `aim`中に有効な威嚇音を受けたら、同じ固定更新で`lunge`を開始しない。
- `lunge`開始後は威嚇音で攻撃を取り消さない。
- 壁越し、経路なし、収容済み、救助保護中の対象へ攻撃を成立させない。
- `rescuePending`は3秒を超えて`active`のまま残らない。
- 救助成功は同じ救助出来事で一度だけ成立する。
- 救助後の保護時間中に再攻撃を成立させない。
- 危険種の全身が囲い内へ入り、主人公が外へ出た後は同じ更新で門を閉じ、危険種を`disabled`へ移す。
- `deltaSeconds <= 0`、非有限の時間差、非有限の入力では状態を進めない。
- すべての位置、時間、状態の数値は有限値である。
- 失敗確定後は、再挑戦以外のシミュレーション状態を進めない。

## 3. 画面とAPIの境界

P4画面では、攻撃段階、警告、威嚇音、救助待ち、結果を画面内で確認できる。開発用のE2Eフックは`import.meta.env.DEV`かつ`p4-e2e=1`のときだけ公開する。

P3の`window.__OITATE_P3__`、`window.__OITATE_P2__`、既存のP1入力回帰は残す。P4はそれらの状態を直接書き換えず、別の`P4SimulationState`を使う。

## 4. 受入証拠と未確認事項

Draft PRへ、型検査、既存63件を含む単体テスト、ビルド、P4 E2E結果を記録する。P4の初見テスト、5回連続手動収容、救助理由の説明、P3手動受入、P1 iPhone実機確認は自動検査と別であり、未実施のまま合格扱いにしない。

## 5. 変更履歴

| 版 | 内容 |
|---|---|
| 1.0 | P4の危険種単体、威嚇音、救助、専用囲いの範囲を固定 |
