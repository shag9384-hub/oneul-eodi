/* 오늘어디 — 데이터 저장소
 *  · 기본: data/seed_places.json + localStorage (서버 0원)
 *  · 선택: Supabase REST (URL + anon key) — 여러 사람이 같은 지도를 봄
 */

import { normalizeDays, uid, safeJson, applyHolidayNotes } from './util.js';

const LS = {
  added: 'oe_added_places',
  reports: 'oe_reports',
  comments: 'oe_comments',
  suggestions: 'oe_suggestions',
  fav: 'oe_favorites',
  votes: 'oe_my_votes',
  profile: 'oe_profile',
  settings: 'oe_settings'
};

const POSTS_POLL_MS = 30000;

function readLS(key, fallback) {
  const raw = localStorage.getItem(key);
  if (raw == null) return fallback;
  const parsed = safeJson(raw, fallback);
  return parsed == null ? fallback : parsed;
}
function writeLS(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); }
  catch (e) { /* 사파리 사생활 보호 모드 등 — 메모리 상태로 계속 동작 */ }
}

/* 카테고리 표기 정규화 (수집 데이터마다 조금씩 달라도 한 칩으로 모이게) */
const CATEGORY_RULES = [
  [/붕어빵|호떡|풀빵|계란빵|국화빵/, '붕어빵·호떡'],
  [/순대|순대국|곱창순대/, '순대'],
  [/소금빵|베이커리|빵집|츄러스|츄로스|크로플|크루아상|에그타르트/, '소금빵·빵'],
  [/닭강정/, '닭강정'],
  [/해산물|수산|초밥|스시|조개|새우|과메기|물회|회무침|굴구이/, '해산물·초밥'],
  [/보쌈|족발|스테이크|그릴|쿠바노|바베큐플래터/, '보쌈·고기'],
  [/꼬치|닭꼬치|오뎅|어묵/, '꼬치'],
  [/통닭|바베큐|바비큐|닭갈비|치킨|닭발|닭튀김/, '통닭·바베큐'],
  [/타코야키|타코야끼|다코야키|문어빵/, '타코야키'],
  [/떡볶이|분식|김밥|라면|어묵|튀김|핫도그|토스트|컵밥/, '떡볶이·분식'],
  [/곱창|막창|대창/, '곱창'],
  [/디저트|간식|와플|크레페|아이스크림|빙수|도넛|쿠키|약과|탕후루|솜사탕|팝콘/, '디저트·간식']
];

export function normalizeCategory(raw) {
  const s = String(raw || '').trim();
  const known = ['붕어빵·호떡', '순대', '꼬치', '통닭·바베큐', '타코야키', '떡볶이·분식', '곱창',
    '소금빵·빵', '닭강정', '보쌈·고기', '해산물·초밥', '디저트·간식', '기타'];
  if (known.includes(s)) return s;
  for (const [re, name] of CATEGORY_RULES) if (re.test(s)) return name;
  return '기타';
}

function normalizePlace(raw, i = 0) {
  const lat = Number(raw.lat);
  const lng = Number(raw.lng ?? raw.lon ?? raw.lng);
  const days = raw.days != null ? raw.days : [];
  return {
    id: String(raw.id || raw.place_id || uid('p')),
    name: String(raw.name || raw.title || '이름 없는 가게').trim(),
    category: normalizeCategory(raw.category),
    type: ['푸드트럭', '노점', '매장'].includes(raw.type) ? raw.type : '노점',
    gu: String(raw.gu || '').trim(),
    dong: String(raw.dong || '').trim(),
    address_desc: String(raw.address_desc || raw.address || '').trim(),
    lat: Number.isFinite(lat) ? lat : null,
    lng: Number.isFinite(lng) ? lng : null,
    days: applyHolidayNotes(days, String(raw.hours || '')),
    hours: String(raw.hours || '').trim(),
    menu_note: String(raw.menu_note || raw.menu || '').trim(),
    source_url: String(raw.source_url || '').trim(),
    source_title: String(raw.source_title || '').trim(),
    coord_verified: !!raw.coord_verified,
    sample: !!raw.sample,
    created_at: raw.created_at || null,
    created_by_user: !!raw.created_by_user
  };
}

