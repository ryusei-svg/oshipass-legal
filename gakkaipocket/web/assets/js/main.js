// main.js — アプリシェルの起動・ナビゲーション・ハッシュルーティングの統合
// #/day/1, #/day/2, #/search, #/mytaite, #/session/<actId> を扱う。
// 不明なハッシュは1日目にフォールバックする。

import { loadCatalogModel } from "./catalog.js";
import { renderGrid } from "./grid.js";
import { openSessionDetail, closeSessionDetail } from "./session-detail.js";
import { renderSearchPage } from "./search.js";
import { renderMytaitePage } from "./mytaite.js";
import { openAboutModal } from "./about.js";
import { formatDateShort } from "./util.js";

const tabsEl = document.getElementById("day-tabs");
const pageContainer = document.getElementById("grid-container");
const statusEl = document.getElementById("grid-status");
const footerLinkEl = document.getElementById("gp-official-link");
const footerEventNameEl = document.getElementById("gp-event-name");
const aboutTriggerEl = document.getElementById("gp-about-trigger");

let model = null;
let currentPage = null; // "day" | "search" | "mytaite"
let currentDayNumber = null;
let currentPageController = null;
let lastPageHash = "#/day/1";

init();

async function init() {
  // カタログのfetch開始前にSWの登録を済ませておく。SW側のinstallハンドラが
  // カタログJSONをプリキャッシュするため、なるべく早く登録した方が
  // 「初回オンライン閲覧直後にオフラインになる」ケースでもキャッシュが間に合いやすい。
  registerServiceWorker();

  try {
    model = await loadCatalogModel();
  } catch (err) {
    console.error("[main] カタログの取得に失敗しました", err);
    showFatalError();
    return;
  }

  buildNavTabs(model);
  populateFooter(model);
  statusEl.hidden = true;

  if (aboutTriggerEl) {
    aboutTriggerEl.addEventListener("click", () => openAboutModal(model.event));
  }

  window.addEventListener("hashchange", handleRoute);
  handleRoute();
}

function buildNavTabs(m) {
  tabsEl.textContent = "";

  m.days.forEach((day) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "gp-day-tab";
    btn.dataset.nav = `day:${day.dayNumber}`;
    btn.textContent = `${day.dayNumber}日目 ${formatDateShort(day.activityDate)}`;
    btn.addEventListener("click", () => {
      location.hash = `#/day/${day.dayNumber}`;
    });
    tabsEl.appendChild(btn);
  });

  const searchBtn = document.createElement("button");
  searchBtn.type = "button";
  searchBtn.className = "gp-day-tab gp-nav-action";
  searchBtn.dataset.nav = "search";
  searchBtn.textContent = "検索";
  searchBtn.addEventListener("click", () => {
    location.hash = "#/search";
  });
  tabsEl.appendChild(searchBtn);

  const mytaiteBtn = document.createElement("button");
  mytaiteBtn.type = "button";
  mytaiteBtn.className = "gp-day-tab gp-nav-action";
  mytaiteBtn.dataset.nav = "mytaite";
  mytaiteBtn.textContent = "マイタイテ";
  mytaiteBtn.addEventListener("click", () => {
    location.hash = "#/mytaite";
  });
  tabsEl.appendChild(mytaiteBtn);
}

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

function populateFooter(m) {
  const url = m.event.official_url;
  const safeUrl = getSafeHttpUrl(url);
  if (safeUrl) {
    footerLinkEl.href = safeUrl;
    footerLinkEl.textContent = "大会公式サイトを見る";
  } else if (url) {
    // https:/http: 以外のスキームはリンク化せず、テキストとしてのみ表示する
    const span = document.createElement("span");
    span.className = footerLinkEl.className;
    span.textContent = "大会公式サイトを見る";
    footerLinkEl.replaceWith(span);
  } else {
    footerLinkEl.remove();
  }
  if (footerEventNameEl) {
    footerEventNameEl.textContent = m.event.name;
  }
}

