# 트립비토즈 이메일 에디터

트립비토즈 마케팅팀을 위한 이메일 템플릿 제작 · 수신자 관리 · 발송 스케줄링 내부 도구입니다.

---

## 주요 기능

### 템플릿 에디터
- 드래그 앤 드롭으로 블록 순서 조정
- 로고 · 타이틀 · 텍스트 · 강조박스 · 호텔그리드 · 예약내역표 · CTA버튼 · 구분선 · 안내사항 · 이미지맵 · 앱배너 · 푸터 블록 지원
- 실시간 600px 이메일 미리보기
- HTML 복사 기능
- Supabase에 자동 저장

### 현황판
- 발송 대기 / 발송 완료 섹션 구분
- 최근 2주 발송 내역 조회
- 예약 취소 및 발송 완료 수동 처리

### 발송 예약
- 템플릿별 발송 주기 설정: 1회성 · 매일 · 매주 · 격주 · 매월
- 수신 세그먼트 선택
- 발송 일시 및 시각 설정

### 세그먼트 관리
- CSV 파일 업로드로 수신자 목록 생성
- 이메일 컬럼 자동 인식
- 세그먼트별 수신자 수 관리

### SQL 에디터
- QueryPie 프록시를 통해 실제 DB 데이터 조회
- 빠른 세그먼트 프리셋 (회원 광고수신 동의 · 비회원 · 전체 합산)
- 호텔 검색 패널: 지역 · 연도 · 월 · 기준(예약건수/매출) 필터
- 조회 결과를 이메일 호텔 블록에 직접 삽입
- SQL 결과를 세그먼트로 저장

---

## 기술 스택

| 영역 | 사용 기술 |
|------|-----------|
| 프론트엔드 | Vanilla JS · HTML · CSS |
| 백엔드 | Node.js · Express |
| DB 연결 | QueryPie Agent 프록시 → MySQL (mysql2) |
| 저장소 | Supabase (템플릿 · 세그먼트 · 스케줄) |
| 드래그앤드롭 | SortableJS |
| 개발 서버 | live-server · concurrently |

---

## 로컬 실행

### 사전 준비
- Node.js 설치
- QueryPie 데스크톱 앱 실행 (DB 프록시)

### 설치 및 실행

```bash
npm install
npm run dev
```

브라우저에서 `http://localhost:3000` 접속

> `server.js`는 포트 3001에서 QueryPie 프록시(127.0.0.1:40008)와 통신합니다.

---

## Supabase 테이블 구조

```sql
-- 이메일 템플릿
create table templates (
  id uuid primary key default gen_random_uuid(),
  name text,
  blocks jsonb,
  html text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 수신자 세그먼트
create table segments (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  count int not null default 0,
  emails jsonb,
  created_at timestamptz default now()
);

-- 발송 스케줄
create table email_schedules (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null,
  template_name text not null,
  segment_id uuid,
  segment_name text,
  schedule_type text not null check (schedule_type in ('once','daily','weekly','biweekly','monthly')),
  scheduled_at timestamptz,
  send_time text,
  weekday int,
  day_of_month int,
  status text not null default 'pending' check (status in ('pending','sent','cancelled')),
  sent_at timestamptz,
  created_at timestamptz default now()
);
```

---

## 프로젝트 구조

```
email-automation/
├── index.html      # 메인 UI (탭 구조: 템플릿 · 현황판 · 세그먼트 · SQL)
├── app.js          # 클라이언트 로직 전체
├── style.css       # 스타일 (lo-fi 다크 테마)
├── server.js       # Express API 서버 (QueryPie 연동)
└── package.json
```
