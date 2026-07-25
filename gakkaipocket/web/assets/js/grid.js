// grid.js — タイテグリッド(縦=時間軸、横=会場レーン)の描画
// CSS Grid + position:sticky で「施設グループヘッダー」「レーン名ヘッダー」「時刻ガター」を
// 上部/左に固定する。セッションブロックは各レーン列内で position:absolute により
// 開始/終了時刻から算出した top/height で配置する。

import { h, formatTimeWithOffset, formatTime, range, bus } from "./util.js";
import { kindMeta, resolveArtistNames, resolveVenueNameForAct } from "./catalog.js";
import { getActMarkSummary } from "./marks.js";

// 1分あたりのピクセル数。app.css の --min-px と必ず同じ値にすること。
const MIN_PX = 2.4;
const GUTTER_WIDTH = 56; // px
const LANE_WIDTH = 168; // px
const VENUE_ROW_H = 32; // px
const LANE_ROW_H = 40; // px
const BLOCK_GAP = 2; // px
const MIN_BLOCK_H = 26; // px

/**
 * グリッドを container 内に描画する。
 * @param {HTMLElement} container
 * @param {object} day - catalog.js の normalizeDay() が返す day オブジェクト
 * @param {Map} artistsById
 * @param {(actId: string) => void} onSelectAct
 * @param {Map} [venuesById] - aria-label 用の会場名解決に使用
 * @returns {{ refreshMarks: () => void, destroy: () => void }}
 */
export function renderGrid(container, day, artistsById, onSelectAct, venuesById) {
  container.textContent = "";

  const laneCount = day.lanes.length;
  const totalMin = day.timeRange.totalMin;
  const bodyHeight = Math.max(1, Math.round(totalMin * MIN_PX));

  const grid = h("div", { className: "tt-grid" });
  grid.style.gridTemplateColumns = `${GUTTER_WIDTH}px repeat(${laneCount}, ${LANE_WIDTH}px)`;
  grid.style.gridTemplateRows = `${VENUE_ROW_H}px ${LANE_ROW_H}px ${bodyHeight}px`;

  // --- row1: 施設グループヘッダー + 左上コーナー ---
  const corner1 = h("div", { className: "tt-corner tt-corner-top" });
  corner1.style.gridColumn = "1 / 2";
  corner1.style.gridRow = "1 / 2";
  grid.appendChild(corner1);

  let col = 2;
  for (const group of day.venueGroups) {
    const cell = h("div", {
      className: "tt-venue-head",
      text: group.venueName,
    });
    cell.style.gridColumn = `${col} / ${col + group.laneCount}`;
    cell.style.gridRow = "1 / 2";
    grid.appendChild(cell);
    col += group.laneCount;
  }

  // --- row2: レーン名ヘッダー + 左コーナー(2段目) ---
  const corner2 = h("div", { className: "tt-corner tt-corner-mid" });
  corner2.style.gridColumn = "1 / 2";
  corner2.style.gridRow = "2 / 3";
  grid.appendChild(corner2);

  day.lanes.forEach((lane, i) => {
    const cell = h("div", { className: "tt-lane-head", text: lane.name });
    cell.style.gridColumn = `${i + 2} / ${i + 3}`;
    cell.style.gridRow = "2 / 3";
    grid.appendChild(cell);
  });

  // --- row3: 時刻ガター(左固定) ---
  const gutterBody = h("div", { className: "tt-gutter-body" });
  gutterBody.style.gridColumn = "1 / 2";
  gutterBody.style.gridRow = "3 / 4";
  gutterBody.style.height = `${bodyHeight}px`;

  const startISO = day.timeRange.startISO;
  const stepMinutes = range(0, totalMin, 30);
  for (const minOffset of stepMinutes) {
    const text = formatTimeWithOffset(startISO, minOffset);
    const isHour = text.endsWith(":00");
    const label = h("div", {
      className: isHour ? "tt-time-label is-hour" : "tt-time-label",
      text,
    });
    label.style.top = `${Math.round(minOffset * MIN_PX)}px`;
    gutterBody.appendChild(label);
  }
  grid.appendChild(gutterBody);

  // --- row3: レーンごとの本体列(セッションブロック) ---
  const actElementById = new Map();

  day.lanes.forEach((lane, laneIndex) => {
    const laneBody = h("div", { className: "tt-lane-body" });
    laneBody.style.gridColumn = `${laneIndex + 2} / ${laneIndex + 3}`;
    laneBody.style.gridRow = "3 / 4";
    laneBody.style.height = `${bodyHeight}px`;
    grid.appendChild(laneBody);
  });

  const laneBodies = Array.from(grid.querySelectorAll(".tt-lane-body"));

  for (const act of day.acts) {
    const laneBody = laneBodies[act.laneIndex];
    if (!laneBody) continue;
    const block = buildActBlock(act, day, artistsById, venuesById, onSelectAct);
    const top = Math.round(act.startMin * MIN_PX) + 1;
    const height = Math.max(
      MIN_BLOCK_H,
      Math.round(act.durationMin * MIN_PX) - BLOCK_GAP
    );
    block.style.top = `${top}px`;
    block.style.height = `${height}px`;
    laneBody.appendChild(block);
    actElementById.set(act.id, block);
  }

  container.appendChild(grid);

  function refreshMarks() {
    for (const act of day.acts) {
      const el = actElementById.get(act.id);
      if (el) applyMarkState(el, act);
    }
  }
  refreshMarks();

  const onBusChange = () => refreshMarks();
  bus.on("marks-changed", onBusChange);

  return {
    refreshMarks,
    destroy() {
      bus.off("marks-changed", onBusChange);
    },
  };
}

