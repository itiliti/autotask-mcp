# Agents — autotask-mcp

## Purpose

This document describes the conventions, structure, and workflow for adding and maintaining agents in this repository.

## Where to put agent code

- Place agent implementations under a dedicated directory (recommended: `agents/`).
- Each agent should live in its own subdirectory, e.g. `agents/<agent-id>/`.

## Agent directory structure (recommended)

- agents/<agent-id>/
  - src/ — source code
  - tests/ — unit/integration tests
  - manifest.yml — agent metadata (see template below)
  - README.md — agent-specific docs

## Agent manifest (manifest.yml) — minimal template

Use a YAML manifest for metadata and wiring:

```yaml
# example manifest.yml
id: example-agent
name: Example Agent
version: 0.1.0
description: Short description of what the agent does
entryPoint: src/index.ts # relative path to main module
runtime: node16 # runtime / target environment
owner: team-name@example.com
tests:
  command: npm run test
build:
  command: npm run build
```

## Conventions

- Use semantic versioning for agent version fields.
- Keep manifests small and focused on metadata required for deployment and testing.
- Add a README.md per agent with usage, inputs, outputs and example calls.

## Development & build

- Use `npm run build` to compile and verify changes locally (default).
- Only use `npm run build:link` when explicitly requested to link the package globally.
- Run tests with the repository test command (e.g. `npm test` or `npm run test`).

## Testing

- Unit tests must live next to the agent (`agents/<agent-id>/tests/`) and be runnable via manifest `tests.command`.
- CI should run `npm run build` and agent test suites for changed agents.

## Pull request checklist

- Manifest present and valid
- README updated with usage
- `npm run build` succeeds
- Tests added/updated and passing
- Version bumped if behavior changed

## Troubleshooting

- If build fails: run `npm run build` locally and inspect error output in the terminal.
- If linking is required for external integration tests, coordinate before running `npm run build:link`.

## Contact / Ownership

- Add `owner` in the manifest for a point of contact for questions and reviews.
