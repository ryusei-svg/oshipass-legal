// mytaite.js — 当日ビュー(iOS版 TodayView 相当)を描画する。
// マーク済み(♡/☆)のセッション・演題(メモのみの項目も含む)を、
// 開催日当日は現在時刻を軸にした「いま/NEXT/終了」で、それ以外の期間は
// 従来どおり日別・時刻順の一覧として表示する。
// ファイル名・CSSクラス接頭辞(gp-mytaite-*)は旧称のまま維持している。
//
// 占有時間(重なり判定・すきま時間・施設間移動の注意に使う時間帯)について:
// - セッション(act)自体のマークは、従来どおり act の開始〜終了を占有時間とする。
// - 演題(presentation)のマークは、catalog.js が正規化時に付与する
//   estStart〜estEnd(演題ごとの推定占有時間。次の演題のestimated_startまで)を
//   占有時間とする。これにより「別会場・時刻がずれた演題2件」を誤って
//   競合(重なり)扱いしないようにしている。表示時刻・「推定」バッジは
//   presentation.estimated_start / estimated のまま従来どおり。

import { h, formatTime, formatDateLong, resolveNow, jstDateString, diffMinutes, bus } from "./util.js";
import { kindMeta, findLaneForAct } from "./catalog.js";
import { listMarks } from "./marks.js";
import { getNote } from "./notes.js";
import { buildMarkButton } from "./session-detail.js";
import { getChoice, setChoice, clearChoice, buildGroupKey } from "./choices.js";

const EMPTY_TEXT = "グリッドや検索で♡☆を付けると、当日の動きがここに並びます。";

// すきま時間として案内する最小の空き分数(iOS版の当日ビューと同じ基準)。
const GAP_THRESHOLD_MIN = 15;

// 現在時刻の再判定・再描画の間隔(ミリ秒)。
const REFRESH_INTERVAL_MS = 60000;

/**
 * 当日ビューを描画する。
 * @param {HTMLElement} container
 * @param {object} model - loadCatalogModel() の返り値
 * @param {{ onSelectAct: (actId: string) => void }} handlers
 * @returns {{ destroy: () => void }}
 */
export function renderMytaitePage(container, model, { onSelectAct }) {
  container.textContent = "";
  const wrap = h("div", { className: "gp-mytaite" });
  container.appendChild(wrap);

  // 「初回描画時に『いま』または『NEXT』へ自動スクロール」は文字どおり初回のみ行う。
  // 60秒ごとの再描画やmarks変更での再描画では、勝手にスクロール位置を動かさない。
  let firstBuildDone = false;

  function computeStatus() {
    const now = resolveNow();
    const today = jstDateString(now);
    const days = model.days;
    const liveDay = days.find((d) => d.activityDate === today);
    if (liveDay) return { phase: "live", now, liveDay };

    const firstDay = days[0];
    const lastDay = days[days.length - 1];
    if (firstDay && today < firstDay.activityDate) {
      return { phase: "before", now, firstDay };
    }
    return { phase: "after", now, lastDay };
  }

  function build() {
    wrap.textContent = "";
    const marks = new Map(listMarks());
    const eventId = model.event.id;
    const status = computeStatus();

    appendStatusBanner(wrap, status);

    // 開催中は「その日を自動選択して表示」するため、その日のセクションのみ描画する。
    // 開催前・開催後は従来どおり全日程ぶんのセクションを表示してよい。
    const daysToRender = status.phase === "live" ? [status.liveDay] : model.days;

    let anyRendered = false;
    let scrollTarget = null;

    for (const day of daysToRender) {
      const entries = collectEntries(day, marks, eventId);
      if (!entries.length) continue;
      anyRendered = true;

      wrap.appendChild(h("h2", { className: "gp-mytaite-day-title", text: `${day.dayNumber}日目` }));

      const isLiveDay = status.phase === "live" && day.dayNumber === status.liveDay.dayNumber;
      const liveNow = isLiveDay ? status.now : null;

      const list = h("div", { className: "gp-mytaite-list" });
      const rows = buildRowsWithGaps(entries, liveNow, onSelectAct);
      for (const row of rows) {
        list.appendChild(row.el);
        if (!scrollTarget && row.isScrollTarget) scrollTarget = row.el;
      }
      wrap.appendChild(list);
    }

    if (!anyRendered) {
      wrap.appendChild(h("p", { className: "gp-empty", text: EMPTY_TEXT }));
    }

    appendPromo(wrap);

    if (!firstBuildDone) {
      firstBuildDone = true;
      if (scrollTarget) {
        // レイアウト確定後にスクロールさせるため次フレームへ回す。
        requestAnimationFrame(() => {
          scrollTarget.scrollIntoView({ block: "center" });
        });
      }
    }
  }

  build();

  const onMarksChanged = () => build();
  bus.on("marks-changed", onMarksChanged);
  bus.on("notes-changed", onMarksChanged);
  bus.on("choice-changed", onMarksChanged);

  // 現在時刻を軸にした「いま/NEXT」表示のため、60秒ごとに再判定して再描画する。
  const intervalId = setInterval(build, REFRESH_INTERVAL_MS);

  // タブを離れて戻ってきた直後にも現在時刻を即時反映する。
  function onVisibilityChange() {
    if (document.visibilityState === "visible") build();
  }
  document.addEventListener("visibilitychange", onVisibilityChange);

  return {
    destroy() {
      bus.off("marks-changed", onMarksChanged);
      bus.off("notes-changed", onMarksChanged);
      bus.off("choice-changed", onMarksChanged);
      clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    },
  };
}

