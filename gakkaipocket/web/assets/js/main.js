// main.js — アプリシェルの起動・ナビゲーション・ハッシュルーティングの統合(複数大会対応)
//
// URL形式(大会をまたいでも共有URLが壊れないよう、大会IDをハッシュに含める):
//   #/e/<eventId>/day/<n>     ... 大会内の日別グリッド
//   #/e/<eventId>/search      ... 大会内の検索
//   #/e/<eventId>/today       ... 大会内の当日ビュー
//   #/e/<eventId>/session/<actId> ... セッション詳細(共有URL)
//   #/events                  ... 大会一覧(選択画面)
//   #/ または空                ... 選択中(localStorage)の大会、無ければ唯一の大会を開く。
//                                  大会が2件以上かつ未選択なら #/events へ。
//
// 後方互換: 旧形式 #/day/<n> #/search #/today #/mytaite #/session/<actId> は、
// 選択中(または唯一)の大会の新形式へ replaceState で読み替える。履歴は積まない。
// #/session/<actId> は選択中の大会に該当actが無ければ、他の大会のJSONを順に
// 読んで見つかった大会で開く(見つからなければ大会一覧へ)。
//
// 不正・未知の eventId は大会一覧へフォールバックする。

import { loadIndex, loadEvent } from "./catalog.js";
import { renderGrid } from "./grid.js";
import { openSessionDetail, closeSessionDetail } from "./session-detail.js";
import { renderSearchPage } from "./search.js";
import { renderMytaitePage } from "./mytaite.js";
import { renderEventsListPage, renderUnpublishedNotice } from "./events.js";
import { openAboutModal } from "./about.js";
import { openOnboarding } from "./onboarding.js";
import { formatDateShort, h } from "./util.js";

const EVENT_STORAGE_KEY = "gp:event:v1";

const eventHeaderEl = document.getElementById("event-header");
const tabsEl = document.getElementById("day-tabs");
const pageContainer = document.getElementById("grid-container");
const statusEl = document.getElementById("grid-status");
const footerLinkEl = document.getElementById("gp-official-link");
const footerDetailEl = document.getElementById("gp-event-footer-detail");
const footerEventNameEl = document.getElementById("gp-event-name");
const aboutTriggerEl = document.getElementById("gp-about-trigger");
const footerToggleEl = document.getElementById("gp-footer-toggle");
const footerDetailsEl = document.getElementById("gp-footer-details");

let indexEvents = []; // index.json の events[](大会メタ情報の一覧)

let currentEventId = null; // 現在表示中の大会ID
let currentModel = null; // loadEvent() が返す現在の大会の正規化モデル
let navTabsEventId = null; // 日タブが現在どの大会向けに構築済みか

let currentPage = null; // "day" | "search" | "today" | "events" | "notice" | "error" | null(未描画)
let currentPageEventId = null; // currentPage がどの大会のものか(大会切り替え検知用)
let currentDayNumber = null;
let currentPageController = null;
let lastPageHash = "#/events";

// 初回ガイド(onboarding.js)は「グリッド読み込み後」の最初の1回だけ表示を試みる。
// この判定自体はセッション内で一度でよい(実際に出すかどうかはonboarding.js側が
// localStorage の gp:onboarded:v1 で最終判断する)。
let onboardingChecked = false;
function maybeShowOnboarding() {
  if (onboardingChecked) return;
  onboardingChecked = true;
  openOnboarding();
}

// 同時に走りうる非同期ルーティング処理のうち、最後に開始したもの以外の結果を
// 画面に反映させないためのトークン。hashchangeの連打やイベント切り替え中の
// 追加ナビゲーションでも、古い処理が後から画面を上書きしないようにする。
let routeToken = 0;

init();

async function init() {
  // カタログのfetch開始前にSWの登録を済ませておく。SW側のinstallハンドラが
  // シェル+index.json+masters.jsonをプリキャッシュするため、なるべく早く
  // 登録した方が「初回オンライン閲覧直後にオフラインになる」ケースでも間に合いやすい。
  registerServiceWorker();

  if (aboutTriggerEl) {
    aboutTriggerEl.addEventListener("click", () => {
      openAboutModal(currentModel ? currentModel.event : null);
    });
  }

  setupFooterToggle();

  try {
    const idx = await loadIndex();
    indexEvents = idx.events;
  } catch (err) {
    console.error("[main] 大会一覧の取得に失敗しました", err);
    showFatalError();
    return;
  }

  window.addEventListener("hashchange", handleRoute);
  handleRoute();
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  const register = () => {
    navigator.serviceWorker
      .register("./sw.js")
      .catch((err) => console.warn("[main] Service Worker の登録に失敗しました", err));
  };
  if (document.readyState === "complete") register();
  else window.addEventListener("load", register);
}

