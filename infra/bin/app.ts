import * as cdk from "aws-cdk-lib";
import { BackendStack } from "../lib/backend-stack.js";

const app = new cdk.App();
const ctx = (k: string) => app.node.tryGetContext(k) as string | undefined;

// 배포 계정·리전은 실행하는 AWS 자격 증명에서 가져온다(코드에 계정 번호를 박지 않는다). DB(Supabase)가 서울이라 기본은 서울.
new BackendStack(app, "TutorAxBackend", {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION ?? "ap-northeast-2" },
  githubRepo: ctx("githubRepo") ?? "yooncandooit/tutor-ax",
  domainName: ctx("domainName"),
  hostedZoneName: ctx("hostedZoneName"),
  alarmEmail: ctx("alarmEmail"),
  githubOidcProviderArn: ctx("githubOidcProviderArn"),
  desiredCount: ctx("desiredCount") === undefined ? undefined : Number(ctx("desiredCount")),
});
