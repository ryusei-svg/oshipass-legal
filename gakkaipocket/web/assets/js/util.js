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
 * "YYYY-MM-DD" を "10月8日" のように整形する(当日ビューの案内文言用)。
 * formatDateShort と同様、文字列から取り出した成分をそのまま組み立てるだけで
 * Dateオブジェクトの端末タイムゾーン依存メソッドは使わない。
 */
export function formatDateLong(activityDate) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(activityDate || "");
  if (!m) return activityDate || "";
  return `${Number(m[2])}月${Number(m[3])}日`;
}

/**
 * `?now=` 検証用オーバーライドの使用を許可するホストかどうか。
 * 本番配信ホストで誤ってクエリを付けても現在時刻が偽装されないよう、
 * localhost / 127.0.0.1 での動作確認時のみ有効にする。
 */
export function isNowOverrideAllowedHost() {
  if (typeof location === "undefined") return false;
  return location.hostname === "localhost" || location.hostname === "127.0.0.1";
}

/**
 * 現在時刻を表す Date を返す(常に「本物の絶対時刻」を返す。Dateは内部的に
 * UTCのタイムスタンプを持つため、この値そのものは端末タイムゾーンに依存しない)。
 *
 * URLクエリに `?now=2026-10-08T13:45` (検証用) が指定されている場合は、
 * その値を日本時間(+09:00)とみなして解釈した時刻を返す。オフセット表記
 * (Z や +09:00 等)を含む値が渡された場合はそれを優先する。
 * このオーバーライドは isNowOverrideAllowedHost() が true の場合(localhost /
 * 127.0.0.1 での動作確認時)のみ有効。本番配信ホストでは常に無視され、
 * 実際の現在時刻を返す。
 * 未指定時・不正な値の場合も実際の現在時刻を返す。
 */
export function resolveNow() {
  if (isNowOverrideAllowedHost()) {
    const params = new URLSearchParams(location.search);
    const override = params.get("now");
    if (override) {
      const hasOffset = /(Z|[+-]\d{2}:?\d{2})$/.test(override);
      const withOffset = hasOffset ? override : `${override}+09:00`;
      const parsed = new Date(withOffset);
      if (!Number.isNaN(parsed.getTime())) return parsed;
    }
  }
  return new Date();
}

/**
 * 現在有効な `?now=` オーバーライドの生文字列を返す(検証モードバナー表示用)。
 * 許可ホストでない場合・未指定の場合・不正な値の場合は null。
 */
export function getActiveNowOverrideLabel() {
  if (!isNowOverrideAllowedHost()) return null;
  const params = new URLSearchParams(location.search);
  const override = params.get("now");
  if (!override) return null;
  const now = resolveNow();
  if (Number.isNaN(now.getTime())) return null;
  try {
    return now.toLocaleString("ja-JP", {
      timeZone: "Asia/Tokyo",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch (err) {
    return override;
  }
}

/**
 * 与えられた Date が指す瞬間の「日本時間での暦日」を "YYYY-MM-DD" で返す。
 * Date#getFullYear()/getMonth()/getDate() のような端末タイムゾーン依存の
 * アクセサは使わず、絶対時刻(getTime())に9時間を加算した上で
 * getUTCFullYear() 等のUTC系アクセサ(タイムゾーン非依存)で成分を取り出す。
 * これにより、端末が海外タイムゾーンでもカタログ上の暦日どおりに判定できる。
 */
export function jstDateString(date) {
  const shifted = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  const y = shifted.getUTCFullYear();
  const mo = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const d = String(shifted.getUTCDate()).padStart(2, "0");
  return `${y}-${mo}-${d}`;
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

let toastEl = null;
let toastHideTimer = null;

/**
 * 画面下部に一時的なトースト通知を表示する(localStorage書き込み失敗時の
 * 案内などに使う)。role="status"/aria-live="polite" のためスクリーンリーダーにも通知される。
 * @param {string} message
 */
export function showToast(message) {
  if (typeof document === "undefined") return;
  if (!toastEl) {
    toastEl = document.createElement("div");
    toastEl.className = "gp-toast";
    toastEl.setAttribute("role", "status");
    toastEl.setAttribute("aria-live", "polite");
    document.body.appendChild(toastEl);
  }
  toastEl.textContent = message;
  // 一度クラスを外して再度付け直すことで、連続表示時にもフェードインをやり直す。
  toastEl.classList.remove("is-visible");
  // eslint禁止のvoid式ではなく、reflowを発生させて再アニメーションさせるための参照。
  void toastEl.offsetWidth;
  toastEl.classList.add("is-visible");

  if (toastHideTimer) clearTimeout(toastHideTimer);
  toastHideTimer = setTimeout(() => {
    if (toastEl) toastEl.classList.remove("is-visible");
  }, 3200);
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