function showFatalError() {
  statusEl.hidden = false;
  statusEl.textContent =
    "プログラム情報の取得に失敗しました。通信環境をご確認のうえ、再読み込みしてください。";
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

function parseRoute(hash) {
  if (hash === "#/search") return { type: "search" };
  if (hash === "#/mytaite") return { type: "mytaite" };

  const dayMatch = /^#\/day\/(\d+)$/.exec(hash);
  if (dayMatch) return { type: "day", day: Number(dayMatch[1]) };

  const sessionMatch = /^#\/session\/([A-Za-z0-9_]+)$/.exec(hash);
  if (sessionMatch) return { type: "session", actId: sessionMatch[1] };

  return null;
}

/**
 * 履歴エントリを追加せずに現在のハッシュを置き換える(ハッシュの正規化・シートを
 * 閉じた時のURL巻き戻しなど、「ユーザー操作としてのページ遷移」ではない場面で使う)。
 */
function replaceHash(hash) {
  const url = `${location.pathname}${location.search}${hash}`;
  history.replaceState(history.state, document.title, url);
}

function handleRoute() {
  if (!model) return;
  const parsed = parseRoute(location.hash);

  if (parsed && parsed.type === "session") {
    const found = model.actIndex.get(parsed.actId);
    if (!found) {
      replaceHash("#/day/1");
      handleRoute();
      return;
    }

    // このセッション詳細ハッシュが「既に表示中のページの上にアプリ内遷移(クリック)で
    // 積まれたものか」を、直リンク/初回アクセスかどうかで判定する。前者ならシートを
    // 閉じる時に history.back() で1つ前のエントリへ戻し、後者(直リンク)なら
    // replaceState で土台のdayページへ書き換える。どちらも新しい履歴エントリを
    // 積まないため、「開く→閉じる→戻る」でループしたり、戻った先で
    // シートが再び開いたりしない。
    const openedViaNav = currentPage !== null;

    if (!currentPage) {
      // 初回アクセスが直接 #/session/... の場合は、そのセッションが属する日を土台にする
      renderDayPage(found.day.dayNumber);
      lastPageHash = `#/day/${found.day.dayNumber}`;
    }

    const sessionHash = location.hash;

    openSessionDetail(
      {
        act: found.act,
        day: found.day,
        artistsById: model.artistsById,
        venuesById: model.venuesById,
        eventId: model.event.id,
      },
      {
        onClose() {
          // ハッシュが既に(ルーティング側の処理で)別のページへ変わっている場合は、
          // その変化に追従してシートを閉じただけなので、ここでは何もしない。
          // ここで再度ハッシュを書き換えると、そのイベント自体がループの原因になる。
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

  if (parsed && parsed.type === "search") {
    lastPageHash = "#/search";
    renderSearch();
    return;
  }

  if (parsed && parsed.type === "mytaite") {
    lastPageHash = "#/mytaite";
    renderMytaite();
    return;
  }

  const dayNumber =
    parsed && parsed.type === "day" && model.days.some((d) => d.dayNumber === parsed.day)
      ? parsed.day
      : model.days[0].dayNumber;

  if (!parsed || parsed.type !== "day" || dayNumber !== parsed.day) {
    // 空ハッシュ・不正なハッシュの正規化は履歴を積まない(replaceState)。
    replaceHash(`#/day/${dayNumber}`);
    lastPageHash = `#/day/${dayNumber}`;
    renderDayPage(dayNumber);
    return;
  }

  lastPageHash = `#/day/${dayNumber}`;
  renderDayPage(dayNumber);
}

function destroyCurrentPageController() {
  if (currentPageController) {
    currentPageController.destroy();
    currentPageController = null;
  }
}

function renderDayPage(dayNumber) {
  const day = model.days.find((d) => d.dayNumber === dayNumber);
  if (!day) return;

  const alreadyShown = currentPage === "day" && currentDayNumber === dayNumber;
  updateNavActive({ page: "day", dayNumber });
  currentPage = "day";
  currentDayNumber = dayNumber;

  if (alreadyShown) return;

  destroyCurrentPageController();
  pageContainer.className = "tt-viewport";
  currentPageController = renderGrid(
    pageContainer,
    day,
    model.artistsById,
    (actId) => {
      location.hash = `#/session/${actId}`;
    },
    model.venuesById
  );
}

function renderSearch() {
  const alreadyShown = currentPage === "search";
  updateNavActive({ page: "search" });
  currentPage = "search";
  currentDayNumber = null;
  if (alreadyShown) return; // 検索語・フィルタ状態を保持したまま(セッション詳細を閉じた時など)

  destroyCurrentPageController();
  pageContainer.className = "gp-page-scroll";
  currentPageController = renderSearchPage(pageContainer, model, {
    onSelectAct: (actId) => {
      location.hash = `#/session/${actId}`;
    },
  });
}

function renderMytaite() {
  const alreadyShown = currentPage === "mytaite";
  updateNavActive({ page: "mytaite" });
  currentPage = "mytaite";
  currentDayNumber = null;
  if (alreadyShown) return; // スクロール位置などを保持したまま

  destroyCurrentPageController();
  pageContainer.className = "gp-page-scroll";
  currentPageController = renderMytaitePage(pageContainer, model, {
    onSelectAct: (actId) => {
      location.hash = `#/session/${actId}`;
    },
  });
}

function updateNavActive({ page, dayNumber }) {
  const tabs = tabsEl.querySelectorAll("[data-nav]");
  tabs.forEach((tab) => {
    const nav = tab.dataset.nav;
    const isActive =
      (page === "day" && nav === `day:${dayNumber}`) ||
      (page === "search" && nav === "search") ||
      (page === "mytaite" && nav === "mytaite");
    tab.classList.toggle("is-active", isActive);
    if (isActive) tab.setAttribute("aria-current", "page");
    else tab.removeAttribute("aria-current");
  });
}
