// sw.js — 学会ポケット Web版 Service Worker
//
// 戦略:
// - アプリシェル(html/css/js/manifest): cache-first。SHELL_CACHE はバージョン付きの
//   キャッシュ名にし、activate時に古いバージョンのシェルキャッシュを削除する。
// - カタログJSON(../catalog/ 配下。web/ から見て親ディレクトリ): network-first、
//   失敗時はキャッシュへフォールバックしてオフライン閲覧を成立させる。
//   このSW自体は web/ 直下に置かれ scope は web/ 配下のクライアントのみだが、
//   「どのURLをfetchできるか」は scope と無関係(scopeは"どのページを制御するか"を
//   決めるだけ)なので、web/ 配下の制御下ページが ../catalog/... を fetch した
//   リクエストは通常どおりこの fetch イベントを通過する。
//   カタログのURLは self.registration.scope から動的に算出しており、絶対パスを
//   決め打ちしていない(配信パスが変わっても動作する)。
// - install時にシェル一式に加えて index.json / masters.json(全大会共通、かつ
//   大会一覧画面の描画に必須)もプリキャッシュする。個々の大会のイベントJSONは
//   複数大会ぶんを事前に全取得すると重くなるためプリキャッシュ対象に含めない。
//   その代わり network-first で扱っており、大会を実際に開いた時点でキャッシュされる
//   (「開いたことのある大会はオフラインでも読める」が成立すれば十分なため)。
//
// キャッシュ名は冒頭の VERSION 定数に一本化している。
// シェル(HTML/CSS/JS)の内容を変更したら、必ずこの VERSION を上げること。
// (上げないと、cache-first で配っている古いシェルがユーザーの端末に残り続ける)

const VERSION = "v11";
const SHELL_CACHE = `gp-shell-${VERSION}`;
const CATALOG_CACHE = `gp-catalog-${VERSION}`;

const SHELL_PATHS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./assets/app.css",
  "./assets/js/util.js",
  "./assets/js/marks.js",
  "./assets/js/notes.js",
  "./assets/js/catalog.js",
  "./assets/js/events.js",
  "./assets/js/grid.js",
  "./assets/js/session-detail.js",
  "./assets/js/search.js",
  "./assets/js/mytaite.js",
  "./assets/js/about.js",
  "./assets/js/main.js",
];

const SHELL_URLS = SHELL_PATHS.map((p) => new URL(p, self.location.href).toString());

/** web/ の親ディレクトリ(= ../catalog/ の親)を指すURL文字列を返す */
function catalogBaseUrl() {
  return new URL("../catalog/", self.registration.scope).toString();
}

function isCatalogRequest(url) {
  return url.href.startsWith(catalogBaseUrl());
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_PATHS))
      .then(() => precacheCatalog())
      .then(() => self.skipWaiting())
  );
});

/**
 * index.json / masters.json をプリフェッチしてCATALOG_CACHEへ保存する
 * (全大会共通で、大会一覧画面の描画にも必須のため)。個々の大会のイベントJSONは
 * ここではプリキャッシュしない(network-firstのfetchハンドラ側で、実際に
 * その大会を開いた時点でキャッシュされる)。
 * ネットワークが使えない状態でのSW初回install時など、失敗してもinstall自体は
 * 継続させたいのでエラーは握りつぶす(ベストエフォート)。
 */
async function precacheCatalog() {
  try {
    const cache = await caches.open(CATALOG_CACHE);
    const base = catalogBaseUrl();
    const indexUrl = new URL("index.json", base).toString();
    const mastersUrl = new URL("masters.json", base).toString();

    await Promise.all([
      fetchAndCache(cache, indexUrl),
      fetchAndCache(cache, mastersUrl),
    ]);
  } catch (err) {
    // オフライン等で失敗しても、シェルのキャッシュ自体は成立させたいので無視する。
  }
}

/** fetchして正常なJSONだった場合のみキャッシュし、Responseを返す(呼び出し元で再利用可) */
async function fetchAndCache(cache, url) {
  try {
    const res = await fetch(url, { cache: "no-cache" });
    if (!res.ok) return null;
    const valid = await isParsableJson(res.clone());
    if (!valid) return null;
    await cache.put(url, res.clone());
    return res;
  } catch (err) {
    return null;
  }
}

async function isParsableJson(res) {
  try {
    await res.json();
    return true;
  } catch (err) {
    return false;
  }
}

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter(
              (name) =>
                (name.startsWith("gp-shell-") || name.startsWith("gp-catalog-")) &&
                name !== SHELL_CACHE &&
                name !== CATALOG_CACHE
            )
            .map((name) => caches.delete(name))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // 他オリジンには関与しない

  if (isCatalogRequest(url)) {
    event.respondWith(networkFirst(req));
    return;
  }

  if (SHELL_URLS.includes(req.url)) {
    event.respondWith(cacheFirst(req));
  }
});

async function cacheFirst(req) {
  const cached = await caches.match(req);
  if (cached) return cached;
  try {
    const res = await fetch(req);
    if (res && res.ok) {
      const cache = await caches.open(SHELL_CACHE);
      cache.put(req, res.clone());
    }
    return res;
  } catch (err) {
    if (cached) return cached;
    throw err;
  }
}

/**
 * network-first。取得したレスポンスは「200 OK かつ JSONとしてparse可能」な場合のみ
 * "last known good" としてキャッシュに保存する。ネットワーク失敗時・レスポンス不正時は
 * 既存のキャッシュ(直近のlast known good)へフォールバックする。
 */
async function networkFirst(req) {
  const cache = await caches.open(CATALOG_CACHE);

  let res = null;
  try {
    res = await fetch(req);
  } catch (err) {
    res = null;
  }

  if (res && res.ok) {
    const candidate = res.clone();
    const valid = await isParsableJson(candidate.clone());
    if (valid) {
      await cache.put(req, candidate);
      return res;
    }
  }

  // ネットワーク失敗、または200以外・不正なJSON: 既存キャッシュへフォールバック
  const cached = await cache.match(req);
  if (cached) return cached;

  // キャッシュも無い場合は、取得できていればそれを(不正でも)返し、
  // 何も無ければ例外を投げる。
  if (res) return res;
  throw new Error(`networkFirst: fetch failed and no cache for ${req.url}`);
}
