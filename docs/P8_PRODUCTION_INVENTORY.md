# P8公開候補版 制作物・権利台帳

## 現在の制作物

| パス | 内容 | 権利・状態 |
|---|---|---|
| `public/candidate.html` | 公開候補ページの本文 | 本リポジトリで作成。外部素材なし |
| `public/candidate.css` | 公開候補ページの表示 | 本リポジトリで作成。外部CSSなし |
| `public/media/key-visual.svg` | ヒーローで使うゲームの中心の構図イメージ | 本リポジトリで作成。実ゲーム画面・実機スクリーンショットではない |
| `public/media/scene-*.svg` | 旧構図イメージ。現在の候補ページでは未参照 | 本リポジトリで作成。削除せず、実ゲームPNGと混同しないよう管理 |
| `public/media/gameplay-position.png` | 面1「接近圧力」の実ゲーム画面 | P7実レンダラーをChromium/Playwrightで取得。外部素材なし。1280×720、開発画面であり実機スクリーンショットではない |
| `public/media/gameplay-signal.png` | 面2「誘導音と経路」の実ゲーム画面 | P7実レンダラーをChromium/Playwrightで取得。外部素材なし。1280×720、開発画面であり実機スクリーンショットではない |
| `public/media/gameplay-danger.png` | 面3「危険管理」の実ゲーム画面 | P7実レンダラーをChromium/Playwrightで取得。外部素材なし。1280×720、開発画面であり実機スクリーンショットではない |
| `docs/P8_MEDIA_CAPTURE.md` | 3場面の再現・検査手順 | 本リポジトリで作成。撮影条件、状態、CI artifact、実機確認との境界を記録 |
| `src/*` | ゲーム本体 | 既存コード。P8-Aでは挙動を変更しない |
| `src/quality/p8-diagnostics.ts` | 開発時の性能・状態遷移の一時記録 | 本リポジトリで作成。外部送信なし |
| `scripts/audit-public-build.mjs` | 公開ビルド・依存ライセンスのCI監査 | Node.js標準機能で作成。外部送信なし |
| `scripts/audit-public-build.test.mjs` | 監査処理の単体試験 | 本リポジトリで作成 |

## 直接依存

| パッケージ | 固定版 | ライセンス | 公式情報 |
|---|---:|---|---|
| three | 0.185.1 | MIT | https://github.com/mrdoob/three.js |
| @playwright/test | 1.62.1 | Apache-2.0 | https://github.com/microsoft/playwright |
| @types/node | 24.13.3 | MIT | https://github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/node |
| @types/three | 0.185.1 | MIT | https://github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/three |
| typescript | 7.0.2 | Apache-2.0 | https://github.com/microsoft/TypeScript |
| vite | 8.2.1 | MIT | https://github.com/vitejs/vite |
| vitest | 4.1.10 | MIT | https://github.com/vitest-dev/vitest |

## 未確認・後続作業

- [ ] 推移依存を含むライセンス一覧を生成する
- [ ] 目標端末の実機スクリーンショット3枚以上を別証跡として取得する
- [ ] 15〜30秒の紹介映像を作成する
- [ ] 目標端末で容量・性能・読み込みを測る
- [ ] 公開直前の固定版と台帳を照合する
- [ ] P8-B診断JSONの記録方式を公開前の確認票へ反映する
- [ ] P8-C監査artifactの容量・入口・ライセンス結果を確認する

候補ページと自作SVGは、外部サーバーから画像やフォントを取得しない。Herdy Gerdyの名称、画像、ロゴは使用していない。
