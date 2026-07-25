// search.js — 演題タイトル・発表者名・セッション名・所属のフリーワード検索
// 680題程度なので、インデックスを作らず全件走査で十分な速度が出る。

import { h, formatTime, normalizeSearchText, bus } from "./util.js";
import { kindMeta, resolveArtistNames, KIND_GROUPS } from "./catalog.js";
import { buildMarkButton } from "./session-detail.js";

/**
 * 検索ページを描画する。
 * @param {HTMLElement} container
 * @param {object} model - loadCatalogModel() の返り値
 * @param {{ onSelectAct: (actId: string) => void }} handlers
 * @returns {{ destroy: () => void }}
 */
export function renderSearchPage(container, model, { onSelectAct }) {
  container.textContent = "";

  const state = {
    query: "",
    dayFilter: "all", // "all" | "1" | "2" ...
    kindFilter: new Set(), // 空 = 絞り込みなし(全kind)
  };

  const wrap = h("div", { className: "gp-search" });

  const input = h("input", {
    className: "gp-search-input",
    attrs: {
      type: "search",
      placeholder: "演題タイトル・発表者名・セッション名・所属で検索",
      "aria-label": "検索キーワード",
      autocomplete: "off",
    },
  });
  wrap.appendChild(h("div", { className: "gp-search-bar", children: [input] }));

  const filterRow = h("div", { className: "gp-search-filters" });

  // 日程フィルタは「両方/1日目/2日目…」から1つだけ選ぶ単一選択のため、
  // ネイティブのラジオグループ相当としてrole="radiogroup"/role="radio"を用いる。
  const dayGroup = h("div", {
    className: "gp-filter-group",
    attrs: { role: "radiogroup", "aria-label": "日程で絞り込み" },
  });
  const dayOptions = [
    { value: "all", label: "両方" },
    ...model.days.map((d) => ({ value: String(d.dayNumber), label: `${d.dayNumber}日目` })),
  ];
  const dayButtons = dayOptions.map((opt) => {
    const btn = h("button", {
      className: "gp-chip",
      text: opt.label,
      attrs: { type: "button", role: "radio", "aria-checked": "false", "data-value": opt.value },
    });
    btn.addEventListener("click", () => {
      state.dayFilter = opt.value;
      syncChips();
      renderResults();
    });
    dayGroup.appendChild(btn);
    return btn;
  });
  filterRow.appendChild(dayGroup);

  // 種別フィルタは複数選択可のトグルのため、押下状態をaria-pressedで表す。
  const kindGroup = h("div", {
    className: "gp-filter-group",
    attrs: { role: "group", "aria-label": "種別で絞り込み" },
  });
  const kindButtons = KIND_GROUPS.map((group) => {
    const btn = h("button", {
      className: `gp-chip ${group.className}`,
      text: group.label,
      attrs: { type: "button", "aria-pressed": "false", "data-value": group.className },
    });
    btn.addEventListener("click", () => {
      if (state.kindFilter.has(group.className)) state.kindFilter.delete(group.className);
      else state.kindFilter.add(group.className);
      syncChips();
      renderResults();
    });
    kindGroup.appendChild(btn);
    return btn;
  });
  filterRow.appendChild(kindGroup);

  wrap.appendChild(filterRow);

  const resultsEl = h("div", { className: "gp-search-results" });
  wrap.appendChild(resultsEl);

  container.appendChild(wrap);

  function syncChips() {
    dayButtons.forEach((btn) => {
      const isActive = btn.dataset.value === state.dayFilter;
      btn.classList.toggle("is-active", isActive);
      btn.setAttribute("aria-checked", isActive ? "true" : "false");
    });
    kindButtons.forEach((btn) => {
      const isActive = state.kindFilter.has(btn.dataset.value);
      btn.classList.toggle("is-active", isActive);
      btn.setAttribute("aria-pressed", isActive ? "true" : "false");
    });
  }
  syncChips();

  input.addEventListener("input", () => {
    state.query = input.value;
    renderResults();
  });

  function renderResults() {
    resultsEl.textContent = "";
    const qRaw = state.query.trim();

    if (!qRaw) {
      resultsEl.appendChild(
        h("p", {
          className: "gp-search-hint",
          text: "演題タイトル・発表者名・セッション名・所属でキーワード検索できます。",
        })
      );
      return;
    }

    const q = normalizeSearchText(qRaw);
    const activeKinds = state.kindFilter.size ? state.kindFilter : null;
    const days =
      state.dayFilter === "all"
        ? model.days
        : model.days.filter((d) => String(d.dayNumber) === state.dayFilter);

    const frag = document.createDocumentFragment();
    let hitCount = 0;

    for (const day of days) {
      for (const act of day.acts) {
        const meta = kindMeta(act.session_kind);
        if (activeKinds && !activeKinds.has(meta.className)) continue;

        const actArtistNames = resolveArtistNames(act.artist_ids, model.artistsById);
        const actMatched =
          normalizeSearchText(act.title).includes(q) ||
          (act.category && normalizeSearchText(act.category).includes(q)) ||
          actArtistNames.some((name) => normalizeSearchText(name).includes(q));
        const matchedPresentations = (act.presentations || []).filter((p) =>
          presentationMatches(p, q, model.artistsById)
        );

        if (!actMatched && matchedPresentations.length === 0) continue;

        hitCount += 1;
        frag.appendChild(
          buildSessionResultRow(act, day, model, matchedPresentations, onSelectAct)
        );
      }
    }

    if (hitCount === 0) {
      resultsEl.appendChild(
        h("p", { className: "gp-search-hint", text: "該当する演題が見つかりませんでした。" })
      );
      return;
    }

    resultsEl.appendChild(frag);
  }

  const onMarksChanged = () => renderResults();
  bus.on("marks-changed", onMarksChanged);

  return {
    destroy() {
      bus.off("marks-changed", onMarksChanged);
    },
  };
}

