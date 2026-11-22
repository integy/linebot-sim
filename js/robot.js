// Differential-drive robot with 7 infrared reflectance sensors.
// Plane coordinates: x (right), y (forward-ish) — mapped to three.js (x, z).

export const ROBOT = {
  wheelBase: 0.092,      // metres between wheel centres
  maxSpeed: 0.42,        // m/s at 100 % command
  sensorSpacing: 0.0115, // 11.5 mm between sensors
  sensorReach: 0.048,    // how far ahead of the axle the bar sits
  barWidth: 0.088,
};

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export class Robot {
  constructor(track) {
    this.track = track;
    this.count = 7;
    this.reset();
  }

  reset(s = 0) {
    const p = this.track.pointAtS(s);
    this.x = p.x;
    this.y = p.y;
    this.th = Math.atan2(p.ty, p.tx);
    this.vL = 0;
    this.vR = 0;
    this.cmdL = 0;
    this.cmdR = 0;
    this.odo = 0;
    this.hint = this.track.pts.findIndex((q) => q.s >= s);
    this.sensorsData = [];
    this.readSensors();
  }

  setMotors(l, r) {
    this.cmdL = clamp(l, -100, 100);
    this.cmdR = clamp(r, -100, 100);
  }

  stop() { this.setMotors(0, 0); }

  /** integrate kinematics; dt in seconds, sub-stepped internally */
  step(dt) {
    const target = dt;
    let left = target;
    while (left > 1e-6) {
      const h = Math.min(0.002, left);
      left -= h;
      // simple first-order lag so motor response is not instant
      const k = 1 - Math.exp(-h / 0.055);
      this.vL += (this.cmdL / 100 * ROBOT.maxSpeed - this.vL) * k;
      this.vR += (this.cmdR / 100 * ROBOT.maxSpeed - this.vR) * k;
      const v = (this.vL + this.vR) / 2;
      const w = (this.vR - this.vL) / ROBOT.wheelBase;
      this.th += w * h;
      this.x += Math.cos(this.th) * v * h;
      this.y += Math.sin(this.th) * v * h;
      this.odo += Math.abs(v) * h;
    }
    this.readSensors();
  }

  sensorPose(i) {
    // index 0 is the robot's LEFT sensor: offset along the left normal
    const off = ((this.count - 1) / 2 - i) * ROBOT.sensorSpacing;
    const cos = Math.cos(this.th), sin = Math.sin(this.th);
    // local (forward, left) → world
    const fx = this.x + cos * ROBOT.sensorReach - sin * off;
    const fy = this.y + sin * ROBOT.sensorReach + cos * off;
    return { x: fx, y: fy, off };
  }

  readSensors() {
    const half = this.track.width / 2;
    const inner = half * 0.55;
    const outer = half * 1.35;
    const out = [];
    for (let i = 0; i < this.count; i++) {
      const p = this.sensorPose(i);
      const n = this.track.nearest(p.x, p.y, this.hint);
      this.hint = n.idx;
      const d = n.dist;
      const v = 100 * clamp((outer - d) / Math.max(outer - inner, 1e-6), 0, 1);
      out.push({ i, x: p.x, y: p.y, dist: d, analog: v, on: v > 45 });
    }
    this.sensorsData = out;
    return out;
  }

  get analog() { return this.sensorsData.map((s) => Math.round(s.analog)); }
  get digital() { return this.sensorsData.map((s) => (s.on ? 1 : 0)); }

  /** weighted line position: -3 (line far left) … 0 (centred) … +3 */
  lineError() {
    let sum = 0, wsum = 0;
    for (const s of this.sensorsData) {
      const w = Math.pow(s.analog / 100, 1.4);
      const pos = s.i - 3;          // -3 (left) … +3 (right)
      sum += pos * w;
      wsum += w;
    }
    return wsum < 1e-3 ? null : sum / wsum;
  }

  /** true when the bar sees nothing (line lost) */
  lost() {
    return this.sensorsData.every((s) => s.analog < 18);
  }
}