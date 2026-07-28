// onboarding.js — 初回訪問時のみ表示する3ステップの使い方ガイド
// session-detail.js / about.js と同じモーダルの作法(sd-overlay/sd-sheetの見た目、
// 背景を inert にしたフォーカストラップ、Escape・オーバーレイクリックで閉じる)を踏襲する。

import { h } from "./util.js";

const STORAGE_KEY = "gp:onboarded:v1";
const SVG_NS = "http://www.w3.org/2000/svg";

const STEPS = [
  { text: "枠をタップすると、そのセッションの演題一覧が開きます。", icon: buildTapIcon },
  { text: "聴きたい演題に♡（絶対聴く）・☆（できれば）を付けます。", icon: buildMarkGlyphIcon },
  { text: "「当日」タブに、マークした予定が時系列で並びます。", icon: buildListIcon },
];

let activeController = null;

/** 既にガイドを見終えている(スキップ・完了いずれかで閉じたことがある)かどうか。 */
export function hasSeenOnboarding() {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch (err) {
    // 保存できない環境(プライベートブラウズ等)では、毎回出して煩わせないよう
    // 「見た」扱いにする。
    return true;
  }
}

function markSeen() {
  try {
    localStorage.setItem(STORAGE_KEY, "1");
  } catch (err) {
    /* no-op */
  }
}

/**
 * 初回ガイドを開く。既に見た記録がある場合は何もしない。
 * 呼び出し側(main.js)はグリッド読み込み後にこの関数を呼ぶ。
 */
export function openOnboarding() {
  if (activeController) return;
  if (hasSeenOnboarding()) return;

  let step = 0;
  const previouslyFocused = document.activeElement;
  const shellEl = document.querySelector(".gp-shell");

  const overlay = h("div", { className: "sd-overlay" });
  const sheet = h("div", {
    className: "sd-sheet sd-sheet--onboarding",
    attrs: { role: "dialog", "aria-modal": "true", "aria-labelledby": "onboarding-title" },
  });

  sheet.appendChild(
    h("h2", { className: "sd-title", attrs: { id: "onboarding-title" }, text: "学会ポケットの使い方" })
  );

  const body = h("div", { className: "onboarding-body" });
  const iconWrap = h("div", { className: "onboarding-icon" });
  const textEl = h("p", { className: "onboarding-text" });
  body.appendChild(iconWrap);
  body.appendChild(textEl);
  sheet.appendChild(body);

  const dots = h("div", { className: "onboarding-dots", attrs: { role: "presentation" } });
  const dotEls = STEPS.map(() => h("span", { className: "onboarding-dot" }));
  for (const d of dotEls) dots.appendChild(d);
  sheet.appendChild(dots);

  const actions = h("div", { className: "onboarding-actions" });
  const skipBtn = h("button", {
    className: "onboarding-skip-btn",
    attrs: { type: "button" },
    text: "スキップ",
  });
  const nextBtn = h("button", { className: "onboarding-next-btn", attrs: { type: "button" } });
  actions.appendChild(skipBtn);
  actions.appendChild(nextBtn);
  sheet.appendChild(actions);

  overlay.appendChild(sheet);
  document.body.appendChild(overlay);
  document.body.classList.add("sd-open");
  // 背景(アプリシェル本体)を inert にして、Tabキーでガイドの外(背景側)へ
  // フォーカスが抜けないようにする(フォーカストラップ)。
  if (shellEl) shellEl.inert = true;

  function renderStep() {
    const current = STEPS[step];
    iconWrap.textContent = "";
    iconWrap.appendChild(current.icon());
    textEl.textContent = current.text;
    dotEls.forEach((dot, i) => dot.classList.toggle("is-active", i === step));
    nextBtn.textContent = step === STEPS.length - 1 ? "はじめる" : "次へ";
  }
  renderStep();

  function handleKeydown(ev) {
    if (ev.key === "Escape") close();
  }
  function handleOverlayClick(ev) {
    if (ev.target === overlay) close();
  }

  nextBtn.addEventListener("click", () => {
    if (step < STEPS.length - 1) {
      step += 1;
      renderStep();
    } else {
      close();
    }
  });
  skipBtn.addEventListener("click", close);
  overlay.addEventListener("click", handleOverlayClick);
  document.addEventListener("keydown", handleKeydown);

  nextBtn.focus();

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
    // スキップ・最後まで進む・Escape・オーバーレイクリック、どの経路で閉じても
    // 「見た」扱いにして二度と出さない。
    markSeen();
    if (activeController) activeController.closed = true;
    activeController = null;
  }

  activeController = { close, closed: false };
}

