# Line Rig

A Revolio Labs prototype: make a 2D line-art character, get a full rig with every view, then animate it with your cursor, your webcam or a video.

1. **Character**: describe it, draw it on the canvas, or build it part by part (head, hair, eyes, brows, nose, mouth, top, bottom, shoes, extras, proportions, flat colours).
2. **Rig**: a turnaround sheet (front, three-quarter, side, back) or a turntable at any angle, with the bones and head axes shown. Face controls: smile, mouth open, blink, brows.
3. **Animate**: the head and eyes follow the pointer; or run motion capture from the webcam or a video clip (MediaPipe pose + face, in the browser).

Export: stage PNG, turnaround sheet PNG (3200×1600), character file (.json), and Record (R) saves the stage as MP4/WebM.

## Run it

Plain ES modules, no build step.

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

The webcam only works on `localhost` or HTTPS. The trackers (about 13 MB) load once from jsDelivr and Google's model storage; every frame is processed on the device and nothing is uploaded. The character and drawing are kept in `sessionStorage` for the tab only.

### Describe with Claude (optional)

`api/character.js` is a Vercel function that asks Claude (`claude-opus-5-5`, structured JSON output) to pick the parts for a description. It runs when the site is deployed on Vercel (or `vercel dev`) with `ANTHROPIC_API_KEY` set. Without it, the page falls back to a built-in word matcher, so describing still works with no server.

## How it works

- `src/spec.js`: the character is a small JSON spec. Every part is drawn by hand-written code from it.
- `src/head.js`: the head is a radial surface (skull, jaw, chin, brow, nose) sampled in longitude/latitude, turned in 3D and projected. The outline is the true silhouette, so the nose and chin show in profile. Hair, beards and caps are shells over regions of the head; the face is drawn on the surface and hidden where it turns away.
- `src/render.js`: body in 3D (17 joints): torso as elliptical sections, limbs as outlined tubes, clothes per outfit, all depth-sorted, so any view angle works.
- `src/skeleton.js`: rest pose, idle (breathing, blinking), and retargeting MediaPipe pose world landmarks and face blendshapes onto the character's own bone lengths.
- `src/drawing.js`: your strokes are bound to the nearest bones (bones have thickness, two-bone blend at joints). Face strokes go onto a sphere for a 2.5D head turn, and the eyes and mouth are found so blinks and talking still work. "Clean rig from my proportions" measures the drawing and makes a spec with every view.
- `src/capture.js`: MediaPipe loading and the tracking preview.

Debug handle in the console: `window.__lineRig`.
