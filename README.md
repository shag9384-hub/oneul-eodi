# 오늘어디 — 인천 푸드트럭·노점 실시간 지도

> **오늘 인천 어디에 떴을까?** 붕어빵·호떡·순대·곱창·닭강정·소금빵·해산물초밥 노점과 푸드트럭 위치를
> 동네 사람들의 '지금 있어요' 제보로 함께 채우는 정적 웹 앱입니다.

- 라이브(예정) 주소: `https://oneul-eodi-five.vercel.app`
- 빌드 없음 — `index.html`을 그대로 올리면 Vercel·Netlify·GitHub Pages 어디서든 동작합니다.
- 초기 데이터: 인천 8개 구 **76곳** (`data/seed_places.json`, 출처 링크 포함) — 2026-11-25 인기 푸드트럭 25곳 추가

---

## 1. 지금 되는 것

| 영역 | 내용 |
| --- | --- |
| 지도 | Leaflet + OpenStreetMap(무키). 카카오 JavaScript 키를 넣으면 **카카오맵으로 자동 전환**, 실패하면 기본 지도로 자동 폴백 |
| 핀 | 상태별 커스텀 핀(지금 있어요=앰버 / 영업일=차콜 테두리 / 그 외=뮤트) + **마커 클러스터링** |
| 필터 | 메뉴 13종 + 인천 8개 구(중구·동구 묶음) → 구 선택 시 **동네 칩이 펼쳐짐** |
| 검색 | 가게명·메뉴·동네·주소·아파트/역 이름까지 실시간 부분일치 |
| 목록 | '오늘 뜰 예정' / '즐겨찾기' 탭, 전체 보기(휴무·정보 없는 곳 포함), 상태 배지, 가까운 순(내 위치 허용 시) |
| 상세 | 위치·요일·시간·메뉴, **실시간 생존 투표(있어요/없어요)**, 위치 수정 제보, 공유, 즐겨찾기, 출처 카드 + '안 열려요' 신고, **500m 이내 다른 가게 3곳**, 한줄평(200자), 네이버·카카오 길찾기 |
| 제보 | 지도에서 핀 찍기 또는 주소·동네 입력, 메뉴·형태·요일·시간·한 줄 소개 입력 후 즉시 지도 반영 |
| 건의 | 종류 선택 + 500자 + 선택 연락처 |
| 설정 | 닉네임(익명 참여), 카카오 키, Supabase URL/anon key, 내 기록 내려받기, 기기 기록 지우기 |
| 저장 | 기본은 `localStorage`(서버비 0원). Supabase를 연결하면 여러 사람이 같은 지도를 보고 30초 폴링 + 즉시 낙관 반영 |

### 상태 계산 규칙

1. **최근 2시간 30분 안의 제보가 있으면 현실 우선** — `있어요` → `지금 있어요`, `없어요` → `지금 없어요`
2. 오늘 요일이 영업일이 아니면 → `오늘 휴무`
3. 영업시간이 있으면 지금이 영업 전/영업 중/영업 후인지 계산 (브레이크 타임 표기 `11:30~15:00 / 17:00~20:30`, 자정 넘김 `18:00~익일 06:00` 지원)
4. `days`가 비어 있으면 **'영업 정보 제보 필요'** — 절대 '영업 중'으로 단정하지 않습니다.
5. 헤더의 **'지금 떴다'** 는 제보로 확인됐거나, 오늘 영업일이면서 영업시간 안에 있는 곳만 셉니다.

---

## 2. 실행

```bash
# 저장소 루트에서
cd work/oneul-eodi
python3 -m http.server 4173
# → http://localhost:4173
```

ES 모듈을 쓰기 때문에 `file://`로 열면 동작하지 않습니다. 정적 서버가 필요합니다.

### Vercel 배포

1. 이 폴더를 GitHub 저장소로 올립니다(빌드 설정 없음, Framework Preset `Other`).
2. Vercel → New Project → 저장소 import → **Build Command 비움 / Output Directory 비움**.
3. 도메인이 `oneul-eodi-five.vercel.app`이 아니면 `robots.txt`·`sitemap.xml`의 주소만 바꿔 주세요.

---

## 3. 폴더 구조

```
oneul-eodi/
├─ index.html            # 화면 뼈대(헤더·필터·지도·바텀시트·모달 4종)
├─ css/app.css           # 디자인 시스템 (웜 크림 · 앰버 · 에스프레소 차콜 · 에메랄드)
├─ js/
│  ├─ config.js          # 런타임 키 기본값 (window.ENV)
│  ├─ util.js            # 상태 계산·거리·링크·포맷
│  ├─ store.js           # 시드+localStorage+Supabase REST 저장소
│  ├─ map.js             # Leaflet ↔ Kakao 어댑터
│  └─ app.js             # 렌더링·이벤트·모달·제보 플로우
├─ data/seed_places.json # 초기 76곳
├─ supabase/schema.sql   # 테이블 4종 + RLS 정책 + 라이브 상태 뷰
├─ vendor/               # Leaflet 1.9.4 · markercluster 1.5.3 (CDN 장애 대비 로컬 번들)
├─ tests/unit.test.mjs   # 단위 26개 (node)
└─ tests/e2e.py          # Playwright 81개 (PC·모바일·Supabase 목·카카오 폴백)
```

---

## 4. 초기 데이터

`data/seed_places.json` — 배열 또는 `{ "_meta": {...}, "places": [...] }` 둘 다 읽습니다.

