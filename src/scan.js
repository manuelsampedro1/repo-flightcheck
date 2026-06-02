import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const AGENT_FILES = ["AGENTS.md", "CLAUDE.md", "GEMINI.md", "CURSOR.md"];
const README_FILES = ["README.md", "readme.md"];
const LICENSE_FILES = ["LICENSE", "LICENSE.md", "LICENSE.txt"];
const ENV_FILES = [".env", ".env.local", ".env.production", ".env.development", ".env.test"];

const SCORE_WEIGHTS = {
  critical: 18,
  high: 12,
  medium: 8,
  low: 4
};

function exists(repoPath, relativePath) {
  return fs.existsSync(path.join(repoPath, relativePath));
}

function readText(repoPath, relativePath) {
  try {
    return fs.readFileSync(path.join(repoPath, relativePath), "utf8");
  } catch {
    return "";
  }
}

function listWorkflowFiles(repoPath) {
  const workflowDir = path.join(repoPath, ".github", "workflows");
  if (!fs.existsSync(workflowDir)) {
    return [];
  }
  return fs
    .readdirSync(workflowDir)
    .filter((entry) => entry.endsWith(".yml") || entry.endsWith(".yaml"))
    .map((entry) => path.join(".github", "workflows", entry));
}

function normalizeCommand(command) {
  return command.trim().replace(/\s+/g, " ");
}

function workflowContainsCommand(repoPath, workflowFiles, commandCandidates) {
  const candidates = commandCandidates.map(normalizeCommand).filter(Boolean);
  const matches = [];

  for (const workflowFile of workflowFiles) {
    const normalizedWorkflow = normalizeCommand(readText(repoPath, workflowFile));
    const matchedCommand = candidates.find((command) => normalizedWorkflow.includes(command));
    if (matchedCommand) {
      matches.push(`${workflowFile}: ${matchedCommand}`);
    }
  }

  return matches;
}

function detectStack(repoPath) {
  if (exists(repoPath, "package.json")) return "node";
  if (exists(repoPath, "pyproject.toml") || exists(repoPath, "requirements.txt")) return "python";
  if (exists(repoPath, "Cargo.toml")) return "rust";
  if (exists(repoPath, "Package.swift") || fs.readdirSync(repoPath).some((name) => name.endsWith(".xcodeproj"))) {
    return "swift";
  }
  return "generic";
}

function parsePackageJson(repoPath) {
  if (!exists(repoPath, "package.json")) {
    return null;
  }
  try {
    return JSON.parse(readText(repoPath, "package.json"));
  } catch {
    return null;
  }
}

function parseMakeTargets(repoPath) {
  if (!exists(repoPath, "Makefile")) {
    return [];
  }
  const content = readText(repoPath, "Makefile");
  return Array.from(content.matchAll(/^([a-zA-Z0-9._-]+):/gm), ([, target]) => target);
}

function hasReadmeGuidance(readmeText) {
  const normalized = readmeText.toLowerCase();
  return {
    hasInstall: /(install|setup|getting started|quickstart)/.test(normalized),
    hasUsage: /(usage|run|example|examples|quickstart)/.test(normalized)
  };
}

function detectCommands(repoPath, stack, packageJson) {
  const scripts = packageJson?.scripts ?? {};
  const makeTargets = parseMakeTargets(repoPath);
  const pyproject = readText(repoPath, "pyproject.toml");

  const commands = {
    test: null,
    build: null,
    lint: null
  };

  if (stack === "node") {
    if (scripts.test) commands.test = `npm test`;
    if (scripts.build) commands.build = `npm run build`;
    if (scripts.lint) commands.lint = `npm run lint`;
    if (!commands.test && scripts.check) commands.test = `npm run check`;
  }

  if (!commands.test && makeTargets.includes("test")) commands.test = "make test";
  if (!commands.build && makeTargets.includes("build")) commands.build = "make build";
  if (!commands.lint && makeTargets.includes("lint")) commands.lint = "make lint";

  if (stack === "python") {
    if (!commands.test && /(pytest|tool\.pytest|tool\.coverage)/.test(pyproject)) commands.test = "pytest";
    if (!commands.lint && /(ruff|flake8|pylint)/.test(pyproject)) commands.lint = "python -m ruff check .";
    if (!commands.build && /(build-system|\[project\])/.test(pyproject)) commands.build = "python -m build";
  }

  if (stack === "rust") {
    commands.test ||= "cargo test";
    commands.build ||= "cargo build";
    commands.lint ||= "cargo clippy";
  }

  if (stack === "swift") {
    commands.test ||= "swift test";
    commands.build ||= "swift build";
  }

  return commands;
}

