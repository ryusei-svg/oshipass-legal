// notes.js — メモ機能の localStorage 永続化
// キー: gp:notes:v1 値: { [key]: { text: string, updatedAt: number } }
// key は `${eventId}|${actId}|${presentationId ?? ""}`
// (演題に紐づかないセッション単位のメモは presentationId 部分が空文字になる)
//
// marks.js と同じ設計思想:
// - 書き込み直前にlocalStorageを再読込してから現在の状態とマージして保存する
//   (複数タブを開いている場合に他タブの変更を上書きしないため)
// - 他タブでの変更は "storage" イベントで検知し、メモリ上のキャッシュを最新化したうえで
//   イベントバスで表示側に再描画を促す

import { bus } from "./util.js";

const STORAGE_KEY = "gp:notes:v1";

/** textarea側のmaxlengthと合わせる文字数上限。データ層では超過分の切り詰めは行わない。 */
export const NOTE_MAX_LENGTH = 2000;

function buildKey(eventId, actId, presentationId) {
  return `${eventId}|${actId}|${presentationId ?? ""}`;
}

function readStore() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return parsed;
    return {};
  } catch (err) {
    console.warn("[notes] localStorage の読み込みに失敗しました", err);
    return {};
  }
}

function writeStore(store) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch (err) {
    console.warn("[notes] localStorage への保存に失敗しました", err);
  }
}

let store = readStore();

/** 指定キーの現在のメモを返す({ text, updatedAt } または該当なしなら null) */
export function getNote(eventId, actId, presentationId) {
  const entry = store[buildKey(eventId, actId, presentationId)];
  if (!entry) return null;
  return { text: entry.text, updatedAt: entry.updatedAt };
}

/** メモが存在する全件を [key, { text, updatedAt }] の配列で返す */
export function listNotes() {
  return Object.entries(store);
}

/**
 * メモを保存する。text が空文字またはホワイトスペースのみの場合は該当エントリを削除する。
 * 複数タブを開いている場合に他タブの変更を上書きしてしまわないよう、
 * 書き込み直前にlocalStorageを再読込してからマージして保存する。
 */
export function setNote(eventId, actId, presentationId, text) {
  const key = buildKey(eventId, actId, presentationId);
  const latest = readStore();

  if (!text || !text.trim()) {
    delete latest[key];
  } else {
    latest[key] = { text, updatedAt: Date.now() };
  }

  store = latest;
  writeStore(store);
  bus.emit("notes-changed", { key, eventId, actId, presentationId });
}

/**
 * セッション(act)自身、または配下のいずれかの演題にメモがあるかを判定する。
 * key が `${eventId}|${actId}|${presentationId}` の形式であることを利用し、
 * `${eventId}|${actId}|` で始まるキーを持つエントリが1件でもあれば true とする
 * (セッション単位のメモは presentationId 部分が空文字のためこのprefixに一致し、
 * 各演題のメモも同じactIdを含むためやはり一致する)。
 */
export function hasNoteForAct(eventId, actId) {
  const prefix = `${eventId}|${actId}|`;
  return Object.keys(store).some((k) => k.startsWith(prefix));
}

// 他タブでメモが変更された場合、この "storage" イベントで検知して
// メモリ上のキャッシュ(store)を最新化し、イベントバスで表示側に再描画を促す。
// (同一タブ内での変更ではこのイベントは発火しないため、setNote側のbus.emitと
// 重複通知にはならない)
if (typeof window !== "undefined") {
  window.addEventListener("storage", (ev) => {
    if (ev.key !== STORAGE_KEY) return;
    store = readStore();
    bus.emit("notes-changed", { key: null, external: true });
  });
}
