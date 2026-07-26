// mytaite.js — マーク済み(♡/☆)のセッション・演題を日別・時刻順に一覧表示する

import { h, formatTime, bus } from "./util.js";
import { kindMeta, findLaneForAct } from "./catalog.js";
import { listMarks } from "./marks.js";
import { getNote } from "./notes.js";
import { buildMarkButton } from "./session-detail.js";

const EMPTY_TEXT = "グリッドや検索から♡☆でマークするか、メモを書くとここに表示されます。";

/**
 * マイタイテページを描画する。
 * @param {HTMLElement} container
 * @param {object} model - loadCatalogModel() の返り値
 * @param {{ onSelectAct: (actId: string) => void }} handlers
 * @returns {{ destroy: () => void }}
 */
export function renderMytaitePage(container, model, { onSelectAct }) {
  container.textContent = "";
  const wrap = h("div", { className: "gp-mytaite" });
  container.appendChild(wrap);

  function build() {
    wrap.textContent = "";
    const marks = new Map(listMarks());
    const eventId = model.event.id;

    let anyRendered = false;

    for (const day of model.days) {
      const entries = collectEntries(day, marks, eventId);
      if (!entries.length) continue;
      anyRendered = true;

      wrap.appendChild(h("h2", { className: "gp-mytaite-day-title", text: `${day.dayNumber}日目` }));

      const overlapping = computeOverlaps(entries);
      const list = h("div", { className: "gp-mytaite-list" });
      for (const entry of entries) {
        list.appendChild(buildEntryRow(entry, overlapping.has(entry.key), onSelectAct));
      }
      wrap.appendChild(list);
    }

    if (!anyRendered) {
      wrap.appendChild(h("p", { className: "gp-empty", text: EMPTY_TEXT }));
    }

    appendPromo(wrap);
  }

  build();

  const onMarksChanged = () => build();
  bus.on("marks-changed", onMarksChanged);
  bus.on("notes-changed", onMarksChanged);

  return {
    destroy() {
      bus.off("marks-changed", onMarksChanged);
      bus.off("notes-changed", onMarksChanged);
    },
  };
}

/**
 * マーク済み、またはメモがあるセッション・演題を収集する。
 * メモだけあってマーク(♡☆)が無い項目も一覧に混ぜ込む(そうしないとメモに
 * 辿り着けなくなるため)。並び順は既存どおり時刻順のまま(sortTimeでソート)。
 */
function collectEntries(day, marks, eventId) {
  const entries = [];

  for (const act of day.acts) {
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

function buildEntryRow(entry, hasOverlap, onSelectAct) {
  const { act, day, presentation } = entry;
  const meta = kindMeta(act.session_kind);
  // row 自体は非インタラクティブな受け皿(position:relative)にし、
  // 「詳細を開くbutton」と「マークbutton」を兄弟要素として分離する
  // (button内button のネストを避け、マークボタンのEnter/Spaceで
  // 詳細が開いてしまわないようにするため)。
  const row = h("div", { className: `gp-mytaite-row ${meta.className}` });

  const openBtn = h("button", { className: "gp-mytaite-btn", attrs: { type: "button" } });

  const timeEl = h("div", { className: "gp-mytaite-time" });
  const timeText = presentation
    ? formatTime(entry.displayIso)
    : `${formatTime(act.start)}〜${formatTime(act.end)}`;
  timeEl.appendChild(document.createTextNode(timeText));
  if (presentation && presentation.estimated) {
    timeEl.appendChild(h("span", { className: "sd-badge-estimated", text: "推定" }));
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