function presentationMatches(p, q, artistsById) {
  if (normalizeSearchText(p.title).includes(q)) return true;
  if (p.affiliation && normalizeSearchText(p.affiliation).includes(q)) return true;
  const presenters = resolveArtistNames(p.presenter_ids, artistsById);
  return presenters.some((name) => normalizeSearchText(name).includes(q));
}

function buildSessionResultRow(act, day, model, matchedPresentations, onSelectAct) {
  const meta = kindMeta(act.session_kind);
  // 「詳細を開くbutton」と「マークbutton」を兄弟要素として分離する(button内button の
  // ネストを避けるため)。.gp-result を position:relative の受け皿にして、
  // マークボタンをその中で絶対配置する。
  const row = h("div", { className: `gp-result ${meta.className}` });

  const head = h("button", {
    className: "gp-result-head",
    attrs: { type: "button" },
  });

  const headMeta = h("div", { className: "gp-result-meta" });
  headMeta.appendChild(h("span", { className: "gp-result-kind", text: meta.label }));
  headMeta.appendChild(
    h("span", {
      className: "gp-result-day",
      text: `${day.dayNumber}日目 ${formatTime(act.start)}〜${formatTime(act.end)}`,
    })
  );
  if (act.category) {
    headMeta.appendChild(h("span", { className: "gp-result-category", text: act.category }));
  }
  head.appendChild(headMeta);
  head.appendChild(h("div", { className: "gp-result-title", text: act.title }));

  const lane = day.lanes.find((l) => l.id === act.lane_id);
  if (lane) head.appendChild(h("div", { className: "gp-result-venue", text: lane.name }));

  const openAct = () => onSelectAct(act.id);
  head.addEventListener("click", openAct);

  row.appendChild(head);
  row.appendChild(buildMarkButton(act.id, "session"));

  if (matchedPresentations.length) {
    const list = h("ul", { className: "gp-result-pres-list" });
    for (const p of matchedPresentations) {
      list.appendChild(buildPresentationHitRow(p, model.artistsById, openAct));
    }
    row.appendChild(list);
  }

  return row;
}

function buildPresentationHitRow(presentation, artistsById, openAct) {
  // li 自体は非インタラクティブな受け皿(position:relative)にし、
  // 「詳細を開くbutton」と「マークbutton」を兄弟要素として分離する。
  const li = h("li", { className: "gp-result-pres-row" });

  const btn = h("button", { className: "gp-result-pres-btn", attrs: { type: "button" } });

  const titleText = presentation.code
    ? `${presentation.code} ／ ${presentation.title}`
    : presentation.title;
  btn.appendChild(h("div", { className: "gp-result-pres-title", text: titleText }));

  const presenters = resolveArtistNames(presentation.presenter_ids, artistsById);
  if (presenters.length || presentation.affiliation) {
    const parts = [presenters.join("、")];
    if (presentation.affiliation) parts.push(`（${presentation.affiliation}）`);
    btn.appendChild(
      h("div", { className: "gp-result-pres-presenter", text: parts.filter(Boolean).join(" ") })
    );
  }

  btn.addEventListener("click", openAct);

  li.appendChild(btn);
  li.appendChild(buildMarkButton(presentation.id, "presentation"));

  return li;
}
