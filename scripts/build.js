import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const repoRoot = process.cwd();
const requiredFiles = [
  "package.json",
  "README.md",
  "LICENSE",
  "bin/repo-flightcheck.js",
  "src/cli.js",
  "src/scan.js"
];

const jsRoots = ["bin", "src", "scripts", "test"];

function collectJsFiles(relativeDir) {
  const start = path.join(repoRoot, relativeDir);
  if (!fs.existsSync(start)) {
    return [];
  }

  const queue = [start];
  const results = [];

  while (queue.length > 0) {
    const current = queue.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(fullPath);
        continue;
      }
      if (entry.isFile() && entry.name.endsWith(".js")) {
        results.push(fullPath);
      }
    }
  }

  return results.sort();
}

const missing = requiredFiles.filter((relativePath) => !fs.existsSync(path.join(repoRoot, relativePath)));
if (missing.length > 0) {
  console.error(`Missing required release files: ${missing.join(", ")}`);
  process.exit(1);
}

const jsFiles = jsRoots.flatMap(collectJsFiles);
for (const filePath of jsFiles) {
  execFileSync(process.execPath, ["--check", filePath], { stdio: "pipe" });
}

console.log(`Build preflight passed for ${jsFiles.length} JavaScript files.`);
