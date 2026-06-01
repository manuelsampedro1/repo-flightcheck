import { renderReport, scanRepo } from "./scan.js";

function printHelp() {
  console.log(`repo-flightcheck

Usage:
  repo-flightcheck [path] [--json] [--strict] [--threshold <score>]

Options:
  --json            Print JSON instead of the text report.
  --strict          Exit with code 1 if the score is below threshold or any critical check fails.
  --threshold <n>   Minimum score required in strict mode. Default: 75.
  --help            Show this help text.
`);
}

function parseArgs(argv) {
  let repoPath = ".";
  let json = false;
  let strict = false;
  let threshold = 75;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "--strict") {
      strict = true;
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

  return { repoPath, json, strict, threshold };
}

export async function main(argv) {
  const options = parseArgs(argv);
  const report = scanRepo(options.repoPath);

  if (options.json) {
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
