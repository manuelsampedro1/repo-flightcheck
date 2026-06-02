import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const AGENT_FILES = ["AGENTS.md", "CLAUDE.md", "GEMINI.md", "CURSOR.md"];
const README_FILES = ["README.md", "readme.md"];
const LICENSE_FILES = ["LICENSE", "LICENSE.md", "LICENSE.txt"];
const ENV_FILES = [".env", ".env.local", ".env.production", ".env.development", ".env.test"];
const DOCUMENTED_COMMAND_FILES = [...README_FILES, ...AGENT_FILES];

const SCORE_WEIGHTS = {
  critical: 18,
  high: 12,
  medium: 8,
  low: 4
};
const DEFAULT_AGENT_CONTRACT_THRESHOLD = 75;
const REQUIRED_AGENT_SEVERITIES = new Set(["critical", "high"]);

function exists(repoPath, relativePath) {
  return fs.existsSync(path.join(repoPath, relativePath));
}

function isDirectory(repoPath, relativePath) {
  try {
    return fs.statSync(path.join(repoPath, relativePath)).isDirectory();
  } catch {
    return false;
  }
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

function commandExecutable(command) {
  return normalizeCommand(command).split(" ")[0] ?? null;
}

function commandExistsOnPath(command) {
  const pathValue = process.env.PATH ?? "";
  if (!pathValue) {
    return false;
  }

  const extensions = process.platform === "win32"
    ? (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD")
      .split(";")
      .filter(Boolean)
      .map((extension) => extension.toLowerCase())
    : [""];
  const names = process.platform === "win32" && !path.extname(command)
    ? extensions.map((extension) => `${command}${extension}`)
    : [command];

  return pathValue.split(path.delimiter).some((directory) => {
    if (!directory) {
      return false;
    }
    return names.some((name) => isExecutable(path.join(directory, name)));
  });
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
  if (exists(repoPath, "action.yml") || exists(repoPath, "action.yaml")) return "github-action";
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

function hasPythonUnittestTests(repoPath) {
  const testsDir = path.join(repoPath, "tests");
  if (!fs.existsSync(testsDir)) {
    return false;
  }

  const queue = [testsDir];
  while (queue.length > 0) {
    const current = queue.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(fullPath);
        continue;
      }
      if (entry.isFile() && /^test.*\.py$/.test(entry.name)) {
        return true;
      }
    }
  }

  return false;
}

function extractDocumentedCommands(text) {
  const commands = new Set();
  const patterns = [
    /\bnpm\s+(?:run\s+)?[a-zA-Z0-9:_-]+\b/g,
    /\bnode\s+--test\b/g,
    /\bmake\s+[a-zA-Z0-9._-]+\b/g,
    /\b(?:python3?|python)\s+-m\s+unittest(?:\s+discover(?:\s+-s\s+[^\s`'",.;:!?]+)?(?:\s+-p\s+[^\s`'",.;:!?]+)?)?/g,
    /\b(?:python3?|python)\s+-m\s+pytest\b/g,
    /\bpytest\b/g,
    /\bcargo\s+(?:test|build|clippy)\b/g,
    /\bswift\s+(?:test|build)\b/g
  ];

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      commands.add(normalizeCommand(match[0]));
    }
  }

  return Array.from(commands);
}

function executableCommandStatus(repoPath, command, stack, packageJson, makeTargets) {
  const normalized = normalizeCommand(command);
  const scripts = packageJson?.scripts ?? {};

  if (normalized === "npm test") {
    return Boolean(scripts.test);
  }

  const npmRunMatch = normalized.match(/^npm run ([a-zA-Z0-9:_-]+)$/);
  if (npmRunMatch) {
    return Boolean(scripts[npmRunMatch[1]]);
  }

  const npmShortMatch = normalized.match(/^npm ([a-zA-Z0-9:_-]+)$/);
  if (npmShortMatch && npmShortMatch[1] !== "run") {
    if (["ci", "install", "pack", "publish"].includes(npmShortMatch[1])) {
      return Boolean(packageJson);
    }
    return Boolean(scripts[npmShortMatch[1]]);
  }

  const makeMatch = normalized.match(/^make ([a-zA-Z0-9._-]+)$/);
  if (makeMatch) {
    return makeTargets.includes(makeMatch[1]);
  }

  if (normalized === "node --test") {
    return stack === "node" || exists(repoPath, "package.json");
  }

  if (["pytest", "python -m pytest", "python3 -m pytest"].includes(normalized)) {
    return stack === "python" || exists(repoPath, "pyproject.toml") || exists(repoPath, "requirements.txt");
  }

  const unittestMatch = normalized.match(/^(?:python3?|python) -m unittest(?: discover(?: -s ([^\s]+))?(?: -p ([^\s]+))?)?$/);
  if (unittestMatch) {
    const startDir = unittestMatch[1];
    if (startDir) {
      return isDirectory(repoPath, startDir);
    }
    return stack === "python" || exists(repoPath, "pyproject.toml") || exists(repoPath, "requirements.txt");
  }

  if (["cargo test", "cargo build", "cargo clippy"].includes(normalized)) {
    return exists(repoPath, "Cargo.toml");
  }

  if (["swift test", "swift build"].includes(normalized)) {
    return exists(repoPath, "Package.swift");
  }

  return true;
}

function toolAvailabilityStatus(commands, options = {}) {
  const usageByTool = new Map();

  for (const command of Object.values(commands).filter(Boolean)) {
    const executable = commandExecutable(command);
    if (!executable) {
      continue;
    }
    const usages = usageByTool.get(executable) ?? [];
    usages.push(command);
    usageByTool.set(executable, usages);
  }

  const tools = Array.from(usageByTool.keys()).sort();
  if (tools.length === 0) {
    return {
      ok: true,
      message: "No detected verification/build/lint commands require local tools.",
      evidence: []
    };
  }

  const commandExists = options.commandExists ?? commandExistsOnPath;
  const missing = [];
  const evidence = [];

  for (const tool of tools) {
    let available = false;
    try {
      available = Boolean(commandExists(tool));
    } catch {
      available = false;
    }

    if (available) {
      evidence.push(`${tool}: available`);
      continue;
    }

    missing.push(tool);
    evidence.push(`${tool}: needed by ${usageByTool.get(tool).join(", ")}`);
  }

  if (missing.length > 0) {
    return {
      ok: false,
      message: `Missing local tool${missing.length === 1 ? "" : "s"} for detected commands: ${missing.join(", ")}.`,
      evidence
    };
  }

  return {
    ok: true,
    message: `Required local tool${tools.length === 1 ? "" : "s"} available: ${tools.join(", ")}.`,
    evidence
  };
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
  const hasUnittestTests = hasPythonUnittestTests(repoPath);

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
    if (!commands.test && hasUnittestTests) commands.test = "python -m unittest discover -s tests";
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
  if (commands.test.startsWith("python -m unittest")) {
    candidates.push(commands.test.replace(/^python /, "python3 "));
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

function documentCommandFiles(repoPath) {
  const seen = new Set();
  const files = [];

  for (const file of DOCUMENTED_COMMAND_FILES) {
    if (!exists(repoPath, file)) {
      continue;
    }
    const fullPath = path.join(repoPath, file);
    let realPath;
    try {
      realPath = fs.realpathSync(fullPath);
    } catch {
      realPath = fullPath;
    }
    const key = realPath.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    files.push(file);
  }

  return files;
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

function packageBinEntries(packageJson) {
  if (!packageJson?.bin) {
    return [];
  }

  if (typeof packageJson.bin === "string") {
    return [[packageJson.name ?? "package", packageJson.bin]];
  }

  if (typeof packageJson.bin === "object") {
    return Object.entries(packageJson.bin)
      .filter(([, target]) => typeof target === "string" && target.trim())
      .map(([name, target]) => [name, target]);
  }

  return [];
}

function isExecutable(filePath) {
  try {
    return Boolean(fs.statSync(filePath).mode & 0o111);
  } catch {
    return false;
  }
}

function nodeCliEntrypointStatus(repoPath, packageJson) {
  const entries = packageBinEntries(packageJson);
  if (entries.length === 0) {
    return {
      ok: true,
      message: "No package.json bin entrypoints declared.",
      evidence: []
    };
  }

  const problems = [];
  const evidence = [];

  for (const [name, target] of entries) {
    const relativeTarget = target.replace(/^\.?\//, "");
    const fullPath = path.join(repoPath, relativeTarget);

    if (!fs.existsSync(fullPath)) {
      problems.push(`${name}: missing ${target}`);
      continue;
    }

    const firstLine = readText(repoPath, relativeTarget).split("\n")[0] ?? "";
    if (!/^#!.*\bnode\b/.test(firstLine)) {
      problems.push(`${name}: ${target} is missing a Node shebang`);
      continue;
    }

    if (!isExecutable(fullPath)) {
      problems.push(`${name}: ${target} is not executable`);
      continue;
    }

    evidence.push(`${name}: ${target}`);
  }

  if (problems.length > 0) {
    return {
      ok: false,
      message: `Found ${problems.length} Node CLI entrypoint issue${problems.length === 1 ? "" : "s"}.`,
      evidence: problems
    };
  }

  return {
    ok: true,
    message: `Validated ${entries.length} Node CLI entrypoint${entries.length === 1 ? "" : "s"}.`,
    evidence
  };
}

function parsePyprojectScripts(pyproject) {
  const scripts = [];
  let inProjectScripts = false;

  for (const rawLine of pyproject.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const heading = line.match(/^\[([^\]]+)\]$/);
    if (heading) {
      inProjectScripts = heading[1].trim() === "project.scripts";
      continue;
    }

    if (!inProjectScripts) {
      continue;
    }

    const match = line.match(/^([A-Za-z0-9_.-]+)\s*=\s*["']([^"']+)["']/);
    if (match) {
      scripts.push([match[1], match[2].trim()]);
    }
  }

  return scripts;
}

function pythonModuleCandidates(moduleName) {
  const modulePath = moduleName.replace(/\./g, "/");
  return [
    `${modulePath}.py`,
    path.join(modulePath, "__init__.py"),
    path.join("src", `${modulePath}.py`),
    path.join("src", modulePath, "__init__.py")
  ];
}

function pythonFunctionExists(repoPath, relativePath, functionName) {
  const content = readText(repoPath, relativePath);
  const escaped = functionName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^\\s*def\\s+${escaped}\\s*\\(`, "m").test(content);
}

function pythonCliEntrypointStatus(repoPath, pyproject) {
  const entries = parsePyprojectScripts(pyproject);
  if (entries.length === 0) {
    return {
      ok: true,
      message: "No pyproject [project.scripts] entrypoints declared.",
      evidence: []
    };
  }

  const problems = [];
  const evidence = [];

  for (const [name, target] of entries) {
    const [moduleName, callableName, extra] = target.split(":");
    if (!moduleName || !callableName || extra !== undefined) {
      problems.push(`${name}: ${target} should use module:function`);
      continue;
    }

    const candidates = pythonModuleCandidates(moduleName);
    const modulePath = candidates.find((candidate) => exists(repoPath, candidate));
    if (!modulePath) {
      problems.push(`${name}: missing Python module ${candidates[0]} or ${candidates[2]}`);
      continue;
    }

    const functionName = callableName.split(".")[0];
    if (!pythonFunctionExists(repoPath, modulePath, functionName)) {
      problems.push(`${name}: ${modulePath} does not define ${functionName}()`);
      continue;
    }

    evidence.push(`${name}: ${target}`);
  }

  if (problems.length > 0) {
    return {
      ok: false,
      message: `Found ${problems.length} Python CLI entrypoint issue${problems.length === 1 ? "" : "s"}.`,
      evidence: problems
    };
  }

  return {
    ok: true,
    message: `Validated ${entries.length} Python CLI entrypoint${entries.length === 1 ? "" : "s"}.`,
    evidence
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

function documentedCommandStatus(repoPath, stack, packageJson) {
  const makeTargets = parseMakeTargets(repoPath);
  const unresolved = [];
  const documented = [];

  for (const file of documentCommandFiles(repoPath)) {
    const commands = extractDocumentedCommands(readText(repoPath, file));
    for (const command of commands) {
      documented.push(`${file}: ${command}`);
      if (!executableCommandStatus(repoPath, command, stack, packageJson, makeTargets)) {
        unresolved.push(`${file}: ${command}`);
      }
    }
  }

  if (unresolved.length > 0) {
    return {
      ok: false,
      message: `Found ${unresolved.length} documented command${unresolved.length === 1 ? "" : "s"} that do not match repo scripts or targets.`,
      evidence: unresolved.slice(0, 8)
    };
  }

  if (documented.length > 0) {
    return {
      ok: true,
      message: `Documented commands match detected repo scripts or targets.`,
      evidence: documented.slice(0, 8)
    };
  }

  return {
    ok: true,
    message: "No README or agent command references found to validate.",
    evidence: []
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

function contractCheckItem(check) {
  return {
    id: check.id,
    title: check.title,
    severity: check.severity,
    status: check.status,
    message: check.message,
    fix: check.fix,
    evidence: check.evidence
  };
}

export function buildAgentContract(report, threshold = DEFAULT_AGENT_CONTRACT_THRESHOLD) {
  const unresolved = report.checks.filter((check) => check.status !== "pass");
  const requiredBeforeAgent = unresolved
    .filter((check) => REQUIRED_AGENT_SEVERITIES.has(check.severity))
    .map(contractCheckItem);
  const recommendedBeforeAgent = unresolved
    .filter((check) => !REQUIRED_AGENT_SEVERITIES.has(check.severity))
    .map(contractCheckItem);

  return {
    schemaVersion: "repo-flightcheck.agent-contract.v1",
    repoPath: report.repoPath,
    stack: report.stack,
    ready: report.summary.score >= threshold
      && report.summary.criticalFailures === 0
      && requiredBeforeAgent.length === 0,
    threshold,
    score: report.summary.score,
    criticalFailures: report.summary.criticalFailures,
    commands: report.commands,
    requiredBeforeAgent,
    recommendedBeforeAgent,
    nextFixes: report.nextFixes
  };
}

export function scanRepo(repoPath, options = {}) {
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
  const documentedCommands = documentedCommandStatus(absolutePath, stack, packageJson);
  const toolAvailability = toolAvailabilityStatus(commands, options);
  const nodeCliEntrypoint = nodeCliEntrypointStatus(absolutePath, packageJson);
  const pythonCliEntrypoint = pythonCliEntrypointStatus(absolutePath, readText(absolutePath, "pyproject.toml"));

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
      id: "tool-availability",
      title: "Tool availability",
      severity: "medium",
      status: toolAvailability.ok ? "pass" : "warn",
      message: toolAvailability.message,
      fix: "Install the missing local tool or document an equivalent command that works in this environment.",
      evidence: toolAvailability.evidence
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
      id: "documented-commands",
      title: "Documented commands",
      severity: "medium",
      status: documentedCommands.ok ? "pass" : "warn",
      message: documentedCommands.message,
      fix: "Update README or AGENTS.md commands so every documented command maps to an actual script, Make target, or stack command.",
      evidence: documentedCommands.evidence
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
    }),
    makeCheck({
      id: "node-cli-entrypoint",
      title: "Node CLI entrypoint",
      severity: "medium",
      status: nodeCliEntrypoint.ok ? "pass" : "warn",
      message: nodeCliEntrypoint.message,
      fix: "Make every package.json bin target point to an executable Node script with a shebang.",
      evidence: nodeCliEntrypoint.evidence
    }),
    makeCheck({
      id: "python-cli-entrypoint",
      title: "Python CLI entrypoint",
      severity: "medium",
      status: pythonCliEntrypoint.ok ? "pass" : "warn",
      message: pythonCliEntrypoint.message,
      fix: "Make every pyproject [project.scripts] entrypoint point to an importable module and defined function.",
      evidence: pythonCliEntrypoint.evidence
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

  const report = {
    repoPath: absolutePath,
    stack,
    commands,
    summary,
    checks,
    nextFixes
  };

  return {
    ...report,
    agentContract: buildAgentContract(report)
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
