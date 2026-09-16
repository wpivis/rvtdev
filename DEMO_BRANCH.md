# claude/gamepad-demo

Game controller input for reVISit: a `useGamepad` polling hook, gamepad entries in
`windowEvents`, provenance nodes colored by the button that produced them, and a
target-acquisition demo study (`demo-gamepad`) with screen recording enabled.

Branched from `main`, **not** from `claude/webcam-demo`. Screen recording is already
on `main`; webcam recording is not needed here, and branching from the webcam branch
would have dragged 400+ unrelated files along.

## This branch is not a pull request

It is a demo branch: long-lived, never merged, and deliberately has no PR. It exists
to be tried out via its Netlify branch deploy. If your editor offers to open a pull
request for it, dismiss the prompt.

## Trying it out

Open the branch deploy and pick the **Gamepad Input with Provenance** study.

You need a game controller attached. Each trial starts with "press any button" —
browsers hide gamepads from a page until it receives gamepad input, so that step is
a permanent requirement, not a bug. The study also asks to record your screen, so the
analysis view can replay the reticle moving rather than only the moments you pressed.

## Pulling in newer reVISit

`main` in this fork tracks upstream `revisit-studies/study`, so refresh from there:

```
git fetch origin main
git merge origin/main
```

To pull from upstream directly instead (e.g. an unmerged upstream branch):

```
git fetch https://github.com/revisit-studies/study dev
git merge FETCH_HEAD
```

Merge rather than rebase — the branch is pushed and shared, and a merge keeps any
existing checkout valid.
