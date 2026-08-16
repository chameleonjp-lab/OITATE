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
| 1.0完成までの現在差分 | [1.0完成ギャップ台帳](docs/ONE_ZERO_COMPLETION_GAP_LEDGER.md) |

節目ごとの固定値と実装対応は、[P2正式仕様](docs/P2_FORMAL_SPEC.md) / [P2実装契約](docs/P2_IMPLEMENTATION_CONTRACT.md)、[P3正式仕様](docs/P3_FORMAL_SPEC.md) / [P3実装契約](docs/P3_IMPLEMENTATION_CONTRACT.md)、[P4正式仕様](docs/P4_FORMAL_SPEC.md) / [P4実装契約](docs/P4_IMPLEMENTATION_CONTRACT.md)、[P5正式仕様](docs/P5_FORMAL_SPEC.md) / [P5実装契約](docs/P5_IMPLEMENTATION_CONTRACT.md)、[P6正式仕様](docs/P6_FORMAL_SPEC.md) / [P6実装契約](docs/P6_IMPLEMENTATION_CONTRACT.md)を参照します。P3の初見・再現確認票は[P3プレイテスト](docs/P3_PLAYTEST.md)、P4の危険種確認票は[P4プレイテスト](docs/P4_PLAYTEST.md)、P5の統合確認票は[P5プレイテスト](docs/P5_PLAYTEST.md)、P6の完成版確認票は[P6プレイテスト](docs/P6_PLAYTEST.md)です。

同じ分野で記述が食い違った場合は、表に示した正式な文書を優先します。標準実装組織は担当、承認操作、進行手続を定め、ゲーム仕様は上書きしません。プロデューサー統括計画は、現在の「最小版」を縦切り完成版として整理し、面白さを確認する小さな試作、制作を止める条件、1.0の上限、公開品質と公開可否の判断基準を定めています。

標準実装組織はOITATEで必須とし、今後のブラウザゲーム開発でも初期設定として再利用します。AIが実際に作業するときの入口は、リポジトリ直下の`AGENTS.md`です。

## 現在の状態

P7「1.0内容完成」のゲーム機能、P8の公開候補基盤、GitHub Pages公開、Chromium/WebKit自動確認まで`main`へマージ済みです。公開URLは `https://chameleonjp-lab.github.io/oitate/` です。

最新の確認基準はPR #32マージ後の`main`です。PR #30〜#32では、Safari空白表示対策、WebKit CI、カメラ旋回時の進行方向ずれ、収容後の羊の高速振動、羊の停止・ワールド端回避判定を修正し、回帰試験を追加しています。

ゲーム本体は練習＋6面、3種類の動物、接近圧力・誘導音・威嚇音、危険種・救助、4項目得点、結果・記録・保存まで実装済みです。ただし、当初計画で進行条件としていたP1〜P7の人手受入、初見理解、再挑戦・改善、対象端末の実機性能は十分に記録されていません。自動CIの成功をこれらの証拠へ読み替えません。

現在は[1.0完成ギャップ台帳](docs/ONE_ZERO_COMPLETION_GAP_LEDGER.md)を基準に、P1〜P7の未確認条件を現在の統合版でまとめて確認し、その後P8-G対象端末証拠、P8-H紹介動画・最終権利照合、P8-I最終独立レビューへ進みます。

GitHub Pagesはpublic公開済みですが、これは当初計画上の「1.0完成判定」が完了したことを意味しません。公開後に実機で見つかった不具合も、可能な限り自動回帰試験へ固定します。

### 開発用コマンド

```bash
npm ci
npm run typecheck
npm test
npm run build
npm run e2e
npm run e2e:preview
npm run capture:p8-media
```

### P8公開候補版の確認

- [1.0完成ギャップ台帳](docs/ONE_ZERO_COMPLETION_GAP_LEDGER.md)
- [P8正式仕様](docs/P8_FORMAL_SPEC.md)
- [P8実装契約](docs/P8_IMPLEMENTATION_CONTRACT.md)
- [P8公開候補確認票](docs/P8_PLAYTEST.md)
- [P8制作物・権利台帳](docs/P8_PRODUCTION_INVENTORY.md)
- [P8開発時診断の使い方](docs/P8_DIAGNOSTICS.md)
- [P8公開前監査の使い方](docs/P8_PUBLIC_AUDIT.md)
- [P8実ゲーム画面の撮影手順](docs/P8_MEDIA_CAPTURE.md)
- [P8-Dマージ後フォローアップ計画](docs/P8_POST_MERGE_PLAN.md)
- [P8-F 手動・初見・実機確認マトリクス](docs/P8_MANUAL_ACCEPTANCE_MATRIX.md)
- [P8-F 手動受入 実行手順](docs/P8F_MANUAL_TEST_RUNBOOK.md)
- [P8-F 記録テンプレート](docs/P8F_EVIDENCE_TEMPLATE.md)
- [P8-G対象端末証拠仕様](docs/P8G_DEVICE_EVIDENCE_SPEC.md)
- [P8-H紹介動画・権利最終確認](docs/P8H_RELEASE_CHECKLIST.md)
- [公開候補ページ](public/candidate.html)
