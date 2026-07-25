// mytaite.js — マーク済み(♡/☆)のセッション・演題を日別・時刻順に一覧表示する

import { h, formatTime, bus } from "./util.js";
import { kindMeta, findLaneForAct } from "./catalog.js";
import { listMarks } from "./marks.js";
import { buildMarkButton } from "./session-detail.js";

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

    if (marks.size === 0) {
      wrap.appendChild(
        h("p", {
          className: "gp-empty",
          text: "グリッドや検索から♡☆でマークするとここに表示されます。",
        })
      );
      appendPromo(wrap);
      return;
    }

    let anyRendered = false;

    for (const day of model.days) {
      const entries = collectEntries(day, marks);
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
      wrap.appendChild(
        h("p", {
          className: "gp-empty",
          text: "グリッドや検索から♡☆でマークするとここに表示されます。",
        })
      );
    }

    appendPromo(wrap);
  }

  build();

  const onMarksChanged = () => build();
  bus.on("marks-changed", onMarksChanged);

  return {
    destroy() {
      bus.off("marks-changed", onMarksChanged);
    },
  };
}

function collectEntries(day, marks) {
  const entries = [];

  for (const act of day.acts) {
    const actMark = marks.get(act.id);
    if (actMark) {
      entries.push({
        key: `act:${act.id}`,
        markTargetId: act.id,
        markKind: "session",
        markValue: actMark,
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
      if (!pMark) continue;
      const sortTime = p.estimated_start ? new Date(p.estimated_start) : act.startDate;
      entries.push({
        key: `pr:${p.id}`,
        markTargetId: p.id,
        markKind: "presentation",
        markValue: pMark,
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
