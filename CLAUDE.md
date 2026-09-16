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

## Checking a deploy instead of guessing

Netlify is reachable from the **Default** cloud environment, and a `NETLIFY` environment
variable holds an account API token. Use it as a bearer token rather than inferring a
deploy's state from HTTP status codes:

```bash
SITE=f0be812b-2af2-4d4a-9fe2-c0758a7f039a   # rvtdev
curl -sS -H "Authorization: Bearer $NETLIFY" \
  "https://api.netlify.com/api/v1/sites/$SITE/deploys?branch=<branch>&per_page=1"
```

`state: ready` with no `error_message` means it built, and `commit_ref` should be the
commit you pushed. `GET /api/v1/deploys/<id>/files` lists what shipped; those `sha` values
are plain sha1 of file content, so comparing them against a local `VITE_BASE_PATH=/ yarn
build` proves the deploy is byte-identical to what you tested. The site-scoped
`/sites/$SITE/files/<path>` endpoint reads **production**, not a branch deploy, so a 404
there for a demo-branch file is expected and not a problem.

What the token does *not* buy: looking at the rendered page. The site sits behind Netlify
team access control, so an unauthenticated request to any branch deploy answers `401` and
redirects to `app.netlify.com/edge-access`. Whether a study actually looks and behaves
right is still a question for a signed-in human — ask, and say plainly that you could not
see it yourself. A branch that has never built answers `404` instead of `401`, which is
how you tell "no deploy" from "deployed, you are just not signed in".

Say plainly if a branch has no deploy because it is missing `netlify.toml`. Netlify only
auto-builds pushes made *after* a branch is added to the branch-deploy list, so the first
build after adding one needs a real commit to trigger it — an empty commit will not do.

The token is account-wide: it sees every site on the account, not just `rvtdev`. Treat it
as a live credential, never print its value, and never commit it.

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
