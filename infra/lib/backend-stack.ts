import * as cdk from "aws-cdk-lib";
import { Duration, RemovalPolicy } from "aws-cdk-lib";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as cwActions from "aws-cdk-lib/aws-cloudwatch-actions";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as logs from "aws-cdk-lib/aws-logs";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as sns from "aws-cdk-lib/aws-sns";
import * as subs from "aws-cdk-lib/aws-sns-subscriptions";
import type { Construct } from "constructs";

export interface BackendStackProps extends cdk.StackProps {
  /** GitHub Actions가 배포할 저장소 (owner/name) */
  githubRepo: string;
  /** 경보를 받을 이메일. 배포 후 받은 확인 메일을 눌러야 구독된다. */
  alarmEmail?: string;
  /** 계정에 GitHub OIDC 공급자가 이미 있으면 그 ARN(같은 공급자는 계정당 하나만 만들 수 있다). */
  githubOidcProviderArn?: string;
  /** Lambda 패키지 폴더(app.jar + run.sh). `npm run build:backend`가 만든다. */
  lambdaCodeDir: string;
  /** true면 비밀만 만든다 — 처음 설치할 때 비밀값을 채우기 전 단계(비어 있으면 SnapStart 초기화가 실패한다). */
  secretOnly?: boolean;
  /** 비밀값을 바꾼 뒤 새 함수 버전을 게시하려면 아무 값으로 바꾼다(SnapStart 스냅샷에 비밀값이 들어 있다). */
  configRevision?: string;
}

const SECRET_KEYS = ["DB_URL", "DB_USER", "DB_PASSWORD", "ADMIN_PASSWORD", "GEMINI_API_KEY"] as const;
// Lambda Web Adapter(awslabs): 일반 Spring Boot 웹 앱을 코드 변경 없이 Lambda에서 돌린다. SnapStart 지원.
const WEB_ADAPTER_LAYER = (region: string) =>
  `arn:aws:lambda:${region}:753240598075:layer:LambdaAdapterLayerArm64:30`;

export class BackendStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: BackendStackProps) {
    super(scope, id, props);

    // 비밀값은 여기 한 곳에. 세션 서명값만 자동 생성하고 나머지는 CLI로 채운다(코드·템플릿에 값 없음).
    // 논리 ID "AppSecret"을 바꾸지 않는다 — 바꾸면 채워 둔 비밀이 새로 만들어진다.
    const secret = new secretsmanager.Secret(this, "AppSecret", {
      description: "tutor-ax backend: DB 읽기 전용 계정, 관리자 비밀번호, 세션 서명값, Gemini 키",
      generateSecretString: {
        secretStringTemplate: JSON.stringify(Object.fromEntries(SECRET_KEYS.map((k) => [k, ""]))),
        generateStringKey: "ADMIN_SESSION_SECRET",
        passwordLength: 64,
        excludePunctuation: true,
      },
    });
    new cdk.CfnOutput(this, "SecretName", { value: secret.secretName, description: "값을 채울 비밀" });
    if (props.secretOnly) return;

    // 사용자는 선생님 몇 명 — 상시 서버 대신 Lambda. SnapStart로 Spring Boot 기동을 스냅샷 복원으로 바꿔 콜드스타트를 줄인다.
    const fn = new lambda.Function(this, "Api", {
      runtime: lambda.Runtime.JAVA_21,
      architecture: lambda.Architecture.ARM_64,
      handler: "run.sh",
      code: lambda.Code.fromAsset(props.lambdaCodeDir),
      memorySize: 1024,
      timeout: Duration.seconds(30), // AI 질문 생성(최대 25초)보다 길게
      snapStart: lambda.SnapStartConf.ON_PUBLISHED_VERSIONS,
      layers: [lambda.LayerVersion.fromLayerVersionArn(this, "WebAdapter", WEB_ADAPTER_LAYER(this.region))],
      environment: {
        AWS_LAMBDA_EXEC_WRAPPER: "/opt/bootstrap",
        AWS_LWA_PORT: "8080",
        AWS_LWA_READINESS_CHECK_PATH: "/api/health",
        APP_SECRET_ID: secret.secretArn,
        CONFIG_REVISION: props.configRevision ?? "1",
      },
      logGroup: new logs.LogGroup(this, "Logs", {
        retention: logs.RetentionDays.TWO_WEEKS,
        removalPolicy: RemovalPolicy.DESTROY,
      }),
    });
    secret.grantRead(fn);
    // 아래 별칭(live)이 currentVersion으로 버전을 게시하므로 SnapStart가 적용된다.
    cdk.Annotations.of(fn).acknowledgeWarning("@aws-cdk/aws-lambda:snapStartRequirePublish", "published via alias live");

