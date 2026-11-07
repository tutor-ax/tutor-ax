import * as path from "node:path";
import { fileURLToPath } from "node:url";
import * as cdk from "aws-cdk-lib";
import { Duration, RemovalPolicy } from "aws-cdk-lib";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as cwActions from "aws-cdk-lib/aws-cloudwatch-actions";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import { Platform } from "aws-cdk-lib/aws-ecr-assets";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as iam from "aws-cdk-lib/aws-iam";
import * as logs from "aws-cdk-lib/aws-logs";
import * as route53 from "aws-cdk-lib/aws-route53";
import * as route53Targets from "aws-cdk-lib/aws-route53-targets";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as sns from "aws-cdk-lib/aws-sns";
import * as subs from "aws-cdk-lib/aws-sns-subscriptions";
import type { Construct } from "constructs";

export interface BackendStackProps extends cdk.StackProps {
  /** GitHub Actions가 배포할 저장소 (owner/name) */
  githubRepo: string;
  /** 예: api.example.com. 주면 ACM 인증서 + HTTPS, 없으면 HTTP만(시험용 — 운영 금지). */
  domainName?: string;
  /** domainName이 속한 Route 53 호스팅 영역. 예: example.com */
  hostedZoneName?: string;
  /** 경보를 받을 이메일. 배포 후 받은 확인 메일을 눌러야 구독된다. */
  alarmEmail?: string;
  /** 계정에 GitHub OIDC 공급자가 이미 있으면 그 ARN(같은 공급자는 계정당 하나만 만들 수 있다). */
  githubOidcProviderArn?: string;
  /** 실행할 작업 수. 첫 배포는 0(비밀값이 비어 있으면 기동 실패 → 롤백), 비밀값을 채운 뒤 2. */
  desiredCount?: number;
}

const BACKEND_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../backend");
const SECRET_KEYS = ["DB_URL", "DB_USER", "DB_PASSWORD", "ADMIN_PASSWORD", "ADMIN_SESSION_SECRET", "GEMINI_API_KEY"] as const;

export class BackendStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: BackendStackProps) {
    super(scope, id, props);

    // 가용 영역 2곳. NAT 게이트웨이는 비싸서(개당 월 수만 원) 두지 않고, 작업에 공인 IP를 주되
    // 보안 그룹으로 ALB에서 오는 요청만 받는다. 바깥으로 나가는 요청(Supabase, Gemini)은 공인 IP로 나간다.
    const vpc = new ec2.Vpc(this, "Vpc", {
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [{ name: "public", subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 }],
    });

    // 비밀값은 여기 한 곳에. 세션 서명값만 자동 생성하고 나머지는 배포 후 CLI로 채운다(코드·템플릿에 값 없음).
    const secret = new secretsmanager.Secret(this, "AppSecret", {
      description: "tutor-ax backend: DB 읽기 전용 계정, 관리자 비밀번호, 세션 서명값, Gemini 키",
      generateSecretString: {
        secretStringTemplate: JSON.stringify(
          Object.fromEntries(SECRET_KEYS.filter((k) => k !== "ADMIN_SESSION_SECRET").map((k) => [k, ""])),
        ),
        generateStringKey: "ADMIN_SESSION_SECRET",
        passwordLength: 64,
        excludePunctuation: true,
      },
    });

    const cluster = new ecs.Cluster(this, "Cluster", { vpc });
    const logGroup = new logs.LogGroup(this, "Logs", {
      retention: logs.RetentionDays.TWO_WEEKS,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    const task = new ecs.FargateTaskDefinition(this, "Task", {
      cpu: 512,
      memoryLimitMiB: 1024,
      runtimePlatform: {
        cpuArchitecture: ecs.CpuArchitecture.ARM64, // Graviton: 같은 사양에서 x86보다 싸다
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
      },
    });
    task.addContainer("backend", {
      // 배포할 때 CDK가 backend/Dockerfile로 이미지를 빌드해 ECR(부트스트랩 저장소)에 올린다.
      image: ecs.ContainerImage.fromAsset(BACKEND_DIR, { platform: Platform.LINUX_ARM64 }),
      portMappings: [{ containerPort: 8080 }],
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: "backend", logGroup }),
      environment: { JAVA_TOOL_OPTIONS: "-XX:MaxRAMPercentage=75" },
      secrets: Object.fromEntries(SECRET_KEYS.map((k) => [k, ecs.Secret.fromSecretsManager(secret, k)])),
    });