/* 시드 파일을 못 불러왔을 때 — 화면이 비지 않도록 쓰는 최소 샘플 */
const INLINE_FALLBACK = [
  { id: 'sample-1', name: '송도 센트럴파크 붕어빵 트럭', category: '붕어빵·호떡', type: '푸드트럭', gu: '연수구', dong: '송도동', address_desc: '센트럴파크 1호관 맞은편 보도', lat: 37.3926, lng: 126.6385, days: ['매일'], hours: '13:00~21:00', menu_note: '팥 붕어빵 3개 2,000원 · 슈크림 3개 2,500원', sample: true },
  { id: 'sample-2', name: '구월 로데오 떡볶이 포장마차', category: '떡볶이·분식', type: '노점', gu: '남동구', dong: '구월동', address_desc: '구월 로데오거리 입구', lat: 37.4507, lng: 126.7016, days: ['월', '화', '수', '목', '금'], hours: '16:00~23:00', menu_note: '떡볶이 3,000원 · 순대 4,000원', sample: true },
  { id: 'sample-3', name: '부평역 닭꼬치 트럭', category: '꼬치', type: '푸드트럭', gu: '부평구', dong: '부평동', address_desc: '부평역 3번 출구 뒤편', lat: 37.4895, lng: 126.7245, days: ['화', '목', '토'], hours: '17:00~22:30', menu_note: '닭꼬치 2,500원 · 데리야끼 닭꼬치 3,000원', sample: true },
  { id: 'sample-4', name: '청라 카페거리 타코야키', category: '타코야키', type: '푸드트럭', gu: '서구', dong: '청라동', address_desc: '청라 커낼웨이 상가 앞', lat: 37.5338, lng: 126.6494, days: ['금', '토', '일'], hours: '15:00~21:00', menu_note: '타코야키 6개 5,000원', sample: true },
  { id: 'sample-5', name: '신포시장 호떡 노점', category: '붕어빵·호떡', type: '노점', gu: '중구', dong: '신포동', address_desc: '신포국제시장 안 3번 골목', lat: 37.4715, lng: 126.6285, days: ['매일'], hours: '10:00~19:00', menu_note: '씨앗호떡 2,000원', sample: true }
];

class ApiError extends Error {
  constructor(message, status, body) { super(message); this.status = status; this.body = body; }
}

export class Store {
  constructor() {
    this.places = [];
    this.reports = [];
    this.comments = [];
    this.suggestions = [];
    this.favorites = new Set(readLS(LS.fav, []));
    this.myVotes = readLS(LS.votes, {});
    this.profile = Object.assign({ nickname: '' }, readLS(LS.profile, {}));
    this.settings = Object.assign(
      {
        kakaoKey: window.ENV?.KAKAO_MAP_KEY || '',
        sbUrl: window.ENV?.SUPABASE_URL || '',
        sbKey: window.ENV?.SUPABASE_ANON_KEY || ''
      },
      readLS(LS.settings, {})
    );
    this.mode = 'seed';           // seed | supabase
    this.seedIsSample = false;
    this.remoteError = '';
    this.lastSync = null;
    this._listeners = new Set();
    this._pollTimer = null;
  }

  on(fn) { this._listeners.add(fn); return () => this._listeners.delete(fn); }
  emit(evt = 'change') { this._listeners.forEach(fn => { try { fn(evt, this); } catch (e) { console.warn(e); } }); }

  get isRemote() { return this.mode === 'supabase' && !!(this.settings.sbUrl && this.settings.sbKey); }
  get dataCount() { return this.places.length; }

  /* ── 초기화 ───────────────────────────────────────────── */
  async init() {
    await this.loadSeed();
    this.loadLocal();
    if (this.settings.sbUrl && this.settings.sbKey) {
      await this.pullRemote(true);
      if (this.isRemote) this.startPolling();
    }
    this.emit('init');
    return this;
  }

  async loadSeed() {
    let data = null;
    try {
      const res = await fetch('data/seed_places.json', { cache: 'no-store' });
      if (res.ok) data = await res.json();
    } catch (e) { /* 오프라인 등 — 아래 폴백 */ }

    let list = [];
    let meta = {};
    if (Array.isArray(data)) list = data;
    else if (data && Array.isArray(data.places)) { list = data.places; meta = data._meta || {}; }
    if (!list.length) {
      list = INLINE_FALLBACK;
      meta = { sample: true, note: '시드 파일을 불러오지 못해 내장 샘플로 표시 중' };
    }
    this.seedPlaces = list.map((p, i) => normalizePlace(p, i));
    this.seedIsSample = !!meta.sample || this.seedPlaces.every(p => p.sample);
    this.seedMeta = meta;
    this.places = this.seedPlaces.slice();
  }

