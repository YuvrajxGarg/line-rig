// Motion capture in the browser with MediaPipe (pose + face). Frames never
// leave the device: the models are downloaded once and run locally.
const VERSION = "1.1.0";
export const MP_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}`;
const POSE_MODEL = "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task";
const FACE_MODEL = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

let loading = null;

export function loadTrackers(onStatus = () => {}) {
  loading ??= (async () => {
    onStatus("Loading the trackers (about 13 MB, once)…");
    const vision = await import(/* webpackIgnore: true */ `${MP_BASE}/vision_bundle.mjs`);
    const files = await vision.FilesetResolver.forVisionTasks(`${MP_BASE}/wasm`);
    const make = async (delegate) => {
      const pose = await vision.PoseLandmarker.createFromOptions(files, {
        baseOptions: { modelAssetPath: POSE_MODEL, delegate },
        runningMode: "VIDEO",
        numPoses: 1,
      });
      const face = await vision.FaceLandmarker.createFromOptions(files, {
        baseOptions: { modelAssetPath: FACE_MODEL, delegate },
        runningMode: "VIDEO",
        numFaces: 1,
        outputFaceBlendshapes: true,
        outputFacialTransformationMatrixes: true,
      });
      return { pose, face, vision };
    };
    try {
      return await make("GPU");
    } catch {
      return await make("CPU");
    }
  })();
  loading.catch(() => (loading = null));
  return loading;
}

/** Run both trackers on the current video frame. */
export function track(trackers, video, ts) {
  const out = { pose: null, face: null, poseImage: null, faceImage: null };
  try {
    const p = trackers.pose.detectForVideo(video, ts);
    if (p.worldLandmarks?.[0]?.length) {
      out.pose = p.worldLandmarks[0];
      out.poseImage = p.landmarks[0];
    }
  } catch (e) {
    out.error = e;
  }
  try {
    const f = trackers.face.detectForVideo(video, ts);
    if (f.faceLandmarks?.[0]) {
      out.face = f;
      out.faceImage = f.faceLandmarks[0];
    }
  } catch (e) {
    out.error = e;
  }
  return out;
}

const POSE_LINKS = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28]];

/** Draw the source video with its tracked points (the little preview). */
export function drawPreview(ctx, video, res, w, h, mirror, accent) {
  ctx.save();
  ctx.clearRect(0, 0, w, h);
  if (mirror) {
    ctx.translate(w, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(video, 0, 0, w, h);
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.fillRect(0, 0, w, h);
  if (res?.poseImage) {
    ctx.strokeStyle = accent;
    ctx.lineWidth = 2;
    const L = res.poseImage;
    for (const [a, b] of POSE_LINKS) {
      if ((L[a].visibility ?? 1) < 0.4 || (L[b].visibility ?? 1) < 0.4) continue;
      ctx.beginPath();
      ctx.moveTo(L[a].x * w, L[a].y * h);
      ctx.lineTo(L[b].x * w, L[b].y * h);
      ctx.stroke();
    }
  }
  if (res?.faceImage) {
    ctx.fillStyle = "#ffffff";
    const F = res.faceImage;
    for (let i = 0; i < F.length; i += 6) ctx.fillRect(F[i].x * w - 0.75, F[i].y * h - 0.75, 1.5, 1.5);
  }
  ctx.restore();
}
