# P8-E 公開前証跡再照合ゲート

## 目的
P8-DとPR #23のマージ後に、公開前の証拠を同じ版・同じ識別子で再照合する。自動CIの成功を、実機確認・手動受入・初見確認・動画・公開品質・公開承認へ拡張しない。

この工程ではゲーム挙動、入力、描画、状態遷移、得点、保存形式、公開入口を変更しない。

## 固定する自動証拠
- P8-D: PR #22マージ済み
- merge前最終CI: run #89 / workflow run ID `31691934450`
- source head: `92f4b74dad427be01027ab490db74aaf607d4492`
- tested merge SHA: `949bd8ec7b1a23a221b4d39902a2317adda94078`
- candidate gzip: 353,069 bytes
- 依存パッケージ: 61
- UNKNOWNライセンス: 0

これらは自動証拠であり、実機・手動・初見・動画・公開承認の完了を意味しない。

## 再照合対象
1. 候補ページが参照する実ゲームPNG 3枚
2. CI artifact `p8-gameplay-media` の3枚とmetadata/report
3. CI artifact `p8-public-audit` の入口・容量・依存ライセンス結果
4. source headとtested merge SHA
5. README、`P8_PLAYTEST.md`、`P8_PRODUCTION_INVENTORY.md`の記録

## 受入条件
- 配信正本3枚と`p8-gameplay-media`の面・状態・寸法・容量を再照合して記録する。
- `p8-public-audit`のcandidate gzip、依存数、UNKNOWN数をrun #89へ結び付けて確認する。
- source headとtested merge SHAを別の値として追跡できる。
- README、P8確認票、制作物・権利台帳で、実機・手動・初見・動画・公開承認が未完了のまま維持される。
- 差異があれば黙って合格にせず、差異と根拠を記録して重大判断へ回す。
- この工程の完了をpublic公開の承認として扱わない。

## 後続順序
1. P8-E: 本書の証跡再照合
2. P8-F: P4〜P7 manual / first-view / device確認の記録
3. P8-G: target device evidence（指定端末、実機スクリーンショット、性能・入力）
4. P8-H: 15〜30秒動画と公開直前の権利・固定版照合
5. P8-I: 公開前の独立レビュー
6. ユーザー判断: public公開など必要な操作を個別に確認

## 対象外
- ゲームコードの変更
- P4〜P7の仕様変更
- 既存画像の作り直し
- 紹介動画の作成
- 実機確認の代行
- GitHub Pages等へのpublic公開

## 担当
標準実装組織に従う。日常の確認・記録はLuna・Max、矛盾・証拠不一致・重大判断はSol・Extra High、公開前の最終レビューは実装へ参加していない別のSol・Highとする。作品の最終責任と公開判断はユーザー本人が持つ。
