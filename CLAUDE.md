# Working agreements for this fork

`wpivis/rvtdev` is an exploration fork of reVISit (upstream: `revisit-studies/study`).
Work here is for demos and creative exploration. It is generally **not** headed for the
upstream core repo, so the usual open-a-PR-and-merge reflex does not apply.

See `AGENTS.md` for the reVISit codebase itself — stack, study config format, libraries,
conventions. This file covers how we work in this fork.

## Always end a push with the links

When you push a branch, finish your reply with the links, every time. Do not make me go
hunting for them:

- **Branch on GitHub** — `https://github.com/wpivis/rvtdev/tree/<branch>`
- **Netlify branch deploy** — `https://<branch-slug>--rvtdev.netlify.app`, where
  `<branch-slug>` is the branch name with `/` replaced by `-`
  (`claude/gamepad-demo` → `claude-gamepad-demo`). Deep-link to the specific study when
  there is one, e.g. `/demo-gamepad`.

`*.netlify.app` is blocked by the sandbox network policy (the proxy answers 403 to
CONNECT), so a deploy link is always constructed from the branch name and never one you
loaded. Say so. Say it plainly too if a branch has no deploy because it is missing
`netlify.toml`, and flag that a brand-new branch only builds if the Netlify site deploys
all branches rather than a named list.

## Demo branches, not pull requests

Explorations live on long-lived `claude/*` branches that are never merged and get no PR.
When you finish work on one:

1. Make sure the branch has a `netlify.toml` at its root, or there will be no working
   branch deploy. `main` does not carry one — it is added per demo branch, and it
   overrides the `/study/` base path in `.env` that would otherwise 404 every asset.
2. Add or update a `DEMO_BRANCH.md` at the branch root saying what the branch explores,
   what it was branched from and why, how to try it, and how to refresh it from upstream.
3. Post the links as above.
4. Do not open a pull request against this fork. If a PR prompt appears, it can be
   dismissed. Work headed for the reVISit core project is the exception — see
   **Upstreaming to reVISit** below.

Branch a new exploration from `main` unless it genuinely builds on another demo branch —
branching from an unrelated demo branch drags its whole diff along.

## Upstreaming to reVISit

Occasionally something from a demo branch is wanted in the core project — Jack asking for
it is the usual trigger. That work does not go through this fork at all.

- **Base the PR on `dev`, never `main`.** Only dependabot PRs target upstream `main`.
- **Push the branch to `revisit-studies/study` itself.** Lane is an org owner with push
  access there, and every recent PR comes from a branch on the upstream repo rather than a
  fork. Name it `lane/<topic>`, matching the existing `jay/...` and `al/...` branches. Do
  not open a cross-fork PR, and do not leave a duplicate branch behind on this fork.
- **Rebuild on `dev`; do not merge.** `main` trails `dev` by hundreds of commits, so
  merging a demo branch conflicts on `package.json` and both lockfiles and drags
  dependency churn into the diff. Cut a fresh branch from `upstream/dev` in a worktree and
  replay the changes onto it.
- **Leave this fork's own files behind.** `CLAUDE.md`, `DEMO_BRANCH.md` and `netlify.toml`
  are ours. Grep the result for `netlify`, `wpivis` and `rvtdev` before pushing.
- **Regenerate schemas** with `yarn generate-schemas` whenever `src/parser/types.ts`
  changes, and commit the result.
- **Open an issue first** and reference it with `Closes #N`. The PR body then runs
  `## Why`, `## Architecture`, `## User-facing impact`, `## Validation`, opening with the
  preview link `https://revisit.dev/study/PR<number>/<study>` — their CI publishes one per
  PR and posts its own comment with the link. Validation names the commands run and their
  actual results, including pre-existing warnings.
- **Upstream CI** runs lint, unit tests, and Playwright sharded across four Chromium
  runners on a PR to `dev`. Upstream has dropped WebKit entirely and uses port 8090, so do
  not add WebKit skips or assume 8080.
- **`gh pr edit` can fail silently** on that repo, reporting success while a Projects
  (classic) GraphQL error prevents the edit. Always verify the body afterwards, and patch
  with `jq -Rs '{body: .}' < file | gh api -X PATCH repos/revisit-studies/study/pulls/<n>
  --input -` if it did not take.

## Refreshing from upstream

`main` here tracks upstream, so demo branches refresh with
`git fetch origin main && git merge origin/main`. Merge, never rebase: these branches are
pushed, and a merge keeps any existing checkout valid.
