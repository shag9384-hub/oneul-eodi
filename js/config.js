/* 오늘어디 — 런타임 설정 (Vercel 정적 배포용)
 *
 * 키를 넣는 방법 3가지
 *  1) 이 파일에 직접 입력하고 배포
 *  2) 배포 후 주소 뒤에 붙여 설정:  /?kakao=...&sb=...&key=...  (이 기기에만 저장)
 *  3) 화면의 '내 설정'에서 입력  (이 기기에만 저장)
 *
 * 여기 값은 '기본값'이고, 브라우저에 저장된 설정이 있으면 그것이 우선합니다.
 */
window.ENV = Object.assign({
  SUPABASE_URL: 'https://zuvmjsfxuosdxhpdhhwh.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp1dm1qc2Z4dW9zZHhocGRoaHdoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTU0ODI1MDQsImV4cCI6MjExMTA1ODUwNH0.8Ag4ZASXMWR0tQC31Wly2TjnbloE1YWL1RcAoWm7cEU',
  KAKAO_MAP_KEY: '',
  // 타일 서버를 바꾸고 싶을 때 (기본: OpenStreetMap 공개 타일)
  TILE_URL: '',
  TILE_ATTR: ''
}, window.ENV || {});