function buildActBlock(act, day, artistsById, venuesById, onSelectAct) {
  const meta = kindMeta(act.session_kind);
  const venueName = venuesById ? resolveVenueNameForAct(act, day, venuesById) : "";
  const timeLabel = `${formatTime(act.start)}〜${formatTime(act.end)}`;
  const ariaLabel = [timeLabel, venueName, meta.label, act.title].filter(Boolean).join(" ");
  const block = h("div", {
    className: `tt-act ${meta.className}`,
    attrs: {
      role: "button",
      tabindex: "0",
      "aria-label": ariaLabel,
      "data-act-id": act.id,
    },
  });

  const titleEl = h("div", { className: "tt-act-title", text: act.title });
  block.appendChild(titleEl);

  const metaText = act.category ? `${meta.label} ／ ${act.category}` : meta.label;
  const metaEl = h("div", { className: "tt-act-meta", text: metaText });
  block.appendChild(metaEl);

  const chairNames = resolveArtistNames(act.chair_ids, artistsById);
  if (chairNames.length) {
    const chairEl = h("div", {
      className: "tt-act-chair",
      text: `座長：${chairNames.join("、")}`,
    });
    block.appendChild(chairEl);
  }

  const markBadge = h("div", { className: "tt-mark-badge" });
  block.appendChild(markBadge);

  const select = () => onSelectAct(act.id);
  block.addEventListener("click", select);
  block.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" || ev.key === " ") {
      ev.preventDefault();
      select();
    }
  });

  return block;
}

function applyMarkState(el, act) {
  const summary = getActMarkSummary(act);
  el.classList.remove("is-marked-heart", "is-marked-star", "is-marked-child");
  const badge = el.querySelector(".tt-mark-badge");
  if (badge) badge.textContent = "";

  if (!summary.best) return;

  const cls = summary.best === "heart" ? "is-marked-heart" : "is-marked-star";
  el.classList.add(cls);
  if (summary.fromChild) el.classList.add("is-marked-child");
  if (badge) badge.textContent = summary.best === "heart" ? "♥" : "★";
}