function baseSvg() {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "34");
  svg.setAttribute("height", "34");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  return svg;
}

/** 手順1「枠をタップ」のアイコン(枠+タップ位置の点と輪)。createElementNSで構築。 */
function buildTapIcon() {
  const svg = baseSvg();

  const rect = document.createElementNS(SVG_NS, "rect");
  rect.setAttribute("x", "3");
  rect.setAttribute("y", "4");
  rect.setAttribute("width", "18");
  rect.setAttribute("height", "13");
  rect.setAttribute("rx", "2.5");
  rect.setAttribute("fill", "none");
  rect.setAttribute("stroke", "currentColor");
  rect.setAttribute("stroke-width", "1.6");
  svg.appendChild(rect);

  const ring = document.createElementNS(SVG_NS, "circle");
  ring.setAttribute("cx", "17");
  ring.setAttribute("cy", "18.5");
  ring.setAttribute("r", "4.2");
  ring.setAttribute("fill", "none");
  ring.setAttribute("stroke", "currentColor");
  ring.setAttribute("stroke-width", "1.2");
  ring.setAttribute("opacity", "0.5");
  svg.appendChild(ring);

  const dot = document.createElementNS(SVG_NS, "circle");
  dot.setAttribute("cx", "17");
  dot.setAttribute("cy", "18.5");
  dot.setAttribute("r", "2.1");
  dot.setAttribute("fill", "currentColor");
  svg.appendChild(dot);

  return svg;
}

/** 手順2「♡・☆を付ける」のアイコン。既存のマーク表示と同じ文字グリフを流用する。 */
function buildMarkGlyphIcon() {
  const wrap = document.createElement("span");
  wrap.className = "onboarding-glyphs";

  const heart = document.createElement("span");
  heart.className = "onboarding-glyph onboarding-glyph--heart";
  heart.textContent = "♡";
  heart.setAttribute("aria-hidden", "true");
  wrap.appendChild(heart);

  const star = document.createElement("span");
  star.className = "onboarding-glyph onboarding-glyph--star";
  star.textContent = "☆";
  star.setAttribute("aria-hidden", "true");
  wrap.appendChild(star);

  return wrap;
}

/** 手順3「当日タブに時系列で並ぶ」のアイコン(一覧を表す枠+線)。createElementNSで構築。 */
function buildListIcon() {
  const svg = baseSvg();

  const outline = document.createElementNS(SVG_NS, "rect");
  outline.setAttribute("x", "3.5");
  outline.setAttribute("y", "4");
  outline.setAttribute("width", "17");
  outline.setAttribute("height", "16");
  outline.setAttribute("rx", "2.5");
  outline.setAttribute("fill", "none");
  outline.setAttribute("stroke", "currentColor");
  outline.setAttribute("stroke-width", "1.6");
  svg.appendChild(outline);

  for (const y of [8.5, 12.5, 16.5]) {
    const line = document.createElementNS(SVG_NS, "line");
    line.setAttribute("x1", "7");
    line.setAttribute("y1", String(y));
    line.setAttribute("x2", "17");
    line.setAttribute("y2", String(y));
    line.setAttribute("stroke", "currentColor");
    line.setAttribute("stroke-width", "1.4");
    line.setAttribute("stroke-linecap", "round");
    svg.appendChild(line);
  }

  return svg;
}
