# infra — AWS CDK (서울 리전)

```
Vercel(tutor-ax) ─HTTPS─▶ Lambda 함수 URL ─▶ Lambda(live 별칭, SnapStart)
                                              └ Lambda Web Adapter ─▶ Spring Boot ─▶ Supabase(서울)
Secrets Manager ──(기동 시 1회 읽기)──▶ Spring Boot
CloudWatch 경보(오류, 스로틀) ──▶ SNS ──▶ 이메일
GitHub Actions ──OIDC──▶ cdk deploy
```

| 결정 | 이유 |
|---|---|
| 상시 서버 대신 Lambda | 사용자는 선생님 몇 명, 하루 요청 수십~수백 건. ALB·Fargate 고정비(월 $55~60)를 없앰 |
| SnapStart | Spring Boot 기동(수 초)을 스냅샷 복원으로 바꿔 콜드스타트를 줄임 |
| Lambda Web Adapter | Spring Boot 4용 공식 Lambda 어댑터가 없어, 웹 앱을 코드 변경 없이 돌리는 AWS 공식 어댑터 사용 |
| 함수 URL(인증 NONE) | 무료 HTTPS. 인증은 앱(관리자 세션 쿠키)이 한다. CloudFront + OAC는 POST마다 본문 해시 헤더가 필요해 뺐다 |
| 남용 상한 | 계정 동시 실행 한도(현재 10)가 상한. 넘으면 스로틀 경보 |
| ARM64 | 같은 사양에서 x86보다 저렴 |
| 비밀값은 Secrets Manager | 환경변수에는 비밀의 ARN만. 값은 기동 시 SDK로 읽음 |

알려진 한계:
- DB(Supabase)는 서울 단일 지역이라 가용성의 상한은 DB가 정한다.
- SnapStart 스냅샷에 비밀값이 들어간다(Lambda가 암호화해 보관). 비밀값을 바꾸면 `-c configRevision=<새 값>`으로 새 버전을 게시해야 반영된다.
- 로그인 실패 횟수는 실행 환경마다 메모리에 센다.

## 처음 배포

필요: `aws sso login --profile tutor-ax`, Node 22, JDK 21. 아래 명령은 `AWS_PROFILE=tutor-ax`가 설정된 셸에서.

```
cd infra && npm ci
npx cdk bootstrap                                     # 계정·리전당 한 번
npx cdk deploy -c secretOnly=true                     # 1) 비밀만 만든다
```

2) 출력의 `SecretName`에 값을 채운다(`ADMIN_SESSION_SECRET`은 자동 생성). 값을 화면·셸 기록에 남기지 않도록 파일로 넘긴다:

```
python3 - <<'PY' > /tmp/secret.json
import json, re
env = dict(re.findall(r'^([A-Z_]+)=(.*)$', open('../.env.local').read(), re.M))
print(json.dumps({k: env[k] for k in ["DB_URL","DB_USER","DB_PASSWORD","ADMIN_PASSWORD","GEMINI_API_KEY"]}))
PY
aws secretsmanager get-secret-value --secret-id <SecretName> --query SecretString --output text \
  | python3 -c 'import json,sys; a=json.load(sys.stdin); a.update(json.load(open("/tmp/secret.json"))); print(json.dumps(a))' > /tmp/merged.json
aws secretsmanager put-secret-value --secret-id <SecretName> --secret-string file:///tmp/merged.json
rm /tmp/secret.json /tmp/merged.json
```

3) 함수까지 배포:

```
npm run build:backend                                 # backend → build/lambda (app.jar + run.sh)
npx cdk deploy -c alarmEmail=<메일>
```

SNS 확인 메일의 링크를 눌러야 경보가 온다.

## 비밀값을 바꾼 뒤

```
npm run build:backend && npx cdk deploy -c alarmEmail=<메일> -c configRevision=$(date +%Y%m%d%H%M)
```

## GitHub Actions 자동 배포

저장소 Settings → Variables에:
- `AWS_DEPLOY_ROLE_ARN`: 출력의 `DeployRoleArn`
- `CDK_CONTEXT`: 예 `-c alarmEmail=me@example.com`

계정에 GitHub OIDC 공급자가 이미 있으면 `-c githubOidcProviderArn=<ARN>`을 함께 넘긴다.

## Vercel 연결

tutor-ax Vercel 프로젝트의 `vercel.json` (`BackendUrl`은 `https://…lambda-url.ap-northeast-2.on.aws/` 꼴):

```json
{ "rewrites": [{ "source": "/api/admin/:path*", "destination": "<BackendUrl>api/admin/:path*" }] }
```

## 지우기

```
npx cdk destroy
```
Secrets Manager 비밀은 삭제 대기(기본 30일) 후 사라진다.