/* ------------------------------------------------------------------ */
/* ルーティング                                                          */
/* ------------------------------------------------------------------ */

function parseRoute(hash) {
  if (hash === "#/events") return { type: "events" };

  let m = /^#\/e\/([A-Za-z0-9_]+)\/day\/(\d+)$/.exec(hash);
  if (m) return { type: "day", eventId: m[1], day: Number(m[2]) };

  m = /^#\/e\/([A-Za-z0-9_]+)\/search$/.exec(hash);
  if (m) return { type: "search", eventId: m[1] };

  m = /^#\/e\/([A-Za-z0-9_]+)\/today$/.exec(hash);
  if (m) return { type: "today", eventId: m[1] };

  m = /^#\/e\/([A-Za-z0-9_]+)\/session\/([A-Za-z0-9_]+)$/.exec(hash);
  if (m) return { type: "session", eventId: m[1], actId: m[2] };

  // 後方互換(大会IDを含まない旧形式)
  if (hash === "#/search") return { type: "legacy-search" };
  if (hash === "#/today") return { type: "legacy-today" };
  if (hash === "#/mytaite") return { type: "legacy-today" };

  m = /^#\/day\/(\d+)$/.exec(hash);
  if (m) return { type: "legacy-day", day: Number(m[1]) };

  m = /^#\/session\/([A-Za-z0-9_]+)$/.exec(hash);
  if (m) return { type: "legacy-session", actId: m[1] };

  return null; // 空ハッシュ・不正なハッシュ
}

/**
 * 履歴エントリを追加せずに現在のハッシュを置き換える(ハッシュの正規化・シートを
 * 閉じた時のURL巻き戻しなど、「ユーザー操作としてのページ遷移」ではない場面で使う)。
 */
function replaceHash(hash) {
  const url = `${location.pathname}${location.search}${hash}`;
  history.replaceState(history.state, document.title, url);
}

function isKnownEvent(eventId) {
  return indexEvents.some((e) => e.id === eventId);
}

function getSelectedEventId() {
  try {
    return localStorage.getItem(EVENT_STORAGE_KEY);
  } catch (err) {
    return null;
  }
}

function setSelectedEventId(eventId) {
  try {
    localStorage.setItem(EVENT_STORAGE_KEY, eventId);
  } catch (err) {
    /* no-op */
  }
}

/** 選択中(localStorageに保存済みで実在する)の大会、無ければ唯一の大会のIDを返す。判定不能なら null。 */
function resolveDefaultEventId() {
  const selected = getSelectedEventId();
  if (selected && isKnownEvent(selected)) return selected;
  if (indexEvents.length === 1) return indexEvents[0].id;
  return null;
}

async function safeLoadEvent(eventId) {
  try {
    return await loadEvent(eventId);
  } catch (err) {
    console.warn(`[main] 大会データの取得に失敗しました: ${eventId}`, err);
    return null;
  }
}

async function handleRoute() {
  const myToken = ++routeToken;
  const parsed = parseRoute(location.hash);

  if (parsed && parsed.type === "events") {
    closeSessionDetail();
    showEventsListPage();
    return;
  }

  if (parsed && parsed.type.startsWith("legacy-")) {
    await handleLegacyRoute(parsed, myToken);
    return;
  }

  if (!parsed) {
    // ルート(空ハッシュ・#/ ・その他不正なハッシュ)
    const defaultId = resolveDefaultEventId();
    if (!defaultId) {
      replaceHash("#/events");
      handleRoute();
      return;
    }
    replaceHash(`#/e/${defaultId}/day/1`);
    handleRoute();
    return;
  }

  if (!isKnownEvent(parsed.eventId)) {
    replaceHash("#/events");
    handleRoute();
    return;
  }

  await openEventRoute(parsed.eventId, parsed, myToken);
}

