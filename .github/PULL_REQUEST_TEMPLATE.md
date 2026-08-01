## What this changes

<!-- One or two sentences. Link the issue if there is one. -->

## Why

<!-- The problem it solves. For a new tool: the repeated manual task it replaces. -->

## How it was verified

<!--
Paste a real call and its response. Tool changes can't be proven by unit tests
alone — a smoke test against a live recipe, table, or job is the evidence that counts.
Redact ids and record data as needed.
-->

```

```

## Checklist

- [ ] `pnpm typecheck`, `pnpm lint`, and `pnpm build` pass
- [ ] Conventional commit messages (`feat(workato): ...`)
- [ ] Tool schemas in `packages/shared/src/tools.ts` describe prerequisites, response shape, and gotchas
- [ ] Responses are slimmed, and secret-shaped keys are stripped on every path
- [ ] Writes verify after a timeout rather than retrying; destructive behaviour is gated behind an explicit flag
- [ ] Newly reverse-engineered endpoints are recorded in `docs/design/specs/`
- [ ] Documentation updated (`README.md`, `docs/TOOLS.md`, `CHANGELOG.md`) if behaviour changed
