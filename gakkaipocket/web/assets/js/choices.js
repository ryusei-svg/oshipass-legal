// choices.js — 当日ビューの「重なりカード」で選んだ候補の localStorage 永続化
// キー: gp:choice:v1 値: { [groupKey]: 選択したエントリのkey }
//
// groupKey は、重なっているエントリ(mytaite.js の entry.key。"act:<id>" または
// "pr:<id>")をソートして "|" で連結した文字列(buildGroupKey参照)。
// マーク構成が変われば重なりグループの構成、延いてはgroupKeyも変わるため、
// 古い選択は自然に無効化される(明示的なクリーンアップは行わない)。
//
// marks.js / notes.js と同じ設計思想:
// - 書き込み直前にlocalStorageを再読込してから現在の状態とマージして保存する
//   (複数タブを開いている場合に他タブの変更を上書きしないため)
// - 他タブでの変更は "storage" イベントで検知し、メモリ上のキャッシュを最新化したうえで
//   イベントバスで表示側に再描画を促す

import { bus } from "./util.js";

const STORAGE_KEY = "gp:choice:v1";

function readStore() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return parsed;
    return {};
  } catch (err) {
    console.warn("[choices] localStorage の読み込みに失敗しました", err);
    return {};
  }
}

function writeStore(store) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch (err) {
    console.warn("[choices] localStorage への保存に失敗しました", err);
  }
}

let store = readStore();

/** 重なりグループのキーを、構成エントリのkey配列から決定的に導く。 */
export function buildGroupKey(entryKeys) {
  return entryKeys.slice().sort().join("|");
}

/** 指定グループの現在の選択(エントリkey)を返す(未選択なら undefined)。 */
export function getChoice(groupKey) {
  return store[groupKey];
}

/**
 * グループの選択を保存する。他タブの変更を上書きしないよう、
 * 書き込み直前にlocalStorageを再読込してからマージして保存する。
 */
export function setChoice(groupKey, entryKey) {
  const latest = readStore();
  latest[groupKey] = entryKey;
  store = latest;
  writeStore(store);
  bus.emit("choice-changed", { groupKey, entryKey });
}

/** グループの選択を解除する(未選択状態に戻す)。 */
export function clearChoice(groupKey) {
  const latest = readStore();
  delete latest[groupKey];
  store = latest;
  writeStore(store);
  bus.emit("choice-changed", { groupKey, entryKey: undefined });
}

// 他タブで選択が変更された場合、この "storage" イベントで検知して
// メモリ上のキャッシュ(store)を最新化し、イベントバスで表示側に再描画を促す。
if (typeof window !== "undefined") {
  window.addEventListener("storage", (ev) => {
    if (ev.key !== STORAGE_KEY) return;
    store = readStore();
    bus.emit("choice-changed", { groupKey: null, entryKey: null, external: true });
  });
}