/** 開催前・開催中・開催後の状態に応じた案内文を先頭に表示する(開催中はバッジ自体が現在地を示すため案内なし)。 */
function appendStatusBanner(wrap, status) {
  if (status.phase === "before") {
    wrap.appendChild(
      h("p", {
        className: "gp-mytaite-banner",
        text: `大会は${formatDateLong(status.firstDay.activityDate)}に開幕します。`,
      })
    );
  } else if (status.phase === "after") {
    wrap.appendChild(h("p", { className: "gp-mytaite-banner", text: "大会は終了しました。" }));
  }
}

/**
 * マーク済み、またはメモがあるセッション・演題を収集する。
 * メモだけあってマーク(♡☆)が無い項目も一覧に混ぜ込む(そうしないとメモに
 * 辿り着けなくなるため)。並び順は既存どおり時刻順のまま(sortTimeでソート)。
 *
 * 占有時間(rangeStart/rangeEnd): セッションのマークは act.startDate〜endDate、
 * 演題のマークは catalog.js が付与した presentation.estStart〜estEnd(演題単位の
 * 推定占有時間)を使う。
 */
function collectEntries(day, marks, eventId) {
  const entries = [];

  for (const act of day.acts) {
    const lane = findLaneForAct(act, day);
    const venueId = lane ? lane.venue_id : null;

    const actMark = marks.get(act.id);
    const actNote = getNote(eventId, act.id, null);
    if (actMark || actNote) {
      entries.push({
        key: `act:${act.id}`,
        markTargetId: act.id,
        markKind: "session",
        markValue: actMark,
        noteText: actNote ? actNote.text : null,
        act,
        day,
        presentation: null,
        venueId,
        sortTime: act.startDate,
        rangeStart: act.startDate,
        rangeEnd: act.endDate,
      });
    }

    for (const p of act.presentations || []) {
      const pMark = marks.get(p.id);
      const pNote = getNote(eventId, act.id, p.id);
      if (!pMark && !pNote) continue;
      entries.push({
        key: `pr:${p.id}`,
        markTargetId: p.id,
        markKind: "presentation",
        markValue: pMark,
        noteText: pNote ? pNote.text : null,
        act,
        day,
        presentation: p,
        venueId,
        sortTime: p.estStart,
        displayIso: p.estimated_start || act.start,
        rangeStart: p.estStart,
        rangeEnd: p.estEnd,
      });
    }
  }

  entries.sort((a, b) => a.sortTime - b.sortTime);
  return entries;
}

/**
 * ♡(絶対聴く)同士で実際に時間が重なっているエントリを、推移的にグループ化する
 * (A-Bが重なり、B-Cが重なるならA/B/Cで1グループ)。☆・メモのみの項目は対象外。
 * 同一セッション(act)内の組み合わせ(セッション自体のマーク×自セッションの演題マーク等)は
 * 重なり扱いにしない。2件以上集まったグループのみ返す。
 * @returns {Array<Array<object>>}
 */
