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

### 演題の占有時間(重なり判定・すきま時間の基準)

セッション(act)自体のマークは、従来どおり `act` の開始〜終了を占有時間として扱う。演題(presentation)単位のマークは、`assets/js/catalog.js` の正規化時に各演題へ付与する `estStart`〜`estEnd`(演題ごとの推定占有時間)を占有時間として扱う。

- `estStart` = `presentation.estimated_start`
- `estEnd` = 同じactの次の演題の `estimated_start`。最後の演題(または次の演題に `estimated_start` が無い)場合は `act.end`
- `estimated_start` を持たない演題(現行データには無いが、将来の他学会で有り得る)は `estStart`/`estEnd` を act の開始〜終了にフォールバックし、`estRangeFallback: true` を付与する

これにより「第3会場13:50の演題」と「第6会場14:10の演題」のように演題単位で会場をはしごする予定を、誤って競合(重なり)扱いしないようにしている。表示時刻・「推定」バッジは `presentation.estimated_start` / `estimated` のまま変更していない。

### 重なりカード(`assets/js/mytaite.js` / `assets/js/choices.js`)

♡(絶対聴く)同士が実際に時間帯として重なっている場合のみ、推移的にグループ化して1枚の「重なりカード」にまとめる(☆は対象外)。カードの候補一覧から「これに行く」を選ぶと、選ばれた候補が通常の予定行として主役表示され、他の候補は「ほかの候補」として畳まれる(消えない。選び直し・選択解除が可能)。

選択は localStorage キー `gp:choice:v1` に `{ [groupKey]: 選択したエントリのkey }` の形で保存する。`groupKey` はグループを構成するエントリkey(`act:<id>` / `pr:<id>`)をソートして連結した文字列(`assets/js/choices.js` の `buildGroupKey()`)。マーク構成が変わればグループの構成、延いては `groupKey` も変わるため、古い選択は自然に無効化される(明示的なクリーンアップは行っていない)。

## 初回ガイド(`assets/js/onboarding.js`)

Web版を初めて開いたとき、日別グリッドの読み込み後に3ステップの使い方案内をオーバーレイで表示する。「次へ」で進み、最後は「はじめる」。いつでも「スキップ」で閉じられ、閉じ方(スキップ・完了・Escape・オーバーレイクリック)を問わず localStorage キー `gp:onboarded:v1` に記録して以後は表示しない。

## Service Worker のキャッシュバージョン

`sw.js` 冒頭の `VERSION` 定数がキャッシュ名(`gp-shell-<VERSION>` / `gp-catalog-<VERSION>`)を決めている。

**HTML/CSS/JS などアプリシェルの内容を変更したら、必ず `VERSION` を上げること。**
上げないと、cache-first で配っている古いシェルがユーザーの端末に残り続けてしまう。

`activate` イベントで旧バージョンの `gp-shell-*` / `gp-catalog-*` キャッシュは自動的に削除される。

## 複数大会対応

Web版はカタログの `index.json` に載っている大会をすべて扱う(1件決め打ちではない)。**大会を追加する場合、Web側のコード変更は不要**で、以下だけでよい。

- `catalog/index.json` の `events[]` に大会のメタ情報(`id` / `name` / `dates` / `venue_names` / `timetable_status` / `path`)を追加する
- 追加した `path` の場所(例 `catalog/events/<eventId>.json`)にその大会のイベントJSONを置く

URLは大会をまたいでも壊れないよう `#/e/<eventId>/day/<n>`・`#/e/<eventId>/search`・`#/e/<eventId>/today`・`#/e/<eventId>/session/<actId>` の形式で大会IDを含む。大会一覧(選択画面)は `#/events`。旧形式(`#/day/1` 等、大会IDを含まないURL)は選択中の大会へ自動的に読み替える。

localStorage の `gp:event:v1` は「現在選択中の大会ID」を保持する。ルート(`#/` や空ハッシュ)を開いたとき、この値があればその大会を直接開き、無ければ大会が1件だけならその大会を、2件以上あれば `#/events`(大会一覧)を表示する。
