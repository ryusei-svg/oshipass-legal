// session-detail.js — セッション詳細シート(モバイル: 下からのシート / PC: 中央モーダル)
// CSSのメディアクエリで見た目を切り替え、DOM構造は共通。

import { h, formatTime } from "./util.js";
import { kindMeta, resolveArtistNames, resolveVenueNameForAct, findLaneForAct } from "./catalog.js";
import { getMark, cycleMark } from "./marks.js";

const MARK_GLYPH = { idle: "♡", heart: "♥", star: "★" };
const MARK_LABEL = { idle: "マークなし", heart: "絶対聴く", star: "できれば" };

let activeController = null;

/**
 * セッション詳細シートを開く。既に開いている場合は入れ替える。
 * @param {object} ctx - { act, day, artistsById, venuesById }
 * @param {{ onClose?: () => void }} [options]
 * @returns {{ close: () => void }}
 */
export function openSessionDetail(ctx, options = {}) {
  closeSessionDetail();

  const { act, day, artistsById, venuesById } = ctx;
  const meta = kindMeta(act.session_kind);
  const lane = findLaneForAct(act, day);
  const venueName = resolveVenueNameForAct(act, day, venuesById);
  const chairNames = resolveArtistNames(act.chair_ids, artistsById);
  const artistNames = resolveArtistNames(act.artist_ids, artistsById);

  const previouslyFocused = document.activeElement;
  const shellEl = document.querySelector(".gp-shell");

  const overlay = h("div", { className: "sd-overlay", attrs: { "data-sd-overlay": "" } });
  const sheet = h("div", {
    className: "sd-sheet",
    attrs: { role: "dialog", "aria-modal": "true", "aria-labelledby": "sd-title" },
  });

  const closeBtn = h("button", {
    className: "sd-close",
    attrs: { type: "button", "aria-label": "閉じる" },
    text: "×",
  });

  const header = h("div", { className: "sd-header" });
  const kindBadge = h("span", { className: `sd-kind-badge ${meta.className}`, text: meta.label });
  const title = h("h2", { className: "sd-title", attrs: { id: "sd-title" }, text: act.title });
  header.appendChild(kindBadge);
  header.appendChild(title);
  // session_code がタイトルと同一の値(「一般演題01」等)の場合は、
  // タイトルと同じ文字列を二重表示することになるため省略する。
  if (act.session_code && act.session_code !== act.title) {
    header.appendChild(h("p", { className: "sd-code", text: act.session_code }));
  }

  const actMarkBtn = buildMarkButton(act.id, "session");
  header.appendChild(actMarkBtn);

  const info = h("dl", { className: "sd-info" });
  addInfoRow(info, "時間", `${formatTime(act.start)}〜${formatTime(act.end)}`);
  const venueLabel = lane ? [lane.name, venueName].filter(Boolean).join("　") : venueName;
  if (venueLabel) addInfoRow(info, "会場", venueLabel);
  if (act.category) addInfoRow(info, "カテゴリ", act.category);
  if (artistNames.length) addInfoRow(info, "演者", artistNames.join("、"));
  if (chairNames.length) addInfoRow(info, "座長", chairNames.join("、"));
  if (typeof act.capacity === "number") addInfoRow(info, "定員", `${act.capacity}名`);
  if (act.note) addInfoRow(info, "備考", act.note);

  sheet.appendChild(closeBtn);
  sheet.appendChild(header);
  sheet.appendChild(info);
  sheet.appendChild(buildShareButton(act.id));

  if (act.presentations && act.presentations.length) {
    const presWrap = h("div", { className: "sd-presentations" });
    presWrap.appendChild(
      h("h3", { className: "sd-presentations-title", text: `演題一覧（${act.presentations.length}件）` })
    );
    const list = h("ol", { className: "sd-pres-list" });
    for (const p of act.presentations) {
      list.appendChild(buildPresentationRow(p, artistsById));
    }
    presWrap.appendChild(list);
    sheet.appendChild(presWrap);
  }

  overlay.appendChild(sheet);
  document.body.appendChild(overlay);
  document.body.classList.add("sd-open");
  // 背景(アプリシェル本体)を inert にして、Tabキーでシートの外(背景側)へ
  // フォーカスが抜けないようにする(フォーカストラップ)。
  if (shellEl) shellEl.inert = true;

  function handleKeydown(ev) {
    if (ev.key === "Escape") {
      close();
    }
  }
  function handleOverlayClick(ev) {
    if (ev.target === overlay) close();
  }

  closeBtn.addEventListener("click", close);
  overlay.addEventListener("click", handleOverlayClick);
  document.addEventListener("keydown", handleKeydown);

  closeBtn.focus();

  function close() {
    if (activeController && activeController.closed) return;
    document.removeEventListener("keydown", handleKeydown);
    overlay.removeEventListener("click", handleOverlayClick);
    overlay.remove();
    document.body.classList.remove("sd-open");
    if (shellEl) shellEl.inert = false;
    if (previouslyFocused && previouslyFocused.focus) {
      try {
        previouslyFocused.focus();
      } catch (err) {
        /* no-op: フォーカス対象が既にDOMから外れている場合がある */
      }
    }
    if (activeController) activeController.closed = true;
    if (options.onClose) options.onClose();
  }

  activeController = { close, closed: false };
  return activeController;
}

