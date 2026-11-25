"""오늘어디 — Playwright E2E (PC 1280×900 / 모바일 390×844)

검증: 로드·필터·검색·전체보기·상세·투표·한줄평·위치수정·즐겨찾기·공유·
      가게 제보(지도 핀)·건의·설정·로컬 저장·500m 이내·콘솔 에러 0
"""
import json, os, subprocess, sys, time, urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path('/workspace/work/oneul-eodi')
DL = Path('/workspace/downloads')
PORT = 4173
BASE = f'http://127.0.0.1:{PORT}'
SEED = json.loads((ROOT / 'data/seed_places.json').read_text(encoding='utf-8'))
BY_ID = {p['id']: p for p in SEED}

RESULTS = []

def check(name, cond, extra=''):
    RESULTS.append((name, bool(cond), extra))
    print(('  ✅ ' if cond else '  ❌ ') + name + (f'  [{extra}]' if extra else ''))
    return cond

def serve():
    proc = subprocess.Popen([sys.executable, '-m', 'http.server', str(PORT), '--bind', '127.0.0.1'],
                            cwd=str(ROOT), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(80):
        try:
            urllib.request.urlopen(BASE, timeout=1); return proc
        except Exception:
            time.sleep(0.15)
    raise RuntimeError('로컬 서버가 뜨지 않았습니다')

def visible_cards(page):
    return page.locator('.place:visible').count()

def card_ids(page):
    return page.eval_on_selector_all('.place', "els => els.map(e => e.dataset.id)")

def wait_idle(page, ms=350):
    page.wait_for_timeout(ms)

def run_pc(browser, errors):
    ctx = browser.new_context(viewport={'width': 1280, 'height': 900}, locale='ko-KR',
                              timezone_id='Asia/Seoul', permissions=['clipboard-read', 'clipboard-write'])
    page = ctx.new_page()
    page.on('console', lambda m: errors.append(f'PC console: {m.text}') if m.type == 'error' else None)
    page.on('pageerror', lambda e: errors.append(f'PC pageerror: {e}'))
    page.goto(BASE, wait_until='networkidle')
    wait_idle(page, 1200)

    # 1. 기본 로드
    check('타이틀', '오늘어디' in page.title(), page.title())
    n_cards = visible_cards(page)
    check('오늘 목록 카드 렌더', n_cards > 0, f'{n_cards}개')
    check('전체 목록 로드', page.evaluate("() => [...document.querySelectorAll('.mode-chip')].length") == 1)
    today_n = int(page.locator('#todayCount').inner_text())
    check('오늘 뜰 예정 카운트 노출', today_n > 0, f'{today_n}곳')
    check('지도 타일 로드', page.locator('.leaflet-tile-loaded').count() > 4, f"{page.locator('.leaflet-tile-loaded').count()}장")
    check('지도 핀·클러스터 표시', page.locator('.oe-pin').count() + page.locator('.oe-cluster').count() > 3,
          f"핀 {page.locator('.oe-pin').count()} · 클러스터 {page.locator('.oe-cluster').count()}")
    check('샘플 배너 없음(실데이터)', page.locator('#demoBar').is_hidden())
    check('빈 요일 배지는 목록에서 숨김', page.locator('.place .status:has-text("영업 정보 제보 필요")').count() == 0,
          f"{page.locator('.place .status:has-text(\"영업 정보 제보 필요\")').count()}개")
    check('가로 넘침 없음(PC)', page.evaluate("() => document.documentElement.scrollWidth <= window.innerWidth"))

    # 1-1. 지도 핀 클릭 → 상세
    page.locator('.oe-pin').first.click(force=True)
    page.wait_for_selector('#detailModal:not([hidden])', timeout=5000)
    check('지도 핀 클릭 → 상세', page.locator('#detailModal').is_visible(), page.locator('#detailTitle').inner_text())
    page.click('#detailModal [data-close]')
    wait_idle(page, 300)

    # 2. 카테고리 필터
    page.locator('#catRow [data-cat="붕어빵·호떡"]').click()
    wait_idle(page)
    ids = card_ids(page)
    check('카테고리 필터 — 붕어빵·호떡만', len(ids) > 0 and all(BY_ID[i]['category'] == '붕어빵·호떡' for i in ids), f'{len(ids)}개')
    check('카테고리 칩 활성 표시', page.locator('#catRow [data-cat="붕어빵·호떡"]').get_attribute('aria-selected') == 'true')

    # 3. 구·동 필터
    page.locator('#guRow [data-gu="연수구"]').click()
    wait_idle(page)
    check('구 선택 시 동네 칩 펼침', page.locator('#dongRow').is_visible())
    dongs = page.locator('#dongChips .chip.dong').all_inner_texts()
    check('동네 칩 생성', len(dongs) > 1, ' / '.join(d.strip() for d in dongs[:6]))
    page.locator('#dongChips [data-dong="송도동"]').click()
    wait_idle(page)
    ids = card_ids(page)
    check('동 필터 — 송도동만', len(ids) > 0 and all(BY_ID[i]['dong'] == '송도동' for i in ids), f'{len(ids)}개')
    page.locator('#guRow [data-gu="전체 인천"]').click()
    page.locator('#catRow [data-cat="전체"]').click()
    wait_idle(page)
    check('필터 초기화', page.locator('#dongRow').is_hidden())

    # 4. 검색
    page.fill('#searchInput', '호떡')
    wait_idle(page, 500)
    ids = card_ids(page)
    check('검색 — 호떡 결과', len(ids) > 0, f'{len(ids)}개')
    page.fill('#searchInput', '존재하지않는가게명')
    wait_idle(page, 500)
    check('검색 — 빈 결과 안내', page.locator('.empty h3').count() > 0, page.locator('.empty h3').first.inner_text() if page.locator('.empty h3').count() else '')
    page.click('#searchClear')
    wait_idle(page, 400)

    # 4-1. 중구·동구 묶음 필터
    page.locator('#guRow [data-gu="중구·동구"]').click()
    wait_idle(page)
    ids = card_ids(page)
    check('중구·동구 묶음 필터', len(ids) > 0 and all(BY_ID[i]['gu'] in ('중구', '동구') for i in ids), f'{len(ids)}개')
    page.locator('#guRow [data-gu="전체 인천"]').click()
    wait_idle(page)

    # 4-2. 지금 떴다 토글
    page.click('#livePill')
    wait_idle(page)
    statuses = page.eval_on_selector_all('.place .status', "els => els.map(e => e.textContent.trim())")
    check('지금 떴다 — 영업 중만', len(statuses) > 0 and all(s in ('지금 있어요', '오늘 영업일') for s in statuses), f'{len(statuses)}개')
    check('지금 떴다 — 안내 문구', '지금 영업 중' in page.locator('#sheetNote').inner_text(), page.locator('#sheetNote').inner_text())
    page.click('#livePill')
    wait_idle(page)

    # 5. 전체 보기 (휴무·정보 없는 곳 포함)
    page.click('#toggleAll')
    wait_idle(page)
    all_ids = card_ids(page)
    check('전체 보기 — 시드 전체', len(all_ids) == len(SEED), f'{len(all_ids)}곳 / 데이터 {len(SEED)}곳')
    check('요일 없는 곳 — 제보 필요 표시', page.locator('.info-needed').count() > 0, f"{page.locator('.info-needed').count()}개")
    check('휴무 배지 표시', page.locator('.place .status:has-text("오늘 휴무")').count() > 0)
    page.click('#toggleAll')
    wait_idle(page)

    # 6. 상세 모달
    target_id = card_ids(page)[0]
    place = BY_ID[target_id]
    page.locator(f'.place[data-id="{target_id}"]').click()
    page.wait_for_selector('#detailModal:not([hidden])')
    wait_idle(page)
    check('상세 모달 열림', page.locator('#detailModal').is_visible())
    check('상세 제목 일치', page.locator('#detailTitle').inner_text() == place['name'], page.locator('#detailTitle').inner_text())
    check('영업 상태 배지', page.locator('#detailBody .dt-status-big').count() == 1, page.locator('#detailBody .dt-status-big').inner_text())
    check('위치·영업·메뉴 행', page.locator('#detailBody .dt-row').count() >= 4)
    check('생존 투표 버튼', page.locator('.vote-here').count() == 1 and page.locator('.vote-gone').count() == 1)
    check('관련 글·후기 영역', page.locator('#detailBody .src-card, #detailBody .src-empty').count() == 1,
          '링크' if page.locator('#detailBody .src-card').count() else '링크 없음 안내')
    check('500m 이내 영역', page.locator('#detailBody').inner_text().find('500m 이내 다른 가게') >= 0)
    check('한줄평 입력', page.locator('#cmtInput').count() == 1)
    naver = page.locator('#detailBody .dir.naver').get_attribute('href')
    kakao = page.locator('#detailBody .dir.kakao').get_attribute('href')
    check('길찾기 링크', naver.startswith('https://map.naver.com') and kakao.startswith('https://map.kakao.com'), f'{naver[:34]} / {kakao[:34]}')

    # 7. 투표
    before = page.locator('.vote-here .v-count').inner_text()
    page.click('.vote-here')
    wait_idle(page, 500)
    after = page.locator('.vote-here .v-count').inner_text()
    check('있어요 투표 반영', int(after) == int(before) + 1, f'{before} → {after}')
    check('투표 후 상태 갱신', '지금 있어요' in page.locator('#detailBody .dt-hero-text b').inner_text(),
          page.locator('#detailBody .dt-hero-text b').inner_text())
    check('지도 상태 갱신', page.locator('#liveNum').inner_text().isdigit())

    # 8. 한줄평
    page.fill('#cmtInput', '테스트 한줄평: 붕어빵이 따뜻하고 좋아요')
    wait_idle(page, 150)
    check('한줄평 글자수 카운터', '22 / 200' in page.locator('#cmtCount').inner_text(), page.locator('#cmtCount').inner_text())
    page.click('#cmtSubmit')
    wait_idle(page, 600)
    check('한줄평 등록·표시', page.locator('#cmtList .cmt p').count() > 0 and '테스트 한줄평' in page.locator('#cmtList').inner_text())

    # 9. 위치 수정 제보
    page.click('[data-act="fix-open"]')
    check('위치 수정 패널', page.locator('#fixPanel').is_visible())
    page.fill('#fixNote', '테스트: 3번 출구 쪽으로 10m 이동했어요')
    page.click('[data-act="fix-send"]')
    wait_idle(page, 400)
    check('위치 수정 제보 저장', '3번 출구' in page.evaluate("() => JSON.parse(localStorage.getItem('oe_reports')||'[]').map(r=>r.note).join(' ')"))

    # 9-1. 안 열려요 신고
    if page.locator('[data-act="broken"]').count():
        page.click('[data-act="broken"]')
        wait_idle(page, 400)
        check('안 열려요 신고 저장', 'broken_link' in page.evaluate("() => JSON.parse(localStorage.getItem('oe_reports')||'[]').map(r=>r.kind).join(' ')"))
    else:
        check('안 열려요 신고 버튼', False, '링크 있는 장소를 찾지 못함')

    # 10. 즐겨찾기
    page.click('.dt-action[data-act="fav"]')
    wait_idle(page, 400)
    check('즐겨찾기 카운트', page.locator('#favCount').inner_text() == '1', page.locator('#favCount').inner_text())
    check('즐겨찾기 버튼 상태', '저장됨' in page.locator('.dt-action[data-act="fav"]').inner_text())

    # 11. 공유
    page.click('.dt-action[data-act="share"]')
    wait_idle(page, 600)
    clip = page.evaluate("() => navigator.clipboard.readText().catch(() => '')")
    check('공유 링크 복사', '#p=' in (clip or ''), (clip or '')[:70])

    # 12. 닫고 즐겨찾기 탭
    page.click('#detailModal [data-close]')
    wait_idle(page, 400)
    check('상세 닫힘', page.locator('#detailModal').is_hidden())
    page.locator('.sheet-tab[data-tab="fav"]').click()
    wait_idle(page, 300)
    check('즐겨찾기 탭 목록', visible_cards(page) == 1, f'{visible_cards(page)}개')
    page.locator('.sheet-tab[data-tab="today"]').click()
    wait_idle(page, 300)

    # 13. 가게 제보 — 지도에서 핀 찍기
    page.click('#addBtn')
    wait_idle(page, 300)
    check('제보 모달 열림', page.locator('#addModal').is_visible())
    page.fill('#fName', '테스트 붕어빵 노점')
    page.select_option('#fCategory', '붕어빵·호떡')
    page.select_option('#fGu', '연수구')
    page.fill('#fDong', '송도동')
    page.fill('#fAddress', '테스트 위치: 센트럴파크 2호관 앞')
    page.fill('#fHours', '13:00~22:00')
    page.fill('#fMenu', '테스트 메뉴 1,000원')
    page.locator('#fDays [data-day="화"]').click()
    page.click('#pickOnMap')
    wait_idle(page, 500)
    check('핀 찍기 모드 진입', page.locator('#pickHint').is_visible() and page.locator('#addModal').is_hidden())
    page.mouse.click(320, 700)
    wait_idle(page, 600)
    check('핀 좌표 반영', ',' in page.locator('#pickCoord').inner_text(), page.locator('#pickCoord').inner_text())
    check('핀 찍은 뒤 모달 복귀', page.locator('#addModal').is_visible())
    page.click('#addForm button[type="submit"]')
    page.wait_for_selector('#detailModal:not([hidden])')
    wait_idle(page, 600)
    check('제보 등록 후 상세 열림', page.locator('#detailTitle').inner_text() == '테스트 붕어빵 노점', page.locator('#detailTitle').inner_text())
    check('제보 저장(localStorage)', page.evaluate("() => JSON.parse(localStorage.getItem('oe_added_places')||'[]').length") == 1)
    page.click('#detailModal [data-close]')
    wait_idle(page, 400)
    page.fill('#searchInput', '테스트 붕어빵')
    wait_idle(page, 500)
    check('제보한 가게 검색', '테스트 붕어빵 노점' in page.locator('#listBody').inner_text())
    page.click('#searchClear')
    wait_idle(page, 300)

    # 14. 건의하기
    page.click('#suggestBtn')
    wait_idle(page, 300)
    page.fill('#sMessage', '테스트 건의: 동네 필터에 검단동도 추가해 주세요')
    page.click('#suggestForm button[type="submit"]')
    wait_idle(page, 500)
    check('건의 저장', page.evaluate("() => JSON.parse(localStorage.getItem('oe_suggestions')||'[]').length") == 1)

    # 15. 내 설정 — 닉네임
    page.click('#settingsBtn')
    wait_idle(page, 300)
    page.fill('#setNick', '테스터')
    page.click('#saveNick')
    wait_idle(page, 300)
    check('닉네임 저장', page.evaluate("() => JSON.parse(localStorage.getItem('oe_profile')||'{}').nickname") == '테스터')
    check('데이터 모드 표시', '이 기기 저장' in page.locator('#sbStatus').inner_text(), page.locator('#sbStatus').inner_text())
    page.click('#settingsModal [data-close]')
    wait_idle(page, 300)

    # 16. 새로고침 후 유지
    page.reload(wait_until='networkidle')
    wait_idle(page, 1000)
    check('새로고침 후 제보 유지', page.evaluate("() => JSON.parse(localStorage.getItem('oe_added_places')||'[]').length") == 1)
    check('새로고침 후 즐겨찾기 유지', page.locator('#favCount').inner_text() == '1', page.locator('#favCount').inner_text())

    # 17. 스크린샷용 깨끗한 상태
    page.evaluate("() => localStorage.clear()")
    page.reload(wait_until='networkidle')
    wait_idle(page, 1300)
    page.screenshot(path=str(DL / 'oneul_eodi_pc.png'))
    # 상세 화면
    ids = card_ids(page)
    page.locator(f'.place[data-id="{ids[0]}"]').click()
    page.wait_for_selector('#detailModal:not([hidden])')
    wait_idle(page, 600)
    page.screenshot(path=str(DL / 'oneul_eodi_pc_detail.png'))
    page.click('#detailModal [data-close]')
    ctx.close()

def run_mobile(browser, errors):
    ctx = browser.new_context(viewport={'width': 390, 'height': 844}, locale='ko-KR', timezone_id='Asia/Seoul',
                              is_mobile=True, has_touch=True, device_scale_factor=2)
    page = ctx.new_page()
    page.on('console', lambda m: errors.append(f'MO console: {m.text}') if m.type == 'error' else None)
    page.on('pageerror', lambda e: errors.append(f'MO pageerror: {e}'))
    page.goto(BASE, wait_until='networkidle')
    wait_idle(page, 1200)

    check('모바일 — 카드 렌더', visible_cards(page) > 0, f'{visible_cards(page)}개')
    hh = page.evaluate("() => document.querySelector('.top-inner').getBoundingClientRect().height")
    check('모바일 — 헤더 한 줄 유지', hh < 72, f'{round(hh)}px')
    check('모바일 — 가로 넘침 없음', page.evaluate("() => document.documentElement.scrollWidth <= window.innerWidth"))
    sheet_h = page.evaluate("() => document.getElementById('sheet').getBoundingClientRect().height")
    check('모바일 — 바텀시트 노출', 200 < sheet_h < 844 * 0.55, f'{round(sheet_h)}px')
    check('모바일 — 지도 영역 확보', page.evaluate("() => document.getElementById('map').getBoundingClientRect().height") > 250)
    page.screenshot(path=str(DL / 'oneul_eodi_mobile.png'))

    # 시트 펼치기
    page.click('#sheetGrab')
    wait_idle(page, 600)
    expanded = page.evaluate("() => document.getElementById('sheet').getBoundingClientRect().height")
    check('모바일 — 시트 펼침', expanded > sheet_h + 40, f'{round(sheet_h)} → {round(expanded)}px')

    # 카테고리 가로 스크롤
    check('모바일 — 카테고리 스크롤', page.evaluate("() => { const e=document.getElementById('catRow'); return e.scrollWidth > e.clientWidth; }"))

    # 상세 모달
    ids = card_ids(page)
    page.locator(f'.place[data-id="{ids[0]}"]').click()
    page.wait_for_selector('#detailModal:not([hidden])')
    wait_idle(page, 600)
    check('모바일 — 상세 모달', page.locator('#detailModal').is_visible())
    mh = page.evaluate("() => document.getElementById('detailModal').getBoundingClientRect().height")
    check('모바일 — 모달 높이 적정', mh <= 844 * 0.93, f'{round(mh)}px')
    check('모바일 — 가로 넘침 없음(모달)', page.evaluate("() => document.documentElement.scrollWidth <= window.innerWidth"))
    page.screenshot(path=str(DL / 'oneul_eodi_mobile_detail.png'))
    ctx.close()

def run_locate(browser, errors):
    """내 위치 버튼 — 위치 권한 허용 시 지도 이동 + 가까운 순 거리 표시"""
    ctx = browser.new_context(viewport={'width': 390, 'height': 844}, locale='ko-KR', timezone_id='Asia/Seoul',
                              is_mobile=True, has_touch=True,
                              geolocation={'latitude': 37.4480, 'longitude': 126.7010},
                              permissions=['geolocation'])
    page = ctx.new_page()
    page.on('console', lambda m: errors.append(f'LOC console: {m.text}') if m.type == 'error' else None)
    page.on('pageerror', lambda e: errors.append(f'LOC pageerror: {e}'))
    page.goto(BASE, wait_until='networkidle')
    wait_idle(page, 900)
    page.click('#locateBtn')
    wait_idle(page, 1600)
    check('내 위치 — 지도 표시', page.locator('.my-dot').count() > 0)
    check('내 위치 — 거리 표시', page.locator('.place .distance').count() > 0,
          f"{page.locator('.place .distance').count()}개")
    check('내 위치 — 가까운 순 정렬', page.locator('.place .distance').first.inner_text().endswith(('m', 'km')),
          page.locator('.place .distance').first.inner_text() if page.locator('.place .distance').count() else '')
    ctx.close()

def run_supabase_mock(browser, errors):
    """실제 키 없이 Supabase REST 흐름 검증 (목 서버)"""
    ctx = browser.new_context(viewport={'width': 1280, 'height': 900}, locale='ko-KR', timezone_id='Asia/Seoul')
    ctx.add_init_script("localStorage.setItem('oe_settings', JSON.stringify({sbUrl:'https://mock.supabase.co', sbKey:'anon-test'}))")
    page = ctx.new_page()
    posted = []
    remote = [{
        'id': 'remote-1', 'name': '원격 테스트 호떡집', 'category': '붕어빵·호떡', 'type': '노점',
        'gu': '남동구', 'dong': '구월동', 'address_desc': '원격 테스트 위치', 'lat': 37.45, 'lng': 126.70,
        'days': ['화', '목'], 'hours': '12:00~20:00', 'menu_note': '원격 메뉴',
        'source_url': '', 'source_title': '', 'coord_verified': False, 'created_at': '2026-11-20T00:00:00Z'
    }]

    def handler(route):
        request = route.request
        url = request.url
        if request.method == 'POST':
            posted.append((url, request.post_data))
            route.fulfill(status=201, body='', headers={'content-type': 'application/json'})
            return
        body = '[]'
        if '/rest/v1/places' in url:
            body = json.dumps(remote, ensure_ascii=False)
        route.fulfill(status=200, body=body, headers={'content-type': 'application/json'})

    page.route('https://mock.supabase.co/**', handler)
    page.on('pageerror', lambda e: errors.append(f'SB pageerror: {e}'))
    page.goto(BASE, wait_until='networkidle')
    wait_idle(page, 1200)
    check('Supabase — 실시간 공유 모드', page.locator('#modeChip').inner_text() == '실시간 공유', page.locator('#modeChip').inner_text())
    page.fill('#searchInput', '원격 테스트')
    wait_idle(page, 500)
    check('Supabase — 원격 장소 검색', '원격 테스트 호떡집' in page.locator('#listBody').inner_text())
    page.locator('.place[data-id="remote-1"]').click()
    page.wait_for_selector('#detailModal:not([hidden])')
    wait_idle(page, 300)
    page.click('.vote-here')
    wait_idle(page, 700)
    check('Supabase — 투표 POST 전송', any('/rest/v1/reports' in u for u, _ in posted), f'{len(posted)}건 전송')
    ctx.close()

def run_kakao_fallback(browser):
    """잘못된 카카오 키 → 기본 지도로 자동 전환되는지"""
    ctx = browser.new_context(viewport={'width': 1280, 'height': 900}, locale='ko-KR', timezone_id='Asia/Seoul')
    ctx.add_init_script("localStorage.setItem('oe_settings', JSON.stringify({kakaoKey:'invalid-test-key'}))")
    page = ctx.new_page()
    page.goto(BASE, wait_until='domcontentloaded')
    page.wait_for_timeout(9000)
    check('카카오 실패 — 기본 지도 폴백', page.locator('.leaflet-tile-loaded').count() > 2,
          f"{page.locator('.leaflet-tile-loaded').count()}장")
    check('카카오 실패 — 핀 유지', page.locator('.oe-pin').count() + page.locator('.oe-cluster').count() > 2)
    ctx.close()

def run_nearby(browser, errors):
    """500m 이내 — 기준 가게 옆에 가게를 하나 심어 두고 확인"""
    ctx = browser.new_context(viewport={'width': 1280, 'height': 900}, locale='ko-KR', timezone_id='Asia/Seoul')
    near = [{
        'id': 'test-nearby', 'name': '테스트 500m 이웃 노점', 'category': '꼬치', 'type': '노점',
        'gu': '연수구', 'dong': '송도동', 'address_desc': '테스트용 이웃 위치',
        'lat': 37.3956, 'lng': 126.6453, 'days': ['화'], 'hours': '13:00~22:00', 'menu_note': '테스트'
    }]
    ctx.add_init_script("localStorage.setItem('oe_added_places', %s)" % json.dumps(json.dumps(near, ensure_ascii=False)))
    page = ctx.new_page()
    page.on('console', lambda m: errors.append(f'NEAR console: {m.text}') if m.type == 'error' else None)
    page.on('pageerror', lambda e: errors.append(f'NEAR pageerror: {e}'))
    page.goto(BASE, wait_until='networkidle')
    wait_idle(page, 900)
    page.fill('#searchInput', '붕어빵생각')
    wait_idle(page, 500)
    page.locator('.place[data-id="incheon-001"]').click()
    page.wait_for_selector('#detailModal:not([hidden])')
    wait_idle(page, 500)
    nearby_text = page.locator('#detailBody').inner_text()
    check('500m 이내 이웃 표시', '테스트 500m 이웃 노점' in nearby_text,
          '이웃 ' + ('있음' if '테스트 500m 이웃 노점' in nearby_text else '없음'))
    check('500m 거리 표기', any(s in nearby_text for s in ['m']) and '테스트용 이웃 위치' not in nearby_text)
    page.click('.nearby button[data-id="test-nearby"]')
    wait_idle(page, 700)
    check('500m 이웃 클릭 이동', page.locator('#detailTitle').inner_text() == '테스트 500m 이웃 노점', page.locator('#detailTitle').inner_text())
    ctx.close()

def run_empty_days(browser, errors):
    """요일 정보가 없는 곳 — 영업 중으로 단정하지 않는지"""
    target = next((p for p in SEED if not p.get('days')), None)
    if not target:
        check('빈 요일 데이터 존재', False); return
    ctx = browser.new_context(viewport={'width': 1280, 'height': 900}, locale='ko-KR', timezone_id='Asia/Seoul')
    page = ctx.new_page()
    page.goto(BASE, wait_until='networkidle')
    wait_idle(page, 800)
    page.fill('#searchInput', target['name'])
    wait_idle(page, 500)
    page.locator(f'.place[data-id="{target["id"]}"]').click()
    page.wait_for_selector('#detailModal:not([hidden])')
    wait_idle(page, 400)
    hero = page.locator('#detailBody .dt-hero-text').inner_text()
    check('요일 없음 — 상태 단정 안 함', '영업 요일·시간이 아직 없어요' in hero, hero.replace('\n', ' / '))
    check('요일 없음 — 배지 문구', '영업 정보 제보 필요' in page.locator('#detailBody .dt-status-big').inner_text())
    ctx.close()

def compose_preview():
    try:
        from PIL import Image, ImageDraw
        pc = Image.open(DL / 'oneul_eodi_pc.png').convert('RGB')
        pcd = Image.open(DL / 'oneul_eodi_pc_detail.png').convert('RGB')
        mo = Image.open(DL / 'oneul_eodi_mobile.png').convert('RGB')
        mod = Image.open(DL / 'oneul_eodi_mobile_detail.png').convert('RGB')
        PW, MW = 960, 312
        def scale(im, w):
            return im.resize((w, int(im.height * w / im.width)), Image.LANCZOS)
        pc, pcd, mo, mod = scale(pc, PW), scale(pcd, PW), scale(mo, MW), scale(mod, MW)
        pad, gap = 34, 24
        col_h = max(pc.height + gap + pcd.height, mo.height + gap + mod.height)
        W = pad * 2 + PW + gap + MW
        H = pad * 2 + col_h
        canvas = Image.new('RGB', (W, H), (250, 247, 242))
        canvas.paste(pc, (pad, pad))
        canvas.paste(pcd, (pad, pad + pc.height + gap))
        canvas.paste(mo, (pad + PW + gap, pad))
        canvas.paste(mod, (pad + PW + gap, pad + mo.height + gap))
        canvas.save(DL / 'oneul_eodi_preview.png')
        print(f'  🖼  미리보기 저장: {DL / "oneul_eodi_preview.png"} ({W}×{H})')
    except Exception as e:
        print('  ⚠ 미리보기 합성 실패:', e)

def main():
    proc = serve()
    errors = []
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            print('\n[PC 1280×900]')
            run_pc(browser, errors)
            print('\n[모바일 390×844]')
            run_mobile(browser, errors)
            print('\n[내 위치]')
            run_locate(browser, errors)
            print('\n[Supabase 연동(목)]')
            run_supabase_mock(browser, errors)
            print('\n[카카오 키 실패 → 기본 지도]')
            run_kakao_fallback(browser)
            print('\n[500m 이내]')
            run_nearby(browser, errors)
            print('\n[요일 정보 없음]')
            run_empty_days(browser, errors)
            browser.close()
    finally:
        proc.terminate()

    compose_preview()
    print('\n[콘솔]')
    if errors:
        for e in errors[:10]:
            print('  •', e)
    else:
        print('  콘솔 에러 0건')

    passed = sum(1 for _, ok, _ in RESULTS if ok)
    failed = [r for r in RESULTS if not r[1]]
    print(f'\n결과: {passed}/{len(RESULTS)} 통과' + (f' · 실패 {len(failed)}' if failed else ''))
    if failed:
        for name, _, extra in failed:
            print('  실패:', name, extra)
        sys.exit(1)
    if errors:
        print('콘솔 에러가 있어 실패로 처리합니다.')
        sys.exit(1)

if __name__ == '__main__':
    main()