/** 大会IDを含まない旧ハッシュを、選択中(または唯一)の大会の新形式へ読み替える。 */
async function handleLegacyRoute(parsed, myToken) {
  if (parsed.type === "legacy-session") {
    const defaultId = resolveDefaultEventId();
    let foundEventId = null;

    if (defaultId) {
      const m = await safeLoadEvent(defaultId);
      if (myToken !== routeToken) return;
      if (m && m.actIndex.has(parsed.actId)) foundEventId = defaultId;
    }

    if (!foundEventId) {
      for (const ev of indexEvents) {
        if (ev.id === defaultId) continue;
        const m = await safeLoadEvent(ev.id);
        if (myToken !== routeToken) return;
        if (m && m.actIndex.has(parsed.actId)) {
          foundEventId = ev.id;
          break;
        }
      }
    }

    if (myToken !== routeToken) return;

    if (!foundEventId) {
      replaceHash("#/events");
      handleRoute();
      return;
    }

    replaceHash(`#/e/${foundEventId}/session/${parsed.actId}`);
    handleRoute();
    return;
  }

  const defaultId = resolveDefaultEventId();
  if (!defaultId) {
    replaceHash("#/events");
    handleRoute();
    return;
  }

  let newHash;
  if (parsed.type === "legacy-day") newHash = `#/e/${defaultId}/day/${parsed.day}`;
  else if (parsed.type === "legacy-search") newHash = `#/e/${defaultId}/search`;
  else newHash = `#/e/${defaultId}/today`; // legacy-today (#/today, #/mytaite)

  replaceHash(newHash);
  handleRoute();
}

/**
 * 有効な eventId が確定したルートを処理する。大会データを読み込み、
 * timetable_status に応じて通常画面(グリッド/検索/当日)か未公開案内画面を出し分ける。
 */
async function openEventRoute(eventId, parsed, myToken) {
  setSelectedEventId(eventId);

  const eventChanged = eventId !== currentEventId;
  if (eventChanged) {
    destroyCurrentPageController();
    closeSessionDetail();
    currentPage = null;
    currentPageEventId = null;
    currentDayNumber = null;
    pageContainer.textContent = "";
    tabsEl.hidden = true;
    eventHeaderEl.hidden = true;
    statusEl.hidden = false;
    statusEl.textContent = "プログラム情報を読み込んでいます…";
  }

  const meta = indexEvents.find((e) => e.id === eventId);
  const status = meta ? meta.timetable_status : "unannounced";

  // 未公開(published以外)の大会は、イベントJSONの取得を待たずに案内を出す。
  // 準備中の大会はイベントJSONがまだ配信されていないことがあり、先に取得を試みると
  // 404で「取得に失敗しました」になってしまうため、状態の判定を先に行う。
  if (status !== "published") {
    currentEventId = eventId;
    currentModel = null;
    statusEl.hidden = true;
    tabsEl.hidden = true;
    tabsEl.textContent = "";
    navTabsEventId = null;
    renderEventHeader();
    populateFooterGeneric();
    renderNoticePage(meta ? meta.name : "");

    // 公式サイトURLはイベントJSON側にしか無いため、取得できた場合のみ後から補う。
    safeLoadEvent(eventId).then((loaded) => {
      if (myToken !== routeToken || !loaded || currentPage !== "notice") return;
      currentModel = loaded;
      renderNoticePage(meta ? meta.name : "");
    });
    return;
  }

  const m = await safeLoadEvent(eventId);
  if (myToken !== routeToken) return;

  if (!m) {
    showFatalError();
    return;
  }

  currentEventId = eventId;
  currentModel = m;
  statusEl.hidden = true;

  renderEventHeader();

  if (navTabsEventId !== eventId) {
    buildNavTabs(m, eventId);
  }
  tabsEl.hidden = false;
  populateFooterForEvent(m.event);

  if (parsed.type === "session") {
    const found = m.actIndex.get(parsed.actId);
    if (!found) {
      replaceHash(`#/e/${eventId}/day/1`);
      handleRoute();
      return;
    }

    const isFreshBase = currentPage === null || currentPageEventId !== eventId;
    const openedViaNav = !isFreshBase;

    if (isFreshBase) {
      renderDayPage(found.day.dayNumber);
      lastPageHash = `#/e/${eventId}/day/${found.day.dayNumber}`;
    }

    const sessionHash = location.hash;

    openSessionDetail(
      {
        act: found.act,
        day: found.day,
        artistsById: m.artistsById,
        venuesById: m.venuesById,
        eventId: m.event.id,
      },
      {
        onClose() {
          // ハッシュが既に(ルーティング側の処理で)別のページへ変わっている場合は、
          // その変化に追従してシートを閉じただけなので、ここでは何もしない。
          if (location.hash !== sessionHash) return;

          if (openedViaNav) {
            history.back();
          } else {
            replaceHash(lastPageHash);
          }
        },
      }
    );
    return;
  }

  closeSessionDetail();

  if (parsed.type === "search") {
    lastPageHash = `#/e/${eventId}/search`;
    renderSearch();
    return;
  }

  if (parsed.type === "today") {
    lastPageHash = `#/e/${eventId}/today`;
    renderToday();
    return;
  }

  const dayNumber =
    parsed.type === "day" && m.days.some((d) => d.dayNumber === parsed.day)
      ? parsed.day
      : (m.days[0] ? m.days[0].dayNumber : 1);

  if (parsed.type !== "day" || dayNumber !== parsed.day) {
    replaceHash(`#/e/${eventId}/day/${dayNumber}`);
    lastPageHash = `#/e/${eventId}/day/${dayNumber}`;
    renderDayPage(dayNumber);
    maybeShowOnboarding();
    return;
  }

  lastPageHash = `#/e/${eventId}/day/${dayNumber}`;
  renderDayPage(dayNumber);
  maybeShowOnboarding();
}

