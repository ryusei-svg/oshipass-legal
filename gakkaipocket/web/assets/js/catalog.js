// catalog.js — カタログJSON(index/masters/event)の取得と正規化モデルの構築
// 同一オリジンの ../catalog/ 配下を相対パスで fetch する(CORS不要)。

import { parseISO, diffMinutes } from "./util.js";

const INDEX_URL = "../catalog/index.json";
const MASTERS_URL = "../catalog/masters.json";

/**
 * session_kind ごとの表示ラベルと色分けクラス。
 * 落ち着いた配色にするため、近い性質のkindは同じ色クラスにまとめている
 * (講演・基調講演・特別講演・教育講演・学生セッション → kind-lecture)。
 */
export const KIND_META = {
  lecture: { label: "講演", className: "kind-lecture" },
  keynote: { label: "基調講演", className: "kind-lecture" },
  special: { label: "特別講演", className: "kind-lecture" },
  education: { label: "教育講演", className: "kind-lecture" },
  student: { label: "学生セッション", className: "kind-lecture" },
  symposium: { label: "シンポジウム", className: "kind-symposium" },
  general_oral: { label: "一般演題", className: "kind-oral" },
  poster: { label: "ポスター", className: "kind-poster" },
  luncheon: { label: "ランチョンセミナー", className: "kind-luncheon" },
  ceremony: { label: "式典", className: "kind-ceremony" },
  other: { label: "その他", className: "kind-other" },
};

export function kindMeta(sessionKind) {
  return KIND_META[sessionKind] || KIND_META.other;
}

/**
 * 検索・グリッドの色分けで使う「グループ単位」の一覧。
 * KIND_META の className をキーに、ユーザー向けのフィルタチップを構成する。
 */
export const KIND_GROUPS = [
  { className: "kind-lecture", label: "講演系", kinds: ["lecture", "keynote", "special", "education", "student"] },
  { className: "kind-symposium", label: "シンポジウム", kinds: ["symposium"] },
  { className: "kind-oral", label: "一般演題", kinds: ["general_oral"] },
  { className: "kind-poster", label: "ポスター", kinds: ["poster"] },
  { className: "kind-luncheon", label: "ランチョン", kinds: ["luncheon"] },
  { className: "kind-ceremony", label: "式典", kinds: ["ceremony"] },
  { className: "kind-other", label: "その他", kinds: ["other"] },
];

/** カタログ一式を取得し、グリッド描画用に正規化したモデルを返す */
export async function loadCatalogModel() {
  const [indexData, masters] = await Promise.all([
    fetchJson(INDEX_URL),
    fetchJson(MASTERS_URL),
  ]);

  const eventMeta = (indexData.events || [])[0];
  if (!eventMeta) {
    throw new Error("index.json に events が見つかりません");
  }

  const eventUrl = `../${eventMeta.path}`;
  const eventFile = await fetchJson(eventUrl);

  const artistsById = new Map((masters.artists || []).map((a) => [a.id, a]));
  const venuesById = new Map((masters.venues || []).map((v) => [v.id, v]));

  const event = eventFile.event;
  const days = (event.days || []).map((day, i) =>
    normalizeDay(day, i + 1, venuesById)
  );

  const actIndex = new Map();
  const presentationIndex = new Map();
  for (const day of days) {
    for (const act of day.acts) {
      actIndex.set(act.id, { act, day });
      for (const presentation of act.presentations) {
        presentationIndex.set(presentation.id, { presentation, act, day });
      }
    }
  }

  return {
    eventMeta,
    event,
    days,
    artistsById,
    venuesById,
    actIndex,
    presentationIndex,
  };
}

async function fetchJson(url) {
  const res = await fetch(url, { cache: "no-cache" });
  if (!res.ok) {
    throw new Error(`fetch failed: ${url} (${res.status})`);
  }
  return res.json();
}

/** 1日分の lanes/acts を描画しやすい形に正規化する */
function normalizeDay(day, dayNumber, venuesById) {
  const lanes = (day.lanes || [])
    .slice()
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));

  const laneIndexById = new Map(lanes.map((l, i) => [l.id, i]));

  // 隣接する同一venue_idのレーンを束ねて施設グループヘッダーを作る
  const venueGroups = [];
  for (let i = 0; i < lanes.length; i++) {
    const lane = lanes[i];
    const venue = venuesById.get(lane.venue_id);
    const venueName = venue ? venue.name : "会場未設定";
    const prev = venueGroups[venueGroups.length - 1];
    if (prev && prev.venueId === lane.venue_id) {
      prev.laneCount += 1;
    } else {
      venueGroups.push({ venueId: lane.venue_id, venueName, laneCount: 1 });
    }
  }

  const timeRange = computeTimeRange(day, lanes);

  const acts = (day.acts || [])
    .map((act) => {
      const startDate = parseISO(act.start);
      const endDate = parseISO(act.end);
      const laneIndex = laneIndexById.get(act.lane_id);
      return {
        ...act,
        laneIndex,
        startDate,
        endDate,
        startMin: diffMinutes(timeRange.startDate, startDate),
        durationMin: diffMinutes(startDate, endDate),
        presentations: (act.presentations || [])
          .slice()
          .sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
      };
    })
    .filter((act) => act.laneIndex !== undefined)
    .sort((a, b) => a.startMin - b.startMin);

  return {
    id: day.id,
    dayNumber,
    activityDate: day.activity_date,
    lanes,
    venueGroups,
    acts,
    timeRange,
  };
}

function computeTimeRange(day, lanes) {
  let startISO = day.start;
  let endISO = day.end;

  if (!startISO || !endISO) {
    const acts = day.acts || [];
    if (acts.length) {
      startISO = acts.reduce(
        (min, a) => (a.start < min ? a.start : min),
        acts[0].start
      );
      endISO = acts.reduce((max, a) => (a.end > max ? a.end : max), acts[0].end);
    }
  }

  const startDate = parseISO(startISO);
  const endDate = parseISO(endISO);
  return {
    startDate,
    endDate,
    startISO,
    totalMin: diffMinutes(startDate, endDate),
  };
}

/** artist_ids/chair_ids から名前配列を解決する */
export function resolveArtistNames(ids, artistsById) {
  if (!ids || !ids.length) return [];
  return ids
    .map((id) => artistsById.get(id))
    .filter(Boolean)
    .map((a) => a.name);
}

/** act が属する施設(venue)名を返す */
export function resolveVenueNameForAct(act, day, venuesById) {
  const lane = day.lanes.find((l) => l.id === act.lane_id);
  if (!lane) return "";
  const venue = venuesById.get(lane.venue_id);
  return venue ? venue.name : "";
}

export function findLaneForAct(act, day) {
  return day.lanes.find((l) => l.id === act.lane_id);
}
