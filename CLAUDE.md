# 트립비토즈 이메일 자동화 툴 — CLAUDE.md

> 이 파일은 Claude가 대화 컨텍스트를 잃더라도 프로젝트를 즉시 이해할 수 있도록 작성된 문서입니다.

---

## 프로젝트 개요

트립비토즈(호텔 예약 서비스) 마케팅팀을 위한 **이메일 발송 자동화 웹 툴**.  
마케터가 코드 없이 이메일 템플릿 제작 → 세그먼트 선택 → AWS SES로 발송까지 할 수 있는 내부 도구.

- **프론트엔드**: `index.html` + `app.js` + `style.css` (Vanilla JS, SPA)
- **백엔드**: `server.js` (Express, Node.js) — Railway에 배포 중
- **프론트 배포**: Vercel (git push 시 자동 배포)
- **백엔드 배포**: Railway (`https://email-automation-production-7cba.up.railway.app`)
- **로컬 개발**: `npm run dev` → 프론트 localhost:3000, 서버 localhost:3001

---

## 파일 구조

```
email-automation/
├── index.html          # 앱 진입점 (HTML 구조, 모달 등)
├── app.js              # 프론트엔드 전체 로직 (2965줄)
├── style.css           # 스타일 전체
├── server.js           # Express API 서버 (1366줄)
├── unsubscribe.html    # 수신거부 처리 페이지 (독립 페이지)
├── .env                # 환경변수 (Railway에는 별도 등록 필요)
├── package.json        # 의존성
└── CLAUDE.md           # 이 파일
```

---

## 외부 서비스 연결

| 서비스 | 용도 | 비고 |
|--------|------|------|
| **AWS SES** | 이메일 발송 | `ap-northeast-2` 리전 |
| **Supabase** | 앱 데이터 저장 (템플릿, 세그먼트, 스케줄, 이벤트 등) | PostgreSQL 기반 |
| **ClickHouse Cloud** | 트립비토즈 내부 DB 조회 (호텔, 회원, 예약 데이터) | `nxof1ut3dh.ap-northeast-2.aws.clickhouse.cloud:8443` |
| **LLM Gateway** | AI 텍스트 생성 (Claude Sonnet) | `llm-gateway.tbz.kr` — **사내 내부망 전용, VPN 필요** |
| **트립비토즈 API** | 호텔 실시간 최저가 조회 | `dev-api.tripbtoz.com` |

---

## .env 환경변수 전체 목록

```env
# AWS SES
AWS_REGION=ap-northeast-2
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
SES_FROM_EMAIL=no-reply@tripbtoz.com
SES_FROM_NAME=트립비토즈
REPORT_EMAIL=sanghyukl@tripbtoz.com

# Supabase
SUPABASE_URL=https://vihwzugbrulsxbembkby.supabase.co
SUPABASE_KEY=...

# 수신거부 페이지
UNSUB_BASE_URL=http://localhost:3000/unsubscribe.html  # 배포 시 실제 URL로 변경

# 트립비토즈 API
TRIPBTOZ_API=https://dev-api.tripbtoz.com

# LLM Gateway (사내 내부망)
LLM_GATEWAY_API_KEY=...
LLM_GATEWAY_URL=https://llm-gateway.tbz.kr

# 트래킹 서버 (Railway)
SERVER_URL=https://email-automation-production-7cba.up.railway.app

# ClickHouse
CH_HOST=https://nxof1ut3dh.ap-northeast-2.aws.clickhouse.cloud:8443
CH_USER=sanghyukl
CH_PASSWORD=...
```

> **Railway 배포 시**: Variables 탭에 위 변수를 모두 등록해야 함. `.env` 파일은 배포되지 않음.

---

## Supabase 테이블 목록

| 테이블 | 용도 |
|--------|------|
| `templates` | 이메일 템플릿 (blocks JSON 저장) |
| `segments` | 수신자 세그먼트 (emails 배열 저장) |
| `email_schedules` | 발송 예약/이력 |
| `email_events` | 오픈/클릭 트래킹 이벤트 |
| `unsubscribers` | 수신거부 이메일 목록 |
| `season_destination_history` | 시즌 프로모션 발송한 여행지 이력 (중복 방지용) |
| `trigger_mappings` | 외부 트리거 이벤트 → 템플릿 매핑 |

---

## ClickHouse 테이블 명명 규칙

기존 MySQL은 `schema.table` 형식이었으나, ClickHouse는 `schema_table` 형식.

