# 검증 기록

2026-10-25 KST, macOS 로컬 환경. Node 20.12.2 / npm 10.5.0.

최종 소스에서 의존성을 다시 설치한 뒤 실행:

| 명령 | 실제 결과 |
| --- | --- |
| `npm ci` | 성공, 151 packages installed |
| `npm test -- --run` | 4 files, 14 tests passed |
| `npm run build` | TypeScript 및 Vite production build 성공 |
| `npm run test:e2e` | Chromium, 7 tests passed |
| `npm audit` | 0 vulnerabilities |
| `git diff --cached --check` | 성공 |

독립 읽기 전용 코드 검토에서도 차단할 보안·논리 결함이 발견되지 않았다. 리뷰어는 단위 테스트와 TypeScript 검사를 별도 실행했고, 브라우저 E2E 재실행은 구현 담당자가 수행했다.

개발 서버 별도 smoke check: 데모 학생 표시, canvas 1개, Vite HMR 연결 확인, pageErrors 빈 배열. 단, 외부 Google Fonts는 테스트에서 차단했다.

모바일 390px·PC 1440px 스크린샷에서 카드 정렬·줄바꿈·차트 표시를 직접 확인했다. 자동 비교는 주요 요소 크기와 표시 데이터 비교이며 전체 픽셀 일치 검증이 아니다.

고객 원본 두 저장소의 `git status --porcelain`은 빈 출력이었다. 개인 원격 저장소는 `isPrivate: true`를 다시 확인했다.

운영 API, 실제 인증/데이터, 관리자, 단어/지문 화면은 이 검증의 범위가 아니다. Google Fonts 요청은 허용하므로 완전 무네트워크 앱이라고 주장하지 않는다.

GitHub Actions 설정을 포함했으나 이 문서의 결과는 로컬 실행 결과이며 원격 CI 성공 여부는 PR의 Checks를 확인해야 한다.