/* ------------------------------------------------------------------ */
/* ヘッダー(大会名・切り替えボタン)                                        */
/* ------------------------------------------------------------------ */

function renderEventHeader() {
  eventHeaderEl.textContent = "";
  const meta = indexEvents.find((e) => e.id === currentEventId);
  if (!meta) {
    eventHeaderEl.hidden = true;
    return;
  }
  eventHeaderEl.hidden = false;

  if (indexEvents.length > 1) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "gp-event-switch";
    btn.setAttribute("aria-label", `${meta.name}(大会を切り替える)`);

    const nameSpan = document.createElement("span");
    nameSpan.className = "gp-event-switch-name";
    nameSpan.textContent = meta.name;
    btn.appendChild(nameSpan);
    btn.appendChild(buildChevronIcon());

    btn.addEventListener("click", () => {
      location.hash = "#/events";
    });
    eventHeaderEl.appendChild(btn);
  } else {
    const span = document.createElement("span");
    span.className = "gp-event-switch gp-event-switch--static";
    span.textContent = meta.name;
    eventHeaderEl.appendChild(span);
  }
}

function buildChevronIcon() {
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "16");
  svg.setAttribute("height", "16");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.setAttribute("class", "gp-event-switch-chevron");

  const path = document.createElementNS(NS, "path");
  path.setAttribute("d", "M9 6l6 6-6 6");
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", "currentColor");
  path.setAttribute("stroke-width", "2");
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-linejoin", "round");
  svg.appendChild(path);

  return svg;
}

function buildNavTabs(m, eventId) {
  tabsEl.textContent = "";
  navTabsEventId = eventId;

  m.days.forEach((day) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "gp-day-tab";
    btn.dataset.nav = `day:${day.dayNumber}`;
    btn.textContent = `${day.dayNumber}日目 ${formatDateShort(day.activityDate)}`;
    btn.addEventListener("click", () => {
      location.hash = `#/e/${eventId}/day/${day.dayNumber}`;
    });
    tabsEl.appendChild(btn);
  });

  const searchBtn = document.createElement("button");
  searchBtn.type = "button";
  searchBtn.className = "gp-day-tab gp-nav-action";
  searchBtn.dataset.nav = "search";
  searchBtn.textContent = "検索";
  searchBtn.addEventListener("click", () => {
    location.hash = `#/e/${eventId}/search`;
  });
  tabsEl.appendChild(searchBtn);

  const todayBtn = document.createElement("button");
  todayBtn.type = "button";
  todayBtn.className = "gp-day-tab gp-nav-action";
  todayBtn.dataset.nav = "today";
  todayBtn.textContent = "当日";
  todayBtn.addEventListener("click", () => {
    location.hash = `#/e/${eventId}/today`;
  });
  tabsEl.appendChild(todayBtn);
}

function updateNavActive({ page, dayNumber }) {
  const tabs = tabsEl.querySelectorAll("[data-nav]");
  tabs.forEach((tab) => {
    const nav = tab.dataset.nav;
    const isActive =
      (page === "day" && nav === `day:${dayNumber}`) ||
      (page === "search" && nav === "search") ||
      (page === "today" && nav === "today");
    tab.classList.toggle("is-active", isActive);
    if (isActive) tab.setAttribute("aria-current", "page");
    else tab.removeAttribute("aria-current");
  });
}