| MySQL (구) | ClickHouse (현재) |
|-----------|-----------------|
| `tripbtoz.hotels` | `tripbtoz_hotels` |
| `tripbtoz.users_0519` | `tripbtoz_users_0519` |
| `tripbtoz.bookings` | `tripbtoz_bookings` |
| `tripbtoz.checkouts` | `tripbtoz_checkouts` |
| `tripbtoz.bookings_octopus` | `tripbtoz_bookings_octopus` |
| `tripbtoz_payment.checkout_detail` | `tripbtoz_payment_checkout_detail` |
| `tripbtoz_meta.accommodation_common` | `tripbtoz_meta_accommodation_common` |

**SQL 함수 차이**: MySQL `MONTH()`, `YEAR()` → ClickHouse `toMonth()`, `toYear()`  
**UNION**: MySQL `UNION` → ClickHouse `UNION DISTINCT`

---

## 앱 주요 탭 및 기능

### 1. 템플릿 목록 (`list` 뷰)
- 저장된 템플릿 목록 표시
- AI 생성: 프롬프트 입력 → LLM이 블록 생성 → 에디터 오픈
- 시즌 프로모션 자동 생성 (아래 별도 설명)
- 트리거 메일 생성

### 2. 이메일 에디터 (`editor` 뷰)
- 블록 기반 드래그&드롭 에디터
- 우측 실시간 미리보기
- 블록 타입: `logo`, `title`, `subtitle`, `text`, `highlight`, `hotels`, `cta`, `divider`, `notice`, `banner`, `footer`, `reservation`
- 호텔 블록: 도시명 입력 → 스마트 조회 → 이미지+가격 카드 자동 생성
- 템플릿 변수 `{{변수명}}` 지원 (수신거부 URL, 발송일 등)
- 저장 시 Supabase `templates` 테이블에 JSON으로 저장

### 3. 대시보드 (`dashboard` 뷰)
- 발송 예약/이력 목록
- 캠페인 통계 조회: 오픈수/클릭수/수신거부 수
- CSV 다운로드

### 4. 세그먼트 (`segment` 뷰)
- 수신자 그룹 관리
- 프리셋: `member` (마케팅 동의 회원), `guest` (게스트 예약자), `all`
- 커스텀 SQL로 세그먼트 생성 가능

### 5. SQL 에디터 (`sql` 뷰)
- ClickHouse 직접 쿼리 (서버 `/api/query` 통해 실행)
- 캐시 기능 (24시간)

### 6. 트리거 (`trigger` 뷰)
- 외부 시스템 이벤트 → 자동 이메일 발송
- `POST /api/trigger` 엔드포인트로 이벤트 수신

---

## 시즌 프로모션 자동 생성 — 상세 플로우

가장 복잡한 기능. 버튼 클릭 1번으로 완성된 이메일 생성.

```
1. Supabase 조회: 이번 달 이미 발송한 여행지 목록 조회 (season_destination_history)

2. LLM Gateway 호출 (llm-gateway.tbz.kr) ← VPN 필요
   → 다음 달에 가기 좋은 여행지 국내2 + 해외2 선정
   → 여행지별 3~4줄 설명 텍스트 생성
   → 이미 발송한 여행지는 제외 (중복 방지)

3. ClickHouse 조회: 여행지별 예약건수 상위 호텔 조회
   - tripbtoz_hotels + tripbtoz_bookings JOIN
   - tripbtoz_meta_accommodation_common 에서 썸네일
   - 작년 같은 달 기준 예약건수 ORDER BY

4. 트립비토즈 API: 각 호텔 차주 최저가 조회 (병렬)
   - 가격 없으면 해당 호텔 제외

5. 블록 조립: logo + title + text + [subtitle+text+hotels] × 4 + footer(marketing)

6. Supabase 저장: 이번 발송 여행지 season_destination_history에 기록

7. 반환: 완성된 blocks JSON → 에디터에서 바로 편집 가능
```

---

## 이메일 발송 플로우

```
1. 템플릿 HTML 로드 (Supabase)
2. 세그먼트 이메일 목록 조회 (ClickHouse 또는 Supabase)
3. 수신거부 필터링 (Supabase unsubscribers 테이블)
4. 동적 변수 치환 ({{HOTEL_CARDS}}, {{SEND_DATE}}, {{UNSUB_URL}} 등)
5. 링크 트래킹 래핑 (href → /track/click?sid=...)
6. 오픈 트래킹 픽셀 삽입 (<img src="/track/open?...">)
7. AWS SES로 10개씩 배치 발송
8. Supabase email_schedules 상태 업데이트
9. 결과 리포트 메일 발송 (REPORT_EMAIL로)
```

---

## 수신거부 처리

- 이메일 내 수신거부 링크: `{{UNSUB_URL}}` 변수로 삽입
- `unsubscribe.html`: HMAC-SHA256 토큰 검증 후 Supabase `unsubscribers`에 저장
- 발송 시: `unsubscribers` 전체 조회 → 필터링 후 발송
- 캠페인별 수신거부 추적: URL에 `sid=scheduleId` 파라미터 포함

