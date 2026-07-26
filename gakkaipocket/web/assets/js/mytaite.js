// mytaite.js — 当日ビュー(iOS版 TodayView 相当)を描画する。
// マーク済み(♡/☆)のセッション・演題(メモのみの項目も含む)を、
// 開催日当日は現在時刻を軸にした「いま/NEXT/終了」で、それ以外の期間は
// 従来どおり日別・時刻順の一覧として表示する。
// ファイル名・CSSクラス接頭辞(gp-mytaite-*)は旧称のまま維持している。

import { h, formatTime, formatDateLong, resolveNow, jstDateString, diffMinutes, bus } from "./util.js";
import { kindMeta, findLaneForAct } from "./catalog.js";
import { listMarks } from "./marks.js";
import { getNote } from "./notes.js";
import { buildMarkButton } from "./session-detail.js";

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

      const overlapping = computeOverlaps(entries);
      const isLiveDay = status.phase === "live" && day.dayNumber === status.liveDay.dayNumber;
      const liveNow = isLiveDay ? status.now : null;

      const list = h("div", { className: "gp-mytaite-list" });
      const rows = buildRowsWithGaps(entries, overlapping, day, liveNow, onSelectAct);
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
      const sortTime = p.estimated_start ? new Date(p.estimated_start) : act.startDate;
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
        sortTime,
        displayIso: p.estimated_start || act.start,
        rangeStart: act.startDate,
        rangeEnd: act.endDate,
      });
    }
  }

  entries.sort((a, b) => a.sortTime - b.sortTime);
  return entries;
}

/**
 * ♡(絶対聴く)同士の時間帯の重なりを検出する。
 * 演題単位のマークは個別の終了時刻を持たないため、簡略化として
 * 「所属するセッションの開始〜終了」を占有時間とみなして判定する。
 */
function computeOverlaps(entries) {
  const hearts = entries.filter((e) => e.markValue === "heart");
  const overlapping = new Set();
  for (let i = 0; i < hearts.length; i++) {
    for (let j = i + 1; j < hearts.length; j++) {
      const a = hearts[i];
      const b = hearts[j];
      if (a.act.id === b.act.id) continue; // 同一セッション内は重なり扱いにしない
      if (a.rangeStart < b.rangeEnd && b.rangeStart < a.rangeEnd) {
        overlapping.add(a.key);
        overlapping.add(b.key);
      }
    }
  }
  return overlapping;
}

/**
 * entries を行要素へ組み立てる。連続する2項目の間に15分以上の空きがあれば
 * 「◯分のすきま」行を挿入し、liveNow(開催中のその日のみ非null)が渡された場合は
 * 各行に「いま」「NEXT」バッジ、終了済み項目には控えめ表示(is-done)を付与する。
 * @returns {{ el: HTMLElement, isScrollTarget: boolean }[]}
 */
function buildRowsWithGaps(entries, overlapping, day, liveNow, onSelectAct) {
  const out = [];
  let nextAssigned = false;

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const prev = i > 0 ? entries[i - 1] : null;

    if (prev && prev.act.id !== entry.act.id) {
      const gapMin = diffMinutes(prev.rangeEnd, entry.rangeStart);
      if (gapMin >= GAP_THRESHOLD_MIN) {
        out.push({ el: buildGapRow(gapMin, prev.venueId, entry.venueId, day), isScrollTarget: false });
      }
    }

    let badge = null;
    let isDone = false;
    if (liveNow) {
      if (entry.rangeEnd <= liveNow) {
        isDone = true;
      } else if (entry.rangeStart <= liveNow && liveNow < entry.rangeEnd) {
        badge = "now";
      } else if (!nextAssigned) {
        badge = "next";
        nextAssigned = true;
      }
    }

    const el = buildEntryRow(entry, overlapping.has(entry.key), onSelectAct, { badge, isDone });
    out.push({ el, isScrollTarget: badge === "now" || badge === "next" });
  }

  return out;
}

/** 「◯分のすきま」行。施設(venue)が変わる場合は移動の注意を添える(分単位の行程管理はしない)。 */
function buildGapRow(gapMin, fromVenueId, toVenueId, day) {
  const row = h("div", { className: "gp-mytaite-gap" });
  row.appendChild(
    h("span", { className: "gp-mytaite-gap-text", text: `${Math.round(gapMin)}分のすきま` })
  );

  if (fromVenueId && toVenueId && fromVenueId !== toVenueId) {
    let moveText = "施設間の移動があります";
    const walk = (day.interVenueWalk || []).find(
      (w) => w.from_venue_id === fromVenueId && w.to_venue_id === toVenueId
    );
    if (walk && typeof walk.minutes === "number") {
      moveText += `（徒歩${walk.minutes}分）`;
    }
    row.appendChild(h("span", { className: "gp-mytaite-gap-move", text: moveText }));
  }

  return row;
}

function buildEntryRow(entry, hasOverlap, onSelectAct, rowStatus = {}) {
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
  if (hasOverlap) {
    body.appendChild(h("div", { className: "gp-mytaite-warning", text: "時間が重なっています" }));
  }
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
