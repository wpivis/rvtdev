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
- **Netlify branch deploy** — `https://<branch-slug>--<site>.netlify.app`, where
  `<branch-slug>` is the branch name with `/` replaced by `-`
  (`claude/gamepad-demo` → `claude-gamepad-demo`). Deep-link to the specific study when
  there is one, e.g. `/demo-gamepad`.

Say plainly when a link is a prediction you have not loaded rather than one you checked,
and say so if a branch has no deploy because it is missing `netlify.toml`.

## Demo branches, not pull requests

Explorations live on long-lived `claude/*` branches that are never merged and get no PR.
When you finish work on one:

1. Make sure the branch has a `netlify.toml` at its root, or there will be no working
   branch deploy. `main` does not carry one — it is added per demo branch, and it
   overrides the `/study/` base path in `.env` that would otherwise 404 every asset.
2. Add or update a `DEMO_BRANCH.md` at the branch root saying what the branch explores,
   what it was branched from and why, how to try it, and how to refresh it from upstream.
3. Post the links as above.
4. Do not open a pull request. If a PR prompt appears, it can be dismissed.

Branch a new exploration from `main` unless it genuinely builds on another demo branch —
branching from an unrelated demo branch drags its whole diff along.

## Refreshing from upstream

`main` here tracks upstream, so demo branches refresh with
`git fetch origin main && git merge origin/main`. Merge, never rebase: these branches are
pushed, and a merge keeps any existing checkout valid.
