import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const option3 = readFileSync(new URL('../option3/main.tf', import.meta.url), 'utf8');
const variables = readFileSync(new URL('../option3/variables.tf', import.meta.url), 'utf8');
const bootstrap = readFileSync(new URL('../bootstrap/main.tf', import.meta.url), 'utf8');
const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');

function contractViolations({ option3Source = option3, variableSource = variables, bootstrapSource = bootstrap } = {}) {
  const violations = [];
  const requirePattern = (source, pattern, label) => {
    if (!pattern.test(source)) violations.push(label);
  };
  const rejectPattern = (source, pattern, label) => {
    if (pattern.test(source)) violations.push(label);
  };

  requirePattern(option3Source, /limit_amount\s*=\s*"150"/, 'budget must be USD150');
  requirePattern(option3Source, /notification_type\s*=\s*"FORECASTED"/, 'forecast budget alert is required');
  requirePattern(option3Source, /notification_type\s*=\s*"ACTUAL"[\s\S]*threshold\s*=\s*100/, '100% actual budget alert is required');
  requirePattern(option3Source, /resource "aws_vpc" "shops"[\s\S]*cidr_block\s*=\s*"10\.42\.0\.0\/16"/, 'dedicated Shops VPC is required');
  requirePattern(option3Source, /resource "aws_subnet" "database"[\s\S]*map_public_ip_on_launch\s*=\s*false/, 'database subnets must remain private');
  requirePattern(option3Source, /resource "aws_security_group" "scanner"[\s\S]*description\s*=\s*"Scanner tasks have no inbound rules"[\s\S]*egress\s*\{/, 'scanner security group must exist');
  const scannerBlock = /resource "aws_security_group" "scanner"\s*\{([\s\S]*?)\n\}/.exec(option3Source)?.[1] ?? '';
  if (/\bingress\s*\{/.test(scannerBlock)) violations.push('scanner security group must have no ingress block');
  requirePattern(option3Source, /resource "aws_ecs_service" "scanner"[\s\S]*desired_count\s*=\s*2/, 'scanner service must run two tasks');
  requirePattern(option3Source, /resource "aws_ecs_service" "web"[\s\S]*desired_count\s*=\s*2/, 'web service must run two tasks');
  requirePattern(option3Source, /resource "aws_ecs_task_definition" "web"[\s\S]*cpu\s*=\s*"256"[\s\S]*memory\s*=\s*"512"[\s\S]*cpu_architecture\s*=\s*"ARM64"/, 'web task size and ARM64 platform are fixed');
  requirePattern(option3Source, /resource "aws_ecs_task_definition" "scanner"[\s\S]*cpu\s*=\s*"256"[\s\S]*memory\s*=\s*"512"[\s\S]*cpu_architecture\s*=\s*"ARM64"/, 'scanner task size and ARM64 platform are fixed');
  requirePattern(option3Source, /resource "aws_db_instance" "shops"[\s\S]*instance_class\s*=\s*"db\.t4g\.small"[\s\S]*allocated_storage\s*=\s*20[\s\S]*multi_az\s*=\s*true[\s\S]*publicly_accessible\s*=\s*false[\s\S]*backup_retention_period\s*=\s*14/, 'RDS Option 3 shape is required');
  requirePattern(option3Source, /resource "aws_s3_bucket_versioning" "shops"[\s\S]*status\s*=\s*"Enabled"/, 'S3 versioning is required');
  requirePattern(option3Source, /AES256/, 'AWS-managed encryption is required');
  requirePattern(option3Source, /quarantine\/\*\/source/, 'quarantine namespace policy is required');
  requirePattern(option3Source, /artifacts\/sha256\/\*/, 'digest artifact namespace policy is required');
  requirePattern(option3Source, /evidence\/\*/, 'evidence namespace policy is required');
  requirePattern(option3Source, /resource "aws_iam_role" "web_task"/, 'separate web task role is required');
  requirePattern(option3Source, /resource "aws_iam_role" "scanner_task"/, 'separate scanner task role is required');
  rejectPattern(option3Source, /aws_kms_key/, 'customer-managed KMS keys are outside scope');
  rejectPattern(option3Source, /route53|cloudflare|netlify/i, 'DNS or competing deploy mechanisms are outside scope');
  requirePattern(variableSource, /var\.aws_region == "eu-north-1"/, 'region must fail closed outside eu-north-1');
  requirePattern(variableSource, /@sha256:\[a-f0-9\]\{64\}/, 'container images must be immutable digests');
  requirePattern(bootstrapSource, /repo:brainAI-bot\/agentfolio:environment:\$\{var\.github_environment\}/, 'OIDC subject must name the exact repository environment');
  requirePattern(bootstrapSource, /token\.actions\.githubusercontent\.com:aud"\s*=\s*"sts\.amazonaws\.com"/, 'OIDC audience must be exact');
  rejectPattern(bootstrapSource, /ref:refs\/heads\/main/, 'a branch subject would bypass the protected environment');
  requirePattern(bootstrapSource, /aws:RequestTag\/Project"\s*=\s*"Makings"/, 'deployer creates only Makings-tagged resources');
  requirePattern(bootstrapSource, /DenyBootstrapAndExcludedServices/, 'deployer must be denied bootstrap mutation');

  return violations;
}

test('checked-in infrastructure satisfies the fail-closed contract', () => {
  assert.deepEqual(contractViolations(), []);
  assert.match(readme, /\*\*Planning total\*\* \| \*\*\$127\.30\/month\*\*/);
  assert.match(readme, /does \*\*not\*\* authorize or perform an AWS plan against a live account, apply, resource creation/i);
});

test('failure case: scanner ingress is rejected', () => {
  const insecure = option3.replace(
    'description = "Scanner tasks have no inbound rules"',
    'description = "Scanner tasks have no inbound rules"\n  ingress { from_port = 0 to_port = 0 protocol = "-1" cidr_blocks = ["0.0.0.0/0"] }',
  );
  const targetedCheck = /resource "aws_security_group" "scanner"[\s\S]*?\n\}/.exec(insecure)?.[0] ?? '';
  assert.match(targetedCheck, /ingress/);
  assert.ok(contractViolations({ option3Source: insecure }).includes('scanner security group must have no ingress block'));
});

test('failure case: wildcard OIDC branch trust is rejected', () => {
  const insecure = bootstrap.replace(
    'repo:brainAI-bot/agentfolio:environment:${var.github_environment}',
    'repo:brainAI-bot/agentfolio:ref:refs/heads/main',
  );
  assert.ok(contractViolations({ bootstrapSource: insecure }).includes('a branch subject would bypass the protected environment'));
  assert.ok(contractViolations({ bootstrapSource: insecure }).includes('OIDC subject must name the exact repository environment'));
});

test('failure case: public database is rejected', () => {
  const insecure = option3.replace('publicly_accessible   = false', 'publicly_accessible   = true');
  assert.ok(contractViolations({ option3Source: insecure }).includes('RDS Option 3 shape is required'));
});

test('failure case: mutable image reference is rejected', () => {
  const insecure = variables.replaceAll('@sha256:[a-f0-9]{64}$', ':latest$');
  assert.ok(contractViolations({ variableSource: insecure }).includes('container images must be immutable digests'));
});
