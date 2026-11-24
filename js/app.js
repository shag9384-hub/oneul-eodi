/* 오늘어디 — 앱 셸 (필터 · 지도 · 목록 · 상세 · 제보) */

import {
  CATEGORIES, CATEGORY_META, GU_FILTERS, KOR_DAYS, STATUS_META,
  esc, debounce, clamp, haversine, fmtDistance, normalizeDays,
  parseHours, computeStatus, isLiveNow, latestReportOf, timeAgo,
  shortHours, fmtHM, naverMapLink, kakaoMapLink, sourceHost, todayLabel, timeLabel, copyText
} from './util.js';
import { Store, normalizeCategory } from './store.js';
import { createMapAdapter, INCHEON_CENTER, INCHEON_ZOOM } from './map.js';

/* ── URL 로 키 넣기 (?kakao=…&sb=…&sbkey=…) ───────────── */
(function absorbUrlSettings() {
  const qs = new URLSearchParams(location.search);
  const patch = {};
  if (qs.get('kakao')) patch.kakaoKey = qs.get('kakao');
  if (qs.get('sb')) patch.sbUrl = qs.get('sb');
  if (qs.get('sbkey') || qs.get('key')) patch.sbKey = qs.get('sbkey') || qs.get('key');
  if (Object.keys(patch).length) {
    try {
      const cur = JSON.parse(localStorage.getItem('oe_settings') || '{}');
      localStorage.setItem('oe_settings', JSON.stringify({ ...cur, ...patch }));
    } catch (e) { /* ignore */ }
    history.replaceState(null, '', location.pathname + location.hash);
  }
})();

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const dom = {
  liveNum: $('#liveNum'),
  livePill: $('#livePill'),
  demoBar: $('#demoBar'),
  demoBarText: $('#demoBarText'),
  catRow: $('#catRow'),
  guRow: $('#guRow'),
  dongRow: $('#dongRow'),
  dongChips: $('#dongChips'),
  search: $('#searchInput'),
  searchClear: $('#searchClear'),
  modeChip: $('#modeChip'),
  map: $('#map'),
  mapFallback: $('#mapFallback'),
  pickHint: $('#pickHint'),
  pickCancel: $('#pickCancel'),
  locateBtn: $('#locateBtn'),
  recenterBtn: $('#recenterBtn'),
  addBtn: $('#addBtn'),
  sheet: $('#sheet'),
  sheetGrab: $('#sheetGrab'),
  sheetNote: $('#sheetNote'),
  listBody: $('#listBody'),
  todayCount: $('#todayCount'),
  favCount: $('#favCount'),
  toggleAll: $('#toggleAll'),
  detailEmoji: $('#detailEmoji'),
  detailEyebrow: $('#detailEyebrow'),
  detailTitle: $('#detailTitle'),
  detailBody: $('#detailBody'),
  scrim: $('#scrim'),
  toastHost: $('#toastHost')
};

const state = {
  cat: '전체',
  gu: '전체 인천',
  dong: '',
  q: '',
  tab: 'today',
  showAll: false,
  liveOnly: false,
  userPos: null,
  loadingLocation: false,
  pickMode: false,
  pickCoord: null,
  addDays: new Set(),
  selectedId: null,
  detailId: null,
  openModal: null
};

let store;
let mapAdapter = null;
let lastFocus = null;

/* ── helpers ───────────────────────────────────────────── */
const norm = (s) => String(s || '').replace(/\s+/g, '').toLowerCase();

function safeUrl(url) {
  return /^https?:\/\//i.test(String(url || '')) ? url : '';
}

function toast(message, ms = 2400) {
  const node = document.createElement('div');
  node.className = 'toast';
  node.textContent = message;
  dom.toastHost.appendChild(node);
  setTimeout(() => {
    node.classList.add('out');
    setTimeout(() => node.remove(), 220);
  }, ms);
}

function placeEmoji(place) {
  return (CATEGORY_META[place.category] || {}).emoji || '🍴';
}

function badge(status, extra = '') {
  const meta = STATUS_META[status] || STATUS_META.unknown;
  return `<span class="status ${meta.cls} ${extra}">${meta.label}</span>`;
}

function matchesGu(place) {
  const filter = GU_FILTERS.find(g => g.name === state.gu);
  if (!filter || !filter.match.length) return true;
  if (filter.match.includes(place.gu)) return true;
  // gu 표기가 비어 있는 데이터는 주소 설명으로 보정
  return filter.match.some(g => (place.address_desc || '').includes(g));
}

function searchHaystack(p) {
  return norm([p.name, p.category, p.type, p.gu, p.dong, p.address_desc, p.menu_note].join(' '));
}

/* ── view 계산 ─────────────────────────────────────────── */
function decorate(list, now = new Date()) {
  return list.map(p => {
    const status = computeStatus(p, store.reports, now);
    const dist = state.userPos && p.lat != null ? haversine(state.userPos, p) : null;
    return Object.assign({}, p, { _status: status, _dist: dist });
  });
}

function baseFiltered(list) {
  const q = norm(state.q);
  return list.filter(p => {
    if (state.cat !== '전체' && p.category !== state.cat) return false;
    if (!matchesGu(p)) return false;
    if (state.dong && p.dong !== state.dong) return false;
    if (q && !searchHaystack(p).includes(q)) return false;
    return true;
  });
}

function scopedList(decorated) {
  let list = baseFiltered(decorated);
  if (state.liveOnly) list = list.filter(p => isLiveNow(p, p._status));
  if (state.tab === 'fav') list = list.filter(p => store.isFavorite(p.id));
  else if (!state.showAll && !state.q) list = list.filter(p => p._status !== 'closed' && p._status !== 'unknown');
  return sortPlaces(list);
}

function sortPlaces(list) {
  return list.sort((a, b) => {
    if (state.tab === 'fav') return a.name.localeCompare(b.name, 'ko');
    const ra = (STATUS_META[a._status] || STATUS_META.unknown).rank;
    const rb = (STATUS_META[b._status] || STATUS_META.unknown).rank;
    if (ra !== rb) return ra - rb;
    if (a._dist != null && b._dist != null && Math.abs(a._dist - b._dist) > 30) return a._dist - b._dist;
    if (a._dist != null && b._dist == null) return -1;
    if (a._dist == null && b._dist != null) return 1;
    return a.name.localeCompare(b.name, 'ko');
  });
}

function allDecorated() { return decorate(store.places); }

