// marks.js — ♡(絶対聴く)/☆(できれば)マークの localStorage 永続化
// キー: gp:marks:v1 値: { [actIdまたはpresentationId]: "heart" | "star" }

import { bus } from "./util.js";

const STORAGE_KEY = "gp:marks:v1";
const CYCLE = [undefined, "heart", "star"];

function readStore() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return parsed;
    return {};
  } catch (err) {
    console.warn("[marks] localStorage の読み込みに失敗しました", err);
    return {};
  }
}

function writeStore(store) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch (err) {
    console.warn("[marks] localStorage への保存に失敗しました", err);
  }
}

let store = readStore();

/** 指定IDの現在のマーク状態を返す ("heart" | "star" | undefined) */
export function getMark(id) {
  return store[id];
}

/** マーク済みの [id, "heart"|"star"] を全件返す(マイタイテ画面で使用) */
export function listMarks() {
  return Object.entries(store);
}

/**
 * 無→♡→☆→無 のサイクルでマークを切り替える。
 * 複数タブを開いている場合に他タブの変更を上書きしてしまわないよう、
 * 書き込み直前にlocalStorageを再読込してからマージして保存する。
 */
export function cycleMark(id) {
  const latest = readStore();
  const current = latest[id];
  const idx = CYCLE.indexOf(current);
  const next = CYCLE[(idx + 1) % CYCLE.length];
  if (next === undefined) {
    delete latest[id];
  } else {
    latest[id] = next;
  }
  store = latest;
  writeStore(store);
  bus.emit("marks-changed", { id, value: next });
  return next;
}

// 他タブでマークが変更された場合、この "storage" イベントで検知して
// メモリ上のキャッシュ(store)を最新化し、イベントバスで表示側に再描画を促す。
// (同一タブ内での変更ではこのイベントは発火しないため、cycleMark側のbus.emitと
// 重複通知にはならない)
if (typeof window !== "undefined") {
  window.addEventListener("storage", (ev) => {
    if (ev.key !== STORAGE_KEY) return;
    store = readStore();
    bus.emit("marks-changed", { id: null, value: null, external: true });
  });
}

/** セッション(act)自身または子演題のいずれかがマークされているかをまとめて判定する。
 * 返り値: { own: "heart"|"star"|undefined, best: "heart"|"star"|undefined, fromChild: boolean }
 * best は自身のマークを優先し、無ければ子演題のうち最も強いマーク(♡>☆)を採用する。
 */
export function getActMarkSummary(act) {
  const own = store[act.id];
  if (own) return { own, best: own, fromChild: false };

  let bestChild;
  for (const p of act.presentations || []) {
    const m = store[p.id];
    if (m === "heart") {
      bestChild = "heart";
      break;
    }
    if (m === "star" && !bestChild) {
      bestChild = "star";
    }
  }
  return { own: undefined, best: bestChild, fromChild: Boolean(bestChild) };
}
