/* 오늘어디 — 단위 테스트 (node tests/unit.test.mjs) */
import assert from 'node:assert/strict';
import {
  esc, normalizeDays, applyHolidayNotes, parseHours, parseHourWindows, fmtHM,
  computeStatus, isLiveNow, haversine, fmtDistance, shortHours, latestReportOf, timeAgo,
  naverMapLink, kakaoMapLink
} from '../js/util.js';
import { normalizeCategory } from '../js/store.js';

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✅ ' + name); }
  catch (err) { failed++; console.log('  ❌ ' + name + ' — ' + err.message); }
}

console.log('\n[util · 문자열]');
test('esc — HTML 특수문자', () => {
  assert.equal(esc('<b>"A"&</b>'), '&lt;b&gt;&quot;A&quot;&amp;&lt;/b&gt;');
  assert.equal(esc(null), '');
});

console.log('\n[util · 요일]');
test('normalizeDays — 매일/주말/평일', () => {
  assert.deepEqual(normalizeDays(['매일']), ['일', '월', '화', '수', '목', '금', '토']);
  assert.deepEqual(normalizeDays(['주말']), ['일', '토']);
  assert.deepEqual(normalizeDays(['평일']), ['월', '화', '수', '목', '금']);
});
test('normalizeDays — 문자열·배열 혼용', () => {
  assert.deepEqual(normalizeDays('화,목,토'), ['화', '목', '토']);
  assert.deepEqual(normalizeDays(['월요일']), ['월']);
  assert.deepEqual(normalizeDays([]), []);
  assert.deepEqual(normalizeDays(null), []);
});
test('applyHolidayNotes — 일 휴무 표기 반영', () => {
  assert.deepEqual(applyHolidayNotes(['매일'], '11:00~21:00 (일 휴무)'), ['월', '화', '수', '목', '금', '토']);
  assert.deepEqual(applyHolidayNotes(['매일'], '10:00~20:00'), ['일', '월', '화', '수', '목', '금', '토']);
  assert.deepEqual(applyHolidayNotes(['화', '목'], '정기휴무 없음'), ['화', '목']);
});

console.log('\n[util · 영업시간]');
test('parseHours — 기본 범위', () => {
  assert.deepEqual(parseHours('15:00~21:00'), { start: 900, end: 1260 });
  assert.deepEqual(parseHours('15:00-21:00'), { start: 900, end: 1260 });
  assert.equal(parseHours(''), null);
  assert.equal(parseHours('평일 21:00까지'), null);
});
test('parseHourWindows — 브레이크 타임', () => {
  assert.deepEqual(parseHourWindows('11:30~15:00 / 17:00~20:30'),
    [{ start: 690, end: 900 }, { start: 1020, end: 1230 }]);
});
test('parseHourWindows — 자정 넘김', () => {
  assert.deepEqual(parseHours('18:00~익일 06:00'), { start: 1080, end: 1800 });
});
test('fmtHM — 24:00 표기', () => {
  assert.equal(fmtHM(1440), '24:00');
  assert.equal(fmtHM(900), '15:00');
  assert.equal(fmtHM(0), '00:00');
});
test('shortHours — 목록용 축약', () => {
  assert.equal(shortHours('07:00~24:00(시장 운영시간)'), '07:00~24:00');
  assert.equal(shortHours('평일 21:00까지'), '평일 21:00까지');
});

