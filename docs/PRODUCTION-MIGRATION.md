# 운영 전환 계획 — Spring Boot + Docker/k8s

작성 2026-11-04. 합성 데이터 데모를 버리고 실제 학원 DB에 연결된 운영 서비스로
전환한다. 포트폴리오는 공개 링크 대신 운영 화면 녹화 영상으로 대체한다.

## 확정된 결정

| 항목 | 결정 |
|---|---|
| 공개 데모 | 버린다. 운영 전용. 포폴은 영상 녹화 |
| 백엔드 | Spring Boot (조교 점수 입력까지 전부 이전) |
| 인프라 | Docker + k8s |
| 프런트 | 현재 Vite+React 유지, 게이트웨이만 교체 |
| 배포 위치 | 기존 Vercel 프로젝트 하위 경로 |
| 더미 데이터 | 사용자가 나중에 직접 채움 |

## 기존 시스템 실측

운영 중인 `score-system`은 단일 파일 둘(`index.html` 5,300줄 · `admin.html`)과
Supabase Edge Function 셋으로 돈다. 브라우저는 DB에 직접 붙지 않는다.

```
index.html ──fetch──> /api/parent-login ──rewrite──> Edge Function ──> Postgres
admin.html ──fetch──> functions/v1/admin-api  ─────────────────────> Postgres
admin.html ──fetch──> functions/v1/send-sms   ─────────────────────> (발송사)
```

### Edge Function 세 개

| 함수 | 레포 사본 | 역할 |
|---|---|---|
| `parent-login` | 있음 (292줄) | PIN 검증, 세션 쿠키 발급, 성적 조회 |
| `admin-api` | 있음 (127줄) | 관리자 비밀번호 확인 후 PostgREST 프록시 |
| `send-sms` | 소스 확인 완료 (레포 미보관) | CoolSMS 문자 발송 |

### send-sms 동작 명세

소스를 확인했으나 **API 키가 하드코딩돼 있어 레포에 보관하지 않는다.**
재발급 후 Supabase 환경변수로만 주입할 것.

- 발송사: CoolSMS `POST https://api.coolsms.co.kr/messages/v4/send`
- 인증 헤더: `HMAC-SHA256 apiKey=…, date=…, salt=…, signature=…`
  - `signature = hex(HMAC-SHA256(date + salt, apiSecret))`
  - `date`는 ISO8601, `salt`는 UUID
- 요청: `{ messages: [{ to, text }] }`
- 응답: `{ success: number, fail: number, results: [{ ok, msg }] }`
- 성공 판정: 응답 JSON에 `groupId` 존재 여부
- 수신번호 하이픈 제거 후 전송

**이전 시 반드시 고칠 것:**

1. **인증이 없다.** 비밀번호도 세션도 확인하지 않는다. URL만 알면 누구나
   문자를 보낼 수 있다. 관리자 세션 검증을 붙여야 한다.
2. **순차 루프.** 한 건씩 왕복해 한 반 30명이면 30회. CoolSMS v4 다건
   발송으로 묶을 여지가 있다.
3. **부분 실패가 묻힌다.** 성공/실패 개수만 돌려주고 수신자 대응이 배열
   순서뿐이다. 조교가 누구에게 안 갔는지 알 수 없다. 수신자별 결과를
   남겨야 한다.

### admin-api는 백엔드가 아니다

비밀번호를 확인하고 PostgREST로 그대로 넘기는 범용 프록시다. 가진 규칙은
허용 테이블 목록과 `data_history` 읽기 전용 제한뿐이다.

따라서 점수 검증·재시험 처리·총점 계산 같은 **비즈니스 로직은 전부
`admin.html` 안에 흩어져 있다.** 호출 지점 99개, 테이블 9개.

```
students 24 · weeks 20 · scores 19 · classes 15 · mock_exams 10
mock_scores 6 · memos 3 · data_history 1 · app_settings 1
```

Spring Boot 이전은 "DB를 붙이는 일"이 아니라 **이 규칙들을 재구현하는 일**이다.
원본에 테스트가 없어 참조할 명세가 코드뿐이다. 전체 공수의 절반 이상이 여기다.

### 세션 토큰 형식

표준 JWT가 아니다.

```
base64url(JSON{sid, vk, exp}) + "." + base64url(HMAC-SHA256(body, SESSION_SECRET))
```

쿠키는 `parent_session`, 속성은 `Path=/; Max-Age=43200; HttpOnly; Secure; SameSite=Lax`.

**새 로그인을 만들지 않는다.** 같은 `SESSION_SECRET`으로 이 토큰을 검증하는
필터만 만든다. 그래야 학생이 기존 성적 화면에서 로그인한 상태 그대로 넘어온다.

### data_history는 트리거가 쓴다

애플리케이션이 아니라 DB 트리거가 `scores` UPDATE/DELETE 직전 값을 남긴다.
Spring Boot가 같은 테이블에 쓰면 변경 이력은 자동으로 따라온다.
**트리거를 건드리지 않는 것이 조건이다.**

## 진행을 막는 것

없음. send-sms 동작 명세를 확보해 4단계 설계가 가능해졌다.

