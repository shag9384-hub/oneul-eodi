-- =========================================================
-- 오늘어디 (인천 푸드트럭·노점 실시간 지도) — Supabase 스키마
-- Supabase 대시보드 → SQL Editor 에 통째로 붙여넣고 실행하세요.
-- 실행 후 프로젝트 설정 → API 의 URL / anon public key 를
-- 오늘어디 '내 설정 → 데이터 연결'에 넣으면 실시간 공유로 전환됩니다.
-- =========================================================

create extension if not exists pgcrypto;

-- ── 1. 장소 ──────────────────────────────────────────────
create table if not exists public.places (
  id              text primary key,
  name            text not null check (char_length(name) between 1 and 60),
  category        text not null default '기타',
  type            text not null default '노점' check (type in ('푸드트럭', '노점', '매장')),
  gu              text default '',
  dong            text default '',
  address_desc    text default '',
  lat             double precision check (lat is null or (lat between 33 and 39)),
  lng             double precision check (lng is null or (lng between 124 and 132)),
  days            text[] not null default '{}',
  hours           text default '',
  menu_note       text default '',
  source_url      text default '',
  source_title    text default '',
  coord_verified  boolean not null default false,
  status          text not null default 'active' check (status in ('active', 'hidden', 'closed')),
  created_at      timestamptz not null default now()
);

create index if not exists places_gu_dong_idx on public.places (gu, dong);
create index if not exists places_category_idx on public.places (category);

-- ── 2. 제보 (있어요 / 없어요 / 위치 수정 / 링크 신고) ──────
create table if not exists public.reports (
  id          uuid primary key default gen_random_uuid(),
  place_id    text not null references public.places(id) on delete cascade,
  kind        text not null check (kind in ('here', 'gone', 'location', 'broken_link')),
  note        text not null default '' check (char_length(note) <= 300),
  reporter    text not null default '익명' check (char_length(reporter) <= 20),
  created_at  timestamptz not null default now()
);

create index if not exists reports_place_time_idx on public.reports (place_id, created_at desc);
create index if not exists reports_kind_time_idx on public.reports (kind, created_at desc);

-- ── 3. 한줄평 ─────────────────────────────────────────────
create table if not exists public.comments (
  id          uuid primary key default gen_random_uuid(),
  place_id    text not null references public.places(id) on delete cascade,
  body        text not null check (char_length(body) between 1 and 200),
  author      text not null default '익명' check (char_length(author) <= 20),
  created_at  timestamptz not null default now()
);

create index if not exists comments_place_time_idx on public.comments (place_id, created_at desc);

-- ── 4. 건의하기 ───────────────────────────────────────────
create table if not exists public.suggestions (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null default '기타',
  message     text not null check (char_length(message) between 1 and 500),
  contact     text not null default '' check (char_length(contact) <= 80),
  place_name  text not null default '',
  created_at  timestamptz not null default now()
);

-- ── 5. RLS: 익명 읽기 + 제보/투표/댓글 쓰기 허용 ───────────
alter table public.places      enable row level security;
alter table public.reports     enable row level security;
alter table public.comments    enable row level security;
alter table public.suggestions enable row level security;

-- 장소: 누구나 읽기, 누구나 추가(제보). 수정·삭제는 운영자(service_role)만.
drop policy if exists places_read_all on public.places;
create policy places_read_all on public.places
  for select using (true);

drop policy if exists places_insert_all on public.places;
create policy places_insert_all on public.places
  for insert with check (
    char_length(name) between 1 and 60
    and char_length(coalesce(address_desc, '')) <= 120
  );

-- 제보: 누구나 읽기(상태 계산에 필요), 누구나 쓰기.
drop policy if exists reports_read_all on public.reports;
create policy reports_read_all on public.reports
  for select using (true);

drop policy if exists reports_insert_all on public.reports;
create policy reports_insert_all on public.reports
  for insert with check (
    kind in ('here', 'gone', 'location', 'broken_link')
    and char_length(note) <= 300
    and char_length(reporter) <= 20
  );

-- 한줄평: 누구나 읽기, 누구나 쓰기 (200자 제한).
drop policy if exists comments_read_all on public.comments;
create policy comments_read_all on public.comments
  for select using (true);

drop policy if exists comments_insert_all on public.comments;
create policy comments_insert_all on public.comments
  for insert with check (
    char_length(body) between 1 and 200
    and char_length(author) <= 20
  );

-- 건의: 쓰기만 허용. 연락처가 들어올 수 있어 익명 읽기는 열지 않습니다.
drop policy if exists suggestions_insert_all on public.suggestions;
create policy suggestions_insert_all on public.suggestions
  for insert with check (
    char_length(message) between 1 and 500
    and char_length(contact) <= 80
  );

-- ── 6. 운영 편의: 오래된 제보 정리용 뷰 ───────────────────
create or replace view public.place_live_state as
select
  p.id,
  p.name,
  max(r.created_at) filter (where r.kind = 'here') as last_here_at,
  max(r.created_at) filter (where r.kind = 'gone') as last_gone_at,
  count(*) filter (where r.kind = 'here') as here_count,
  count(*) filter (where r.kind = 'gone') as gone_count
from public.places p
left join public.reports r on r.place_id = p.id
group by p.id, p.name;

-- ── 7. (선택) 초기 장소 넣기 예시 ─────────────────────────
-- insert into public.places (id, name, category, type, gu, dong, address_desc, lat, lng, days, hours, menu_note)
-- values ('incheon-001', '예시 붕어빵 트럭', '붕어빵·호떡', '푸드트럭', '연수구', '송도동',
--         '센트럴파크 1호관 맞은편', 37.3926, 126.6385, '{월,화,수,목,금}', '12:00~20:00', '팥 3개 2,000원')
-- on conflict (id) do nothing;
