# infra — AWS CDK (서울 리전)

```
Vercel(tutor-ax) ─HTTPS─▶ CloudFront(*.cloudfront.net) ─VPC 오리진─▶ 내부 ALB ─┬─ Fargate (AZ-a) ─┐
                                                                            └─ Fargate (AZ-c) ─┴─▶ Supabase(서울)
GitHub Actions ──OIDC──▶ cdk deploy (이미지는 CDK가 backend/Dockerfile로 빌드)
Secrets Manager ──▶ 작업 환경변수(DB·관리자·세션·Gemini)
CloudWatch 경보(정상 작업 < 2, 5xx) ──▶ SNS ──▶ 이메일
```

| 결정 | 이유 |
|---|---|
| Fargate 2개, 가용 영역 2곳 | 콜드스타트 없음, AZ 하나 장애에도 응답 |
| CloudFront + 내부 ALB | 도메인 없이 무료 HTTPS(*.cloudfront.net). ALB는 인터넷에 노출되지 않고 CloudFront만 AWS 내부망으로 접근 |
| CloudFront 캐시 끔 | 관리자 API라 응답이 섞이면 안 됨. 쿠키·헤더·쿼리는 그대로 전달 |
| NAT 게이트웨이 없음 | 월 수만 원 절약. 작업은 공인 IP로 밖에 나가되 보안 그룹은 ALB 요청만 허용 |
| ARM64(Graviton) | 같은 사양에서 x86보다 저렴 |
| 배포 회로 차단기 + 자동 롤백 | 새 버전이 `/api/health`를 못 넘기면 이전 버전 유지 |
| OIDC 배포 역할 | GitHub에 AWS 키를 저장하지 않음, `main`에서만 배포 |

알려진 한계: DB(Supabase)는 서울 단일 지역이라 가용성의 상한은 DB가 정한다.

## 처음 배포

필요: `aws sso login --profile tutor-ax`, Docker 실행 중, Node 22. 아래 명령은 `AWS_PROFILE=tutor-ax`가 설정된 셸에서.

```
cd infra && npm ci
npx cdk bootstrap                                  # 계정·리전당 한 번
npx cdk deploy -c desiredCount=0 -c alarmEmail=<메일>  # 비밀값이 비어 있으니 작업 0개로
```

출력의 `SecretName`에 값을 채운다(`ADMIN_SESSION_SECRET`은 자동 생성됨). 값을 화면·셸 기록에 남기지 않도록 파일로 넘긴다:

```
python3 - <<'PY' > /tmp/secret.json
import json, re
env = dict(re.findall(r'^([A-Z_]+)=(.*)$', open('../.env.local').read(), re.M))
print(json.dumps({k: env[k] for k in ["DB_URL","DB_USER","DB_PASSWORD","ADMIN_PASSWORD","GEMINI_API_KEY"]}))
PY
# 자동 생성된 ADMIN_SESSION_SECRET을 보존하며 합친다
aws secretsmanager get-secret-value --secret-id <SecretName> --query SecretString --output text \
  | python3 -c 'import json,sys; a=json.load(sys.stdin); a.update(json.load(open("/tmp/secret.json"))); print(json.dumps(a))' > /tmp/merged.json
aws secretsmanager put-secret-value --secret-id <SecretName> --secret-string file:///tmp/merged.json
rm /tmp/secret.json /tmp/merged.json
```

그다음 작업을 2개로:

```
npx cdk deploy -c alarmEmail=<메일>
```

SNS 확인 메일의 링크를 눌러야 경보가 온다.

## 도메인을 붙이고 싶으면

지금은 `*.cloudfront.net` 주소로 충분하다. 나중에 도메인을 사면 ACM 인증서(us-east-1)를 만들어 CloudFront 배포에 대체 도메인으로 붙인다.

## GitHub Actions 자동 배포

저장소 Settings → Variables에:
- `AWS_DEPLOY_ROLE_ARN`: 출력의 `DeployRoleArn`
- `CDK_CONTEXT`: 예 `-c alarmEmail=me@example.com`

계정에 GitHub OIDC 공급자가 이미 있으면 `-c githubOidcProviderArn=<ARN>`을 함께 넘긴다.

## Vercel 연결

tutor-ax Vercel 프로젝트의 `vercel.json`:

```json
{ "rewrites": [{ "source": "/api/admin/:path*", "destination": "<BackendUrl>/api/admin/:path*" }] }
```

## 지우기

```
npx cdk destroy
```
Secrets Manager 비밀은 삭제 대기(기본 7~30일) 후 사라진다.
