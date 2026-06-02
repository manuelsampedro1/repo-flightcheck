import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

import { buildAgentContract, scanRepo } from "../src/scan.js";

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

test("builds an agent contract for a ready repo", () => {
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
  initCleanGitRepo(repoPath);

  const report = scanRepo(repoPath);
  const contract = buildAgentContract(report, 80);

  assert.equal(report.agentContract.schemaVersion, "repo-flightcheck.agent-contract.v1");
  assert.equal(contract.ready, true);
  assert.equal(contract.threshold, 80);
  assert.equal(contract.commands.test, "npm test");
  assert.equal(contract.requiredBeforeAgent.length, 0);
  assert.equal(contract.recommendedBeforeAgent.length, 0);
});

test("agent contract separates blockers from recommendations", () => {
  const repoPath = writeRepo({
    "README.md": "# Broken\n\ntext only\n",
    ".env": "API_KEY=shh\n"
  });

  const contract = buildAgentContract(scanRepo(repoPath), 80);

  assert.equal(contract.ready, false);
  assert.ok(contract.requiredBeforeAgent.some((item) => item.id === "verification-command"));
  assert.ok(contract.requiredBeforeAgent.some((item) => item.id === "secret-hygiene"));
  assert.ok(contract.recommendedBeforeAgent.some((item) => item.id === "license"));
});

