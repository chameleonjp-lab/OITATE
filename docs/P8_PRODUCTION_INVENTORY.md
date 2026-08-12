# P8公開候補版 制作物・権利台帳

## 現在の制作物

| パス | 内容 | 権利・状態 |
|---|---|---|
| `public/candidate.html` | 公開候補ページの本文 | 本リポジトリで作成。外部素材なし |
| `public/candidate.css` | 公開候補ページの表示 | 本リポジトリで作成。外部CSSなし |
| `public/media/*.svg` | ゲームの中心を説明する構図イメージ | 本リポジトリで作成。実機スクリーンショットではない |
| `src/*` | ゲーム本体 | 既存コード。P8-Aでは挙動を変更しない |

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
- [ ] 実機スクリーンショット3枚以上へ差し替える
- [ ] 15〜30秒の紹介映像を作成する
- [ ] 目標端末で容量・性能・読み込みを測る
- [ ] 公開直前の固定版と台帳を照合する

候補ページと自作SVGは、外部サーバーから画像やフォントを取得しない。Herdy Gerdyの名称、画像、ロゴは使用していない。

