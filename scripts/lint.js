import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const scanRoots = ["bin", "src", "scripts", "test"];
const problems = [];

function collectFiles(relativeDir) {
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

for (const filePath of scanRoots.flatMap(collectFiles)) {
  const content = fs.readFileSync(filePath, "utf8");
  const lines = content.split("\n");

  lines.forEach((line, index) => {
    if (line.includes("\t")) {
      problems.push(`${path.relative(repoRoot, filePath)}:${index + 1} contains a tab character`);
    }
    if (/[ \t]+$/.test(line)) {
      problems.push(`${path.relative(repoRoot, filePath)}:${index + 1} has trailing whitespace`);
    }
  });

  if (!content.endsWith("\n")) {
    problems.push(`${path.relative(repoRoot, filePath)} is missing a trailing newline`);
  }
}

if (problems.length > 0) {
  console.error("Lint failed:");
  for (const problem of problems) {
    console.error(`- ${problem}`);
  }
  process.exit(1);
}

console.log("Lint passed.");
