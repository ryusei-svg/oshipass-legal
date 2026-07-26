// events.js — 大会一覧画面(#/events)と「タイムテーブル未公開」案内画面を描画する。

import { h } from "./util.js";

const STATUS_LABEL = {
  published: "タイムテーブル公開中",
  lineup_only: "演題のみ公開",
  unannounced: "準備中",
};

function statusClassName(status) {
  if (status === "published") return "gp-status-badge--published";
  if (status === "lineup_only") return "gp-status-badge--lineup";
  return "gp-status-badge--unannounced";
}

function parseDateParts(dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr || "");
  if (!m) return null;
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

/** ["2026-10-08","2026-10-09"] のような日付配列を「2026年10月8日〜9日」等に整形する */
function formatDateRange(dates) {
  if (!dates || !dates.length) return "";
  const first = parseDateParts(dates[0]);
  if (!first) return "";
  const last = parseDateParts(dates[dates.length - 1]);

  if (!last || (dates.length === 1)) {
    return `${first.year}年${first.month}月${first.day}日`;
  }
  if (first.year === last.year && first.month === last.month) {
    return `${first.year}年${first.month}月${first.day}日〜${last.day}日`;
  }
  if (first.year === last.year) {
    return `${first.year}年${first.month}月${first.day}日〜${last.month}月${last.day}日`;
  }
  return `${first.year}年${first.month}月${first.day}日〜${last.year}年${last.month}月${last.day}日`;
}

/** 会場名の配列を1行に整形する。多い場合は先頭2件+件数省略にする。 */
function formatVenueNames(names) {
  if (!names || !names.length) return "";
  if (names.length <= 2) return names.join("、");
  return `${names.slice(0, 2).join("、")} ほか${names.length - 2}件`;
}

/**
 * https:/http: 以外のスキームがURLとして混入していても href に設定しないようにする。
 * main.js / about.js と同じ方針の小さなヘルパー(モジュール間の依存を増やさないため
 * 意図的に重複させている)。
 * @param {string|undefined} url
 * @returns {string|null}
 */
function getSafeHttpUrl(url) {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "https:" || parsed.protocol === "http:") return parsed.href;
  } catch (err) {
    /* 不正なURL文字列 */
  }
  return null;
}

/**
 * 大会一覧画面を描画する。
 * @param {HTMLElement} container
 * @param {object[]} events - index.json の events[] (id/name/dates/venue_names/timetable_status)
 * @param {{ onSelectEvent: (eventId: string) => void }} handlers
 * @returns {{ destroy: () => void }}
 */
export function renderEventsListPage(container, events, { onSelectEvent }) {
  container.textContent = "";
  const wrap = h("div", { className: "gp-events" });
  wrap.appendChild(h("h1", { className: "gp-events-title", text: "大会を選ぶ" }));

  if (!events.length) {
    wrap.appendChild(
      h("p", { className: "gp-search-hint", text: "現在配信中の大会がありません。" })
    );
  } else {
    const list = h("div", { className: "gp-events-list" });
    for (const ev of events) {
      list.appendChild(buildEventCard(ev, onSelectEvent));
    }
    wrap.appendChild(list);
  }

  container.appendChild(wrap);
  return { destroy() {} };
}

function buildEventCard(ev, onSelectEvent) {
  const card = h("button", { className: "gp-event-card", attrs: { type: "button" } });

  card.appendChild(h("div", { className: "gp-event-card-name", text: ev.name }));

  const metaRow = h("div", { className: "gp-event-card-meta" });
  const dateText = formatDateRange(ev.dates);
  if (dateText) metaRow.appendChild(h("span", { text: dateText }));
  const venueText = formatVenueNames(ev.venue_names);
  if (venueText) metaRow.appendChild(h("span", { text: venueText }));
  if (metaRow.childNodes.length) card.appendChild(metaRow);

  card.appendChild(
    h("span", {
      className: `gp-status-badge ${statusClassName(ev.timetable_status)}`,
      text: STATUS_LABEL[ev.timetable_status] || STATUS_LABEL.unannounced,
    })
  );

  card.addEventListener("click", () => onSelectEvent(ev.id));
  return card;
}

/**
 * timetable_status が published でない大会を開いた場合の案内画面を描画する。
 * @param {HTMLElement} container
 * @param {{ name: string, officialUrl: string|undefined|null }} info
 * @param {{ onBackToEvents: () => void }} handlers
 * @returns {{ destroy: () => void }}
 */
export function renderUnpublishedNotice(container, info, { onBackToEvents }) {
  container.textContent = "";
  const wrap = h("div", { className: "gp-notice" });

  if (info.name) {
    wrap.appendChild(h("h1", { className: "gp-notice-title", text: info.name }));
  }
  wrap.appendChild(
    h("p", {
      className: "gp-notice-text",
      text: "この大会のタイムテーブルはまだ公開されていません。公開まで今しばらくお待ちください。",
    })
  );

  const safeUrl = getSafeHttpUrl(info.officialUrl);
  if (safeUrl) {
    wrap.appendChild(
      h("a", {
        className: "gp-notice-link",
        text: "大会公式サイトを見る",
        attrs: { href: safeUrl, target: "_blank", rel: "noopener" },
      })
    );
  }

  const backBtn = h("button", {
    className: "gp-notice-back",
    attrs: { type: "button" },
    text: "大会一覧へ戻る",
  });
  backBtn.addEventListener("click", onBackToEvents);
  wrap.appendChild(backBtn);

  container.appendChild(wrap);
  return { destroy() {} };
}
