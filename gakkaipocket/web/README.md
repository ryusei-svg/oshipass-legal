# 学会ポケット Web版

ビルドステップなしの vanilla JS PWA。GitHub Pages で静的配信する。

- `index.html` / `manifest.webmanifest` / `sw.js` … アプリシェル
- `assets/js/*.js` … 各ページ・機能のモジュール(ES modules)
- カタログJSON(`../catalog/index.json` 等)は同一オリジンの親ディレクトリから fetch する
- メモ機能(♡☆マークとは別に自由記述できるメモ)は localStorage キー `gp:notes:v1` に保存する(`assets/js/notes.js`)

## 当日ビュー(`assets/js/mytaite.js`)

- ナビ上のラベルは「当日」、ハッシュは `#/today` が正。旧ハッシュ `#/mytaite` は `#/today` へ後方互換リダイレクトする(履歴を積まないため「戻る」がループしない)。
- 開催日当日は現在時刻(日本時間)を軸に「いま」「NEXT」バッジ・終了済み項目の控えめ表示・自動スクロールを行う。開催前後は従来どおり日別の一覧を表示する。
- **動作確認用**: URLクエリ `?now=2026-10-08T13:45` を付けると、その時刻を日本時間(+09:00)とみなして現在時刻として扱う(`assets/js/util.js` の `resolveNow()`)。本番では指定しないため、常に実際の現在時刻が使われる。例: `index.html?now=2026-10-08T13:45#/today`

## Service Worker のキャッシュバージョン

`sw.js` 冒頭の `VERSION` 定数がキャッシュ名(`gp-shell-<VERSION>` / `gp-catalog-<VERSION>`)を決めている。

**HTML/CSS/JS などアプリシェルの内容を変更したら、必ず `VERSION` を上げること。**
上げないと、cache-first で配っている古いシェルがユーザーの端末に残り続けてしまう。

`activate` イベントで旧バージョンの `gp-shell-*` / `gp-catalog-*` キャッシュは自動的に削除される。