test("prints a compact contract from the CLI", () => {
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
  initCleanGitRepo(repoPath);

  const output = execFileSync(
    process.execPath,
    [path.resolve("bin/repo-flightcheck.js"), repoPath, "--contract", "--threshold", "90"],
    { encoding: "utf8" }
  );
  const contract = JSON.parse(output);

  assert.equal(contract.schemaVersion, "repo-flightcheck.agent-contract.v1");
  assert.equal(contract.ready, true);
  assert.equal(contract.threshold, 90);
  assert.equal(contract.commands.test, "npm test");
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

test("passes executable Node CLI bin entrypoints", () => {
  const repoPath = writeRepo({
    "README.md": "# Demo\n\n## Quickstart\nRun npm install.\n\n## Usage\nRun demo.\n",
    "LICENSE": "MIT",
    ".gitignore": ".env\n",
    "AGENTS.md": "# Agent Guide\n\n## Goal\nShip the demo.\n\n## Rules\nPrefer small changes.\n\n## Verification\nRun npm test.\n",
    "package.json": JSON.stringify({
      name: "demo",
      description: "demo repo",
      license: "MIT",
      bin: {
        demo: "bin/demo.js"
      },
      scripts: {
        test: "node --test"
      }
    }),
    "bin/demo.js": "#!/usr/bin/env node\nconsole.log('demo');\n",
    ".github/workflows/ci.yml": "name: ci\njobs:\n  test:\n    steps:\n      - run: node --test\n",
    "fixtures/sample.txt": "hello"
  });
  fs.chmodSync(path.join(repoPath, "bin", "demo.js"), 0o755);

  const report = scanRepo(repoPath);
  const check = report.checks.find((item) => item.id === "node-cli-entrypoint");

  assert.equal(check?.status, "pass");
  assert.equal(check?.message, "Validated 1 Node CLI entrypoint.");
  assert.deepEqual(check?.evidence, ["demo: bin/demo.js"]);
});

test("warns when Node CLI bin entrypoints are missing or not invokable", () => {
  const repoPath = writeRepo({
    "README.md": "# Demo\n\n## Quickstart\nRun npm install.\n\n## Usage\nRun demo.\n",
    "LICENSE": "MIT",
    ".gitignore": ".env\n",
    "AGENTS.md": "# Agent Guide\n\n## Goal\nShip the demo.\n\n## Rules\nPrefer small changes.\n\n## Verification\nRun npm test.\n",
    "package.json": JSON.stringify({
      name: "demo",
      description: "demo repo",
      license: "MIT",
      bin: {
        demo: "bin/demo.js",
        missing: "bin/missing.js",
        noShebang: "bin/no-shebang.js"
      },
      scripts: {
        test: "node --test"
      }
    }),
    "bin/demo.js": "#!/usr/bin/env node\nconsole.log('demo');\n",
    "bin/no-shebang.js": "console.log('demo');\n",
    ".github/workflows/ci.yml": "name: ci\njobs:\n  test:\n    steps:\n      - run: node --test\n",
    "fixtures/sample.txt": "hello"
  });

  const report = scanRepo(repoPath);
  const check = report.checks.find((item) => item.id === "node-cli-entrypoint");

  assert.equal(check?.status, "warn");
  assert.match(check?.message ?? "", /3 Node CLI entrypoint issues/);
  assert.ok(check?.evidence.includes("demo: bin/demo.js is not executable"));
  assert.ok(check?.evidence.includes("missing: missing bin/missing.js"));
  assert.ok(check?.evidence.includes("noShebang: bin/no-shebang.js is missing a Node shebang"));
});

test("detects standard-library Python unittest suites", () => {
  const repoPath = writeRepo({
    "README.md": "# Demo\n\n## Quickstart\nInstall with pip.\n\n## Usage\nRun python -m unittest discover -s tests.\n",
    "LICENSE": "MIT",
    ".gitignore": ".env\n",
    "AGENTS.md": "# Agent Guide\n\n## Goal\nShip the demo.\n\n## Rules\nPrefer small changes.\n\n## Verification\nRun python3 -m unittest discover -s tests.\n",
    "pyproject.toml": "[build-system]\nrequires = [\"setuptools>=77\"]\n\n[project]\nname = \"demo\"\nversion = \"0.1.0\"\n",
    ".github/workflows/ci.yml": "name: ci\njobs:\n  test:\n    steps:\n      - run: python3 -m unittest discover -s tests\n",
    "tests/test_cli.py": "import unittest\n\nclass DemoTest(unittest.TestCase):\n    def test_demo(self):\n        self.assertTrue(True)\n"
  });

  const report = scanRepo(repoPath);

  assert.equal(report.stack, "python");
  assert.equal(report.commands.test, "python -m unittest discover -s tests");
  assert.equal(report.checks.find((item) => item.id === "verification-command")?.status, "pass");
  assert.equal(report.checks.find((item) => item.id === "ci-verification")?.status, "pass");
  assert.equal(report.checks.find((item) => item.id === "documented-commands")?.status, "pass");
});

test("passes valid Python pyproject script entrypoints", () => {
  const repoPath = writeRepo({
    "README.md": "# Demo\n\n## Quickstart\nInstall with pip.\n\n## Usage\nRun demo.\n",
    "LICENSE": "MIT",
    ".gitignore": ".env\n",
    "AGENTS.md": "# Agent Guide\n\n## Goal\nShip the demo.\n\n## Rules\nPrefer small changes.\n\n## Verification\nRun python3 -m unittest discover -s tests.\n",
    "pyproject.toml": [
      "[build-system]",
      "requires = [\"setuptools>=77\"]",
      "",
      "[project]",
      "name = \"demo\"",
      "version = \"0.1.0\"",
      "",
      "[project.scripts]",
      "demo = \"demo.cli:main\"",
      "demo-admin = \"demo.admin:run\""
    ].join("\n"),
    "src/demo/cli.py": "def main():\n    return 0\n",
    "src/demo/admin.py": "def run():\n    return 0\n",
    ".github/workflows/ci.yml": "name: ci\njobs:\n  test:\n    steps:\n      - run: python3 -m unittest discover -s tests\n",
    "tests/test_cli.py": "import unittest\n\nclass DemoTest(unittest.TestCase):\n    def test_demo(self):\n        self.assertTrue(True)\n"
  });

  const report = scanRepo(repoPath);
  const check = report.checks.find((item) => item.id === "python-cli-entrypoint");

  assert.equal(check?.status, "pass");
  assert.equal(check?.message, "Validated 2 Python CLI entrypoints.");
  assert.deepEqual(check?.evidence, ["demo: demo.cli:main", "demo-admin: demo.admin:run"]);
});

test("warns when Python pyproject script entrypoints are not importable", () => {
  const repoPath = writeRepo({
    "README.md": "# Demo\n\n## Quickstart\nInstall with pip.\n\n## Usage\nRun demo.\n",
    "LICENSE": "MIT",
    ".gitignore": ".env\n",
    "AGENTS.md": "# Agent Guide\n\n## Goal\nShip the demo.\n\n## Rules\nPrefer small changes.\n\n## Verification\nRun python3 -m unittest discover -s tests.\n",
    "pyproject.toml": [
      "[project]",
      "name = \"demo\"",
      "version = \"0.1.0\"",
      "",
      "[project.scripts]",
      "demo = \"demo.cli:main\"",
      "missing = \"demo.missing:main\"",
      "bad = \"not-a-callable\""
    ].join("\n"),
    "demo/cli.py": "def other():\n    return 0\n",
    "tests/test_cli.py": "import unittest\n\nclass DemoTest(unittest.TestCase):\n    def test_demo(self):\n        self.assertTrue(True)\n"
  });

  const report = scanRepo(repoPath);
  const check = report.checks.find((item) => item.id === "python-cli-entrypoint");

  assert.equal(check?.status, "warn");
  assert.match(check?.message ?? "", /3 Python CLI entrypoint issues/);
  assert.ok(check?.evidence.includes("demo: demo/cli.py does not define main()"));
  assert.ok(check?.evidence.includes("missing: missing Python module demo/missing.py or src/demo/missing.py"));
  assert.ok(check?.evidence.includes("bad: not-a-callable should use module:function"));
});

test("detects dependency-light GitHub Action repos with Make verification", () => {
  const repoPath = writeRepo({
    "README.md": "# Deploy Gate\n\n## Quickstart\nNo package install is required.\n\n## Usage\nRun make test, make build, and make lint before release.\n",
    "LICENSE": "MIT",
    ".gitignore": ".env\n",
    "AGENTS.md": "# Agent Guide\n\n## Purpose\nMaintain a composite action.\n\n## Constraints\nPreserve fail-closed behavior.\n\n## Verification\nRun make test.\n",
    "Makefile": "test:\n\tpython3 scripts/validate_action.py\n\nbuild:\n\tpython3 scripts/validate_docs.py\n\nlint:\n\tpython3 -m py_compile scripts/validate_action.py scripts/validate_docs.py\n",
    "action.yml": "name: Deploy Gate\nruns:\n  using: composite\n  steps:\n    - shell: bash\n      run: echo ok\n",
    ".github/workflows/ci.yml": "name: ci\njobs:\n  verify:\n    steps:\n      - run: make test\n      - run: make build\n      - run: make lint\n",
    "examples/workflow.yml": "name: Deploy Gate\n",
    "scripts/validate_action.py": "print('ok')\n",
    "scripts/validate_docs.py": "print('ok')\n"
  });

  const report = scanRepo(repoPath);

  assert.equal(report.stack, "github-action");
  assert.equal(report.commands.test, "make test");
  assert.equal(report.commands.build, "make build");
  assert.equal(report.commands.lint, "make lint");
  assert.equal(report.checks.find((item) => item.id === "verification-command")?.status, "pass");
  assert.equal(report.checks.find((item) => item.id === "ci-verification")?.status, "pass");
  assert.equal(report.checks.find((item) => item.id === "documented-commands")?.status, "pass");
});

test("warns when documented unittest commands point at a missing start directory", () => {
  const repoPath = writeRepo({
    "README.md": "# Demo\n\n## Quickstart\nInstall with pip.\n\n## Usage\nRun python3 -m unittest discover -s missing.\n",
    "LICENSE": "MIT",
    ".gitignore": ".env\n",
    "pyproject.toml": "[project]\nname = \"demo\"\nversion = \"0.1.0\"\n",
    "tests/test_cli.py": "import unittest\n\nclass DemoTest(unittest.TestCase):\n    def test_demo(self):\n        self.assertTrue(True)\n"
  });

  const report = scanRepo(repoPath);
  const check = report.checks.find((item) => item.id === "documented-commands");

  assert.equal(check?.status, "warn");
  assert.deepEqual(check?.evidence, ["README.md: python3 -m unittest discover -s missing"]);
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
