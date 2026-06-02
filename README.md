# repo-flightcheck

Audit whether a repository is actually ready for Codex, Claude Code, or a human reviewer before you ask an agent to work inside it.

Most repos are missing one of the same things: no agent instructions, no reliable verification command, no CI, weak README, or a tracked `.env`. `repo-flightcheck` turns that into a fast local report with a score, evidence, and exact fixes.

## Why it exists

If you want AI tools to produce better work, the repo has to give them a fighting chance.

This CLI checks the basics that usually decide whether an agent session goes smoothly or turns into guesswork:

- onboarding context,
- verification discipline,
- agent-specific instructions,
- CI presence,
- secret hygiene,
- examples and demo artifacts.

## What it checks

- `README.md` presence and whether it includes install/usage guidance.
- `LICENSE` and `.gitignore`.
- Agent instructions like `AGENTS.md` or `CLAUDE.md`, including goal, constraints, and verification guidance.
- Verification commands from `package.json`, `Makefile`, Python config, Rust, or Swift packages.
- Build and lint coverage where the stack implies they should exist.
- Whether the local environment has the tools required by detected verification, build, and lint commands.
- Python standard-library `unittest` suites under `tests/` when no third-party runner is configured.
- Dependency-light GitHub Action repos that expose `action.yml` or `action.yaml` plus Makefile verification targets.
- GitHub Actions workflows.
- Whether CI appears to run the same verification command expected locally.
- Whether documented README or agent commands map to actual scripts, Make targets, or stack commands.
- Whether Node CLI `package.json` `bin` entrypoints point to executable Node scripts.
- Whether Python CLI `pyproject.toml` `[project.scripts]` entrypoints point to existing modules and defined functions.
- Git working-tree cleanliness before handing work to an agent.
- Whether an `origin` Git remote exists, with optional reachability and published-HEAD validation for public proof.
- Tracked `.env` files and whether `.env` is ignored.
- Example or fixture material that makes the repo feel real.
- A compact agent-readiness contract for tools that need blockers, recommendations, and commands without parsing the full report.

## Quickstart

Clone the repo and run it directly with Node:

```bash
git clone https://github.com/manuelsampedro1/repo-flightcheck.git
cd repo-flightcheck
node bin/repo-flightcheck.js .
```

Scan another repo:

```bash
node /path/to/repo-flightcheck/bin/repo-flightcheck.js /path/to/target-repo
```

Machine-readable output:

```bash
node bin/repo-flightcheck.js . --json
```

Compact readiness contract for agent handoff:

```bash
node bin/repo-flightcheck.js . --contract --threshold 80
```

Strict mode for CI:

```bash
node bin/repo-flightcheck.js . --strict --threshold 80
```

Validate that a configured `origin` remote is reachable and the local `HEAD` is published before claiming a repo is public:

```bash
node bin/repo-flightcheck.js . --check-remote
```

## Example output

From `node bin/repo-flightcheck.js fixtures/sample-repo` with the local fixture path shortened:

```text
repo-flightcheck :: fixtures/sample-repo
Score: 59/100
Stack: generic

WARN  README guidance              README exists but is missing clear installation or usage guidance.
WARN  License                      No license file found.
WARN  Gitignore                    No .gitignore found.
WARN  Agent instructions           No AGENTS.md or equivalent agent guidance found.
FAIL  Verification command         No reliable verification command detected.
WARN  Build command                No build command detected for this generic repo.
WARN  Lint command                 No lint command detected for this generic repo.
PASS  Tool availability            No detected verification/build/lint commands require local tools.
WARN  CI workflow                  No GitHub Actions workflow detected.
WARN  CI verification              No CI workflow is available to run the verification command.
PASS  Documented commands          No README or agent command references found to validate.
PASS  Working tree                 Git working tree is clean.
WARN  Git remote                   No origin remote configured.
WARN  Secret hygiene               No tracked env files found, but .env is not explicitly ignored.
WARN  Examples or fixtures         No examples, demo, or fixtures folder found.
PASS  Package metadata             No package.json present, so package metadata is not required.
PASS  Node CLI entrypoint          No package.json bin entrypoints declared.
PASS  Python CLI entrypoint        No pyproject [project.scripts] entrypoints declared.

Next fixes:
1. README guidance: Add a README with setup, usage, and a short explanation of why the project matters.
2. Verification command: Expose one obvious test or check command that an agent can run before finishing work.
3. Git remote: Configure a reachable origin remote before claiming a repo is published or ready for public proof.
```

## Exit codes

- `0`: scan completed and strict mode passed or was not requested.
- `1`: scan failed, path was invalid, or strict mode failed.

## Why this is useful in practice

- Before opening a repo to Codex or Claude Code.
- Before inviting collaborators to review an AI-assisted codebase.
- As a machine-readable readiness contract before importing work into a run ledger or review packet.
- Inside CI as a guardrail for internal templates.
- As a quick audit for client repos that feel hard to onboard.

## Development

Run tests:

```bash
node --test
```

Run static checks:

```bash
node scripts/lint.js
node scripts/build.js
```

Run the CLI against itself:

```bash
node bin/repo-flightcheck.js . --strict --threshold 80
```

## Limits

- It uses heuristics, not full semantic parsing.
- Some repos intentionally skip build or lint steps; those show up as warnings, not always failures.
- Agent-instruction quality is checked by keyword signals, so unusual but valid guidance may need clearer headings.
- Stack detection is intentionally shallow; JavaScript actions with `package.json` report as Node, while dependency-light composite actions can report as `github-action`.
- Documented command validation is heuristic and only checks common package-manager, Make, Python test-runner, and stack test commands in README or agent guidance.
- Tool availability checks the current `PATH`; CI containers, local shells, and Codex desktop sessions can legitimately differ.
- Remote reachability and published-HEAD checks only run when `--check-remote` is passed because they can require network access or GitHub authentication.
- Node CLI entrypoint validation checks local `package.json` `bin` targets for file presence, a Node shebang, and POSIX executability; Windows-only packaging may need a documented exception.
- Python CLI entrypoint validation checks simple `pyproject.toml` `[project.scripts]` targets shaped as `module:function` in root or `src/` layouts; dynamic TOML, generated modules, or class-based callables may need a documented exception.
- It checks whether `origin` exists locally and, with `--check-remote`, whether Git can reach it and whether local `HEAD` matches the current branch on `origin`; it does not inspect GitHub branch protection or repository visibility settings.
- The working-tree check uses local Git status. A dirty parent repo can affect scans of subdirectories inside that repo.
- The agent-readiness contract is a compact view of the same heuristic checks, not a substitute for review or domain-specific acceptance criteria.