    // SnapStart는 게시된 버전에만 적용된다 → 별칭(live)이 항상 최신 버전을 가리키게.
    const alias = new lambda.Alias(this, "Live", { aliasName: "live", version: fn.currentVersion });
    // 함수 URL(무료 HTTPS). 인증은 앱이 한다(관리자 세션 쿠키). 남용 상한은 계정 동시 실행 한도(현재 10).
    const url = alias.addFunctionUrl({ authType: lambda.FunctionUrlAuthType.NONE });

    // 경보 → SNS → 이메일
    const alarms = new sns.Topic(this, "Alarms", { displayName: "tutor-ax backend alarms" });
    if (props.alarmEmail) alarms.addSubscription(new subs.EmailSubscription(props.alarmEmail));
    const notify = new cwActions.SnsAction(alarms);
    const errors = new cloudwatch.Alarm(this, "ApiErrors", {
      alarmDescription: "Lambda 오류(시간 초과·기동 실패 포함)가 5분에 3건 이상",
      metric: alias.metricErrors({ period: Duration.minutes(5), statistic: "Sum" }),
      threshold: 3,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    const throttles = new cloudwatch.Alarm(this, "ApiThrottles", {
      alarmDescription: "동시 실행 한도에 걸려 요청이 거절됨 — 남용 또는 한도 부족",
      metric: alias.metricThrottles({ period: Duration.minutes(5), statistic: "Sum" }),
      threshold: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    for (const alarm of [errors, throttles]) {
      alarm.addAlarmAction(notify);
      alarm.addOkAction(notify);
    }

    // GitHub Actions 배포 권한: 장기 액세스 키 없이 OIDC로, 이 저장소의 main 브랜치에서만.
    // 실제 리소스 변경은 CDK 부트스트랩 역할이 하므로 그 역할을 맡는 권한만 준다.
    const provider = props.githubOidcProviderArn
      ? iam.OpenIdConnectProvider.fromOpenIdConnectProviderArn(this, "GithubOidc", props.githubOidcProviderArn)
      : new iam.OpenIdConnectProvider(this, "GithubOidc", {
          url: "https://token.actions.githubusercontent.com",
          clientIds: ["sts.amazonaws.com"],
        });
    const deployRole = new iam.Role(this, "GithubDeployRole", {
      description: "GitHub Actions -> cdk deploy (tutor-ax main only)",
      maxSessionDuration: Duration.hours(1),
      assumedBy: new iam.WebIdentityPrincipal(provider.openIdConnectProviderArn, {
        StringEquals: { "token.actions.githubusercontent.com:aud": "sts.amazonaws.com" },
        StringLike: { "token.actions.githubusercontent.com:sub": `repo:${props.githubRepo}:ref:refs/heads/main` },
      }),
    });
    deployRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["sts:AssumeRole"],
        resources: [`arn:aws:iam::${this.account}:role/cdk-hnb659fds-*-${this.account}-${this.region}`],
      }),
    );

    new cdk.CfnOutput(this, "BackendUrl", { value: url.url, description: "Vercel rewrite 대상(끝의 / 포함)" });
    new cdk.CfnOutput(this, "DeployRoleArn", { value: deployRole.roleArn, description: "GitHub 변수 AWS_DEPLOY_ROLE_ARN" });
    new cdk.CfnOutput(this, "AlarmTopicArn", { value: alarms.topicArn });
  }
}
