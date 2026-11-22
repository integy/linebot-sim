// Headless check: can a simple P/PD line follower complete every level?
// node test/levels.mjs
import { LEVELS, makeTrack } from "../js/track.js";
import { Robot } from "../js/robot.js";

const dt = 1 / 240;

function drive(level, { base = 60, kp = 16, kd = 0, maxTime = 240 } = {}) {
  const track = makeTrack(level);
  const r = new Robot(track);
  let t = 0, progress = 0, lastS = 0, lastErr = 0, off = 0, maxOff = 0;
  let hint = r.hint;

  while (t < maxTime) {
    const err = r.lineError() ?? lastErr;
    const d = (err - lastErr) / dt;
    lastErr = err;
    const steer = kp * err + kd * d;
    r.setMotors(base + steer, base - steer);
    r.step(dt);
    t += dt;

    const n = track.nearest(r.x, r.y, hint);
    hint = n.idx;
    if (n.dist < Math.max(track.width * 2.2, 0.09)) {
      let ds = n.s - lastS;
      if (ds > track.length / 2) ds -= track.length;
      if (ds < -track.length / 2) ds += track.length;
      progress += ds;
    }
    lastS = n.s;
    maxOff = Math.max(maxOff, n.dist);
    if (n.dist > 0.12) { off += dt; if (off > 2.5) return { ok: false, why: "off-track", t, progress, maxOff }; }
    else off = 0;

    if (progress >= track.length * level.laps) return { ok: true, t, maxOff, len: track.length };
  }
  return { ok: false, why: "timeout", t, progress, maxOff };
}

const results = [];
for (const lv of LEVELS) {
  const r = drive(lv, { base: 55, kp: 20, kd: 0.004 });
  results.push({ id: lv.id, name: lv.name, ...r, len: r.len ?? null });
  console.log(
    String(lv.id).padStart(2), lv.name.padEnd(8, " "),
    r.ok ? "OK  " : "FAIL",
    r.ok ? `t=${r.t.toFixed(1)}s` : `${r.why} t=${r.t.toFixed(1)} progress=${(r.progress).toFixed(2)} maxOff=${r.maxOff.toFixed(3)}`,
    "len=" + (r.len ? r.len.toFixed(2) : "-")
  );
}
const bad = results.filter((r) => !r.ok);
console.log("\npass", results.length - bad.length, "/", results.length);
process.exit(bad.length ? 1 : 0);