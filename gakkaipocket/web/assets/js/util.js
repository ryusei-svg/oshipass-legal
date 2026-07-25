// util.js — 汎用ヘルパー(日付・DOM生成・簡易イベントバス)
// 依存ゼロ・ビルドステップなしの vanilla ES module。

const WEEKDAY_JA = ["日", "月", "火", "水", "木", "金", "土"];

/** ISO8601文字列(+09:00等)を Date に変換 */
export function parseISO(iso) {
  return new Date(iso);
}

const ISO_DATETIME_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/;

/**
 * ISO8601文字列(例: "2026-10-08T10:20:00+09:00")から "HH:MM" を直接抜き出す。
 * Date#getHours()/getMinutes() は端末のタイムゾーンに依存してしまい、
 * 海外のタイムゾーンで開くと表示時刻がズレるため使わない。
 * 常に文字列中の時刻成分(=常に+09:00で書かれているカタログの表記)をそのまま表示する。
 * @param {string} iso
 */
export function formatTime(iso) {
  const m = ISO_DATETIME_RE.exec(iso || "");
  if (!m) return "--:--";
  return `${m[4]}:${m[5]}`;
}

/**
 * ISO8601の時刻文字列に分単位のオフセットを加えた "HH:MM" を返す。
 * grid.js の時刻ガター(30分刻みラベル)のように、実データに紐づかない
 * 「基準時刻+n分」のラベルを作る場合に使う。Dateオブジェクトを経由せず
 * 文字列から取り出した時分に対して直接分加算するため、端末タイムゾーンに依存しない。
 * @param {string} iso
 * @param {number} offsetMinutes
 */
export function formatTimeWithOffset(iso, offsetMinutes) {
  const m = ISO_DATETIME_RE.exec(iso || "");
  if (!m) return "--:--";
  const baseMinutes = Number(m[4]) * 60 + Number(m[5]);
  const total = (((baseMinutes + offsetMinutes) % 1440) + 1440) % 1440;
  const h = String(Math.floor(total / 60)).padStart(2, "0");
  const mm = String(total % 60).padStart(2, "0");
  return `${h}:${mm}`;
}

/**
 * "YYYY-MM-DD" を "10/8(木)" のように整形。
 * 曜日の算出にDate#getDay()(端末タイムゾーン依存)を使わず、
 * 文字列から取り出したY/M/DをDate.UTC()で組み立てた上でgetUTCDay()を使うことで、
 * 端末タイムゾーンに関わらず常にカタログ上の暦日どおりの曜日を返す。
 */
export function formatDateShort(activityDate) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(activityDate || "");
  if (!m) return activityDate || "";
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const wd = WEEKDAY_JA[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
  return `${month}/${day}(${wd})`;
}

/** 2つの Date 間の分数差 */
export function diffMinutes(a, b) {
  return (b.getTime() - a.getTime()) / 60000;
}

/**
 * createElement のショートハンド。XSS対策のため文字列は必ず textContent 経由で設定し、
 * innerHTML は一切使用しない。
 * @param {string} tag
 * @param {object} [opts] - { className, text, attrs, children }
 */
export function h(tag, opts = {}) {
  const el = document.createElement(tag);
  if (opts.className) el.className = opts.className;
  if (opts.text !== undefined && opts.text !== null) el.textContent = opts.text;
  if (opts.attrs) {
    for (const [k, v] of Object.entries(opts.attrs)) {
      if (v === undefined || v === null || v === false) continue;
      el.setAttribute(k, v === true ? "" : String(v));
    }
  }
  if (opts.children) {
    for (const c of opts.children) {
      if (c) el.appendChild(c);
    }
  }
  return el;
}

/** 簡易イベントバス(marks更新など、モジュール間の疎結合な通知に使う) */
class EventBus extends EventTarget {
  emit(name, detail) {
    this.dispatchEvent(new CustomEvent(name, { detail }));
  }
  on(name, handler) {
    this.addEventListener(name, handler);
  }
  off(name, handler) {
    this.removeEventListener(name, handler);
  }
}

export const bus = new EventBus();

/** 30分単位などへ丸めた時刻ラベルのステップ生成 (分単位の配列) */
export function range(start, end, step) {
  const out = [];
  for (let v = start; v <= end; v += step) out.push(v);
  return out;
}

/**
 * 検索用に文字列を正規化する。
 * - 全角英数記号 → 半角
 * - 全角スペース → 半角スペース
 * - カタカナ → ひらがな(ひらがな⇄カタカナを同一視するため片方向に寄せる)
 * - 大文字 → 小文字
 * 半角カタカナの変換は対象データに現れない想定のため未対応(既知の制限)。
 */
export function normalizeSearchText(input) {
  if (!input) return "";
  let s = String(input);
  // 全角英数記号(U+FF01-FF5E) → 半角(U+0021-007E)
  s = s.replace(/[！-～]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
  // 全角スペース(U+3000) → 半角スペース
  s = s.replace(/　/g, " ");
  // 全角カタカナ(U+30A1-30F6) → ひらがな(U+3041-3096)
  s = s.replace(/[ァ-ヶ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60));
  return s.toLowerCase().trim();
}