function verificationCommandCandidates(commands, packageJson) {
  if (!commands.test) {
    return [];
  }

  const candidates = [commands.test];
  const testScript = packageJson?.scripts?.test;

  if (commands.test === "npm test") {
    candidates.push("npm run test");
  }
  if (testScript) {
    candidates.push(testScript);
  }

  return Array.from(new Set(candidates));
}

function findAgentFile(repoPath) {
  return AGENT_FILES.find((entry) => exists(repoPath, entry)) ?? null;
}

function agentGuidanceStatus(agentText) {
  const normalized = agentText.toLowerCase();
  const hasGoal = /(goal|purpose|product|objective|mission|scope)/.test(normalized);
  const hasConstraints = /(constraint|principle|rule|do not|avoid|prefer|must|quality)/.test(normalized);
  const hasVerification = /(verify|verification|test|check|build|lint|ci|quality)/.test(normalized);

  return {
    ok: hasGoal && hasConstraints && hasVerification,
    missing: [
      hasGoal ? null : "goal or product scope",
      hasConstraints ? null : "constraints or repo rules",
      hasVerification ? null : "verification or quality commands"
    ].filter(Boolean)
  };
}

function findReadme(repoPath) {
  return README_FILES.find((entry) => exists(repoPath, entry)) ?? null;
}

function findLicense(repoPath) {
  return LICENSE_FILES.find((entry) => exists(repoPath, entry)) ?? null;
}

function findExampleMaterial(repoPath) {
  const candidates = ["examples", "example", "demo", "fixtures", "samples"];
  return candidates.find((entry) => exists(repoPath, entry)) ?? null;
}

function trackedEnvFiles(repoPath) {
  return ENV_FILES.filter((entry) => exists(repoPath, entry));
}

function envIsIgnored(repoPath) {
  if (!exists(repoPath, ".gitignore")) return false;
  const content = readText(repoPath, ".gitignore");
  return /^\.env(\..*)?$/m.test(content) || /^\.env$/m.test(content);
}