### 선행 조치 (코드 작업과 무관, 즉시)

send-sms 소스에 CoolSMS API 키·시크릿·발신번호가 하드코딩돼 있었다.
**노출된 것으로 간주하고 재발급한다.** 새 키는 레포에 넣지 않고
`supabase secrets set`으로만 주입한다.

## 지켜야 할 제약

### 1. 스키마를 바꾸지 않는다

`parent-login`이 `scores?select=*`로 전체 컬럼을 받아 쓰고, `item4_score`·
`item_scores` 같은 나중에 붙은 컬럼을 이름으로 직접 참조한다.

실제 사용 중인 컬럼(사용 빈도순):

```
homework_rate 50 · retest 41 · item_scores 34 · clinic_memo 30
retest_pass 13 · item4_score 6 · no_homework 4
word_score 3 · reading_score 3 · mc_score 3 · total_score 2
item1~3_score 각 2
```

`item_scores` JSON을 테이블로 정규화하거나 번호 붙은 컬럼을 정리하려는 유혹이
반드시 온다. 그 순간 **운영 중인 학부모 성적 화면이 마이그레이션 한 번으로
즉시 깨진다.**

```yaml
spring:
  jpa:
    hibernate:
      ddl-auto: validate   # none 아님. 스키마가 다르면 기동 실패해야 한다
```

Flyway는 당분간 붙이지 않는다.

### 2. 커넥션 풀을 묶는다

파드 3개 × HikariCP 기본 10 = 30 커넥션. Supabase 소형 플랜 직접 연결 한도를
넘긴다. 넘기면 **같은 DB를 쓰는 Edge Function도 연결을 못 받아 운영 성적
조회가 멈춘다.**

- 트랜잭션 풀러(6543 포트) 사용
- `maximum-pool-size` 파드당 2~3
- 풀러 모드에서는 prepared statement 캐시 해제 (`prepareThreshold=0`)

### 3. k8s를 트래픽으로 정당화하지 않는다

학원 한 곳 영어과다. 동시 접속이 수백이 될 일이 없다. 면접에서 "일 평균
요청이 몇 건인가요" 한 마디에 뚫린다.

서사는 이쪽이다 — **"단일 파일 5,300줄 + 서버리스 함수로 운영하던 서비스를,
스키마를 깨지 않고 무중단으로 이전한 과정."** 실제로 어렵고 실제로 그렇다.

## 단계

각 단계는 독립적으로 되돌릴 수 있어야 한다.

### 0. 데모 자산 제거

- `createDemoGateway` 제거, `ScoreGateway` 구현을 실 API로 교체
- 화면의 "합성 데이터 전용 · 운영 연결 없음" 고지 제거
- `e2e/safety.spec.ts`의 CSP 외부 연결 차단 테스트 재작성
  (차단이 아니라 "허용된 오리진만"으로)
- `src/data/demo-score.json`은 **테스트 fixture로 남긴다** (삭제 아님)

테스트 69개 중 게이트웨이에 의존하는 것만 손본다. 도메인 계산 테스트
(`weeklyStats`, `computeTotal`, `scoreChange`)는 그대로 자산으로 남는다.

### 1. Spring Boot 읽기 전용 API

- 기존 `parent_session` 쿠키 검증 필터 (새 로그인 만들지 않음)
- `GET /api/student/me` — `parent-login`의 GET 응답 계약과 동일하게
- DB 쓰기 없음
- 로컬 Docker Compose
- **기존 서비스에 영향 없음**

### 2. Vercel rewrite 연결

```json
{ "source": "/app/:path*", "destination": "https://<ingress>/:path*" }
```

같은 오리진이므로 `SameSite=Lax` 쿠키가 그대로 붙는다. Edge Function은
손대지 않는다. 여기서 쿠키가 실제로 전달되는지 확인한다.

`parent-login`이 이미 외부 오리진 rewrite를 통해 `Set-Cookie`를 보내고 있으므로
패턴 자체는 운영에서 검증된 상태다.

**되돌리기: rewrite 한 줄 삭제.**

### 3. 프런트엔드 연결 교체

- 게이트웨이 구현만 교체, 컴포넌트·테스트 유지
- 여기까지가 기존 서비스 무영향 구간

### 4. 쓰기 경로 — 가장 위험

`admin-api`와 역할이 겹친다. 같은 표를 두 백엔드가 고치게 된다.

- 표 단위로 하나씩 이전, 동시에 두 곳에서 쓰지 않는다
- 이전한 표는 `admin-api`의 `ALLOWED_TABLES`에서 제거해 경로를 하나로 만든다
- `data_history` 트리거 동작을 매 표마다 확인
- send-sms 소스 확보가 선행 조건

### 5. k8s

여기서부터는 서비스 동작이 아니라 운영 역량의 문제다.

## 열린 질문

- send-sms 소스 확보 (4단계 차단 중)
- Supabase 플랜과 실제 커넥션 한도
- k8s 호스팅 위치 (관리형 / 자체 구축)
- `app_settings` 테이블 용도 미확인 (호출 1회)
