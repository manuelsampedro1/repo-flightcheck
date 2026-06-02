import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

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

function git(repoPath, args) {
  execFileSync("git", ["-C", repoPath, ...args], { stdio: "ignore" });
}

function initCleanGitRepo(repoPath) {
  git(repoPath, ["init", "-q"]);
  git(repoPath, ["add", "."]);
  execFileSync(
    "git",
    [
      "-C",
      repoPath,
      "-c",
      "user.name=Repo Flightcheck Test",
      "-c",
      "user.email=repo-flightcheck@example.com",
      "commit",
      "-m",
      "initial fixture"
    ],
    { stdio: "ignore" }
  );
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
    ".github/workflows/ci.yml": "name: ci\njobs:\n  test:\n    steps:\n      - run: node --test\n",
    "fixtures/sample.txt": "hello"
  });

  const report = scanRepo(repoPath);

  assert.equal(report.stack, "node");
  assert.equal(report.summary.criticalFailures, 0);
  assert.ok(report.summary.score >= 90);
  assert.equal(report.checks.find((check) => check.id === "verification-command")?.status, "pass");
  assert.equal(report.checks.find((check) => check.id === "ci-verification")?.status, "pass");
  assert.equal(report.checks.find((check) => check.id === "documented-commands")?.status, "pass");
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
    ".github/workflows/ci.yml": "name: ci\njobs:\n  test:\n    steps:\n      - run: node --test\n",
    "fixtures/sample.txt": "hello"
  });

  const report = scanRepo(repoPath);
  const check = report.checks.find((item) => item.id === "agent-instructions");

  assert.equal(check?.status, "warn");
  assert.match(check?.message ?? "", /missing/);
});

test("warns when CI does not run the detected verification command", () => {
  const repoPath = writeRepo({
    "README.md": "# Demo\n\n## Quickstart\nInstall it.\n\n## Usage\nRun it.\n",
    "LICENSE": "MIT",
    ".gitignore": ".env\n",
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
    ".github/workflows/ci.yml": "name: ci\njobs:\n  build:\n    steps:\n      - run: npm run build\n",
    "fixtures/sample.txt": "hello"
  });

  const report = scanRepo(repoPath);
  const check = report.checks.find((item) => item.id === "ci-verification");

  assert.equal(check?.status, "warn");
  assert.match(check?.message ?? "", /does not appear to run/);
  assert.deepEqual(check?.evidence, [".github/workflows/ci.yml"]);
});

test("warns when documented commands do not map to repo scripts", () => {
  const repoPath = writeRepo({
    "README.md": "# Demo\n\n## Quickstart\nInstall it.\n\n## Usage\nRun npm run e2e before shipping.\n",
    "LICENSE": "MIT",
    ".gitignore": ".env\n",
    "AGENTS.md": "# Agent Guide\n\n## Goal\nShip the demo.\n\n## Rules\nPrefer small changes.\n\n## Verification\nRun npm test.\n",
    "package.json": JSON.stringify({
      name: "demo",
      description: "demo repo",
      license: "MIT",
      scripts: {
        test: "node --test"
      }
    }),
    ".github/workflows/ci.yml": "name: ci\njobs:\n  test:\n    steps:\n      - run: npm test\n",
    "fixtures/sample.txt": "hello"
  });

  const report = scanRepo(repoPath);
  const check = report.checks.find((item) => item.id === "documented-commands");

  assert.equal(check?.status, "warn");
  assert.match(check?.message ?? "", /do not match repo scripts/);
  assert.deepEqual(check?.evidence, ["README.md: npm run e2e"]);
});

test("passes when documented commands match package scripts and make targets", () => {
  const repoPath = writeRepo({
    "README.md": "# Demo\n\n## Quickstart\nRun npm install.\n\n## Usage\nRun npm test and make build.\n",
    "LICENSE": "MIT",
    ".gitignore": ".env\n",
    "AGENTS.md": "# Agent Guide\n\n## Goal\nShip the demo.\n\n## Rules\nPrefer small changes.\n\n## Verification\nRun npm run lint.\n",
    "Makefile": "build:\n\t@echo build\n",
    "package.json": JSON.stringify({
      name: "demo",
      description: "demo repo",
      license: "MIT",
      scripts: {
        test: "node --test",
        lint: "node scripts/lint.js"
      }
    }),
    ".github/workflows/ci.yml": "name: ci\njobs:\n  test:\n    steps:\n      - run: npm test\n",
    "fixtures/sample.txt": "hello"
  });

  const report = scanRepo(repoPath);
  const check = report.checks.find((item) => item.id === "documented-commands");

  assert.equal(check?.status, "pass");
  assert.ok(check?.evidence.includes("README.md: npm install"));
  assert.ok(check?.evidence.includes("README.md: npm test"));
  assert.ok(check?.evidence.includes("README.md: make build"));
  assert.ok(check?.evidence.includes("AGENTS.md: npm run lint"));
});

test("passes a clean git working tree", () => {
  const repoPath = writeRepo({
    "README.md": "# Demo\n\n## Quickstart\nInstall it.\n\n## Usage\nRun it.\n",
    "LICENSE": "MIT",
    ".gitignore": ".env\n",
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
    ".github/workflows/ci.yml": "name: ci\njobs:\n  test:\n    steps:\n      - run: node --test\n",
    "fixtures/sample.txt": "hello"
  });
  initCleanGitRepo(repoPath);

  const report = scanRepo(repoPath);
  const check = report.checks.find((item) => item.id === "working-tree");

  assert.equal(check?.status, "pass");
  assert.match(check?.message ?? "", /clean/);
});

test("warns when a git working tree has pre-existing changes", () => {
  const repoPath = writeRepo({
    "README.md": "# Demo\n\n## Quickstart\nInstall it.\n\n## Usage\nRun it.\n",
    "LICENSE": "MIT",
    ".gitignore": ".env\n",
    "AGENTS.md": "# Agent Guide\n\n## Goal\nShip the demo.\n\n## Rules\nPrefer small changes.\n\n## Verification\nRun npm test.\n",
    "package.json": JSON.stringify({
      name: "demo",
      description: "demo repo",
      license: "MIT",
      scripts: {
        test: "node --test"
      }
    })
  });
  initCleanGitRepo(repoPath);
  fs.appendFileSync(path.join(repoPath, "README.md"), "\nUncommitted note.\n");
  fs.writeFileSync(path.join(repoPath, "scratch.txt"), "draft\n");

  const report = scanRepo(repoPath);
  const check = report.checks.find((item) => item.id === "working-tree");

  assert.equal(check?.status, "warn");
  assert.match(check?.message ?? "", /changed paths?/);
  assert.ok(check?.evidence.some((entry) => entry.includes("README.md")));
  assert.ok(check?.evidence.some((entry) => entry.includes("scratch.txt")));
});

test("warns when the target is not a git working tree", () => {
  const repoPath = writeRepo({
    "README.md": "# Demo\n\n## Quickstart\nInstall it.\n\n## Usage\nRun it.\n"
  });

  const report = scanRepo(repoPath);
  const check = report.checks.find((item) => item.id === "working-tree");

  assert.equal(check?.status, "warn");
  assert.match(check?.message ?? "", /not a Git working tree/);
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
