# AGENTS.md

## Goal
- Keep this repo dependency-light, inspectable, and immediately useful for builders.
- Favor exact filesystem evidence over guesswork.

## Product
- `repo-flightcheck` audits whether a repo is ready for Codex, Claude Code, or human contributors.
- Output must stay concrete: findings, evidence, exact fixes, and machine-readable JSON.

## Engineering
- Node 20+ with no runtime dependencies.
- Prefer small pure functions and `node:test`.
- Do not add frameworks, spinners, or color libraries for superficial polish.

## Quality
- Keep the CLI fast on medium repos.
- Every new rule needs at least one test.
- If a rule can false-positive on common repos, document the tradeoff in the README.