    const service = new ecs.FargateService(this, "Service", {
      cluster,
      taskDefinition: task,
      desiredCount: props.desiredCount ?? 2, // 가용 영역마다 하나씩 — 한 곳이 죽어도 다른 하나가 받는다
      assignPublicIp: true,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      minHealthyPercent: 100, // 배포 중에도 2개를 유지하고 새 작업을 먼저 띄운다
      maxHealthyPercent: 200,
      circuitBreaker: { enable: true, rollback: true }, // 새 버전이 헬스체크를 못 넘기면 자동 롤백
      healthCheckGracePeriod: Duration.seconds(90), // JVM 기동 시간
    });

    const alb = new elbv2.ApplicationLoadBalancer(this, "Alb", { vpc, internetFacing: true });
    let listener: elbv2.ApplicationListener;
    let publicUrl: string;
    if (props.domainName && props.hostedZoneName) {
      const zone = route53.HostedZone.fromLookup(this, "Zone", { domainName: props.hostedZoneName });
      const certificate = new acm.Certificate(this, "Cert", {
        domainName: props.domainName,
        validation: acm.CertificateValidation.fromDns(zone),
      });
      listener = alb.addListener("Https", { port: 443, certificates: [certificate], sslPolicy: elbv2.SslPolicy.RECOMMENDED_TLS });
      alb.addRedirect({ sourcePort: 80, targetPort: 443 });
      new route53.ARecord(this, "Alias", {
        zone,
        recordName: props.domainName,
        target: route53.RecordTarget.fromAlias(new route53Targets.LoadBalancerTarget(alb)),
      });
      publicUrl = `https://${props.domainName}`;
    } else {
      // shortcut: 도메인 없이 HTTP로만 연다 — 비밀번호가 평문으로 오간다. 동작 확인용, 운영 전 domainName 필수.
      listener = alb.addListener("Http", { port: 80 });
      publicUrl = `http://${alb.loadBalancerDnsName}`;
    }
    const targetGroup = listener.addTargets("Backend", {
      port: 8080,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targets: [service],
      healthCheck: { path: "/api/health", healthyHttpCodes: "200", interval: Duration.seconds(15), healthyThresholdCount: 2 },
      deregistrationDelay: Duration.seconds(30),
    });

    // 경보 → SNS → 이메일. "정상 작업이 2개 미만"과 "백엔드 5xx"를 장애로 본다.
    const alarms = new sns.Topic(this, "Alarms", { displayName: "tutor-ax backend alarms" });
    if (props.alarmEmail) alarms.addSubscription(new subs.EmailSubscription(props.alarmEmail));
    const notify = new cwActions.SnsAction(alarms);
    const healthy = new cloudwatch.Alarm(this, "HealthyHostsLow", {
      alarmDescription: "정상 작업이 2개 미만 — 가용 영역 하나를 잃었거나 배포가 실패 중",
      metric: targetGroup.metrics.healthyHostCount({ period: Duration.minutes(1), statistic: "Minimum" }),
      threshold: 2,
      comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
      evaluationPeriods: 3,
      treatMissingData: cloudwatch.TreatMissingData.BREACHING,
    });
    const errors = new cloudwatch.Alarm(this, "Backend5xx", {
      alarmDescription: "백엔드 5xx가 5분에 5건 이상",
      metric: targetGroup.metrics.httpCodeTarget(elbv2.HttpCodeTarget.TARGET_5XX_COUNT, {
        period: Duration.minutes(5),
        statistic: "Sum",
      }),
      threshold: 5,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    for (const alarm of [healthy, errors]) {
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

    new cdk.CfnOutput(this, "BackendUrl", { value: publicUrl, description: "Vercel rewrite 대상" });
    new cdk.CfnOutput(this, "SecretName", { value: secret.secretName, description: "배포 후 값을 채울 비밀" });
    new cdk.CfnOutput(this, "DeployRoleArn", { value: deployRole.roleArn, description: "GitHub 변수 AWS_DEPLOY_ROLE_ARN" });
    new cdk.CfnOutput(this, "AlarmTopicArn", { value: alarms.topicArn });
  }
}
