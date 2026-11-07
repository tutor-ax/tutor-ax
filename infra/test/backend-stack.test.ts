import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as cdk from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { expect, it } from "vitest";
import { BackendStack, type BackendStackProps } from "../lib/backend-stack.js";

const codeDir = mkdtempSync(join(tmpdir(), "lambda-"));
writeFileSync(join(codeDir, "run.sh"), "#!/bin/sh\n");
writeFileSync(join(codeDir, "app.jar"), "");

const synth = (extra: Partial<BackendStackProps> = {}) =>
  Template.fromStack(
    new BackendStack(new cdk.App(), "T", {
      env: { account: "111111111111", region: "ap-northeast-2" },
      githubRepo: "owner/repo",
      alarmEmail: "ops@example.com",
      lambdaCodeDir: codeDir,
      ...extra,
    }),
  );

it("runs Spring Boot on ARM Lambda with SnapStart behind the web adapter", () => {
  const t = synth();
  t.hasResourceProperties("AWS::Lambda::Function", {
    Runtime: "java21",
    Architectures: ["arm64"],
    Handler: "run.sh",
    Timeout: 30,
    SnapStart: { ApplyOn: "PublishedVersions" },
    Layers: ["arn:aws:lambda:ap-northeast-2:753240598075:layer:LambdaAdapterLayerArm64:30"],
    Environment: {
      Variables: Match.objectLike({
        AWS_LAMBDA_EXEC_WRAPPER: "/opt/bootstrap",
        AWS_LWA_READINESS_CHECK_PATH: "/api/health",
      }),
    },
  });
  // 상시 비용이 드는 리소스는 없어야 한다
  for (const type of ["AWS::ElasticLoadBalancingV2::LoadBalancer", "AWS::ECS::Service", "AWS::EC2::NatGateway"])
    t.resourceCountIs(type, 0);
  t.hasResourceProperties("AWS::Lambda::Url", { AuthType: "NONE" });
  t.hasResourceProperties("AWS::Lambda::Alias", { Name: "live" });
});

it("passes only the secret's ARN to the function, never secret values", () => {
  const t = synth();
  const [fn] = Object.values(t.findResources("AWS::Lambda::Function")).filter(
    (r: any) => r.Properties.Handler === "run.sh",
  ) as any[];
  const vars = fn.Properties.Environment.Variables;
  expect(Object.keys(vars).sort()).toEqual(
    ["APP_SECRET_ID", "AWS_LAMBDA_EXEC_WRAPPER", "AWS_LWA_PORT", "AWS_LWA_READINESS_CHECK_PATH", "CONFIG_REVISION"],
  );
  expect(vars.APP_SECRET_ID).toEqual({ Ref: expect.stringMatching(/^AppSecret/) });
});

it("alerts by email on errors and throttles, and lets only main of the repo deploy", () => {
  const t = synth();
  t.resourceCountIs("AWS::CloudWatch::Alarm", 2);
  t.hasResourceProperties("AWS::SNS::Subscription", { Protocol: "email", Endpoint: "ops@example.com" });
  t.hasResourceProperties("AWS::IAM::Role", {
    AssumeRolePolicyDocument: Match.objectLike({
      Statement: Match.arrayWith([
        Match.objectLike({
          Condition: Match.objectLike({
            StringLike: { "token.actions.githubusercontent.com:sub": "repo:owner/repo:ref:refs/heads/main" },
          }),
        }),
      ]),
    }),
  });
});

it("creates only the secret in secretOnly mode", () => {
  const t = synth({ secretOnly: true });
  t.resourceCountIs("AWS::SecretsManager::Secret", 1);
  t.resourceCountIs("AWS::Lambda::Function", 0);
});
