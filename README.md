# OITATE

動物の種類ごとの性質を読み取り、主人公の立ち位置と合図を使って、群れを適切な囲いへ導く3Dアクションパズルゲームの開発リポジトリです。

## 計画・仕様文書

企画から公開まで、分野ごとに次の文書を正式な参照先とします。

| 分野 | 正式な文書 |
|---|---|
| 担当モデル、引き継ぎ、承認、公開前レビュー | [標準実装組織](docs/IMPLEMENTATION_ORGANIZATION.md) |
| 実装上の禁止事項、入力、時間、得点、衝突 | [実装契約](docs/IMPLEMENTATION_CONTRACT.md) |
| 制作範囲、優先順位、節目、公開判断 | [プロデューサー統括計画](docs/PRODUCER_MASTER_PLAN.md) |
| 動物、危険種、群れ、囲いの状態 | [状態遷移仕様](docs/STATE_TRANSITION_SPEC.md) |
| ゲーム性、操作感、演出、得点の意図 | [ゲームデザイン詳細計画書](docs/GAME_DESIGN_MASTER_PLAN.md) |
| 技術選定、構成、性能、基本実装順 | [実装計画書](docs/IMPLEMENTATION_PLAN.md) |

節目ごとの固定値と実装対応は、[P2正式仕様](docs/P2_FORMAL_SPEC.md) / [P2実装契約](docs/P2_IMPLEMENTATION_CONTRACT.md)、[P3正式仕様](docs/P3_FORMAL_SPEC.md) / [P3実装契約](docs/P3_IMPLEMENTATION_CONTRACT.md)、[P4正式仕様](docs/P4_FORMAL_SPEC.md) / [P4実装契約](docs/P4_IMPLEMENTATION_CONTRACT.md)、[P5正式仕様](docs/P5_FORMAL_SPEC.md) / [P5実装契約](docs/P5_IMPLEMENTATION_CONTRACT.md)を参照します。P3の初見・再現確認票は[P3プレイテスト](docs/P3_PLAYTEST.md)、P4の危険種確認票は[P4プレイテスト](docs/P4_PLAYTEST.md)、P5の統合確認票は[P5プレイテスト](docs/P5_PLAYTEST.md)です。

同じ分野で記述が食い違った場合は、表に示した正式な文書を優先します。標準実装組織は担当、承認操作、進行手続を定め、ゲーム仕様は上書きしません。プロデューサー統括計画は、現在の「最小版」を縦切り完成版として整理し、面白さを確認する小さな試作、制作を止める条件、1.0の上限、公開品質と公開可否の判断基準を定めています。

標準実装組織はOITATEで必須とし、今後のブラウザゲーム開発でも初期設定として再利用します。AIが実際に作業するときの入口は、リポジトリ直下の`AGENTS.md`です。

## 現在の状態

プロデューサー統括計画のP5「縦切り統合版」の実装候補へ進みました。`?p5=1`で、臆病種6体、追従種4体、危険種1体、地形差、安全・速い経路、危険種の救助、仮結果画面を確認できます。P3・P4のシミュレーションとP1の入力回帰は互換用に残し、P5は別の20Hz決定論シミュレーションへ分離します。

今回のP5範囲に正式得点、称号、完成素材、複数ステージ、Navmesh、公開は含めません。P4手動受入はユーザー承認により未確認のままP5へ進めています。P5の初見テスト、複数解の発見、P4の手動受入、P1のiPhone実機確認、P2/P3の初見プレイは未記録であり、自動検査の成功はそれらの合格を意味しません。

### 開発用コマンド

```bash
npm ci
npm run typecheck
npm test
npm run build
npm run e2e
```
