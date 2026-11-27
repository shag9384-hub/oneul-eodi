/* 오늘어디 — 공용 유틸 (상태 계산 · 거리 · 링크) */

export const KOR_DAYS = ['일', '월', '화', '수', '목', '금', '토'];

export const CATEGORIES = [
  { name: '전체', emoji: '', key: '전체' },
  { name: '붕어빵·호떡', emoji: '🐟', key: '붕어빵·호떡' },
  { name: '순대', emoji: '🍲', key: '순대' },
  { name: '곱창', emoji: '🥘', key: '곱창' },
  { name: '꼬치', emoji: '🍢', key: '꼬치' },
  { name: '통닭·바베큐', emoji: '🔥', key: '통닭·바베큐' },
  { name: '닭강정', emoji: '🍗', key: '닭강정' },
  { name: '보쌈·고기', emoji: '🥩', key: '보쌈·고기' },
  { name: '타코야키', emoji: '🐙', key: '타코야키' },
  { name: '떡볶이·분식', emoji: '🍜', key: '떡볶이·분식' },
  { name: '소금빵·빵', emoji: '🥐', key: '소금빵·빵' },
  { name: '해산물·초밥', emoji: '🦐', key: '해산물·초밥' },
  { name: '디저트·간식', emoji: '🍪', key: '디저트·간식' },
  { name: '기타', emoji: '🥡', key: '기타' }
];

export const CATEGORY_META = Object.fromEntries(CATEGORIES.map(c => [c.key, c]));

// 2026-07-01 인천 행정체제 개편(2군 9구) 반영 —
// 기존 중구는 제물포구·영종구로, 서구는 서해구·검단구로 나뉘었습니다.
export const GU_FILTERS = [
  { name: '전체 인천', match: [] },
  { name: '연수구', match: ['연수구'] },
  { name: '남동구', match: ['남동구'] },
  { name: '부평구', match: ['부평구'] },
  { name: '미추홀구', match: ['미추홀구'] },
  { name: '서해구·검단구', match: ['서구', '서해구', '검단구'] },
  { name: '계양구', match: ['계양구'] },
  { name: '제물포구·동구', match: ['중구', '동구', '제물포구'] },
  { name: '영종구', match: ['영종구'] },
  { name: '강화·옹진', match: ['강화군', '옹진군'] }
];

// 제보 폼의 '구' 선택지 — 2026-07-01 개편 기준 현행 자치구·군
export const GU_OPTIONS = [
  '연수구', '남동구', '부평구', '미추홀구', '서해구', '검단구',
  '계양구', '제물포구', '영종구', '강화군', '옹진군'
];

export const STATUS_META = {
  live: { label: '지금 있어요', cls: 's-live', rank: 0 },
  open: { label: '오늘 영업일', cls: 's-open', rank: 1 },
  soon: { label: '영업 전', cls: 's-soon', rank: 2 },
  gone: { label: '지금 없어요', cls: 's-gone', rank: 3 },
  closed: { label: '오늘 휴무', cls: 's-closed', rank: 5 },
  unknown: { label: '영업 정보 제보 필요', cls: 's-unknown', rank: 4 }
};

/** HTML 특수문자 이스케이프 */
export function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function uid(prefix = 'oe') {
  return prefix + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

export function debounce(fn, wait = 140) {
  let t;
  return function (...args) {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), wait);
  };
}

export function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }

/** 두 좌표 사이 거리(m) — 하버사인 */
export function haversine(a, b) {
  if (!a || !b) return null;
  const R = 6371000;
  const toRad = d => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function fmtDistance(m) {
  if (m == null || !Number.isFinite(m)) return '';
  if (m < 1000) return Math.round(m / 10) * 10 + 'm';
  return (m / 1000).toFixed(m < 10000 ? 1 : 0) + 'km';
}

/** '매일', '주말', ['화','목'] 등 다양한 표기를 요일 배열로 */
export function normalizeDays(days) {
  const out = new Set();
  const list = Array.isArray(days) ? days : (days ? String(days).split(/[,·/\s]+/) : []);
  for (const raw of list) {
    const s = String(raw == null ? '' : raw).trim();
    if (!s) continue;
    if (/매일|상시|연중|매일영업|항상/.test(s)) { KOR_DAYS.forEach(d => out.add(d)); continue; }
    if (/평일/.test(s)) { ['월', '화', '수', '목', '금'].forEach(d => out.add(d)); continue; }
    if (/주말/.test(s)) { ['토', '일'].forEach(d => out.add(d)); continue; }
    const explicit = Array.from(s.matchAll(/([월화수목금토일])요일/g)).map(m => m[1]);
    if (explicit.length) { explicit.forEach(d => out.add(d)); continue; }
    const hits = KOR_DAYS.filter(d => s.includes(d));
    hits.forEach(d => out.add(d));
  }
  return KOR_DAYS.filter(d => out.has(d));
}

export function isEveryDay(days) {
  const n = normalizeDays(days);
  return n.length === 7;
}

export function fmtDays(days) {
  const n = normalizeDays(days);
  if (!n.length) return '요일 정보 없음';
  if (n.length === 7) return '매일';
  return n.join('·');
}

/** '15:00~21:00' → {start:900, end:1260}. 못 읽으면 null */
export function parseHours(hours) {
  const list = parseHourWindows(hours);
  return list.length ? list[0] : null;
}

/** 브레이크 타임이 있는 경우까지: '11:00~15:00, 17:00~21:00' → [{start,end}, ...] */
export function parseHourWindows(hours) {
  if (!hours) return [];
  const text = String(hours).replace(/\s/g, '');
  const out = [];
  const re = /(\d{1,2}):?(\d{2})?\s*[~\-–]\s*(?:익일|다음날)?\s*(\d{1,2}):?(\d{2})?/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const start = (+m[1]) * 60 + (m[2] ? +m[2] : 0);
    let end = (+m[3]) * 60 + (m[4] ? +m[4] : 0);
    if (end <= start) end += 24 * 60;
    out.push({ start, end });
    if (out.length >= 4) break;
  }
  return out;
}

/** '일 휴무' 같은 영업시간 표기에서 쉬는 요일을 days 에서 덜어낸다 */
export function applyHolidayNotes(days, hours) {
  const list = normalizeDays(days);
  const text = String(hours || '');
  const remove = new Set();
  if (/토\s*[·,]?\s*일\s*휴무|주말\s*휴무|토요일\s*[·,]?\s*일요일\s*휴무/.test(text)) { remove.add('토'); remove.add('일'); }
  else {
    if (/일요일\s*휴무|일\s*휴무/.test(text)) remove.add('일');
    if (/토요일\s*휴무|토\s*휴무/.test(text)) remove.add('토');
  }
  if (/월요일\s*휴무|월\s*휴무/.test(text)) remove.add('월');
  if (/화요일\s*휴무|화\s*휴무/.test(text)) remove.add('화');
  if (/수요일\s*휴무|수\s*휴무/.test(text)) remove.add('수');
  if (/목요일\s*휴무|목\s*휴무/.test(text)) remove.add('목');
  if (/금요일\s*휴무|금\s*휴무/.test(text)) remove.add('금');
  return remove.size ? list.filter(d => !remove.has(d)) : list;
}

export function nowMinutes(date = new Date()) {
  return date.getHours() * 60 + date.getMinutes();
}

export function minutesSince(iso, now = Date.now()) {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return Infinity;
  return (now - t) / 60000;
}

export function timeAgo(iso) {
  if (!iso) return '';
  const mins = minutesSince(iso);
  if (!Number.isFinite(mins)) return '';
  if (mins < 1) return '방금 전';
  if (mins < 60) return Math.floor(mins) + '분 전';
  const hours = Math.floor(mins / 60);
  if (hours < 24) return hours + '시간 전';
  const days = Math.floor(hours / 24);
  if (days < 7) return days + '일 전';
  const d = new Date(iso);
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
}

