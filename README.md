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
- GitHub Actions workflows.
- Tracked `.env` files and whether `.env` is ignored.
- Example or fixture material that makes the repo feel real.

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

Strict mode for CI:

```bash
node bin/repo-flightcheck.js . --strict --threshold 80
```

## Example output

From `node bin/repo-flightcheck.js fixtures/sample-repo` with the local fixture path shortened:

```text
repo-flightcheck :: fixtures/sample-repo
Score: 44/100
Stack: generic

WARN  README guidance              README exists but is missing clear installation or usage guidance.
WARN  License                      No license file found.
WARN  Gitignore                    No .gitignore found.
WARN  Agent instructions           No AGENTS.md or equivalent agent guidance found.
FAIL  Verification command         No reliable verification command detected.
WARN  Build command                No build command detected for this generic repo.
WARN  Lint command                 No lint command detected for this generic repo.
WARN  CI workflow                  No GitHub Actions workflow detected.
WARN  Secret hygiene               No tracked env files found, but .env is not explicitly ignored.
WARN  Examples or fixtures         No examples, demo, or fixtures folder found.
PASS  Package metadata             No package.json present, so package metadata is not required.

Next fixes:
1. README guidance: Add a README with setup, usage, and a short explanation of why the project matters.
2. Verification command: Expose one obvious test or check command that an agent can run before finishing work.
3. Secret hygiene: Ignore .env files and keep secrets out of version control. If anything sensitive was committed, rotate it.
```

## Exit codes

- `0`: scan completed and strict mode passed or was not requested.
- `1`: scan failed, path was invalid, or strict mode failed.

## Why this is useful in practice

- Before opening a repo to Codex or Claude Code.
- Before inviting collaborators to review an AI-assisted codebase.
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
- It inspects the working tree on disk, not remote GitHub settings like branch protection or repository visibility.