/** 지도에 보이는 목록 — 목록 탭과 별개로 필터된 모든 곳 */
function mapListNow(all = allDecorated()) {
  const filtered = baseFiltered(all);
  return state.liveOnly ? filtered.filter(p => isLiveNow(p, p._status)) : filtered;
}

/* ── 필터 렌더 ─────────────────────────────────────────── */
function renderFilters() {
  const decorated = allDecorated();

  dom.catRow.innerHTML = CATEGORIES.map(c => {
    const count = c.name === '전체'
      ? decorated.length
      : decorated.filter(p => p.category === c.name).length;
    return `<button type="button" class="chip" role="tab" data-cat="${esc(c.name)}"
      aria-selected="${state.cat === c.name}">
      ${c.emoji ? `<span class="c-emoji" aria-hidden="true">${c.emoji}</span>` : ''}
      ${esc(c.name)}<span class="c-count">${count || ''}</span>
    </button>`;
  }).join('');

  dom.guRow.innerHTML = GU_FILTERS.map(g => {
    const count = g.match.length ? decorated.filter(p => matchesGuName(p, g)).length : decorated.length;
    return `<button type="button" class="chip gu" role="tab" data-gu="${esc(g.name)}"
      aria-selected="${state.gu === g.name}">${esc(g.name)}<span class="c-count">${count || ''}</span></button>`;
  }).join('');

  const dongRow = dom.dongRow;
  if (!state.gu || state.gu === '전체 인천') {
    dongRow.hidden = true;
  } else {
    const guPlaces = decorated.filter(p => matchesGuName(p, GU_FILTERS.find(g => g.name === state.gu)));
    const counts = new Map();
    guPlaces.forEach(p => { if (p.dong) counts.set(p.dong, (counts.get(p.dong) || 0) + 1); });
    const dongs = Array.from(counts.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ko'));
    if (!dongs.length) { dongRow.hidden = true; }
    else {
      dongRow.hidden = false;
      $('#dongChips').innerHTML =
        `<button type="button" class="chip dong" data-dong="" aria-selected="${!state.dong}">전체</button>` +
        dongs.map(([d, n]) => `<button type="button" class="chip dong" data-dong="${esc(d)}"
          aria-selected="${state.dong === d}">${esc(d)}<span class="c-count">${n}</span></button>`).join('');
    }
  }

  updateModeChip();
}

function matchesGuName(place, filter) {
  if (!filter || !filter.match || !filter.match.length) return true;
  if (filter.match.includes(place.gu)) return true;
  return filter.match.some(g => (place.address_desc || '').includes(g));
}

function updateModeChip() {
  let label = '기기 저장';
  let live = false;
  if (store.isRemote) { label = '실시간 공유'; live = true; }
  else if (store.seedIsSample) { label = '샘플 데이터'; }
  dom.modeChip.textContent = label;
  dom.modeChip.classList.toggle('is-live', live);
  dom.modeChip.title = live
    ? 'Supabase와 연결되어 여러 사람의 제보가 함께 반영됩니다'
    : '이 기기에 제보를 저장합니다. 설정에서 Supabase를 연결하면 실시간으로 공유돼요.';

  dom.demoBar.hidden = !store.seedIsSample;
  if (store.seedIsSample) {
    dom.demoBarText.textContent = `미리보기용 샘플 ${store.places.length}곳으로 화면을 채웠어요. 실제 데이터로 바꾸면 그대로 반영됩니다.`;
  }
}

/* ── 목록 렌더 ─────────────────────────────────────────── */
function renderList(list, { resetScroll = false } = {}) {
  const previous = dom.listBody.scrollTop;
  const frag = [];

  if (!list.length) {
    frag.push(emptyStateHTML());
  } else {
    for (const p of list) {
      const isFav = store.isFavorite(p.id);
      const dist = p._dist != null ? `<span class="distance">${fmtDistance(p._dist)}</span>` : '';
      const metaBits = [p.type, [p.gu, p.dong].filter(Boolean).join(' ')].filter(Boolean);
      const needInfo = p._status === 'unknown';
      const metaTail = needInfo
        ? '<span class="info-needed">영업 정보 제보 필요</span>'
        : (p.hours ? `<span class="sep">·</span>${esc(shortHours(p.hours))}` : '');
      frag.push(`
        <div class="place ${p._status === 'live' ? 'is-live' : ''}" role="button" tabindex="0" data-id="${esc(p.id)}" aria-label="${esc(p.name)} 상세 보기">
          <span class="tile" aria-hidden="true">${placeEmoji(p)}</span>
          <div class="body">
            <div class="name">${esc(p.name)}${p.sample ? ' <span class="sample-flag">샘플</span>' : ''}</div>
            <div class="meta">${esc(metaBits.join(' · '))}${metaTail}</div>
            <div class="sub">${esc(p.menu_note || p.address_desc || '메뉴 정보가 아직 없어요')}</div>
          </div>
          <div class="side">
            ${needInfo ? '' : badge(p._status)}
            <button type="button" class="fav-btn ${isFav ? 'is-on' : ''}" data-act="fav" data-id="${esc(p.id)}" aria-label="${isFav ? '즐겨찾기 해제' : '즐겨찾기'}">
              <svg viewBox="0 0 24 24" fill="${isFav ? 'currentColor' : 'none'}" aria-hidden="true"><path d="m12 3.6 2.6 5.4 5.9.8-4.3 4.2 1.1 5.9-5.3-2.9-5.3 2.9 1.1-5.9L3.5 9.8l5.9-.8L12 3.6Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>
            </button>
            ${dist}
          </div>
        </div>`);
    }
  }
  dom.listBody.innerHTML = frag.join('');
  dom.listBody.scrollTop = resetScroll ? 0 : previous;
}

function emptyStateHTML() {
  if (state.tab === 'fav') {
    return `<div class="empty">
      <div class="emoji">☆</div>
      <h3>즐겨찾기가 비어 있어요</h3>
      <p>가게 상세에서 별을 눌러두면<br>단골 트럭을 한 번에 볼 수 있어요.</p>
      <button type="button" class="btn btn-soft" data-act="tab-today">오늘 뜬 가게 보기</button>
    </div>`;
  }
  if (state.q) {
    return `<div class="empty">
      <div class="emoji">🔍</div>
      <h3>'${esc(state.q)}' 검색 결과가 없어요</h3>
      <p>아직 등록되지 않은 곳일 수 있어요.<br>알고 있다면 바로 지도에 올려주세요.</p>
      <button type="button" class="btn btn-primary" data-act="add">가게 제보하기</button>
    </div>`;
  }
  return `<div class="empty">
    <div class="emoji">🛺</div>
    <h3>조건에 맞는 가게가 없어요</h3>
    <p>카테고리나 동네를 바꿔보거나,<br>오늘 본 트럭을 직접 제보해 주세요.</p>
    <div class="row-gap" style="justify-content:center;margin-top:12px">
      <button type="button" class="btn btn-soft" data-act="reset-filters">필터 초기화</button>
      <button type="button" class="btn btn-primary" data-act="add">가게 제보</button>
    </div>
  </div>`;
}

/* ── 지도 렌더 ─────────────────────────────────────────── */
function renderMap(list) {
  if (!mapAdapter) return;
  mapAdapter.setMarkers(list, { onClick: (id) => openDetail(id), selectedId: state.selectedId });
}

/* ── 상단 카운트 / 시트 문구 ───────────────────────────── */
function renderCounts(all, list) {
  const liveCount = all.filter(p => isLiveNow(p, p._status)).length;
  dom.liveNum.textContent = liveCount;

  const todayScoped = baseFiltered(all).filter(p => p._status !== 'closed' && p._status !== 'unknown');
  const todayN = todayScoped.length;
  dom.todayCount.textContent = todayN;
  dom.favCount.textContent = store.favorites.size;

  dom.livePill.classList.toggle('is-on', state.liveOnly);

  const bits = [];
  if (state.liveOnly) bits.push(`지금 영업 중·제보 확인 <b>${list.length}곳</b>만 보는 중`);
  else if (state.q) bits.push(`'${esc(state.q)}' 검색 <b>${list.length}곳</b>`);
  else if (state.showAll) bits.push(`전체 <b>${list.length}곳</b> · 휴무·정보 없는 곳 포함`);
  else if (state.gu !== '전체 인천') bits.push(`${esc(state.gu)}${state.dong ? ' ' + esc(state.dong) : ''}에서 오늘 <b>${list.length}곳</b>`);
  else bits.push(`${todayLabel()} ${timeLabel()} · 오늘 <b>${todayN}곳</b>이 떠요`);

  let note = bits.join(' ');
  if (state.cat !== '전체') note += ` · ${esc(state.cat)}`;
  dom.sheetNote.innerHTML = note;

  dom.toggleAll.textContent = state.showAll ? '접기' : '전체 보기';
  $$('.sheet-tab').forEach(btn => {
    const on = btn.dataset.tab === state.tab;
    btn.classList.toggle('is-active', on);
    btn.setAttribute('aria-selected', String(on));
  });
}

/* ── 전체 렌더 ─────────────────────────────────────────── */
function render({ resetScroll = false } = {}) {
  const all = allDecorated();
  const list = scopedList(all);
  renderFilters();
  renderCounts(all, list);
  renderList(list, { resetScroll });
  renderMap(mapListNow(all));
}

/* ── 상세 ─────────────────────────────────────────────── */
function nearbyOf(place) {
  if (place.lat == null || place.lng == null) return [];
  return store.places
    .filter(p => p.id !== place.id && p.lat != null && p.lng != null)
    .map(p => ({ place: p, dist: haversine(place, p) }))
    .filter(x => x.dist != null && x.dist <= 500)
    .sort((a, b) => a.dist - b.dist)
    .slice(0, 3);
}

function statusHeroText(place, status) {
  const last = latestReportOf(place.id, store.reports);
  const h = parseHours(place.hours);
  switch (status) {
    case 'live':
      return last ? `${timeAgo(last.created_at)} 누군가 '있어요'를 확인했어요` : '지금 영업 중이에요';
    case 'open':
      return h ? `영업 중이에요 (${fmtHM(h.start)}~${fmtHM(h.end)}) · 아직 현장 제보는 없어요`
        : '오늘 영업일이에요 · 아직 현장 제보는 없어요';
    case 'soon':
      return h ? `오늘 ${fmtHM(h.start)}부터 영업 예정이에요` : '오늘 영업 예정이에요';
    case 'gone':
      return last && last.kind === 'gone' ? `최근 제보에서 자리에 없었어요 (${timeAgo(last.created_at)})` : '오늘 영업이 끝났어요';
    case 'closed':
      return '오늘은 쉬는 날이에요';
    default:
      return '영업 요일·시간이 아직 없어요. 알고 있다면 제보해 주세요';
  }
}

function detailHTML(place) {
  const now = new Date();
  const status = computeStatus(place, store.reports, now);
  const meta = STATUS_META[status] || STATUS_META.unknown;
  const counts = store.countsFor(place.id);
  const myVote = store.myVoteFor(place.id);
  const isFav = store.isFavorite(place.id);
  const days = normalizeDays(place.days);
  const today = KOR_DAYS[now.getDay()];
  const nearby = nearbyOf(place);
  const comments = store.commentsFor(place.id).slice(0, 5);
  const src = safeUrl(place.source_url);
  const lastVote = latestReportOf(place.id, store.reports);
  const lastConfirm = lastVote && ['here', 'gone'].includes(lastVote.kind) ? lastVote : null;
  const heroClass = status === 'live' ? 'is-live' : (status === 'open' ? 'is-open' : '');

  const daysHTML = days.length
    ? `<div class="dt-days">${KOR_DAYS.map(d => `<i class="${days.includes(d) ? 'on' : ''}">${d}</i>`).join('')}</div>`
    : `<span class="muted">요일 정보가 아직 없어요</span>`;

  const voteNote = lastConfirm
    ? `마지막 확인 ${timeAgo(lastConfirm.created_at)} · 지금까지 '있어요' ${counts.here}번`
    : '아직 오늘 확인한 사람이 없어요. 첫 제보를 남겨주세요!';

  return `
  <div class="dt-hero ${heroClass}">
    <div class="dt-hero-text">
      <b>${esc(meta.label)}</b>
      <span>${esc(statusHeroText(place, status))}</span>
    </div>
    ${badge(status, 'dt-status-big')}
  </div>

  <dl class="dt-rows">
    <div class="dt-row">
      <dt>위치</dt>
      <dd>${esc(place.address_desc || '위치 설명이 아직 없어요')}
        ${place.gu ? `<br><span class="muted">${esc(place.gu)} ${esc(place.dong)}</span>` : ''}
      </dd>
    </div>
    <div class="dt-row">
      <dt>영업</dt>
      <dd>${daysHTML}
        <div style="margin-top:4px">${place.hours ? esc(place.hours) : '<span class="muted">시간 정보가 아직 없어요</span>'}</div>
      </dd>
    </div>
    <div class="dt-row">
      <dt>메뉴</dt>
      <dd>${place.menu_note ? esc(place.menu_note) : '<span class="muted">대표 메뉴 정보가 아직 없어요</span>'}</dd>
    </div>
    <div class="dt-row">
      <dt>형태</dt>
      <dd>${esc(place.type)} · ${esc(place.category)}${place.coord_verified ? ' · <span class="muted">위치 확인됨</span>' : ''}</dd>
    </div>
  </dl>

  <div class="vote-wrap">
    <div class="vote-title">
      <h3>지금 여기 있나요?</h3>
      <span>${counts.here + counts.gone}명이 알려줬어요</span>
    </div>
    <div class="votes">
      <button type="button" class="vote vote-here ${myVote && myVote.kind === 'here' ? 'is-mine' : ''}" data-act="vote" data-kind="here" data-id="${esc(place.id)}">
        <span class="v-emoji" aria-hidden="true">👍</span> 있어요 <span class="v-count">${counts.here}</span>
        ${myVote && myVote.kind === 'here' ? '<span class="mine-tag">내 제보</span>' : ''}
      </button>
      <button type="button" class="vote vote-gone ${myVote && myVote.kind === 'gone' ? 'is-mine' : ''}" data-act="vote" data-kind="gone" data-id="${esc(place.id)}">
        <span class="v-emoji" aria-hidden="true">👎</span> 없어요 <span class="v-count">${counts.gone}</span>
        ${myVote && myVote.kind === 'gone' ? '<span class="mine-tag">내 제보</span>' : ''}
      </button>
    </div>
    <p class="vote-note">${voteNote}</p>
  </div>

  <div class="dt-actions">
    <button type="button" class="dt-action ${isFav ? 'is-on' : ''}" data-act="fav" data-id="${esc(place.id)}">
      <svg viewBox="0 0 24 24" fill="${isFav ? 'currentColor' : 'none'}" aria-hidden="true"><path d="m12 3.6 2.6 5.4 5.9.8-4.3 4.2 1.1 5.9-5.3-2.9-5.3 2.9 1.1-5.9L3.5 9.8l5.9-.8L12 3.6Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>
      ${isFav ? '저장됨' : '즐겨찾기'}
    </button>
    <button type="button" class="dt-action" data-act="share" data-id="${esc(place.id)}">
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 15V4m0 0L8 8m4-4 4 4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 13v5.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V13" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>
      공유
    </button>
    <button type="button" class="dt-action" data-act="fix-open" data-id="${esc(place.id)}">
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 21s6-5.6 6-10.2A6 6 0 0 0 6 10.8C6 15.4 12 21 12 21Z" stroke="currentColor" stroke-width="1.6"/><circle cx="12" cy="10.5" r="2.2" stroke="currentColor" stroke-width="1.6"/></svg>
      위치 수정
    </button>
  </div>

  <div class="inline-panel" id="fixPanel" hidden>
    <textarea id="fixNote" maxlength="200" placeholder="어떻게 다른지 알려주세요. 예: 3번 출구에서 왼쪽 30m, 빨간 트럭이에요"></textarea>
    <div class="row-gap">
      <button type="button" class="btn btn-primary" data-act="fix-send" data-id="${esc(place.id)}" style="height:36px;font-size:12px">제보 보내기</button>
      <button type="button" class="btn btn-ghost" data-act="fix-close" style="height:36px;font-size:12px">닫기</button>
    </div>
  </div>

  <section class="dt-sec">
    <div class="dt-sec-head">
      <h3>관련 글·후기</h3>
    </div>
    ${src ? `<div class="src-card">
      <span class="src-ico" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M10.5 13.5a4 4 0 0 0 5.7 0l2.6-2.6a4 4 0 1 0-5.7-5.7l-1.3 1.3" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M13.5 10.5a4 4 0 0 0-5.7 0l-2.6 2.6a4 4 0 1 0 5.7 5.7l1.3-1.3" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg></span>
      <a class="src-body" href="${esc(src)}" target="_blank" rel="noopener noreferrer">
        <div class="src-title">${esc(place.source_title || '현장 후기 보기')}</div>
        <div class="src-url">${esc(sourceHost(src))}</div>
      </a>
      <button type="button" class="src-flag" data-act="broken" data-id="${esc(place.id)}">안 열려요</button>
    </div>`
    : `<div class="src-empty">등록된 후기 링크가 아직 없어요. 알고 있다면 '건의'로 알려주세요.</div>`}
  </section>

  <section class="dt-sec">
    <div class="dt-sec-head">
      <h3>500m 이내 다른 가게 <span class="n">${nearby.length ? nearby.length + '곳' : ''}</span></h3>
      <span class="small-note">지도에서 바로 이동</span>
    </div>
    ${nearby.length ? `<div class="nearby">
      ${nearby.map(({ place: np, dist }) => `<button type="button" data-act="nearby" data-id="${esc(np.id)}">
        <span class="n-emoji" aria-hidden="true">${placeEmoji(np)}</span>
        <span class="n-name">${esc(np.name)}</span>
        <span class="n-meta">${esc(computeStatus(np, store.reports, now) === 'live' ? '있어요' : np.type)}</span>
        <span class="n-dist">${fmtDistance(dist)}</span>
      </button>`).join('')}
    </div>` : `<p class="nearby-empty">반경 500m 안에 등록된 다른 가게가 없어요.</p>`}
  </section>

  <section class="dt-sec">
    <div class="dt-sec-head">
      <h3>한줄평 <span class="n">${comments.length ? comments.length + '개' : ''}</span></h3>
    </div>
    <div class="cmt-list" id="cmtList">
      ${comments.length ? comments.map(c => `<div class="cmt">
        <div class="cmt-top"><b>${esc(c.author || '익명')}</b><span>${esc(timeAgo(c.created_at))}</span></div>
        <p>${esc(c.body)}</p>
      </div>`).join('') : `<p class="nearby-empty">아직 한줄평이 없어요. 오늘 맛은 어땠나요?</p>`}
    </div>
    <form class="cmt-form" id="cmtForm" data-id="${esc(place.id)}">
      <textarea id="cmtInput" maxlength="200" placeholder="예: 팥이 진하고 6시 넘으면 줄 서요 (200자까지)"></textarea>
      <div class="cmt-foot">
        <span class="counter" id="cmtCount">0 / 200</span>
        <button type="submit" class="btn btn-primary" id="cmtSubmit">한줄평 등록</button>
      </div>
    </form>
  </section>

  <section class="dt-sec" style="margin-bottom:4px">
    <div class="dt-sec-head"><h3>길찾기</h3></div>
    <div class="directions">
      <a class="dir naver" href="${esc(naverMapLink(place))}" target="_blank" rel="noopener noreferrer"><span class="dir-dot"></span>네이버지도</a>
      <a class="dir kakao" href="${esc(kakaoMapLink(place))}" target="_blank" rel="noopener noreferrer"><span class="dir-dot"></span>카카오맵</a>
    </div>
    <p class="dir-foot">휴대폰에서는 지도 앱이 설치되어 있으면 앱으로 열려요.</p>
  </section>`;
}

function renderDetail() {
  const place = store.getPlace(state.detailId);
  if (!place) { closeModal(); return; }
  dom.detailEmoji.textContent = placeEmoji(place);
  dom.detailEyebrow.textContent = `${place.type} · ${place.category}`;
  dom.detailTitle.textContent = place.name;
  const body = $('#detailBody');
  body.dataset.placeId = place.id;
  body.innerHTML = detailHTML(place);
}

function openDetail(id, { fly = false } = {}) {
  const place = store.getPlace(id);
  if (!place) return;
  state.detailId = id;
  state.selectedId = id;
  renderDetail();
  openModal('detailModal');
  if (mapAdapter) {
    renderMap(mapListNow());
    if (fly && place.lat != null) mapAdapter.flyTo(place.lat, place.lng, 15);
  }
  try { history.replaceState(null, '', `#p=${encodeURIComponent(id)}`); } catch (e) { /* ignore */ }
}

function closeDetail() {
  if (state.detailId) state.selectedId = null;
  state.detailId = null;
  closeModal();
  try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* ignore */ }
  if (mapAdapter) renderMap(mapListNow());
}