console.log('\n[util · 상태 계산]');
const NOW = new Date('2026-11-24T13:00:00+09:00'); // 화요일 13:00
const base = { id: 'x', days: ['화'], hours: '12:00~20:00' };
test('오늘 영업일 + 영업시간 안 → open', () => {
  assert.equal(computeStatus(base, [], NOW), 'open');
});
test('영업 전 → soon', () => {
  assert.equal(computeStatus({ ...base, hours: '16:00~22:00' }, [], NOW), 'soon');
});
test('영업 종료 → gone', () => {
  assert.equal(computeStatus({ ...base, hours: '08:00~11:00' }, [], NOW), 'gone');
});
test('오늘 쉬는 날 → closed', () => {
  assert.equal(computeStatus({ id: 'x', days: ['월'], hours: '' }, [], NOW), 'closed');
});
test('요일 정보 없음 → unknown', () => {
  assert.equal(computeStatus({ id: 'x', days: [], hours: '' }, [], NOW), 'unknown');
  assert.equal(computeStatus({ id: 'x', days: [], hours: '12:00~20:00' }, [], NOW), 'unknown');
});
test('시간 정보 없고 오늘 영업일 → open (영업 중 단정 아님)', () => {
  assert.equal(computeStatus({ id: 'x', days: ['화'], hours: '' }, [], NOW), 'open');
});
test("최근 '있어요' 제보 → live (휴무일도 현실 우선)", () => {
  const reports = [{ id: 'r1', place_id: 'x', kind: 'here', created_at: '2026-11-24T12:40:00+09:00' }];
  assert.equal(computeStatus({ id: 'x', days: ['월'], hours: '' }, reports, NOW), 'live');
});
test("최근 '없어요' 제보 → gone", () => {
  const reports = [{ id: 'r1', place_id: 'x', kind: 'gone', created_at: '2026-11-24T12:55:00+09:00' }];
  assert.equal(computeStatus(base, reports, NOW), 'gone');
});
test('오래된 제보는 무시 (2시간 반 초과)', () => {
  const reports = [{ id: 'r1', place_id: 'x', kind: 'here', created_at: '2026-11-24T10:00:00+09:00' }];
  assert.equal(computeStatus({ ...base, hours: '16:00~22:00' }, reports, NOW), 'soon');
});
test('isLiveNow — 시간표 있는 open 만 지금 떴다', () => {
  assert.equal(isLiveNow({ hours: '12:00~20:00' }, 'open'), true);
  assert.equal(isLiveNow({ hours: '' }, 'open'), false);
  assert.equal(isLiveNow({ hours: '' }, 'live'), true);
  assert.equal(isLiveNow({ hours: '12:00~20:00' }, 'soon'), false);
});
test('latestReportOf — 가장 최근 제보', () => {
  const reports = [
    { id: 'a', place_id: 'x', kind: 'here', created_at: '2026-11-24T11:00:00+09:00' },
    { id: 'b', place_id: 'x', kind: 'gone', created_at: '2026-11-24T12:00:00+09:00' }
  ];
  assert.equal(latestReportOf('x', reports).id, 'b');
});

console.log('\n[util · 거리]');
test('haversine — 약 1.3km', () => {
  const d = haversine({ lat: 37.5665, lng: 126.9780 }, { lat: 37.5704, lng: 126.9922 });
  assert.ok(d > 1200 && d < 1400, 'got ' + d);
});
test('haversine — 20m 이내', () => {
  const d = haversine({ lat: 37.3954912, lng: 126.6452189 }, { lat: 37.3956, lng: 126.6453 });
  assert.ok(d < 30, 'got ' + d);
});
test('fmtDistance', () => {
  assert.equal(fmtDistance(499), '500m');
  assert.equal(fmtDistance(1234), '1.2km');
  assert.equal(fmtDistance(null), '');
});

console.log('\n[util · 링크]');
test('지도 딥링크', () => {
  const p = { name: '송도 붕어빵', dong: '송도동', lat: 37.39, lng: 126.64 };
  assert.ok(naverMapLink(p).startsWith('https://map.naver.com/p/search/'));
  assert.ok(kakaoMapLink(p).startsWith('https://map.kakao.com/link/to/'));
  assert.equal(kakaoMapLink(p), 'https://map.kakao.com/link/to/%EC%86%A1%EB%8F%84%20%EB%B6%95%EC%96%B4%EB%B9%B5,37.39,126.64');
});
test('timeAgo', () => {
  const now = Date.now();
  assert.equal(timeAgo(new Date(now - 30 * 1000).toISOString()), '방금 전');
  assert.equal(timeAgo(new Date(now - 5 * 60000).toISOString()), '5분 전');
});

console.log('\n[store · 카테고리 정규화]');
test('normalizeCategory — 표기 흔들림 흡수', () => {
  assert.equal(normalizeCategory('붕어빵/호떡'), '붕어빵·호떡');
  assert.equal(normalizeCategory('호떡, 붕어빵'), '붕어빵·호떡');
  assert.equal(normalizeCategory('분식'), '떡볶이·분식');
  assert.equal(normalizeCategory('닭꼬치'), '꼬치');
  assert.equal(normalizeCategory('타코야끼'), '타코야키');
  assert.equal(normalizeCategory('디저트'), '디저트·간식');
  assert.equal(normalizeCategory('없는분류'), '기타');
});

console.log(`\n결과: ${passed}/${passed + failed} 통과` + (failed ? ` · 실패 ${failed}` : ''));
if (failed) process.exit(1);
