import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const output = execFileSync("git", [
  "-c",
  `safe.directory=${root.replaceAll("\\", "/")}`,
  "ls-files",
  "--cached",
  "--others",
  "--exclude-standard",
  "-z",
], { cwd: root });

const files = [...new Set(output.toString("utf8").split("\0").filter(Boolean))];
const rules = [
  { name: "OpenAI API key", pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}/g },
  { name: "GitHub token", pattern: /\b(?:ghp|gho|ghu|ghs|github_pat)_[A-Za-z0-9_]{20,}/g },
  { name: "PostgreSQL credential URL", pattern: /postgres(?:ql)?:\/\/[^:\s/]+:[^@\s/]+@/gi },
  { name: "Private key", pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g },
];

const findings = [];
for (const file of files) {
  const absolute = resolve(root, file);
  if (statSync(absolute).size > 2_000_000) continue;
  const buffer = readFileSync(absolute);
  if (buffer.includes(0)) continue;
  const content = buffer.toString("utf8");
  for (const rule of rules) {
    rule.pattern.lastIndex = 0;
    if (rule.pattern.test(content)) findings.push({ file, rule: rule.name });
  }
}

if (findings.length > 0) {
  console.error(JSON.stringify({ status: "failed", findings }, null, 2));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({ status: "passed", scannedFiles: files.length }));
}