  loadLocal() {
    const added = readLS(LS.added, []).map((p, i) => normalizePlace(p, i));
    const reports = readLS(LS.reports, []);
    const comments = readLS(LS.comments, []);
    this.localPlaces = added;
    this.localReports = Array.isArray(reports) ? reports : [];
    this.localComments = Array.isArray(comments) ? comments : [];
    this.suggestions = readLS(LS.suggestions, []);

    this.places = this.mergePlaces(this.seedPlaces, added);
    this.reports = this.mergeByID(this.localReports, []);
    this.comments = this.mergeComments(this.localComments, []);
  }

  mergePlaces(base, extra) {
    const map = new Map();
    for (const p of base) map.set(p.id, p);
    for (const p of extra || []) map.set(p.id, p);
    return Array.from(map.values());
  }

  mergeByID(a, b) {
    const map = new Map();
    for (const x of b || []) map.set(x.id, x);
    for (const x of a || []) map.set(x.id, x);
    return Array.from(map.values()).sort((x, y) => new Date(y.created_at || 0) - new Date(x.created_at || 0));
  }

  mergeComments(a, b) {
    return this.mergeByID(a, b).sort((x, y) => new Date(y.created_at || 0) - new Date(x.created_at || 0));
  }

  /* ── Supabase REST ────────────────────────────────────── */
  async sbFetch(path, options = {}) {
    const { sbUrl, sbKey } = this.settings;
    const url = sbUrl.replace(/\/+$/, '') + '/rest/v1/' + path;
    const res = await fetch(url, {
      ...options,
      headers: {
        apikey: sbKey,
        Authorization: `Bearer ${sbKey}`,
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    });
    const text = await res.text();
    const body = text ? safeJson(text, text) : null;
    if (!res.ok) throw new ApiError(`Supabase ${res.status}`, res.status, body);
    return body;
  }

  async pullRemote(initial = false) {
    if (!this.settings.sbUrl || !this.settings.sbKey) return false;
    try {
      const [places, reports, comments] = await Promise.all([
        this.sbFetch('places?select=*&order=created_at.asc&limit=2000'),
        this.sbFetch('reports?select=*&order=created_at.desc&limit=2000'),
        this.sbFetch('comments?select=*&order=created_at.desc&limit=2000')
      ]);
      const remotePlaces = (Array.isArray(places) ? places : []).map((p, i) => normalizePlace(p, i));
      const localAdded = readLS(LS.added, []).map((p, i) => normalizePlace(p, i));

      this.places = this.mergePlaces(this.seedPlaces, remotePlaces.concat(localAdded));
      this.reports = this.mergeByID(this.localReports, Array.isArray(reports) ? reports : []);
      this.comments = this.mergeComments(this.localComments, Array.isArray(comments) ? comments : []);
      const merged = new Map();
      for (const p of remotePlaces) merged.set(p.id, p);
      for (const p of this.places) if (!merged.has(p.id)) merged.set(p.id, p);
      this.places = Array.from(merged.values());

      this.mode = 'supabase';
      this.remoteError = '';
      this.lastSync = new Date().toISOString();
      if (!initial) this.emit('sync');
      return true;
    } catch (err) {
      this.mode = 'seed';
      this.remoteError = err.status === 401 || err.status === 403
        ? 'anon key 또는 RLS 정책을 확인해 주세요.'
        : (err.message || '연결 실패');
      if (initial) this.emit('remote-error');
      return false;
    }
  }

  startPolling() {
    this.stopPolling();
    this._pollTimer = setInterval(() => {
      if (document.visibilityState === 'visible') this.pullRemote(false);
    }, POSTS_POLL_MS);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && this.isRemote) this.pullRemote(false);
    });
  }

  stopPolling() {
    if (this._pollTimer) clearInterval(this._pollTimer);
    this._pollTimer = null;
  }

  async push(table, row) {
    if (!this.isRemote) return { ok: false, skipped: true };
    try {
      const out = await this.sbFetch(table, {
        method: 'POST',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify(row)
      });
      return { ok: true, data: out };
    } catch (err) {
      this.syncWarning = err.message;
      return { ok: false, error: err };
    }
  }

  /* ── 읽기 ─────────────────────────────────────────────── */
  getPlace(id) { return this.places.find(p => p.id === id) || null; }
  reportsFor(id) { return this.reports.filter(r => r.place_id === id); }
  commentsFor(id) {
    return this.comments.filter(c => c.place_id === id)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }
  isFavorite(id) { return this.favorites.has(id); }
  myVoteFor(id) { return this.myVotes[id] || null; }

  countsFor(id) {
    const rs = this.reportsFor(id);
    return {
      here: rs.filter(r => r.kind === 'here').length,
      gone: rs.filter(r => r.kind === 'gone').length
    };
  }

  /* ── 쓰기 ─────────────────────────────────────────────── */
  async addPlace(input) {
    const place = normalizePlace({
      ...input,
      id: input.id || uid('p'),
      created_at: new Date().toISOString(),
      created_by_user: true,
      sample: false
    });
    const added = readLS(LS.added, []);
    added.unshift(place);
    writeLS(LS.added, added);
    this.localPlaces = added.map((p, i) => normalizePlace(p, i));
    this.places = this.mergePlaces(this.places, [place]);
    this.emit('places');

    if (this.isRemote) {
      const res = await this.push('places', {
        id: place.id, name: place.name, category: place.category, type: place.type,
        gu: place.gu, dong: place.dong, address_desc: place.address_desc,
        lat: place.lat, lng: place.lng, days: place.days, hours: place.hours,
        menu_note: place.menu_note, source_url: place.source_url,
        source_title: place.source_title, coord_verified: place.coord_verified
      });
      if (!res.ok) this.emit('sync-warning');
    }
    return place;
  }

  async addReport({ place_id, kind, note = '' }) {
    const report = {
      id: uid('r'),
      place_id,
      kind,
      note: String(note || '').slice(0, 200),
      reporter: this.profile.nickname || '익명',
      created_at: new Date().toISOString()
    };
    this.localReports = [report, ...this.localReports];
    writeLS(LS.reports, this.localReports);
    this.reports = this.mergeByID(this.localReports, this.reports);
    if (kind === 'here' || kind === 'gone') {
      this.myVotes[place_id] = { kind, at: report.created_at };
      writeLS(LS.votes, this.myVotes);
    }
    this.emit('reports');
    if (this.isRemote) {
      const res = await this.push('reports', { place_id, kind, note: report.note, reporter: report.reporter });
      if (!res.ok) this.emit('sync-warning');
    }
    return report;
  }

  async addComment({ place_id, body }) {
    const text = String(body || '').trim().slice(0, 200);
    if (!text) throw new Error('한줄평을 입력해 주세요.');
    const comment = {
      id: uid('c'),
      place_id,
      body: text,
      author: this.profile.nickname || '익명',
      created_at: new Date().toISOString()
    };
    this.localComments = [comment, ...this.localComments];
    writeLS(LS.comments, this.localComments);
    this.comments = this.mergeComments(this.localComments, this.comments);
    this.emit('comments');
    if (this.isRemote) {
      const res = await this.push('comments', { place_id, body: text, author: comment.author });
      if (!res.ok) this.emit('sync-warning');
    }
    return comment;
  }

  async addSuggestion({ kind, message, contact, place_name }) {
    const suggestion = {
      id: uid('s'),
      kind: String(kind || '기타'),
      message: String(message || '').trim().slice(0, 500),
      contact: String(contact || '').trim().slice(0, 60),
      place_name: String(place_name || ''),
      created_at: new Date().toISOString()
    };
    if (!suggestion.message) throw new Error('내용을 입력해 주세요.');
    this.suggestions = [suggestion, ...this.suggestions];
    writeLS(LS.suggestions, this.suggestions);
    if (this.isRemote) {
      await this.push('suggestions', {
        kind: suggestion.kind, message: suggestion.message,
        contact: suggestion.contact, place_name: suggestion.place_name
      });
    }
    return suggestion;
  }

  toggleFavorite(id) {
    if (this.favorites.has(id)) this.favorites.delete(id);
    else this.favorites.add(id);
    writeLS(LS.fav, Array.from(this.favorites));
    this.emit('favorites');
    return this.favorites.has(id);
  }

  setNickname(name) {
    this.profile.nickname = String(name || '').trim().slice(0, 16);
    writeLS(LS.profile, this.profile);
    this.emit('profile');
  }

  setSettings(patch) {
    Object.assign(this.settings, patch);
    writeLS(LS.settings, this.settings);
  }

  exportMine() {
    return {
      exported_at: new Date().toISOString(),
      profile: this.profile,
      favorites: this.places.filter(p => this.favorites.has(p.id)).map(p => ({ id: p.id, name: p.name })),
      places: this.localPlaces,
      reports: this.localReports,
      comments: this.localComments,
      suggestions: this.suggestions
    };
  }

  clearLocal() {
    [LS.added, LS.reports, LS.comments, LS.suggestions, LS.fav, LS.votes, LS.profile].forEach(k => localStorage.removeItem(k));
    this.favorites = new Set();
    this.myVotes = {};
    this.profile = { nickname: '' };
    this.localPlaces = [];
    this.localReports = [];
    this.localComments = [];
    this.suggestions = [];
    this.places = (this.seedPlaces || []).slice();
    this.reports = [];
    this.comments = [];
    this.emit('reset');
  }
}