export function closeSessionDetail() {
  if (activeController && !activeController.closed) {
    activeController.close();
  }
  activeController = null;
}

function addInfoRow(dl, label, value) {
  const row = h("div", { className: "sd-info-row" });
  row.appendChild(h("dt", { text: label }));
  row.appendChild(h("dd", { text: value }));
  dl.appendChild(row);
}

function buildPresentationRow(presentation, artistsById) {
  const li = h("li", { className: "sd-pres-row" });

  const codeEl = h("div", { className: "sd-pres-code", text: presentation.code || "" });

  const body = h("div", { className: "sd-pres-body" });
  const timeRow = h("div", { className: "sd-pres-time" });
  if (presentation.estimated_start) {
    timeRow.appendChild(document.createTextNode(formatTime(presentation.estimated_start)));
    if (presentation.estimated) {
      timeRow.appendChild(h("span", { className: "sd-badge-estimated", text: "推定" }));
    }
  }
  body.appendChild(timeRow);
  body.appendChild(h("div", { className: "sd-pres-title", text: presentation.title }));

  const presenterNames = resolveArtistNames(presentation.presenter_ids, artistsById);
  if (presenterNames.length || presentation.affiliation) {
    const parts = [presenterNames.join("、")];
    if (presentation.affiliation) parts.push(`（${presentation.affiliation}）`);
    body.appendChild(h("div", { className: "sd-pres-presenter", text: parts.filter(Boolean).join(" ") }));
  }

  li.appendChild(codeEl);
  li.appendChild(body);
  li.appendChild(buildMarkButton(presentation.id, "presentation"));
  return li;
}

/**
 * セッションの共有用絶対URLを組み立てる。
 * デプロイパスを固定文字列で決め打ちせず、document.baseURI(このページ自身の場所)を
 * 基準に解決することで、配信先のパス構成が変わっても正しいURLになるようにする。
 */
function buildShareUrl(actId) {
  return new URL(`#/session/${actId}`, document.baseURI).href;
}

function buildShareButton(actId) {
  const btn = h("button", {
    className: "sd-share-btn",
    attrs: { type: "button" },
    text: "このセッションのリンクをコピー",
  });
  const originalText = btn.textContent;
  let resetTimer = null;

  btn.addEventListener("click", async (ev) => {
    ev.stopPropagation();
    const url = buildShareUrl(actId);

    try {
      if (!navigator.clipboard || !navigator.clipboard.writeText) {
        throw new Error("clipboard API unavailable");
      }
      await navigator.clipboard.writeText(url);
      btn.textContent = "コピーしました";
      btn.classList.add("is-copied");
    } catch (err) {
      window.prompt("このURLをコピーしてください", url);
    }

    if (resetTimer) clearTimeout(resetTimer);
    resetTimer = setTimeout(() => {
      btn.textContent = originalText;
      btn.classList.remove("is-copied");
    }, 1800);
  });

  return btn;
}

export function buildMarkButton(targetId, kind) {
  const btn = h("button", {
    className: `sd-mark-btn sd-mark-btn--${kind}`,
    attrs: {
      type: "button",
      "data-mark-target": targetId,
      "data-kind": kind,
    },
  });
  updateMarkButton(btn, getMark(targetId));

  btn.addEventListener("click", (ev) => {
    ev.stopPropagation();
    const next = cycleMark(targetId);
    updateMarkButton(btn, next);
  });

  return btn;
}

function updateMarkButton(btn, state) {
  const key = state || "idle";
  const kind = btn.dataset.kind;
  btn.textContent = MARK_GLYPH[key];
  btn.className = `sd-mark-btn sd-mark-btn--${kind} mark-${key}`;
  btn.setAttribute("aria-label", `マーク切り替え（現在: ${MARK_LABEL[key]}）`);
}