---

## 이메일 트래킹

- **오픈 트래킹**: 1×1 투명 GIF 픽셀 (`/track/open?sid=...&e=emailHash`)
- **클릭 트래킹**: 모든 링크를 `/track/click?sid=...&e=...&url=...`으로 래핑
- 이벤트는 Supabase `email_events` 테이블에 저장
- 트래킹 URL 기준: `SERVER_URL` 환경변수 (Railway URL 사용)

---

## 호텔 카드 이메일 렌더링

이메일 클라이언트 호환을 위해 CSS position:absolute 대신 `<td background-image>` 방식 사용.

```
카드 구조:
- 이미지: <td> background-image (이메일 안전)
  - 상단 100px: 할인 배지
  - 하단 90px: 그라디언트 + 호텔명(2줄 고정) + 국가/도시
- 가격 영역:
  - 할인 있으면: 정가(취소선) + 할인가 나란히
  - 할인 없으면: 가격만
- 국가/도시 표시: 🇰🇷 대한민국 · 서울 형식
```

---

## 알려진 이슈 / 미완료 사항

| 항목 | 상태 | 내용 |
|------|------|------|
| ClickHouse 인증 | **미확인** | 계정 정보 확인 필요. `sanghyukl` 계정 비밀번호가 맞지 않을 수 있음. 개발팀에 재확인 필요 |
| LLM Gateway | **사내망 전용** | `llm-gateway.tbz.kr` VPN 없으면 접근 불가. 시즌 프로모션/AI 생성 기능 외부에서 사용 불가 |
| Railway 비용 | **검토 중** | 무료 한도 초과 시 내부 서버로 이전 예정. 내부 서버 IP가 외부 접근 가능해야 Vercel 프론트와 통신 가능 |
| 수신거부 인원 | **완료** | 발송 시 자동 제외됨 (server.js 387-390줄) |
| 캠페인별 수신거부 통계 | **완료** | schedule_id 기준 집계, 통계 모달에 표시 |

---

## 자주 발생하는 문제

### 서버 포트 충돌 (EADDRINUSE 3001)
```bash
lsof -ti:3001 | xargs kill -9
```

### ClickHouse `host` deprecated 경고
server.js의 `createClickHouseClient` 설정에서 `host` → `url` 사용 (이미 수정됨)

### 시즌 프로모션 500 에러
→ LLM Gateway (`llm-gateway.tbz.kr`) 접근 불가. VPN 연결 또는 사내 네트워크 필요.

### 트래킹 링크가 localhost로 떨어지는 경우
→ `.env`의 `SERVER_URL`이 Railway URL로 설정되어 있는지 확인.  
→ 서버 시작 시 `[트래킹 URL] SERVER_URL = ...` 로그로 확인 가능.

---

## 배포 방법

### 프론트엔드 (Vercel)
```bash
git add . && git commit -m "..." && git push origin main
# Vercel 자동 배포
```

### 백엔드 (Railway)
- Railway는 git push 시 자동 배포 (main 브랜치)
- 환경변수는 Railway 대시보드 Variables 탭에서 관리
- 내부 서버로 이전 시: Node.js 설치 → `npm install` → `pm2 start server.js`

---

## API 엔드포인트 목록

| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET | `/health` | 서버 상태 확인 |
| GET | `/api/cities?q=검색어` | 도시 자동완성 (ClickHouse) |
| POST | `/api/query` | SQL 직접 실행 (ClickHouse) |
| GET | `/api/preset/:key` | 프리셋 세그먼트 조회 (캐시 24h) |
| GET | `/api/preset-count/:key` | 프리셋 수신자 수 |
| POST | `/api/send` | 이메일 발송 시작 |
| GET | `/api/send-job/:jobId` | 발송 진행 상황 조회 |
| POST | `/api/preview-content` | 다이나믹 콘텐츠 미리보기 |
| GET | `/api/hotel-price/:hotelId` | 호텔 실시간 최저가 |
| POST | `/api/hotels/smart-pick` | 도시별 호텔 스마트 조회 |
| POST | `/api/ai-generate` | AI 마케팅/트리거 메일 생성 |
| POST | `/api/ai/season-generate` | 시즌 프로모션 자동 생성 |
| GET | `/api/campaign-stats/:scheduleId` | 캠페인 통계 |
| GET | `/api/campaign-stats/:scheduleId/csv` | 통계 CSV 다운로드 |
| GET | `/track/open` | 오픈 트래킹 픽셀 |
| GET | `/track/click` | 클릭 트래킹 & 리다이렉트 |
| POST | `/api/trigger` | 외부 이벤트 트리거 |
| GET/POST/PUT/DELETE | `/api/trigger-mappings` | 트리거 매핑 CRUD |