/* ------------------------------------------------------------------ */
/* フッター(非公式明示・法務 + 大会情報)                                    */
/* ------------------------------------------------------------------ */

/**
 * https:/http: 以外のスキーム(javascript: 等)がURLとして混入していても
 * href に設定しないようにする。妥当な場合のみ正規化済みのhrefを返す。
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

function populateFooterForEvent(event) {
  if (footerDetailEl) footerDetailEl.hidden = false;
  if (footerEventNameEl) footerEventNameEl.textContent = event ? event.name : "";

  if (!footerLinkEl) return;
  const safeUrl = getSafeHttpUrl(event ? event.official_url : null);
  if (safeUrl) {
    footerLinkEl.hidden = false;
    footerLinkEl.href = safeUrl;
    footerLinkEl.classList.remove("is-plain");
    footerLinkEl.textContent = "大会公式サイトを見る";
  } else if (event && event.official_url) {
    // https:/http: 以外のスキームはリンク化せず、テキストとしてのみ表示する
    footerLinkEl.hidden = false;
    footerLinkEl.removeAttribute("href");
    footerLinkEl.classList.add("is-plain");
    footerLinkEl.textContent = "大会公式サイトを見る";
  } else {
    footerLinkEl.hidden = true;
  }

  syncFooterToggleAvailability();
}

/** 大会一覧・未公開案内・エラー画面など、特定の大会に紐づかない画面向けのフッター。 */
function populateFooterGeneric() {
  if (footerDetailEl) footerDetailEl.hidden = true;
  if (footerEventNameEl) footerEventNameEl.textContent = "";
  if (footerLinkEl) footerLinkEl.hidden = true;
  syncFooterToggleAvailability();
}

const FOOTER_OPEN_KEY = "gp:footer-open:v1";

/**
 * フッターの補足(出典・公式サイトリンク)の開閉。非公式である旨の一文は法務要件のため
 * 常時表示で、ここで折りたたむのは補足だけ。開閉状態はlocalStorageに保持し、
 * 開いたままにしたい利用者が毎回開き直さずに済むようにする。
 */
function setupFooterToggle() {
  if (!footerToggleEl || !footerDetailsEl) return;

  let open = false;
  try {
    open = localStorage.getItem(FOOTER_OPEN_KEY) === "1";
  } catch (err) {
    open = false;
  }
  applyFooterOpenState(open);

  footerToggleEl.addEventListener("click", () => {
    const next = footerToggleEl.getAttribute("aria-expanded") !== "true";
    applyFooterOpenState(next);
    try {
      localStorage.setItem(FOOTER_OPEN_KEY, next ? "1" : "0");
    } catch (err) {
      // プライベートブラウズ等で保存できなくても開閉自体は成立させる
    }
  });
}

function applyFooterOpenState(open) {
  if (!footerToggleEl || !footerDetailsEl) return;
  footerToggleEl.setAttribute("aria-expanded", open ? "true" : "false");
  footerToggleEl.setAttribute("aria-label", open ? "出典と注意事項を閉じる" : "出典と注意事項を開く");
  footerDetailsEl.hidden = !open;
}

/**
 * 補足の中身が両方とも空になる画面(大会一覧など)では、開いても何も出ないため
 * 開閉ボタン自体を隠す。
 */
function syncFooterToggleAvailability() {
  if (!footerToggleEl || !footerDetailsEl) return;
  const hasDetail = footerDetailEl && !footerDetailEl.hidden;
  const hasLink = footerLinkEl && !footerLinkEl.hidden;
  const usable = Boolean(hasDetail || hasLink);
  footerToggleEl.hidden = !usable;
  if (!usable) footerDetailsEl.hidden = true;
  else applyFooterOpenState(footerToggleEl.getAttribute("aria-expanded") === "true");
}

/* ------------------------------------------------------------------ */
/* 各ページの描画                                                        */
/* ------------------------------------------------------------------ */

function destroyCurrentPageController() {
  if (currentPageController) {
    currentPageController.destroy();
    currentPageController = null;
  }
}

