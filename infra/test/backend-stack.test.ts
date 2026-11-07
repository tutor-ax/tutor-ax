import * as cdk from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { expect, it } from "vitest";
import { BackendStack } from "../lib/backend-stack.js";

const synth = (extra: Partial<ConstructorParameters<typeof BackendStack>[2]> = {}) =>
  Template.fromStack(
    new BackendStack(new cdk.App(), "T", {
      env: { account: "111111111111", region: "ap-northeast-2" },
      githubRepo: "owner/repo",
      alarmEmail: "ops@example.com",
      ...extra,
    }),
  );

it("runs two ARM tasks across two AZs with rollback and no NAT gateway", () => {
  const t = synth();
  t.hasResourceProperties("AWS::ECS::Service", {
    DesiredCount: 2,
    DeploymentConfiguration: Match.objectLike({
      MinimumHealthyPercent: 100,
      DeploymentCircuitBreaker: { Enable: true, Rollback: true },
    }),
  });
  t.hasResourceProperties("AWS::ECS::TaskDefinition", {
    RuntimePlatform: { CpuArchitecture: "ARM64", OperatingSystemFamily: "LINUX" },
  });
  t.resourceCountIs("AWS::EC2::Subnet", 4); // public 2 (작업) + isolated 2 (내부 ALB)
  t.resourceCountIs("AWS::EC2::NatGateway", 0);
  t.hasResourceProperties("AWS::ElasticLoadBalancingV2::TargetGroup", { HealthCheckPath: "/api/health" });
});

it("injects every secret from Secrets Manager and never as plain environment", () => {
  const t = synth();
  const [def] = Object.values(t.findResources("AWS::ECS::TaskDefinition")) as any[];
  const container = def.Properties.ContainerDefinitions[0];
  expect(container.Secrets.map((s: any) => s.Name).sort()).toEqual(
    ["ADMIN_PASSWORD", "ADMIN_SESSION_SECRET", "DB_PASSWORD", "DB_URL", "DB_USER", "GEMINI_API_KEY"],
  );
  expect(container.Environment.map((e: any) => e.Name)).toEqual(["JAVA_TOOL_OPTIONS"]);
});

it("alerts by email on lost tasks and 5xx, and lets only main of the repo deploy", () => {
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

it("serves HTTPS through CloudFront to an internal ALB with caching disabled", () => {
  const t = synth();
  t.hasResourceProperties("AWS::ElasticLoadBalancingV2::LoadBalancer", { Scheme: "internal" });
  t.resourceCountIs("AWS::CloudFront::VpcOrigin", 1);
  t.hasResourceProperties("AWS::CloudFront::Distribution", {
    DistributionConfig: Match.objectLike({
      DefaultCacheBehavior: Match.objectLike({
        ViewerProtocolPolicy: "https-only",
        CachePolicyId: "4135ea2d-6df8-44a3-9df3-4b5a84be39ad", // Managed-CachingDisabled
        AllowedMethods: Match.arrayWith(["POST", "DELETE"]),
      }),
    }),
  });
  // ALB 보안 그룹에 0.0.0.0/0 인바운드가 없어야 한다
  const sgs = Object.values(t.findResources("AWS::EC2::SecurityGroup")) as any[];
  for (const sg of sgs) for (const r of sg.Properties.SecurityGroupIngress ?? []) expect(r.CidrIp).not.toBe("0.0.0.0/0");
});

it("can start with zero tasks for the first deploy", () => {
  synth({ desiredCount: 0 }).hasResourceProperties("AWS::ECS::Service", { DesiredCount: 0 });
});