function computeOverlapGroups(heartEntries) {
  const parent = new Map();
  function find(k) {
    let root = k;
    while (parent.get(root) !== root) root = parent.get(root);
    return root;
  }
  function union(a, b) {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  }

  for (const e of heartEntries) parent.set(e.key, e.key);

  for (let i = 0; i < heartEntries.length; i++) {
    for (let j = i + 1; j < heartEntries.length; j++) {
      const a = heartEntries[i];
      const b = heartEntries[j];
      if (a.act.id === b.act.id) continue; // 同一セッション内は重なり扱いにしない
      if (a.rangeStart < b.rangeEnd && b.rangeStart < a.rangeEnd) {
        union(a.key, b.key);
      }
    }
  }

  const groupsByRoot = new Map();
  for (const e of heartEntries) {
    const root = find(e.key);
    if (!groupsByRoot.has(root)) groupsByRoot.set(root, []);
    groupsByRoot.get(root).push(e);
  }

  return Array.from(groupsByRoot.values()).filter((g) => g.length >= 2);
}

/**
 * entries を「単独の予定」または「重なりグループ」の item 列に組み立てる。
 * 同じグループに属するエントリは1つの item にまとめ、entries の時刻順走査で
 * 最初に現れた位置に置く(= グループ内で最も早いエントリの位置)。
 */
function buildItems(entries) {
  const hearts = entries.filter((e) => e.markValue === "heart");
  const groups = computeOverlapGroups(hearts);

  const groupInfoByKey = new Map();
  for (const group of groups) {
    const sortedGroup = group.slice().sort((a, b) => a.sortTime - b.sortTime);
    const groupKey = buildGroupKey(sortedGroup.map((e) => e.key));
    const info = { sortedGroup, groupKey };
    for (const e of group) groupInfoByKey.set(e.key, info);
  }

  const items = [];
  const emittedGroupKeys = new Set();

  for (const entry of entries) {
    const info = groupInfoByKey.get(entry.key);
    if (info) {
      if (emittedGroupKeys.has(info.groupKey)) continue;
      emittedGroupKeys.add(info.groupKey);
      const choiceKey = getChoice(info.groupKey);
      const selectedEntry = choiceKey
        ? info.sortedGroup.find((e) => e.key === choiceKey) || null
        : null;
      items.push({
        type: "group",
        groupKey: info.groupKey,
        sortedGroup: info.sortedGroup,
        selectedEntry,
      });
    } else {
      items.push({ type: "single", entry });
    }
  }

  return items;
}

/** item(単独/グループ)を代表する1エントリを返す(すきま・移動注意・バッジ計算の基準に使う)。 */
function representativeOf(item) {
  if (item.type === "single") return item.entry;
  return item.selectedEntry || item.sortedGroup[0];
}

/**
 * entries を時刻順に走査し、「いま」「NEXT」バッジと終了済み(is-done)を判定する。
 * グループ化とは独立に、フラットな entries 全体で1つの NEXT のみを割り当てる
 * (従来の単独行の判定ロジックをそのまま踏襲。重なりカードの各候補にも同じ基準で
 * バッジを付けられるようにする)。
 * @returns {Map<string, { badge: "now"|"next"|null, isDone: boolean }>}
 */
function computeBadgeInfo(entries, liveNow) {
  const map = new Map();
  if (!liveNow) {
    for (const entry of entries) map.set(entry.key, { badge: null, isDone: false });
    return map;
  }

  let nextAssigned = false;
  for (const entry of entries) {
    let badge = null;
    let isDone = false;
    if (entry.rangeEnd <= liveNow) {
      isDone = true;
    } else if (entry.rangeStart <= liveNow && liveNow < entry.rangeEnd) {
      badge = "now";
    } else if (!nextAssigned) {
      badge = "next";
      nextAssigned = true;
    }
    map.set(entry.key, { badge, isDone });
  }
  return map;
}

/**
 * entries を行要素へ組み立てる。連続する2項目の間に15分以上の空きがあれば
 * 「◯分のすきま」行を挿入し、liveNow(開催中のその日のみ非null)が渡された場合は
 * 各行に「いま」「NEXT」バッジ、終了済み項目には控えめ表示(is-done)を付与する。
 * ♡同士が実際に重なっている場合は、個別の行ではなく1枚の「重なりカード」にまとめる。
 * @returns {{ el: HTMLElement, isScrollTarget: boolean }[]}
 */
