# 学会ポケット Web版

ビルドステップなしの vanilla JS PWA。GitHub Pages で静的配信する。

- `index.html` / `manifest.webmanifest` / `sw.js` … アプリシェル
- `assets/js/*.js` … 各ページ・機能のモジュール(ES modules)
- カタログJSON(`../catalog/index.json` 等)は同一オリジンの親ディレクトリから fetch する

## Service Worker のキャッシュバージョン

`sw.js` 冒頭の `VERSION` 定数がキャッシュ名(`gp-shell-<VERSION>` / `gp-catalog-<VERSION>`)を決めている。

**HTML/CSS/JS などアプリシェルの内容を変更したら、必ず `VERSION` を上げること。**
上げないと、cache-first で配っている古いシェルがユーザーの端末に残り続けてしまう。

`activate` イベントで旧バージョンの `gp-shell-*` / `gp-catalog-*` キャッシュは自動的に削除される。
