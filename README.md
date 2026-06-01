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
- Agent instructions like `AGENTS.md` or `CLAUDE.md`.
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

```text
repo-flightcheck :: /work/repo
Score: 86/100
Stack: node

PASS  README guidance               README.md exists and includes installation and usage guidance.
PASS  Agent instructions            Found AGENTS.md.
PASS  Verification command          Found a test command: npm test
PASS  CI workflow                   Found 1 workflow file under .github/workflows.
WARN  Lint command                  No lint command detected for this Node repo.
FAIL  Secret hygiene                Found tracked env files: .env

Next fixes:
1. Remove tracked env files and rotate any leaked secrets.
2. Add a lint command that agents can run before committing.
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
- It inspects the working tree on disk, not remote GitHub settings like branch protection or repository visibility.
