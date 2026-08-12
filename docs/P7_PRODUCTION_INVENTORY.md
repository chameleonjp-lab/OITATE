# P7制作物・権利確認台帳

## 目的

P7の主要な制作物と、公開前に確認する権利情報の境界を記録する。これはP7の手動受入や1.0公開を完了扱いにする文書ではない。

## 現在の制作物

| 区分 | 現在の実体 | P7時点の確認 |
|---|---|---|
| 画面・動物・地形 | src/main.ts のThree.jsによる手続き的な形状と、src/styles.css の画面表現 | 外部画像・3Dモデル・動画ファイルは使っていない |
| 音 | Web Audio APIで生成する短い音 | 音声ファイルは使っていない |
| 振動 | navigator.vibrate による端末機能 | 素材ファイルは使っていない |
| 文字・記号 | システムフォントと画面内テキスト | フォントファイル・外部アイコンは同梱していない |

## 直接依存のライセンス

package.jsonの固定バージョンについて、npmレジストリのパッケージ情報から直接依存を記録する。推移依存はこの表の対象外であり、P8で生成物を確認する。

| パッケージ | 固定版 | ライセンス | 公式情報 |
|---|---:|---|---|
| three | 0.185.1 | MIT | https://github.com/mrdoob/three.js |
| @playwright/test | 1.62.1 | Apache-2.0 | https://github.com/microsoft/playwright |
| @types/node | 24.13.3 | MIT | https://github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/node |
| @types/three | 0.185.1 | MIT | https://github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/three |
| typescript | 7.0.2 | Apache-2.0 | https://github.com/microsoft/TypeScript |
| vite | 8.2.1 | MIT | https://github.com/vitejs/vite |
| vitest | 4.1.10 | MIT | https://github.com/vitest-dev/vitest |

## P8へ引き継ぐ確認

- [ ] 推移依存を含むライセンス一覧を生成し、公開物へ保存する
- [ ] GitHub Pagesの公開ページへ権利表示と使用OSS一覧を掲載する
- [ ] 公開画像・短い映像を追加する場合、その制作元と利用条件を記録する
- [ ] 公開前に、現在の固定版と台帳の版が一致することを再確認する
- [ ] 既知問題、対応端末、補助設定、横画面を公開説明へ反映する

## 判定

この台帳は、P7の実装範囲に外部メディアがないことと、直接依存の確認範囲を明示する。P7の初見・実機受入、推移依存の完全な確認、公開ページの権利表示が終わるまで、1.0公開可能とは判定しない。
