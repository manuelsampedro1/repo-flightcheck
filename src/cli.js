import { buildAgentContract, renderReport, scanRepo } from "./scan.js";

function printHelp() {
  console.log(`repo-flightcheck

Usage:
  repo-flightcheck [path] [--json|--contract] [--strict] [--check-remote] [--threshold <score>]

Options:
  --json            Print JSON instead of the text report.
  --contract        Print a compact agent-readiness contract as JSON.
  --strict          Exit with code 1 if the score is below threshold or any critical check fails.
  --check-remote    Validate that origin is reachable and local HEAD is published.
  --threshold <n>   Minimum score required by strict mode and contract readiness. Default: 75.
  --help            Show this help text.
`);
}

function parseArgs(argv) {
  let repoPath = ".";
  let json = false;
  let contract = false;
  let strict = false;
  let checkRemote = false;
  let threshold = 75;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "--contract") {
      contract = true;
      continue;
    }
    if (arg === "--strict") {
      strict = true;
      continue;
    }
    if (arg === "--check-remote") {
      checkRemote = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
    if (arg === "--threshold") {
      const next = argv[index + 1];
      if (!next || Number.isNaN(Number(next))) {
        throw new Error("--threshold requires a numeric value.");
      }
      threshold = Number(next);
      index += 1;
      continue;
    }
    if (arg.startsWith("--")) {
      throw new Error(`Unknown flag: ${arg}`);
    }
    repoPath = arg;
  }

  if (json && contract) {
    throw new Error("--json and --contract cannot be combined.");
  }

  return { repoPath, json, contract, strict, checkRemote, threshold };
}

export async function main(argv) {
  const options = parseArgs(argv);
  const report = scanRepo(options.repoPath, { checkRemote: options.checkRemote });

  if (options.contract) {
    console.log(JSON.stringify(buildAgentContract(report, options.threshold), null, 2));
  } else if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    process.stdout.write(renderReport(report));
  }

  if (options.strict) {
    const failed = report.summary.score < options.threshold || report.summary.criticalFailures > 0;
    if (failed) {
      process.exit(1);
    }
  }
}
