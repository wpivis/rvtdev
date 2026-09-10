# claude/webcam-demo

This branch tracks Jack Wilburn's upstream webcam recording feature
([revisit-studies/study#1159](https://github.com/revisit-studies/study/pull/1159),
branch `webcam-recording`, not yet merged into `dev`), for trying the
feature out via the `claude/webcam-demo` Netlify branch deploy.

It includes his built-in example study at `public/library-webcam-recording`,
already registered in `public/global.json`.

To pull in his latest commits later:

```
git fetch https://github.com/revisit-studies/study webcam-recording
git merge FETCH_HEAD
```