/* ── 모달 ─────────────────────────────────────────────── */
function openModal(name) {
  if (state.openModal === name) return;
  lastFocus = document.activeElement;
  closeModal(true);
  const map = {
    detailModal: $('#detailModal'),
    addModal: $('#addModal'),
    suggestModal: $('#suggestModal'),
    settingsModal: $('#settingsModal')
  };
  const el = map[name];
  if (!el) return;
  dom.scrim.hidden = false;
  el.hidden = false;
  state.openModal = name;
  document.body.classList.add('has-modal');
  if (name === 'addModal' && window.innerWidth <= 980) setSheetHeight(PEEK);
  const first = el.querySelector('input:not([type=hidden]),textarea,select,button');
  if (first) setTimeout(() => { try { first.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }, 80);
}

function closeModal(silent = false) {
  const closing = state.openModal;
  if (!silent) state.detailId = state.openModal === 'detailModal' ? null : state.detailId;
  ['detailModal', 'addModal', 'suggestModal', 'settingsModal'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.hidden = true;
  });
  dom.scrim.hidden = true;
  state.openModal = null;
  document.body.classList.remove('has-modal');
  if (!silent && closing && closing !== 'detailModal' && !state.pickMode && window.innerWidth <= 980) {
    setSheetHeight(PEEK);
  }
  if (!silent) {
    if (lastFocus && document.contains(lastFocus)) { try { lastFocus.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
    lastFocus = null;
  }
}

/* ── 제보 폼 ───────────────────────────────────────────── */
function populateAddForm() {
  const cat = $('#fCategory');
  if (!cat.options.length) {
    cat.innerHTML = CATEGORIES.filter(c => c.name !== '전체')
      .map(c => `<option value="${esc(c.name)}">${c.emoji ? c.emoji + ' ' : ''}${esc(c.name)}</option>`).join('');
  }
  const gu = $('#fGu');
  if (!gu.options.length) {
    gu.innerHTML = GU_FILTERS.filter(g => g.match.length)
      .map(g => `<option value="${esc(g.match[0])}">${esc(g.name)}</option>`).join('');
  }
  const dl = $('#dongList');
  const dongs = Array.from(new Set(store.places.map(p => p.dong).filter(Boolean)));
  dl.innerHTML = dongs.map(d => `<option value="${esc(d)}"></option>`).join('');
}

function updatePickUI() {
  const label = $('#pickCoord');
  if (state.pickCoord) {
    label.textContent = `${state.pickCoord.lat.toFixed(5)}, ${state.pickCoord.lng.toFixed(5)}`;
    label.classList.add('has');
  } else {
    label.textContent = '아직 위치를 찍지 않았어요';
    label.classList.remove('has');
  }
}

function startPick() {
  closeModal();
  state.pickMode = true;
  dom.pickHint.hidden = false;
  setSheetHeight(132);
  if (mapAdapter) {
    mapAdapter.setPickMode(true);
    mapAdapter.invalidate();
  }
  toast('지도를 눌러 가게 위치를 찍어주세요');
}

function finishPick(coord) {
  state.pickCoord = coord;
  state.pickMode = false;
  dom.pickHint.hidden = true;
  if (mapAdapter) {
    mapAdapter.setPickMode(false);
    mapAdapter.showPick(coord.lat, coord.lng);
    mapAdapter.flyTo(coord.lat, coord.lng, 16);
  }
  updatePickUI();
  openModal('addModal');
}

function cancelPick() {
  state.pickMode = false;
  dom.pickHint.hidden = true;
  if (mapAdapter) mapAdapter.setPickMode(false);
  setSheetHeight(308);
  openModal('addModal');
}

async function submitAdd(ev) {
  ev.preventDefault();
  const name = $('#fName').value.trim();
  const address = $('#fAddress').value.trim();
  const guValue = $('#fGu').value;
  if (!name) { toast('가게 이름을 적어주세요'); $('#fName').focus(); return; }
  if (!address) { toast('위치 설명을 적어주세요'); $('#fAddress').focus(); return; }

  const place = await store.addPlace({
    name,
    category: normalizeCategory($('#fCategory').value),
    type: $('#fType').value,
    gu: guValue,
    dong: $('#fDong').value.trim(),
    address_desc: address,
    lat: state.pickCoord ? state.pickCoord.lat : null,
    lng: state.pickCoord ? state.pickCoord.lng : null,
    days: Array.from(state.addDays),
    hours: $('#fHours').value.trim(),
    menu_note: $('#fMenu').value.trim(),
    source_url: '',
    source_title: '',
    coord_verified: false
  });

  $('#addForm').reset();
  state.addDays.clear();
  $$('#fDays button').forEach(b => b.setAttribute('aria-pressed', 'false'));
  state.pickCoord = null;
  updatePickUI();
  if (mapAdapter) mapAdapter.setPickMode(false);

  state.cat = '전체';
  state.gu = '전체 인천';
  state.dong = '';
  state.q = '';
  dom.search.value = '';
  dom.searchClear.hidden = true;
  state.tab = 'today';
  state.showAll = true;
  state.liveOnly = false;

  closeModal();
  setSheetHeight(308);
  render({ resetScroll: true });
  if (mapAdapter && place.lat != null) mapAdapter.flyTo(place.lat, place.lng, 16);
  openDetail(place.id);
  toast(place.lat != null ? '제보 등록! 지도에 바로 표시했어요' : '제보 등록! 위치 핀이 없어 목록에만 보여요', 3200);
}

/* ── 시트 높이 ─────────────────────────────────────────── */
const SHEET_MIN = 132;
const PEEK = 308;
function maxSheetH() { return Math.min(window.innerHeight * 0.86, 760); }
function setSheetHeight(h) {
  if (window.innerWidth > 980) return;
  const v = clamp(h, SHEET_MIN, maxSheetH());
  const stage = $('.stage');
  stage.style.setProperty('--sheet-h', v + 'px');
}

/* ── 이벤트 ───────────────────────────────────────────── */
function bindEvents() {
  /* 상단 */
  $('#suggestBtn').addEventListener('click', () => { openModal('suggestModal'); });
  $('#settingsBtn').addEventListener('click', () => { fillSettings(); openModal('settingsModal'); });
  dom.livePill.addEventListener('click', () => {
    state.liveOnly = !state.liveOnly;
    if (state.liveOnly && state.tab !== 'today') state.tab = 'today';
    render({ resetScroll: true });
    toast(state.liveOnly ? '지금 영업 중인 곳만 보고 있어요' : '전체 가게를 다시 보여드릴게요');
  });

  /* 필터 */
  dom.catRow.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-cat]');
    if (!btn) return;
    state.cat = btn.dataset.cat;
    render({ resetScroll: true });
  });
  dom.guRow.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-gu]');
    if (!btn) return;
    state.gu = btn.dataset.gu;
    state.dong = '';
    render({ resetScroll: true });
  });
  dom.dongChips.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-dong]');
    if (!btn) return;
    state.dong = btn.dataset.dong;
    render({ resetScroll: true });
  });

  const onSearch = debounce(() => {
    state.q = dom.search.value.trim();
    dom.searchClear.hidden = !state.q;
    if (state.q && state.tab === 'fav') state.tab = 'today';
    render({ resetScroll: true });
  }, 150);
  dom.search.addEventListener('input', onSearch);
  dom.searchClear.addEventListener('click', () => {
    dom.search.value = '';
    state.q = '';
    dom.searchClear.hidden = true;
    render({ resetScroll: true });
    dom.search.focus();
  });
  dom.search.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && dom.search.value) {
      dom.search.value = ''; state.q = ''; dom.searchClear.hidden = true; render({ resetScroll: true });
    }
  });

  /* 탭 · 전체보기 */
  $$('.sheet-tab').forEach(btn => btn.addEventListener('click', () => {
    state.tab = btn.dataset.tab;
    render({ resetScroll: true });
    if (state.tab === 'fav' && !store.favorites.size) toast('가게 상세에서 별을 눌러 즐겨찾기에 담아보세요');
  }));
  dom.toggleAll.addEventListener('click', () => {
    state.showAll = !state.showAll;
    if (state.showAll && window.innerWidth <= 980) setSheetHeight(maxSheetH() * 0.78);
    if (!state.showAll && window.innerWidth <= 980) setSheetHeight(PEEK);
    render();
  });

  /* 목록 */
  dom.listBody.addEventListener('click', (e) => {
    const actEl = e.target.closest('[data-act]');
    if (actEl) {
      e.stopPropagation();
      handleAction(actEl.dataset.act, actEl);
      return;
    }
    const card = e.target.closest('.place');
    if (card) openDetail(card.dataset.id);
  });
  dom.listBody.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const card = e.target.closest('.place');
    if (card) { e.preventDefault(); openDetail(card.dataset.id); }
  });

  /* 지도 버튼 */
  dom.locateBtn.addEventListener('click', locateMe);
  dom.recenterBtn.addEventListener('click', () => {
    if (!mapAdapter) return;
    const list = state.liveOnly
      ? baseFiltered(allDecorated()).filter(p => isLiveNow(p, p._status))
      : baseFiltered(allDecorated());
    const pts = list.filter(p => p.lat != null && p.lng != null);
    if (!pts.length) { mapAdapter.setCenter(INCHEON_CENTER.lat, INCHEON_CENTER.lng, INCHEON_ZOOM); return; }
    const lats = pts.map(p => p.lat), lngs = pts.map(p => p.lng);
    mapAdapter.fitBounds({
      south: Math.min(...lats), north: Math.max(...lats),
      west: Math.min(...lngs), east: Math.max(...lngs)
    }, [36, 36]);
    toast(`${pts.length}곳이 한눈에 보이도록 맞췄어요`);
  });
  dom.addBtn.addEventListener('click', () => { populateAddForm(); openModal('addModal'); });
  $('.sheet-foot').addEventListener('click', (e) => {
    if (e.target.closest('[data-act="add"]')) { populateAddForm(); openModal('addModal'); }
  });
  $('#pickOnMap').addEventListener('click', startPick);
  dom.pickCancel.addEventListener('click', cancelPick);

  /* 시트 드래그 */
  const grab = dom.sheetGrab;
  let drag = null;
  grab.addEventListener('pointerdown', (e) => {
    if (window.innerWidth > 980) return;
    drag = { y: e.clientY, h: dom.sheet.getBoundingClientRect().height, moved: false };
    dom.sheet.style.transition = 'none';
    try { grab.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
  });
  grab.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const next = drag.h + (drag.y - e.clientY);
    if (Math.abs(drag.h - next) > 4) drag.moved = true;
    setSheetHeight(next);
  });
  const endDrag = () => {
    if (!drag) return;
    dom.sheet.style.transition = '';
    const h = dom.sheet.getBoundingClientRect().height;
    if (!drag.moved) {
      setSheetHeight(h < maxSheetH() * 0.6 ? maxSheetH() * 0.78 : PEEK);
    } else {
      const stops = [SHEET_MIN, PEEK, maxSheetH() * 0.78];
      setSheetHeight(stops.reduce((best, s) => Math.abs(s - h) < Math.abs(best - h) ? s : best, stops[0]));
    }
    drag = null;
  };
  grab.addEventListener('pointerup', endDrag);
  grab.addEventListener('pointercancel', endDrag);

  /* 모달 닫기 */
  dom.scrim.addEventListener('click', () => { if (state.detailId) closeDetail(); else closeModal(); });
  document.addEventListener('click', (e) => {
    const closeBtn = e.target.closest('[data-close]');
    if (closeBtn) { if (state.detailId) closeDetail(); else closeModal(); }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (state.pickMode) { cancelPick(); return; }
    if (state.openModal) {
      if (state.detailId) closeDetail(); else closeModal();
    }
  });

  /* 상세 · 제보 액션 위임 */
  $('#detailBody').addEventListener('click', (e) => {
    const actEl = e.target.closest('[data-act]');
    if (actEl) { handleAction(actEl.dataset.act, actEl); }
  });
  $('#detailBody').addEventListener('input', (e) => {
    if (e.target.id === 'cmtInput') {
      const c = $('#cmtCount');
      if (c) c.textContent = `${e.target.value.length} / 200`;
    }
  });
  $('#detailBody').addEventListener('submit', (e) => {
    if (e.target.id === 'cmtForm') {
      e.preventDefault();
      submitComment(e.target.dataset.id);
    }
  });

  /* 제보 폼 */
  $('#addForm').addEventListener('submit', submitAdd);
  $('#fDays').addEventListener('click', (e) => {
    const b = e.target.closest('[data-day]');
    if (!b) return;
    const d = b.dataset.day;
    if (state.addDays.has(d)) state.addDays.delete(d);
    else state.addDays.add(d);
    b.setAttribute('aria-pressed', String(state.addDays.has(d)));
  });

  /* 건의 */
  $('#suggestForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const message = $('#sMessage').value.trim();
    if (!message) { toast('내용을 적어주세요'); $('#sMessage').focus(); return; }
    try {
      await store.addSuggestion({
        kind: $('#sKind').value,
        message,
        contact: $('#sContact').value
      });
      $('#suggestForm').reset();
      $('#sCount').textContent = '0 / 500';
      closeModal();
      toast('건의 고마워요! 하나씩 반영해 볼게요', 3200);
    } catch (err) {
      toast(err.message || '보내지 못했어요');
    }
  });
  $('#sMessage').addEventListener('input', (e) => {
    $('#sCount').textContent = `${e.target.value.length} / 500`;
  });

  /* 설정 */
  $('#saveNick').addEventListener('click', () => {
    store.setNickname($('#setNick').value);
    toast(store.profile.nickname ? `'${store.profile.nickname}'으로 저장했어요` : '익명으로 참여합니다');
  });
  $('#saveKakao').addEventListener('click', () => {
    const key = $('#setKakao').value.trim();
    if (!key) { toast('카카오 JavaScript 키를 입력해 주세요'); return; }
    store.setSettings({ kakaoKey: key });
    toast('저장했어요. 새로고침하면 카카오맵으로 바뀝니다', 2600);
    setTimeout(() => location.reload(), 700);
  });
  $('#saveSb').addEventListener('click', async () => {
    const url = $('#setSbUrl').value.trim();
    const key = $('#setSbKey').value.trim();
    if (!url || !key) { toast('Supabase URL과 anon key를 모두 넣어주세요'); return; }
    if (!/^https?:\/\//.test(url)) { toast('URL은 https:// 로 시작해야 해요'); return; }
    store.setSettings({ sbUrl: url, sbKey: key });
    const status = $('#sbStatus');
    status.textContent = '연결 확인 중…';
    status.className = 'status-line';
    const ok = await store.pullRemote(true);
    if (ok) {
      status.textContent = `연결됨 · 장소 ${store.places.length}곳 · 제보 ${store.reports.length}건`;
      status.className = 'status-line ok';
      store.startPolling();
      toast('Supabase 연결 완료! 이제 제보가 함께 공유돼요');
      render();
    } else {
      status.textContent = `연결 실패: ${store.remoteError || '알 수 없는 오류'}`;
      status.className = 'status-line err';
      toast('연결하지 못했어요. URL·key·RLS를 확인해 주세요', 3200);
    }
  });
  $('#testSb').addEventListener('click', async () => {
    const status = $('#sbStatus');
    const url = $('#setSbUrl').value.trim() || store.settings.sbUrl;
    const key = $('#setSbKey').value.trim() || store.settings.sbKey;
    if (!url || !key) { status.textContent = '설정된 Supabase가 없어요. 이 기기에만 저장됩니다.'; status.className = 'status-line'; return; }
    status.textContent = '확인 중…';
    try {
      const res = await fetch(`${url.replace(/\/+$/, '')}/rest/v1/places?select=id&limit=1`, {
        headers: { apikey: key, Authorization: `Bearer ${key}` }
      });
      if (res.ok) {
        status.textContent = '연결 정상 · places 테이블을 읽었어요';
        status.className = 'status-line ok';
      } else {
        status.textContent = `응답 ${res.status} · anon key와 RLS 정책을 확인해 주세요`;
        status.className = 'status-line err';
      }
    } catch (err) {
      status.textContent = '네트워크 오류로 확인하지 못했어요';
      status.className = 'status-line err';
    }
  });
  $('#exportBtn').addEventListener('click', () => {
    const data = store.exportMine();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'oneul-eodi-my-data.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
    toast('내 기록 파일을 내려받았어요');
  });
  $('#resetBtn').addEventListener('click', () => {
    if (!window.confirm('이 기기에 저장된 즐겨찾기·제보·한줄평을 모두 지울까요? 되돌릴 수 없어요.')) return;
    store.clearLocal();
    closeModal();
    render({ resetScroll: true });
    toast('이 기기 기록을 지웠어요');
  });

  /* 해시로 들어온 가게 */
  window.addEventListener('hashchange', () => {
    const m = location.hash.match(/^#p=(.+)$/);
    if (m) openDetail(decodeURIComponent(m[1]));
  });

  window.addEventListener('resize', () => {
    if (mapAdapter) mapAdapter.invalidate();
    if (window.innerWidth > 980 && dom.sheet) dom.sheet.style.height = '';
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') render();
  });
}

function fillSettings() {
  $('#setNick').value = store.profile.nickname || '';
  $('#setKakao').value = store.settings.kakaoKey || '';
  $('#setSbUrl').value = store.settings.sbUrl || '';
  $('#setSbKey').value = store.settings.sbKey || '';
  const status = $('#sbStatus');
  if (store.isRemote) {
    status.textContent = `현재: 실시간 공유(Supabase) · 장소 ${store.places.length}곳`;
    status.className = 'status-line ok';
  } else {
    status.textContent = store.remoteError ? `현재: 이 기기 저장 · 연결 오류(${store.remoteError})` : '현재: 이 기기 저장 모드';
    status.className = 'status-line';
  }
}

function locateMe() {
  if (!navigator.geolocation) { toast('이 브라우저에서는 위치를 쓸 수 없어요'); return; }
  if (state.loadingLocation) return;
  state.loadingLocation = true;
  dom.locateBtn.classList.add('is-on');
  navigator.geolocation.getCurrentPosition((pos) => {
    state.loadingLocation = false;
    dom.locateBtn.classList.remove('is-on');
    state.userPos = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    if (mapAdapter) {
      mapAdapter.showMe(state.userPos.lat, state.userPos.lng);
      mapAdapter.flyTo(state.userPos.lat, state.userPos.lng, 14);
    }
    render();
    toast('내 위치로 이동했어요 · 가까운 순으로 정렬합니다');
  }, (err) => {
    state.loadingLocation = false;
    dom.locateBtn.classList.remove('is-on');
    toast(err.code === 1 ? '위치 권한을 허용하면 가까운 순으로 볼 수 있어요' : '위치를 확인하지 못했어요', 3200);
  }, { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 });
}

/* ── 액션 처리 ─────────────────────────────────────────── */
async function handleAction(act, el) {
  const id = el.dataset.id;
  if (act === 'fav') {
    const on = store.toggleFavorite(id);
    toast(on ? '즐겨찾기에 담았어요' : '즐겨찾기에서 뺐어요');
    return;
  }
  if (act === 'add') { populateAddForm(); openModal('addModal'); return; }
  if (act === 'tab-today') { state.tab = 'today'; render({ resetScroll: true }); return; }
  if (act === 'reset-filters') {
    state.cat = '전체'; state.gu = '전체 인천'; state.dong = ''; state.q = '';
    state.liveOnly = false; dom.search.value = ''; dom.searchClear.hidden = true;
    render({ resetScroll: true });
    return;
  }
  if (act === 'vote') {
    const kind = el.dataset.kind;
    await store.addReport({ place_id: id, kind });
    toast(kind === 'here' ? '👍 제보 고마워요! 지도에 바로 반영했어요' : '👎 알려줘서 고마워요. 상태를 바꿔둘게요', 2800);
    return;
  }
  if (act === 'share') {
    const place = store.getPlace(id);
    if (!place) return;
    const url = `${location.origin}${location.pathname}#p=${encodeURIComponent(id)}`;
    const text = `${place.name} — ${place.address_desc || place.dong || '인천'} · 오늘어디`;
    if (navigator.share) {
      try { await navigator.share({ title: '오늘어디', text, url }); return; } catch (e) { if (e.name === 'AbortError') return; }
    }
    try { await copyText(url); toast('링크를 복사했어요'); }
    catch (e) { toast('공유 링크를 복사하지 못했어요'); }
    return;
  }
  if (act === 'fix-open') { const p = $('#fixPanel'); if (p) { p.hidden = false; $('#fixNote')?.focus(); } return; }
  if (act === 'fix-close') { const p = $('#fixPanel'); if (p) p.hidden = true; return; }
  if (act === 'fix-send') {
    const note = ($('#fixNote')?.value || '').trim();
    if (!note) { toast('어떻게 다른지 한 줄만 적어주세요'); $('#fixNote')?.focus(); return; }
    await store.addReport({ place_id: id, kind: 'location', note });
    $('#fixPanel')?.setAttribute('hidden', '');
    toast('위치 수정 제보를 남겼어요. 확인해서 반영할게요', 3000);
    return;
  }
  if (act === 'broken') {
    await store.addReport({ place_id: id, kind: 'broken_link', note: '후기 링크가 열리지 않는다는 제보' });
    toast('알려줘서 고마워요. 링크를 확인할게요');
    return;
  }
  if (act === 'nearby') {
    openDetail(id, { fly: true });
    const body = $('#detailBody');
    if (body) body.scrollTop = 0;
    return;
  }
}

async function submitComment(placeId) {
  const input = $('#cmtInput');
  if (!input) return;
  const body = input.value.trim();
  if (!body) { toast('한줄평을 적어주세요'); input.focus(); return; }
  await store.addComment({ place_id: placeId, body });
  toast('한줄평을 남겼어요. 고마워요!');
}

/* ── 시작 ─────────────────────────────────────────────── */
async function start() {
  try {
    store = new Store();
    await store.init();
  } catch (err) {
    console.error('[오늘어디] 초기화 실패', err);
    toast('데이터를 불러오지 못했어요. 새로고침해 주세요.', 5000);
    return;
  }

  populateAddForm();
  renderFilters();
  bindEvents();

  try {
    mapAdapter = await createMapAdapter({
      el: dom.map,
      key: store.settings.kakaoKey,
      center: INCHEON_CENTER,
      zoom: INCHEON_ZOOM,
      onPick: (coord) => { if (state.pickMode) finishPick(coord); }
    });
    if (mapAdapter.fallbackReason) toast('카카오맵 키를 확인할 수 없어 기본 지도로 열었어요', 3600);
  } catch (err) {
    console.warn('[오늘어디] 지도 초기화 실패', err);
    dom.mapFallback.hidden = false;
    mapAdapter = null;
  }

  render();

  store.on((evt) => {
    if (evt === 'sync-warning') {
      toast('서버에 저장하지 못해 이 기기에 저장했어요', 3200);
      return;
    }
    if (evt === 'remote-error') {
      updateModeChip();
      toast(`데이터 연결 실패: ${store.remoteError}`, 4000);
      return;
    }
    render();
    updateModeChip();
    if (state.detailId && ['reports', 'favorites', 'places', 'profile', 'comments'].includes(evt)) {
      renderDetail();
    }
    if (evt === 'sync' && state.detailId) renderDetail();
  });

  if (store.remoteError) {
    updateModeChip();
    toast(`데이터 연결 실패: ${store.remoteError}`, 4000);
  }

  /* 들어온 주소에 가게가 있으면 바로 열기 */
  const m = location.hash.match(/^#p=(.+)$/);
  if (m) openDetail(decodeURIComponent(m[1]));

  /* 시간이 흐르면 영업 상태 갱신 */
  setInterval(() => { if (!state.detailId || state.openModal !== 'detailModal') render(); }, 60000);

  /* 화면 높이에 맞춰 시트 기본 높이 */
  if (window.innerWidth <= 980) setSheetHeight(Math.min(PEEK, window.innerHeight * 0.42));
}

start();
