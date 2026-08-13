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

節目ごとの固定値と実装対応は、[P2正式仕様](docs/P2_FORMAL_SPEC.md) / [P2実装契約](docs/P2_IMPLEMENTATION_CONTRACT.md)、[P3正式仕様](docs/P3_FORMAL_SPEC.md) / [P3実装契約](docs/P3_IMPLEMENTATION_CONTRACT.md)、[P4正式仕様](docs/P4_FORMAL_SPEC.md) / [P4実装契約](docs/P4_IMPLEMENTATION_CONTRACT.md)、[P5正式仕様](docs/P5_FORMAL_SPEC.md) / [P5実装契約](docs/P5_IMPLEMENTATION_CONTRACT.md)、[P6正式仕様](docs/P6_FORMAL_SPEC.md) / [P6実装契約](docs/P6_IMPLEMENTATION_CONTRACT.md)を参照します。P3の初見・再現確認票は[P3プレイテスト](docs/P3_PLAYTEST.md)、P4の危険種確認票は[P4プレイテスト](docs/P4_PLAYTEST.md)、P5の統合確認票は[P5プレイテスト](docs/P5_PLAYTEST.md)、P6の完成版確認票は[P6プレイテスト](docs/P6_PLAYTEST.md)です。

同じ分野で記述が食い違った場合は、表に示した正式な文書を優先します。標準実装組織は担当、承認操作、進行手続を定め、ゲーム仕様は上書きしません。プロデューサー統括計画は、現在の「最小版」を縦切り完成版として整理し、面白さを確認する小さな試作、制作を止める条件、1.0の上限、公開品質と公開可否の判断基準を定めています。

標準実装組織はOITATEで必須とし、今後のブラウザゲーム開発でも初期設定として再利用します。AIが実際に作業するときの入口は、リポジトリ直下の`AGENTS.md`です。

## 現在の状態

P7「1.0内容完成」の6面進行・記録保存・面別条件、P8-A「公開候補ページの基盤」、P8-B「公開前測定基盤」、P8-C「公開前証跡基盤」は`main`へマージ済みです。現在はP8-C監査補正のDraft PRを確認しています。`public/candidate.html`（配信時は`candidate.html`）で、ゲームの目的、遊び方、対応端末、補助設定、権利表示、既知の注意を確認できます。ゲーム本体は`?p7=1`で起動します。

P4〜P7の手動受入、初見テスト、実機・性能確認は未確認のままです。候補ページの画像は現在、制作途中の構図イメージであり、実機スクリーンショットと15〜30秒の紹介映像は公開前に追加確認します。GitHub Pagesへの公開、検索掲載、一般共有は、公開品質条件とユーザーの明示承認が揃うまで行いません。

### 開発用コマンド

```bash
npm ci
npm run typecheck
npm test
npm run build
npm run e2e
npm run e2e:preview
```

### P8公開候補版の確認

- [P8正式仕様](docs/P8_FORMAL_SPEC.md)
- [P8実装契約](docs/P8_IMPLEMENTATION_CONTRACT.md)
- [P8公開候補確認票](docs/P8_PLAYTEST.md)
- [P8制作物・権利台帳](docs/P8_PRODUCTION_INVENTORY.md)
- [P8開発時診断の使い方](docs/P8_DIAGNOSTICS.md)
- [P8公開前監査の使い方](docs/P8_PUBLIC_AUDIT.md)
- [公開候補ページ](public/candidate.html)