function showEventsListPage() {
  destroyCurrentPageController();
  currentPage = "events";
  currentPageEventId = null;
  currentDayNumber = null;
  lastPageHash = "#/events";

  tabsEl.hidden = true;
  tabsEl.textContent = "";
  navTabsEventId = null;
  eventHeaderEl.hidden = true;
  eventHeaderEl.textContent = "";
  statusEl.hidden = true;
  populateFooterGeneric();

  pageContainer.className = "gp-page-scroll";
  currentPageController = renderEventsListPage(pageContainer, indexEvents, {
    onSelectEvent(eventId) {
      location.hash = `#/e/${eventId}/day/1`;
    },
  });
}

/**
 * 未公開の大会の案内画面。イベントJSONがまだ無い場合でも出せるよう、大会名は索引側
 * (index.json)の値を使う。公式サイトURLはイベントJSONが取得できた場合のみ添える。
 */
function renderNoticePage(fallbackName = "") {
  destroyCurrentPageController();
  currentPage = "notice";
  currentPageEventId = currentEventId;
  currentDayNumber = null;
  lastPageHash = `#/e/${currentEventId}/day/1`;

  pageContainer.className = "gp-page-scroll";
  currentPageController = renderUnpublishedNotice(
    pageContainer,
    {
      name: (currentModel && currentModel.event ? currentModel.event.name : "") || fallbackName,
      officialUrl: currentModel && currentModel.event ? currentModel.event.official_url : null,
    },
    {
      onBackToEvents() {
        location.hash = "#/events";
      },
    }
  );
}

function renderDayPage(dayNumber) {
  const day = currentModel.days.find((d) => d.dayNumber === dayNumber);
  if (!day) return;

  const alreadyShown =
    currentPage === "day" && currentDayNumber === dayNumber && currentPageEventId === currentEventId;
  updateNavActive({ page: "day", dayNumber });
  currentPage = "day";
  currentDayNumber = dayNumber;
  currentPageEventId = currentEventId;

  if (alreadyShown) return;

  destroyCurrentPageController();
  pageContainer.className = "tt-viewport";
  currentPageController = renderGrid(
    pageContainer,
    day,
    currentModel.artistsById,
    (actId) => {
      location.hash = `#/e/${currentEventId}/session/${actId}`;
    },
    currentModel.venuesById
  );
}

function renderSearch() {
  const alreadyShown = currentPage === "search" && currentPageEventId === currentEventId;
  updateNavActive({ page: "search" });
  currentPage = "search";
  currentDayNumber = null;
  currentPageEventId = currentEventId;
  if (alreadyShown) return; // 検索語・フィルタ状態を保持したまま(セッション詳細を閉じた時など)

  destroyCurrentPageController();
  pageContainer.className = "gp-page-scroll";
  currentPageController = renderSearchPage(pageContainer, currentModel, {
    onSelectAct: (actId) => {
      location.hash = `#/e/${currentEventId}/session/${actId}`;
    },
  });
}

function renderToday() {
  const alreadyShown = currentPage === "today" && currentPageEventId === currentEventId;
  updateNavActive({ page: "today" });
  currentPage = "today";
  currentDayNumber = null;
  currentPageEventId = currentEventId;
  if (alreadyShown) return; // スクロール位置などを保持したまま

  destroyCurrentPageController();
  pageContainer.className = "gp-page-scroll";
  currentPageController = renderMytaitePage(pageContainer, currentModel, {
    onSelectAct: (actId) => {
      location.hash = `#/e/${currentEventId}/session/${actId}`;
    },
  });
}

function showFatalError() {
  destroyCurrentPageController();
  currentPage = "error";
  currentPageEventId = null;
  tabsEl.hidden = true;
  eventHeaderEl.hidden = true;
  populateFooterGeneric();
  pageContainer.textContent = "";
  statusEl.hidden = false;
  statusEl.textContent =
    "プログラム情報の取得に失敗しました。通信環境をご確認のうえ、再読み込みしてください。";

  // 大会が複数ある場合は、他の大会を試せるよう一覧への導線を添える。
  // (index.json 自体の取得に失敗した初回起動時は indexEvents が空のため表示されない)
  if (indexEvents.length > 1) {
    const backBtn = h("button", {
      className: "gp-notice-back",
      attrs: { type: "button" },
      text: "大会一覧へ戻る",
    });
    backBtn.addEventListener("click", () => {
      location.hash = "#/events";
    });
    pageContainer.className = "gp-page-scroll";
    pageContainer.appendChild(h("div", { className: "gp-notice", children: [backBtn] }));
  }
}