function buildRowsWithGaps(entries, liveNow, onSelectAct) {
  const badgeInfo = computeBadgeInfo(entries, liveNow);
  const items = buildItems(entries);
  const out = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const rep = representativeOf(item);

    if (i > 0) {
      const prevRep = representativeOf(items[i - 1]);
      if (prevRep.act.id !== rep.act.id) {
        const gapMin = diffMinutes(prevRep.rangeEnd, rep.rangeStart);
        if (gapMin >= GAP_THRESHOLD_MIN) {
          out.push({ el: buildGapRow(gapMin, prevRep.venueId, rep.venueId), isScrollTarget: false });
        }
      }
    }

    if (item.type === "single") {
      const info = badgeInfo.get(item.entry.key) || { badge: null, isDone: false };
      const el = buildEntryRow(item.entry, onSelectAct, info);
      out.push({ el, isScrollTarget: info.badge === "now" || info.badge === "next" });
    } else {
      out.push(buildOverlapCard(item, badgeInfo, onSelectAct));
    }
  }

  return out;
}

/**
 * 「◯分のすきま」行。施設(venue)が変わる場合は移動の注意を添える(分単位の行程管理はしない)。
 *
 * カタログの inter_venue_walk(徒歩分数)はここでは表示しない。現在の値は実測でも公式の
 * アクセス案内でもない概算(生成元 config.json に「仮値・要調整」と明記)であり、
 * 事実情報のみを扱う方針に反するため。確定した所要時間が公式に示されたら復活を検討する。
 */
function buildGapRow(gapMin, fromVenueId, toVenueId) {
  const row = h("div", { className: "gp-mytaite-gap" });
  row.appendChild(
    h("span", { className: "gp-mytaite-gap-text", text: `${Math.round(gapMin)}分のすきま` })
  );

  if (fromVenueId && toVenueId && fromVenueId !== toVenueId) {
    row.appendChild(
      h("span", { className: "gp-mytaite-gap-move", text: "施設間の移動があります" })
    );
  }

  return row;
}

function buildEntryRow(entry, onSelectAct, rowStatus = {}) {
  const { badge, isDone } = rowStatus;
  const { act, day, presentation } = entry;
  const meta = kindMeta(act.session_kind);
  // row 自体は非インタラクティブな受け皿(position:relative)にし、
  // 「詳細を開くbutton」と「マークbutton」を兄弟要素として分離する
  // (button内button のネストを避け、マークボタンのEnter/Spaceで
  // 詳細が開いてしまわないようにするため)。
  const rowClassName = `gp-mytaite-row ${meta.className}${isDone ? " is-done" : ""}`;
  const row = h("div", { className: rowClassName });

  const openBtn = h("button", { className: "gp-mytaite-btn", attrs: { type: "button" } });

  const timeEl = h("div", { className: "gp-mytaite-time" });
  const timeText = presentation
    ? formatTime(entry.displayIso)
    : `${formatTime(act.start)}〜${formatTime(act.end)}`;
  timeEl.appendChild(document.createTextNode(timeText));
  if (presentation && presentation.estimated) {
    timeEl.appendChild(h("span", { className: "sd-badge-estimated", text: "推定" }));
  }
  if (badge === "now") {
    timeEl.appendChild(h("span", { className: "gp-mytaite-badge gp-mytaite-badge--now", text: "いま" }));
  } else if (badge === "next") {
    timeEl.appendChild(h("span", { className: "gp-mytaite-badge gp-mytaite-badge--next", text: "NEXT" }));
  }
  openBtn.appendChild(timeEl);

  const body = h("div", { className: "gp-mytaite-body" });
  const lane = findLaneForAct(act, day);
  if (lane) body.appendChild(h("div", { className: "gp-mytaite-venue", text: lane.name }));
  body.appendChild(
    h("div", { className: "gp-mytaite-title", text: presentation ? presentation.title : act.title })
  );
  body.appendChild(
    h("div", { className: "gp-mytaite-sub", text: presentation ? act.title : meta.label })
  );
  if (entry.noteText) {
    // マークが無くメモだけの項目は、控えめに「メモ」ラベルを添えて見分けられるようにする
    // (CSS側の ::before で付与するため、ユーザー入力のテキストとは分離している)。
    const noteClass = entry.markValue ? "gp-mytaite-note-preview" : "gp-mytaite-note-preview has-no-mark";
    body.appendChild(h("div", { className: noteClass, text: entry.noteText }));
  }
  openBtn.appendChild(body);

  const open = () => onSelectAct(act.id);
  openBtn.addEventListener("click", open);

  row.appendChild(openBtn);
  row.appendChild(buildMarkButton(entry.markTargetId, entry.markKind));

  return row;
}

