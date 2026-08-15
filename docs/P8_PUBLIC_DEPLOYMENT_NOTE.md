# Pages公開方式の移行メモ

現在のGitHub Pagesは`main`ブランチのルートを直接配信するlegacy方式である。

本変更をマージ後、GitHub PagesのSourceを`GitHub Actions`へ変更し、`Deploy GitHub Pages` workflowから`dist`を配信する。
