// about.js — フッターの非公式明示から開く簡易説明モーダル
// session-detail.js と同じ .sd-overlay / .sd-sheet の見た目を流用する。

import { h, showToast } from "./util.js";
import { openOnboarding } from "./onboarding.js";

let activeController = null;

/** 端末内に保存する gp: プレフィックスのlocalStorageキー一覧を返す(マーク・メモ・重なりの選択・選択中の大会・表示設定など)。 */
function listAppStorageKeys() {
  const keys = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith("gp:")) keys.push(key);
  }
  return keys;
}

function buildExportTimestamp(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
}

/**
 * 保存データ(gp: プレフィックスの全localStorageキー)をJSONファイルとして書き出す。
 * 値がJSONとして保存されているものはparseし、そうでないものは生の文字列のまま含める。
 */
function exportAppData() {
  try {
    const data = {};
    for (const key of listAppStorageKeys()) {
      const raw = localStorage.getItem(key);
      try {
        data[key] = JSON.parse(raw);
      } catch (err) {
        data[key] = raw;
      }
    }
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `gakkaipocket-data-${buildExportTimestamp(new Date())}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Blob URLはダウンロード完了後は不要なので、少し待ってから解放する。
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (err) {
    console.warn("[about] 保存データの書き出しに失敗しました", err);
    showToast("書き出しに失敗しました。ブラウザの設定をご確認ください。");
  }
}

/** 確認ダイアログのあと、gp: プレフィックスの保存データをすべて削除してページを再読み込みする。 */
function deleteAllAppData() {
  const confirmed = window.confirm(
    "保存されているマーク・メモ・重なりの選択・大会選択などの設定をすべて削除します。この操作は取り消せません。よろしいですか？"
  );
  if (!confirmed) return;

  for (const key of listAppStorageKeys()) {
    try {
      localStorage.removeItem(key);
    } catch (err) {
      console.warn("[about] 保存データの削除に失敗しました", err);
    }
  }
  location.reload();
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

/**
 * このアプリについてモーダルを開く。
 * @param {object} event - catalog.js の loadCatalogModel().event (name / official_url を使用)
 */
export function openAboutModal(event) {
  closeAboutModal();

  const previouslyFocused = document.activeElement;
  const shellEl = document.querySelector(".gp-shell");

  const overlay = h("div", { className: "sd-overlay" });
  const sheet = h("div", {
    className: "sd-sheet sd-sheet--about",
    attrs: { role: "dialog", "aria-modal": "true", "aria-labelledby": "about-title" },
  });

  const closeBtn = h("button", {
    className: "sd-close",
    attrs: { type: "button", "aria-label": "閉じる" },
    text: "×",
  });
  sheet.appendChild(closeBtn);

  sheet.appendChild(h("h2", { className: "sd-title", attrs: { id: "about-title" }, text: "このアプリについて" }));

  const body = h("div", { className: "about-body" });

  body.appendChild(
    h("p", {
      text:
        "本アプリ「学会ポケット」は、掲載する学会・大会の主催者・運営とは関係のない非公式アプリです。参加者が公式サイトで公開しているプログラム情報をもとに、聴きたい演題を選んで自分のスケジュールを作るためのツールとして提供しています。",
    })
  );

  if (event && event.name) {
    const p = h("p", {});
    p.appendChild(document.createTextNode("収録している大会："));
    p.appendChild(h("strong", { text: event.name }));
    body.appendChild(p);
  }

  if (event && event.official_url) {
    const safeUrl = getSafeHttpUrl(event.official_url);
    const p = h("p", {});
    p.appendChild(document.createTextNode("出典・最新情報："));
    if (safeUrl) {
      p.appendChild(
        h("a", {
          text: "大会公式サイトを見る",
          attrs: { href: safeUrl, target: "_blank", rel: "noopener" },
        })
      );
    } else {
      // https:/http: 以外のスキームはリンク化せず、テキストとしてのみ表示する
      p.appendChild(document.createTextNode("大会公式サイトを見る"));
    }
    body.appendChild(p);
  }

  body.appendChild(
    h("p", {
      text: "掲載内容は公式の発表により変更となる場合があります。最新かつ正確な情報は必ず公式サイトをご確認ください。",
    })
  );

  const settingsWrap = h("div", { className: "about-settings" });
  settingsWrap.appendChild(h("h3", { className: "about-settings-title", text: "使い方・保存データ" }));

  const replayOnboardingBtn = h("button", {
    className: "about-settings-btn",
    attrs: { type: "button" },
    text: "使い方をもう一度見る",
  });
  replayOnboardingBtn.addEventListener("click", () => {
    closeAboutModal();
    openOnboarding({ force: true });
  });
  settingsWrap.appendChild(replayOnboardingBtn);

  const exportBtn = h("button", {
    className: "about-settings-btn",
    attrs: { type: "button" },
    text: "保存データを書き出す",
  });
  exportBtn.addEventListener("click", () => exportAppData());
  settingsWrap.appendChild(exportBtn);

  const deleteBtn = h("button", {
    className: "about-settings-btn about-settings-btn--danger",
    attrs: { type: "button" },
    text: "保存データをすべて削除する",
  });
  deleteBtn.addEventListener("click", () => deleteAllAppData());
  settingsWrap.appendChild(deleteBtn);

  settingsWrap.appendChild(
    h("p", {
      className: "about-settings-hint",
      text: "マーク・メモ・重なりの選択・大会の選択・表示設定は、この端末のブラウザ内にのみ保存されています。",
    })
  );

  body.appendChild(settingsWrap);

  const linksWrap = h("div", { className: "about-links" });
  linksWrap.appendChild(
    h("a", { text: "プライバシーポリシー", attrs: { href: "../privacy-policy.html", target: "_blank", rel: "noopener" } })
  );
  linksWrap.appendChild(
    h("a", { text: "利用規約", attrs: { href: "../terms-of-service.html", target: "_blank", rel: "noopener" } })
  );
  linksWrap.appendChild(
    h("a", { text: "このアプリについて（詳細）", attrs: { href: "../about.html", target: "_blank", rel: "noopener" } })
  );
  body.appendChild(linksWrap);

  body.appendChild(
    h("p", {
      className: "about-contact",
      text: "掲載情報の修正・削除依頼、お問い合わせは contact@oshibul.jp までご連絡ください。",
    })
  );

  sheet.appendChild(body);
  overlay.appendChild(sheet);
  document.body.appendChild(overlay);
  document.body.classList.add("sd-open");
  // 背景(アプリシェル本体)を inert にして、Tabキーでモーダルの外(背景側)へ
  // フォーカスが抜けないようにする(フォーカストラップ)。
  if (shellEl) shellEl.inert = true;

  function handleKeydown(ev) {
    if (ev.key === "Escape") close();
  }
  function handleOverlayClick(ev) {
    if (ev.target === overlay) close();
  }

  closeBtn.addEventListener("click", close);
  overlay.addEventListener("click", handleOverlayClick);
  document.addEventListener("keydown", handleKeydown);
  closeBtn.focus();

  // session-detail.js と同様にコントローラー化することで、X/背景クリック/Escapeの
  // どこから閉じても、また外部から closeAboutModal() を呼んだ場合でも、
  // 必ず同じ close() を通ってkeydownリスナーの解除とフォーカス復元が行われるようにする。
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
        /* no-op */
      }
    }
    if (activeController) activeController.closed = true;
  }

  activeController = { close, closed: false };
}

export function closeAboutModal() {
  if (activeController && !activeController.closed) {
    activeController.close();
  }
  activeController = null;
}
