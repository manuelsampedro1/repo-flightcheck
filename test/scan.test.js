import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { scanRepo } from "../src/scan.js";

function writeRepo(files) {
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), "repo-flightcheck-"));

  for (const [relativePath, contents] of Object.entries(files)) {
    const fullPath = path.join(repoPath, relativePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, contents);
  }

  return repoPath;
}

test("scores a healthy node repo well", () => {
  const repoPath = writeRepo({
    "README.md": "# Demo\n\n## Quickstart\nInstall it.\n\n## Usage\nRun it.\n",
    "LICENSE": "MIT",
    ".gitignore": ".env\nnode_modules\n",
    "AGENTS.md": "# Agent Guide\n\n## Goal\nShip the demo.\n\n## Rules\nPrefer small changes.\n\n## Verification\nRun npm test.\n",
    "package.json": JSON.stringify({
      name: "demo",
      description: "demo repo",
      license: "MIT",
      scripts: {
        test: "node --test",
        build: "node build.js",
        lint: "node lint.js"
      }
    }),
    ".github/workflows/ci.yml": "name: ci\n",
    "fixtures/sample.txt": "hello"
  });

  const report = scanRepo(repoPath);

  assert.equal(report.stack, "node");
  assert.equal(report.summary.criticalFailures, 0);
  assert.ok(report.summary.score >= 90);
  assert.equal(report.checks.find((check) => check.id === "verification-command")?.status, "pass");
});

test("warns when agent instructions are too thin", () => {
  const repoPath = writeRepo({
    "README.md": "# Demo\n\n## Quickstart\nInstall it.\n\n## Usage\nRun it.\n",
    "LICENSE": "MIT",
    ".gitignore": ".env\n",
    "AGENTS.md": "# Rules\n",
    "package.json": JSON.stringify({
      name: "demo",
      description: "demo repo",
      license: "MIT",
      scripts: {
        test: "node --test",
        build: "node build.js",
        lint: "node lint.js"
      }
    }),
    ".github/workflows/ci.yml": "name: ci\n",
    "fixtures/sample.txt": "hello"
  });

  const report = scanRepo(repoPath);
  const check = report.checks.find((item) => item.id === "agent-instructions");

  assert.equal(check?.status, "warn");
  assert.match(check?.message ?? "", /missing/);
});

test("fails tracked env files and missing verification commands", () => {
  const repoPath = writeRepo({
    "README.md": "# Broken\n\ntext only\n",
    ".env": "API_KEY=shh\n",
    ".gitignore": "node_modules\n"
  });

  const report = scanRepo(repoPath);

  assert.equal(report.checks.find((check) => check.id === "secret-hygiene")?.status, "fail");
  assert.equal(report.checks.find((check) => check.id === "verification-command")?.status, "fail");
  assert.ok(report.summary.score < 60);
});