```json
{
  "id": "incheon-001",
  "name": "붕어빵생각 송도본점",
  "category": "붕어빵·호떡",
  "type": "매장",
  "gu": "연수구",
  "dong": "송도동",
  "address_desc": "해돋이로 168 1층 101호 (베스킨라빈스 건물 코너)",
  "lat": 37.3954912,
  "lng": 126.6452189,
  "days": ["월", "화", "수", "목", "금", "토"],
  "hours": "11:00~21:00 (일 휴무)",
  "menu_note": "단팥·슈크림 붕어빵 1,000원 …",
  "source_url": "https://m.blog.naver.com/…",
  "source_title": "인천 송도 1공구 붕어빵 맛집 …",
  "coord_verified": true
}
```

- `category`는 9종 중 하나로 자동 정규화됩니다(`호떡, 붕어빵` → `붕어빵·호떡` 등).
- `days`는 `["매일"]`, `["주말"]`, `["화","목"]`, `"화,목,토"` 모두 허용. `hours`에 `(일 휴무)`가 있으면 요일에서 자동 제외.
- 데이터를 갱신할 때는 이 파일만 교체하면 됩니다(코드 수정 불필요).

---

## 5. Supabase 연결 (선택)

1. Supabase 무료 프로젝트 생성 → **SQL Editor**에서 `supabase/schema.sql` 전체 실행.
2. Project Settings → API에서 **Project URL**과 **anon public key** 복사.
3. 앱의 **내 설정 → 데이터 연결**에 붙여넣고 `연결하기`.
   (또는 주소 뒤에 `?sb=https://xxxx.supabase.co&sbkey=...` — 이 기기에만 저장됨)
4. 연결되면 장소·제보·한줄평이 REST로 오가고 30초마다 새 제보를 당겨옵니다.

RLS 정책: 장소·제보·한줄평은 익명 읽기/쓰기, 건의는 **쓰기만**(연락처 보호), 수정·삭제는 service_role만.
자세한 주석은 `supabase/schema.sql` 참고.

> 실서버 없이도 검증할 수 있게, E2E는 Supabase REST를 목으로 가로채 연결·투표 POST까지 확인합니다.

---

## 6. 카카오맵 키 (선택)

1. [Kakao Developers](https://developers.kakao.com) → 애플리케이션 추가 → **JavaScript 키** 복사.
2. 플랫폼 → Web → 사이트 도메인에 배포 도메인 등록(`http://localhost:4173`, `https://oneul-eodi-five.vercel.app`).
3. 앱 **내 설정 → 지도 설정**에 키 입력 → 새로고침.

키가 없거나 도메인 미등록·SDK 실패 시 **자동으로 Leaflet 지도로 폴백**하고 핀·클러스터·상세는 그대로 동작합니다.

---

## 7. 테스트

```bash
node tests/unit.test.mjs        # 26개: 요일/시간 파싱·상태 계산·거리·링크·카테고리 정규화
python3 tests/e2e.py            # 81개: PC 1280×900 / 모바일 390×844 / Supabase 목 / 카카오 폴백
```

E2E가 확인하는 것: 콘솔 에러 0 · 가로 넘침 0 · 카테고리/구/동/검색 필터 · 전체 보기 76곳 ·
상세 모달 · 투표 반영 · 한줄평 · 위치 수정 · '안 열려요' · 즐겨찾기 · 공유 클립보드 ·
지도 핀 찍어 제보 · 새로고침 후 유지 · 500m 이내 · 요일 없는 곳 상태 · Supabase 연결/투표 POST ·
카카오 실패 폴백. 스크린샷은 `downloads/oneul_eodi_*.png`에 저장됩니다.

---

## 8. 디자인 메모

- 팔레트: 크림 `#FAF7F2` / 앰버 `#EA580C` / 차콜 `#1C1917` / 에메랄드 `#16A34A`
- 레퍼런스 앱(빨간 핀·빨간 원형 버튼)의 색·형태를 쓰지 않았습니다. 상태는 **앰버(영업) + 에메랄드(확인됨)**,
  지도 핀은 이름표형 칩, 클러스터는 차콜 원, 제보 버튼은 왼쪽 앰버 알약입니다.
- PC는 지도+사이드 리스트 2단, 모바일은 지도 위 바텀시트(드래그·스냅). iOS 사파리 `dvh`·세이프에어리어 대응.

## 9. 알려진 한계

- Supabase 실프로젝트·카카오 실키는 이 작업 환경에 없어 **목/폴백 경로로만 검증**했습니다.
- '위치 수정' 제보는 저장만 되고 장소 좌표를 자동으로 바꾸지 않습니다(운영자 확인 후 반영 전제).
- 로그인·계정은 없습니다. 익명 참여 + 닉네임 방식이라 기기별 localStorage에 기록이 남습니다.
- 한줄평·제보의 악성 도배는 Supabase 요금제 수준의 rate limit 외 별도 방어가 없습니다.
- 기본 지도 타일은 OpenStreetMap 공개 타일입니다(소규모 동네 서비스 기준). 방문자가 크게 늘면 OSM 타일 정책상 부적합하므로 `js/config.js`의 `TILE_URL`을 VWorld·카카오·MapTiler 등으로 바꾸거나 카카오맵 모드를 쓰는 것이 좋습니다. (CARTO는 현재 무키 사용 시 워터마크가 찍혀 기본값에서 제외했습니다.)

## 10. 라이선스

- 코드: 이 프로젝트(승학님 소유)
- `vendor/leaflet` — Leaflet 1.9.4, BSD-2-Clause (`vendor/leaflet/LICENSE`)
- `vendor/markercluster` — Leaflet.markercluster 1.5.3, MIT (`vendor/markercluster/LICENSE`)
- 지도 타일: © OpenStreetMap 기여자 (ODbL), 타일 서버 약관 준수