/** 한 가게의 최신 제보 */
export function latestReportOf(placeId, reports) {
  let best = null;
  for (const r of reports) {
    if (r.place_id !== placeId) continue;
    if (!best || new Date(r.created_at) > new Date(best.created_at)) best = r;
  }
  return best;
}

export function reportsOf(placeId, reports, kind) {
  return reports.filter(r => r.place_id === placeId && (!kind || r.kind === kind));
}

/**
 * 영업 상태 계산
 * live(지금 있어요) > 최근 '없어요' > 요일/시간표 순으로 판단.
 */
export function computeStatus(place, reports, now = new Date()) {
  const today = KOR_DAYS[now.getDay()];
  const days = normalizeDays(place.days);
  const latest = latestReportOf(place.id, reports);
  const age = latest ? minutesSince(latest.created_at, now.getTime()) : Infinity;

  if (latest && age <= 150) {
    if (latest.kind === 'here') return 'live';
    if (latest.kind === 'gone') return 'gone';
  }
  if (!days.length) return 'unknown';
  if (!days.includes(today)) return 'closed';

  const windows = parseHourWindows(place.hours);
  if (!windows.length) return 'open';
  const mins = nowMinutes(now);
  if (mins < windows[0].start) return 'soon';
  if (windows.some(w => mins >= w.start && mins <= w.end)) return 'open';
  if (mins > windows[windows.length - 1].end) return 'gone';
  return 'gone'; // 브레이크 타임 사이
}

export function isLiveStatus(status) { return status === 'live' || status === 'open'; }

/** '지금 떴다' 카운트용 — 제보로 확인됐거나, 오늘 영업일 + 영업시간 안 */
export function isLiveNow(place, status) {
  if (status === 'live') return true;
  return status === 'open' && parseHourWindows(place.hours).length > 0;
}

export function statusLabel(status) {
  return (STATUS_META[status] || STATUS_META.unknown).label;
}

export function naverMapLink(place) {
  const q = encodeURIComponent(`${place.name} ${place.dong || ''}`.trim() || place.name);
  if (place.lat && place.lng) {
    return `https://map.naver.com/p/search/${q}`;
  }
  return `https://map.naver.com/p/search/${q}`;
}

export function kakaoMapLink(place) {
  if (place.lat != null && place.lng != null) {
    const name = encodeURIComponent(place.name);
    return `https://map.kakao.com/link/to/${name},${place.lat},${place.lng}`;
  }
  return `https://map.kakao.com/link/search/${encodeURIComponent(place.name)}`;
}

export function sourceHost(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); }
  catch { return 'link'; }
}

export function todayLabel(now = new Date()) {
  const week = ['일', '월', '화', '수', '목', '금', '토'][now.getDay()];
  return `${now.getMonth() + 1}월 ${now.getDate()}일 (${week})`;
}

export function timeLabel(now = new Date()) {
  return `${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}`;
}

export function fmtHM(totalMinutes) {
  const m = totalMinutes === 1440 ? 1440 : ((totalMinutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** 목록용 짧은 영업시간 — '07:00~24:00(시장 운영시간)' → '07:00~24:00' */
export function shortHours(hours, max = 16) {
  const w = parseHourWindows(hours);
  if (w.length) return `${fmtHM(w[0].start)}~${fmtHM(w[0].end)}`;
  const t = String(hours || '').trim();
  return t.length > max ? t.slice(0, max) + '…' : t;
}

/** 카카오·네이버 지도 링크 여는 동안 앱이 없으면 웹으로 */
export function openExternal(url) {
  const w = window.open(url, '_blank', 'noopener');
  if (!w) location.href = url;
}

export function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    return navigator.clipboard.writeText(text);
  }
  return new Promise((resolve, reject) => {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); resolve(); }
    catch (e) { reject(e); }
    finally { ta.remove(); }
  });
}

export function safeJson(text, fallback = null) {
  try { return JSON.parse(text); } catch { return fallback; }
}