function workingTreeStatus(repoPath) {
  try {
    execFileSync("git", ["-C", repoPath, "rev-parse", "--is-inside-work-tree"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
  } catch {
    return {
      ok: false,
      message: "Path is not a Git working tree, so pre-existing changes cannot be checked.",
      evidence: []
    };
  }

  let output;
  try {
    output = execFileSync("git", ["-C", repoPath, "status", "--porcelain", "--untracked-files=all"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
  } catch {
    return {
      ok: false,
      message: "Git working tree exists, but status could not be read.",
      evidence: []
    };
  }
  const entries = output.split("\n").filter(Boolean);

  if (entries.length === 0) {
    return {
      ok: true,
      message: "Git working tree is clean.",
      evidence: ["git status --porcelain"]
    };
  }

  const preview = entries.slice(0, 8);
  const omitted = entries.length - preview.length;
  return {
    ok: false,
    message: omitted > 0
      ? `Working tree has ${entries.length} changed paths; showing first ${preview.length}.`
      : `Working tree has ${entries.length} changed path${entries.length === 1 ? "" : "s"}.`,
    evidence: omitted > 0 ? [...preview, `... ${omitted} more`] : preview
  };
}

function packageMetadataStatus(packageJson) {
  if (!packageJson) {
    return {
      ok: true,
      message: "No package.json present, so package metadata is not required."
    };
  }

  const missing = [];
  if (!packageJson.name) missing.push("name");
  if (!packageJson.description) missing.push("description");
  if (!packageJson.license) missing.push("license");

  if (missing.length === 0) {
    return {
      ok: true,
      message: "package.json includes basic package metadata."
    };
  }

  return {
    ok: false,
    message: `package.json is missing: ${missing.join(", ")}.`
  };
}

function ciVerificationStatus(repoPath, workflowFiles, commandCandidates) {
  if (workflowFiles.length === 0) {
    return {
      ok: false,
      message: "No CI workflow is available to run the verification command.",
      evidence: []
    };
  }

  if (commandCandidates.length === 0) {
    return {
      ok: false,
      message: "No verification command is available to compare against CI workflows.",
      evidence: workflowFiles
    };
  }

  const matches = workflowContainsCommand(repoPath, workflowFiles, commandCandidates);
  if (matches.length > 0) {
    return {
      ok: true,
      message: "CI workflow appears to run the local verification command.",
      evidence: matches
    };
  }

  return {
    ok: false,
    message: "CI workflow exists but does not appear to run the detected verification command.",
    evidence: workflowFiles
  };
}

function makeCheck({ id, title, severity, status, message, fix, evidence }) {
  const passed = status === "pass";
  const warned = status === "warn";
  const weight = SCORE_WEIGHTS[severity];
  return {
    id,
    title,
    severity,
    status,
    message,
    fix,
    evidence,
    pointsEarned: passed ? weight : warned ? Math.round(weight / 2) : 0,
    pointsPossible: weight
  };
}

export function scanRepo(repoPath) {
  const absolutePath = path.resolve(repoPath);
  const stats = fs.existsSync(absolutePath) ? fs.statSync(absolutePath) : null;

  if (!stats || !stats.isDirectory()) {
    throw new Error(`Path does not exist or is not a directory: ${absolutePath}`);
  }

  const stack = detectStack(absolutePath);
  const packageJson = parsePackageJson(absolutePath);
  const commands = detectCommands(absolutePath, stack, packageJson);
  const readmeFile = findReadme(absolutePath);
  const readmeText = readmeFile ? readText(absolutePath, readmeFile) : "";
  const readmeGuidance = hasReadmeGuidance(readmeText);
  const agentFile = findAgentFile(absolutePath);
  const agentText = agentFile ? readText(absolutePath, agentFile) : "";
  const agentGuidance = agentGuidanceStatus(agentText);
  const licenseFile = findLicense(absolutePath);
  const workflowFiles = listWorkflowFiles(absolutePath);
  const exampleMaterial = findExampleMaterial(absolutePath);
  const envFiles = trackedEnvFiles(absolutePath);
  const envIgnored = envIsIgnored(absolutePath);
  const workingTree = workingTreeStatus(absolutePath);
  const pkgStatus = packageMetadataStatus(packageJson);
  const verificationCandidates = verificationCommandCandidates(commands, packageJson);
  const ciVerification = ciVerificationStatus(absolutePath, workflowFiles, verificationCandidates);

  const checks = [
    makeCheck({
      id: "readme-guidance",
      title: "README guidance",
      severity: "critical",
      status: readmeFile && readmeGuidance.hasInstall && readmeGuidance.hasUsage ? "pass" : readmeFile ? "warn" : "fail",
      message: readmeFile
        ? readmeGuidance.hasInstall && readmeGuidance.hasUsage
          ? "README exists and includes installation and usage guidance."
          : "README exists but is missing clear installation or usage guidance."
        : "README is missing.",
      fix: "Add a README with setup, usage, and a short explanation of why the project matters.",
      evidence: readmeFile ? [readmeFile] : []
    }),
    makeCheck({
      id: "license",
      title: "License",
      severity: "medium",
      status: licenseFile ? "pass" : "warn",
      message: licenseFile ? `Found ${licenseFile}.` : "No license file found.",
      fix: "Add an explicit open-source or internal-use license so contributors know the rules.",
      evidence: licenseFile ? [licenseFile] : []
    }),
    makeCheck({
      id: "gitignore",
      title: "Gitignore",
      severity: "medium",
      status: exists(absolutePath, ".gitignore") ? "pass" : "warn",
      message: exists(absolutePath, ".gitignore") ? "Found .gitignore." : "No .gitignore found.",
      fix: "Add a .gitignore tuned to the stack so build output and secrets do not drift into commits.",
      evidence: exists(absolutePath, ".gitignore") ? [".gitignore"] : []
    }),
    makeCheck({
      id: "agent-instructions",
      title: "Agent instructions",
      severity: "high",
      status: agentFile ? agentGuidance.ok ? "pass" : "warn" : "warn",
      message: agentFile
        ? agentGuidance.ok
          ? `${agentFile} includes goal, constraints, and verification guidance.`
          : `${agentFile} exists but is missing ${agentGuidance.missing.join(", ")}.`
        : "No AGENTS.md or equivalent agent guidance found.",
      fix: "Add AGENTS.md with repo goals, constraints, verification commands, and commit expectations.",
      evidence: agentFile ? [agentFile] : []
    }),
    makeCheck({
      id: "verification-command",
      title: "Verification command",
      severity: "critical",
      status: commands.test ? "pass" : "fail",
      message: commands.test ? `Found a test command: ${commands.test}.` : "No reliable verification command detected.",
      fix: "Expose one obvious test or check command that an agent can run before finishing work.",
      evidence: commands.test ? [commands.test] : []
    }),
    makeCheck({
      id: "build-command",
      title: "Build command",
      severity: "high",
      status: commands.build ? "pass" : stack === "generic" ? "warn" : "warn",
      message: commands.build ? `Found a build command: ${commands.build}.` : `No build command detected for this ${stack} repo.`,
      fix: "Add a build command if the project compiles, bundles, or packages code before shipping.",
      evidence: commands.build ? [commands.build] : []
    }),
    makeCheck({
      id: "lint-command",
      title: "Lint command",
      severity: "medium",
      status: commands.lint ? "pass" : "warn",
      message: commands.lint ? `Found a lint command: ${commands.lint}.` : `No lint command detected for this ${stack} repo.`,
      fix: "Add a lint or static-analysis command so style and obvious mistakes are caught before review.",
      evidence: commands.lint ? [commands.lint] : []
    }),
    makeCheck({
      id: "ci-workflow",
      title: "CI workflow",
      severity: "high",
      status: workflowFiles.length > 0 ? "pass" : "warn",
      message: workflowFiles.length > 0
        ? `Found ${workflowFiles.length} workflow file${workflowFiles.length === 1 ? "" : "s"} under .github/workflows.`
        : "No GitHub Actions workflow detected.",
      fix: "Add a small CI workflow that runs the same verification command you expect contributors to use locally.",
      evidence: workflowFiles
    }),
    makeCheck({
      id: "ci-verification",
      title: "CI verification",
      severity: "medium",
      status: ciVerification.ok ? "pass" : "warn",
      message: ciVerification.message,
      fix: "Make CI run the same verification command that agents and contributors are expected to run locally.",
      evidence: ciVerification.evidence
    }),
    makeCheck({
      id: "working-tree",
      title: "Working tree",
      severity: "high",
      status: workingTree.ok ? "pass" : "warn",
      message: workingTree.message,
      fix: "Start agent work from a clean Git state, or explicitly document the existing staged, unstaged, and untracked changes.",
      evidence: workingTree.evidence
    }),
    makeCheck({
      id: "secret-hygiene",
      title: "Secret hygiene",
      severity: "critical",
      status: envFiles.length > 0 ? "fail" : envIgnored ? "pass" : "warn",
      message: envFiles.length > 0
        ? `Found tracked env files: ${envFiles.join(", ")}.`
        : envIgnored
          ? "No tracked env files found and .env is ignored."
          : "No tracked env files found, but .env is not explicitly ignored.",
      fix: "Ignore .env files and keep secrets out of version control. If anything sensitive was committed, rotate it.",
      evidence: envFiles.length > 0 ? envFiles : envIgnored ? [".gitignore"] : []
    }),
    makeCheck({
      id: "examples-or-fixtures",
      title: "Examples or fixtures",
      severity: "low",
      status: exampleMaterial ? "pass" : "warn",
      message: exampleMaterial ? `Found ${exampleMaterial}/.` : "No examples, demo, or fixtures folder found.",
      fix: "Add examples, fixtures, or demo material so the project feels real and easier to verify.",
      evidence: exampleMaterial ? [`${exampleMaterial}/`] : []
    }),
    makeCheck({
      id: "package-metadata",
      title: "Package metadata",
      severity: "low",
      status: pkgStatus.ok ? "pass" : "warn",
      message: pkgStatus.message,
      fix: "Fill in package metadata so the repo is easier to publish or consume.",
      evidence: packageJson ? ["package.json"] : []
    })
  ];

  const pointsEarned = checks.reduce((sum, check) => sum + check.pointsEarned, 0);
  const pointsPossible = checks.reduce((sum, check) => sum + check.pointsPossible, 0);
  const score = Math.round((pointsEarned / pointsPossible) * 100);

  const summary = {
    score,
    pointsEarned,
    pointsPossible,
    passed: checks.filter((check) => check.status === "pass").length,
    warnings: checks.filter((check) => check.status === "warn").length,
    failed: checks.filter((check) => check.status === "fail").length,
    criticalFailures: checks.filter((check) => check.status === "fail" && check.severity === "critical").length
  };

  const nextFixes = checks
    .filter((check) => check.status !== "pass")
    .sort((left, right) => SCORE_WEIGHTS[right.severity] - SCORE_WEIGHTS[left.severity])
    .slice(0, 3)
    .map((check) => `${check.title}: ${check.fix}`);

  return {
    repoPath: absolutePath,
    stack,
    commands,
    summary,
    checks,
    nextFixes
  };
}

export function renderReport(report) {
  const iconByStatus = {
    pass: "PASS",
    warn: "WARN",
    fail: "FAIL"
  };

  const lines = [
    `repo-flightcheck :: ${report.repoPath}`,
    `Score: ${report.summary.score}/100`,
    `Stack: ${report.stack}`,
    ""
  ];

  for (const check of report.checks) {
    const title = check.title.padEnd(28, " ");
    lines.push(`${iconByStatus[check.status]}  ${title} ${check.message}`);
  }

  if (report.nextFixes.length > 0) {
    lines.push("", "Next fixes:");
    report.nextFixes.forEach((fix, index) => {
      lines.push(`${index + 1}. ${fix}`);
    });
  }

  return `${lines.join("\n")}\n`;
}