/**
 * 重なりグループの1枚のカードを組み立てる。
 * - 未選択: 見出し(◯件が重なっています/どれに行くか選べます)+候補一覧
 *   (各候補は通常行と同じ情報量+「これに行く」ボタン)。
 * - 選択済み: 選ばれた候補を通常の予定行として主役表示し、他の候補は
 *   「ほかの候補(N件)」として畳む(消さない)。「選択を解除」で未選択に戻せる。
 */
function buildOverlapCard(item, badgeInfo, onSelectAct) {
  const { sortedGroup, groupKey, selectedEntry } = item;
  const card = h("div", { className: "gp-mytaite-overlap-card" });
  let isScrollTarget = false;

  if (selectedEntry) {
    card.classList.add("is-selected");

    const info = badgeInfo.get(selectedEntry.key) || { badge: null, isDone: false };
    card.appendChild(buildEntryRow(selectedEntry, onSelectAct, info));
    isScrollTarget = info.badge === "now" || info.badge === "next";

    const others = sortedGroup.filter((e) => e.key !== selectedEntry.key);

    const footer = h("div", { className: "gp-mytaite-overlap-footer" });
    const toggleBtn = h("button", {
      className: "gp-mytaite-overlap-others-toggle",
      attrs: { type: "button", "aria-expanded": "false" },
      text: `ほかの候補（${others.length}件）`,
    });
    const clearBtn = h("button", {
      className: "gp-mytaite-overlap-clear-btn",
      attrs: { type: "button" },
      text: "選択を解除",
    });
    footer.appendChild(toggleBtn);
    footer.appendChild(clearBtn);
    card.appendChild(footer);

    const othersWrap = h("div", { className: "gp-mytaite-overlap-others", attrs: { hidden: true } });
    for (const cand of others) {
      othersWrap.appendChild(buildOverlapCandidate(cand, groupKey, onSelectAct, {}));
    }
    card.appendChild(othersWrap);

    toggleBtn.addEventListener("click", () => {
      const expanded = toggleBtn.getAttribute("aria-expanded") === "true";
      toggleBtn.setAttribute("aria-expanded", expanded ? "false" : "true");
      othersWrap.hidden = expanded;
    });
    clearBtn.addEventListener("click", () => {
      clearChoice(groupKey);
    });
  } else {
    const head = h("div", { className: "gp-mytaite-overlap-head" });
    head.appendChild(
      h("p", {
        className: "gp-mytaite-overlap-title",
        text: `同じ時間に${sortedGroup.length}件が重なっています`,
      })
    );
    head.appendChild(h("p", { className: "gp-mytaite-overlap-hint", text: "どれに行くか選べます" }));
    card.appendChild(head);

    const candidatesWrap = h("div", { className: "gp-mytaite-overlap-candidates" });
    for (const cand of sortedGroup) {
      const info = badgeInfo.get(cand.key) || { badge: null, isDone: false };
      candidatesWrap.appendChild(buildOverlapCandidate(cand, groupKey, onSelectAct, info));
      if (info.badge === "now" || info.badge === "next") isScrollTarget = true;
    }
    card.appendChild(candidatesWrap);
  }

  return { el: card, isScrollTarget };
}

function buildOverlapCandidate(entry, groupKey, onSelectAct, badgeInfoForEntry) {
  const wrap = h("div", { className: "gp-mytaite-overlap-candidate" });
  wrap.appendChild(buildEntryRow(entry, onSelectAct, badgeInfoForEntry));

  const chooseBtn = h("button", {
    className: "gp-mytaite-overlap-choose-btn",
    attrs: { type: "button" },
    text: "これに行く",
  });
  chooseBtn.addEventListener("click", () => {
    setChoice(groupKey, entry.key);
  });
  wrap.appendChild(chooseBtn);

  return wrap;
}

function appendPromo(wrap) {
  const promo = h("div", { className: "gp-mytaite-promo" });
  promo.appendChild(h("p", { text: "当日ビューはiOSアプリでより便利に使えます。" }));
  // TODO: App Store公開後、下記リンクを実際のストアURLに差し替えること(現在は審査中のためLPへ暫定リンク)
  promo.appendChild(
    h("a", {
      className: "gp-mytaite-promo-link",
      text: "iOSアプリのページを見る",
      attrs: { href: "https://oshibul.jp/gakkaipocket/", target: "_blank", rel: "noopener" },
    })
  );
  wrap.appendChild(promo);
}
