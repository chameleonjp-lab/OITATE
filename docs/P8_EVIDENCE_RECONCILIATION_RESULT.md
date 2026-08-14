# P8-E 証跡再照合結果

## 判定

P8-Dの自動証拠について、文書上の識別子と公開候補版の記録を再照合した。確認できた範囲では、source headとtested merge SHAの混同、候補ページ容量・依存ライセンス結果の食い違い、実機未確認事項の隠れた合格扱いは見つからなかった。

**P8-E判定: PASS（自動証拠の文書再照合のみ）**

このPASSは、実機確認、手動受入、初見確認、紹介動画、公開品質、公開可否を合格にしない。

## 再照合した値

| 項目 | 記録 |
|---|---|
| P8-D PR | #22 |
| merge前最終CI | run #89 |
| workflow run ID | `31691934450` |
| source head | `92f4b74dad427be01027ab490db74aaf607d4492` |
| tested merge SHA | `949bd8ec7b1a23a221b4d39902a2317adda94078` |
| candidate gzip | 353,069 bytes |
| 依存パッケージ | 61 |
| UNKNOWNライセンス | 0 |
| 実ゲーム画面 | 面1・面2・面3のPNG 3枚、各1280×720として記録 |

README、`P8_PLAYTEST.md`、`P8_PRODUCTION_INVENTORY.md`、`P8_POST_MERGE_PLAN.md`で、上記SHAと未確認事項の境界が同じ意味で記録されていることを確認した。

## 未完了

- P4〜P7の手動受入
- 初見プレイ確認
- iPhone 17 Pro、iPhone 11 Pro、iPad Pro 2018、PCでの実機・実環境確認
- 実機スクリーンショット
- 15〜30秒の紹介映像
- 公開直前の固定版と権利台帳の照合
- 公開前の独立レビュー
- public公開のユーザー承認

## 次工程

P8-Fとして、P4〜P7のmanual / first-view / device確認を一つの確認票へ統合する。未実施項目は未実施のまま記録し、自動テスト成功で代替しない。
