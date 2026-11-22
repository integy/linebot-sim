import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { LEVELS, makeTrack } from "./track.js";
import { Robot, ROBOT } from "./robot.js";
import { registerBlocks, toolbox, compileWorkspace } from "./blocks.js";

/* ------------------------------------------------------------------ *
 *  scene
 * ------------------------------------------------------------------ */

const canvas = document.getElementById("view");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x070a10);
scene.fog = new THREE.Fog(0x070a10, 6, 16);

const camera = new THREE.PerspectiveCamera(52, 1, 0.01, 60);
camera.position.set(0, 1.1, 1.6);

const hemi = new THREE.HemisphereLight(0x8fa8c8, 0x0a0f18, 0.65);
scene.add(hemi);

const key = new THREE.DirectionalLight(0xdce8ff, 1.5);
key.position.set(2.2, 3.4, 1.6);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.near = 0.5;
key.shadow.camera.far = 12;
key.shadow.camera.left = -3;
key.shadow.camera.right = 3;
key.shadow.camera.top = 3;
key.shadow.camera.bottom = -3;
key.shadow.bias = -0.0009;
scene.add(key);

const rim = new THREE.DirectionalLight(0x38e1ff, 0.55);
rim.position.set(-2.4, 1.4, -2.2);
scene.add(rim);

const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(24, 24),
  new THREE.MeshStandardMaterial({ color: 0x0c111a, roughness: 0.95, metalness: 0.0 })
);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

const grid = new THREE.GridHelper(16, 64, 0x1a2434, 0x121a26);
grid.position.y = 0.0005;
scene.add(grid);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.maxPolarAngle = Math.PI * 0.49;
controls.minDistance = 0.25;
controls.maxDistance = 8;

/* ------------------------------------------------------------------ *
 *  track + robot meshes
 * ------------------------------------------------------------------ */

const trackGroup = new THREE.Group();
scene.add(trackGroup);

let track = null;
let robot = null;
let levelIndex = 0;

// a real line-following course: light mat, black tape — reads instantly in 3D
const bedMat = new THREE.MeshStandardMaterial({
  color: 0xb9c6d8, roughness: 0.95, metalness: 0.0, side: THREE.DoubleSide,
});
const lineMat = new THREE.MeshStandardMaterial({
  color: 0x0a0d13, roughness: 0.85, metalness: 0.0, side: THREE.DoubleSide,
});

function ribbon(t, halfWidth, y) {
  const g = new THREE.BufferGeometry();
  const pos = [];
  const idx = [];
  const n = t.pts.length;
  for (let i = 0; i <= n; i++) {
    const p = t.pts[i % n];
    pos.push(p.x + -p.ty * halfWidth, y, p.y + p.tx * halfWidth);
    pos.push(p.x + p.ty * halfWidth, y, p.y + -p.tx * halfWidth);
    if (i < n) {
      const a = i * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial());
  mesh.receiveShadow = true;
  return { geom: g, idx };
}

function buildTrackMesh(t) {
  const bed = ribbon(t, Math.max(t.width * 1.9, 0.055), 0.003);
  bed.geom.attributes.position.needsUpdate = true;
  const bedMesh = new THREE.Mesh(bed.geom, bedMat);
  bedMesh.receiveShadow = true;

  const line = ribbon(t, t.width / 2, 0.005);
  const lineMesh = new THREE.Mesh(line.geom, lineMat);
  lineMesh.receiveShadow = true;
  lineMesh.renderOrder = 2;

  const g = new THREE.Group();
  g.add(bedMesh, lineMesh);
  g.userData.dispose = [bed.geom, line.geom];
  return g;
}

function checkerTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const x = c.getContext("2d");
  for (let i = 0; i < 8; i++) {
    for (let j = 0; j < 8; j++) {
      x.fillStyle = (i + j) % 2 ? "#ffffff" : "#10151f";
      x.fillRect(i * 8, j * 8, 8, 8);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(10, 1);
  return tex;
}

const startMat = new THREE.MeshStandardMaterial({
  map: checkerTexture(), roughness: 0.8, emissive: 0x222222, emissiveIntensity: 0.1,
});

function buildStartGate(t) {
  const p = t.pts[0];
  const w = Math.max(t.width * 3.2, 0.10);
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(w, 0.018), startMat);
  plane.rotation.x = -Math.PI / 2;
  plane.rotation.z = -Math.atan2(p.ty, p.tx);
  plane.position.set(p.x, 0.006, p.y);
  plane.receiveShadow = true;
  return plane;
}

function sensorOffset(i) {
  // index 0 sits on the robot's LEFT; local +Z is the left-hand side
  return ((7 - 1) / 2 - i) * ROBOT.sensorSpacing;
}

function makeReadoutStrip() {
  const W = 7 * 64, H = 128;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d");
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const spr = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false })
  );
  spr.scale.set(0.118, 0.034, 1);
  spr.renderOrder = 30;
  const last = { vals: [] };
  const draw = (vals) => {
    ctx.clearRect(0, 0, W, H);
    for (let i = 0; i < 7; i++) {
      const v = Math.round(vals[i] ?? 0);
      const on = v > 45;
      const x = i * 64;
      ctx.fillStyle = on ? "rgba(12,40,32,0.94)" : "rgba(10,16,26,0.86)";
      ctx.beginPath();
      ctx.roundRect(x + 3, 4, 58, 120, 12);
      ctx.fill();
      ctx.strokeStyle = on ? "#3ddc97" : "#2b3a4a";
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.textAlign = "center";
      ctx.font = "600 26px ui-monospace, Menlo, monospace";
      ctx.fillStyle = on ? "#8ff3c4" : "#6b7d99";
      ctx.fillText(String(i + 1), x + 32, 40);
      ctx.font = "bold 44px ui-monospace, Menlo, monospace";
      ctx.fillStyle = on ? "#ffffff" : "#94a6c0";
      ctx.fillText(String(v), x + 32, 96);
    }
    tex.needsUpdate = true;
  };
  draw([0, 0, 0, 0, 0, 0, 0]);
  return { spr, draw, last };
}

function buildRobotMesh() {
  const g = new THREE.Group();

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.115, 0.026, 0.088),
    new THREE.MeshStandardMaterial({ color: 0x5a6b86, roughness: 0.42, metalness: 0.35 })
  );
  body.position.y = 0.024;
  body.castShadow = true;
  g.add(body);

  const plate = new THREE.Mesh(
    new THREE.BoxGeometry(0.082, 0.006, 0.062),
    new THREE.MeshStandardMaterial({ color: 0x1f6f8b, emissive: 0x1f6f8b, emissiveIntensity: 0.35, roughness: 0.5 })
  );
  plate.position.y = 0.040;
  plate.castShadow = true;
  g.add(plate);

  // differential drive: one wheel per side, axle across the robot (local Z)
  const tyreMat = new THREE.MeshStandardMaterial({ color: 0x141a24, roughness: 0.92 });
  const hubMat = new THREE.MeshStandardMaterial({ color: 0x8e9cb2, roughness: 0.35, metalness: 0.6 });
  const wheels = [];
  for (const side of [-1, 1]) {
    const wheel = new THREE.Group();
    const tyre = new THREE.Mesh(new THREE.CylinderGeometry(0.0205, 0.0205, 0.011, 22), tyreMat);
    tyre.rotation.x = Math.PI / 2;          // axle along local Z = rolling along local X
    tyre.castShadow = true;
    wheel.add(tyre);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.0095, 0.0095, 0.0118, 14), hubMat);
    hub.rotation.x = Math.PI / 2;
    wheel.add(hub);
    wheel.position.set(0, 0.0205, side * 0.0475);
    g.add(wheel);
    wheels.push({ group: wheel, side });
  }

  // idler balls so the chassis looks like it rests on something front and back
  const casterMat = new THREE.MeshStandardMaterial({ color: 0x2b3648, roughness: 0.5 });
  for (const x of [-0.042, 0.042]) {
    const c = new THREE.Mesh(new THREE.SphereGeometry(0.0062, 12, 10), casterMat);
    c.position.set(x, 0.0062, 0);
    g.add(c);
  }

  const barMat = new THREE.MeshStandardMaterial({ color: 0x0d1220, roughness: 0.7 });
  const bar = new THREE.Mesh(new THREE.BoxGeometry(0.010, 0.007, ROBOT.barWidth + 0.004), barMat);
  bar.position.set(ROBOT.sensorReach, 0.007, 0);
  g.add(bar);

  const led = [];
  for (let i = 0; i < 7; i++) {
    const off = sensorOffset(i);
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(0.0034, 12, 10),
      new THREE.MeshStandardMaterial({ color: 0x1a2432, emissive: 0x0a1520, emissiveIntensity: 0.4, roughness: 0.35 })
    );
    m.position.set(ROBOT.sensorReach + 0.003, 0.005, off);
    g.add(m);
    led.push(m);
  }

  // one floating readout above the robot: sensor 1 … 7 with live values
  const strip = makeReadoutStrip();
  strip.spr.position.set(0, 0.078, 0);
  g.add(strip.spr);

  const beacon = new THREE.Mesh(
    new THREE.SphereGeometry(0.006, 12, 10),
    new THREE.MeshStandardMaterial({ color: 0x38e1ff, emissive: 0x38e1ff, emissiveIntensity: 1.6 })
  );
  beacon.position.set(-0.032, 0.048, 0);
  g.add(beacon);

  // ground footprints show where each sensor is actually looking
  const spots = [];
  const spotGeo = new THREE.RingGeometry(0.0072, 0.0112, 22).rotateX(-Math.PI / 2);
  for (let i = 0; i < 7; i++) {
    const mat = new THREE.MeshBasicMaterial({
      color: 0x0d1220, transparent: true, opacity: 0.5, depthWrite: false,
    });
    const s = new THREE.Mesh(spotGeo, mat);
    s.position.y = 0.008;
    s.renderOrder = 4;
    scene.add(s);
    spots.push(s);
  }

  scene.add(g);
  return { group: g, led, strip, beacon, wheels, spots };
}

let robotMesh = null;

function loadLevel(i) {
  levelIndex = i;
  const lv = LEVELS[i];
  track = makeTrack(lv);
  robot = new Robot(track);

  while (trackGroup.children.length) {
    const c = trackGroup.children.pop();
    c.userData?.dispose?.forEach((g) => g.dispose());
    c.geometry?.dispose?.();
    trackGroup.remove(c);
  }
  trackGroup.add(buildTrackMesh(track));
  trackGroup.add(buildStartGate(track));

  if (robotMesh) {
    scene.remove(robotMesh.group);
    robotMesh.spots.forEach((sp) => { scene.remove(sp); sp.material.dispose(); });
  }
  robotMesh = buildRobotMesh();

  sim.reset();
  fitCamera(lv);
  renderLevelList();
  document.getElementById("objText").textContent = lv.goal;
  document.getElementById("statBest").textContent = bestLabel(lv.id);
  updateHud();
}

function fitCamera() {
  const b = track.bounds;
  const span = Math.max(b.w, b.h);
  if (camMode === "top") {
    camera.position.set(b.cx, span * 1.15, b.cy + 0.001);
    controls.target.set(b.cx, 0, b.cy);
  } else {
    camera.position.set(b.cx - span * 0.1, span * 0.75, b.cy + span * 1.05);
    controls.target.set(b.cx, 0, b.cy);
  }
  camera.updateProjectionMatrix();
}

/* ------------------------------------------------------------------ *
 *  simulation state
 * ------------------------------------------------------------------ */

const S = {
  time: 0,
  laps: 0,
  running: false,
  finished: false,
  lastS: 0,
  offTrack: 0,
  progress: 0,
  memo: new Map(),
};

let camMode = "chase";

const frameWaiters = [];
let stopToken = { stopped: false };
let programRun = null;

const sim = {
  reset() {
    S.time = 0;
    S.laps = 0;
    S.running = false;
    S.finished = false;
    S.offTrack = 0;
    S.lastS = 0;
    S.progress = 0;
    stopToken.stopped = true;
    robot?.reset(0);
    flushWaiters();
    updateHud();
    pill("就緒", "");
  },
};

function flushWaiters() {
  while (frameWaiters.length) frameWaiters.shift()();
}

const nextFrame = () => new Promise((r) => frameWaiters.push(r));

/* block API exposed to the program */
function makeBotApi() {
  const token = stopToken;
  return {
    setMotors(l, r) {
      if (token.stopped) throw new Error("stopped");
      robot.setMotors(l, r);
    },
    setLeft(v) { robot.setMotors(v, robot.cmdR); },
    setRight(v) { robot.setMotors(robot.cmdL, v); },
    sensor(i) { return Math.round(robot.sensorsData[Number(i)]?.analog ?? 0); },
    onLine(i) { return !!robot.sensorsData[Number(i)]?.on; },
    lineError() { return robot.lineError(); },
    lost() { return robot.lost(); },
    laps() { return S.laps; },
    time() { return S.time; },
    async wait(ms) {
      const until = S.time + Math.max(0, Number(ms) || 0) / 1000;
      while (S.time < until) {
        if (token.stopped) throw new Error("stopped");
        await nextFrame();
      }
    },
  };
}

async function runProgram() {
  const lv = LEVELS[levelIndex];
  const { code, error } = compileWorkspace(workspace);
  if (error) { msg(error, "err"); return; }

  sim.reset();
  stopToken = { stopped: false };
  const token = stopToken;

  const bot = makeBotApi();
  let steps = 0;
  const y = async () => {
    if (token.stopped) throw new Error("stopped");
    if (++steps > 400000) { token.stopped = true; throw new Error("程式執行太長（可能係無限迴圈）"); }
    await nextFrame();
  };

  S.running = true;
  pill("執行中", "live");
  msg("");

  let fn;
  try {
    fn = new Function("bot", "y", `"use strict"; return (async () => {\n${code}\n})();`);
  } catch (e) {
    msg("程式有語法問題：" + e.message, "err");
    S.running = false;
    return;
  }

  programRun = (async () => {
    try {
      await fn(bot, y);
      if (!token.stopped) finish(true, "程式完成");
    } catch (e) {
      if (token.stopped) return;
      msg(e.message === "stopped" ? "" : "執行錯誤：" + e.message, "err");
      S.running = false;
      pill("已停止", "");
    }
  })();
}

function stopProgram() {
  stopToken.stopped = true;
  S.running = false;
  robot?.stop();
  flushWaiters();
  pill("已停止", "");
}

function finish(success, why) {
  if (S.finished) return;
  S.finished = true;
  S.running = false;
  stopToken.stopped = true;
  robot.stop();
  flushWaiters();

  const lv = LEVELS[levelIndex];
  const won = S.laps >= lv.laps;
  if (won) {
    const key = "lfr-best-" + lv.id;
    const prev = Number(localStorage.getItem(key) || 0);
    if (!prev || S.time < prev) localStorage.setItem(key, S.time.toFixed(2));
    msg(`完成！用時 ${S.time.toFixed(2)} 秒`, "ok");
    pill("完成 ✓", "live");
  } else {
    msg(why || "程式結束但未完成任務", "err");
    pill("未完成", "bad");
  }
  document.getElementById("statBest").textContent = bestLabel(lv.id);
  renderLevelList();
}

/* ------------------------------------------------------------------ *
 *  frame loop
 * ------------------------------------------------------------------ */

let last = performance.now();
let speed = 1;

function tick(now) {
  requestAnimationFrame(tick);
  const dtReal = Math.min((now - last) / 1000, 0.05);
  last = now;

  if (S.running && robot) {
    const dt = dtReal * speed;
    robot.step(dt);
    S.time += dt;

    // lap counting: accumulate wrapped arc-length progress, only while on the line
    const n = track.nearest(robot.x, robot.y, robot.hint);
    const L = track.length;
    if (n.dist < Math.max(track.width * 2.2, 0.09)) {
      let ds = n.s - S.lastS;
      if (ds > L / 2) ds -= L;
      if (ds < -L / 2) ds += L;
      S.progress += ds;
    }
    S.lastS = n.s;
    const done = Math.max(0, Math.floor(S.progress / L));
    if (done !== S.laps) {
      S.laps = done;
      if (S.laps >= LEVELS[levelIndex].laps) finish(true);
    }

    if (!S.finished) {
      if (n.dist > 0.22) {
        S.offTrack += dt;
        if (S.offTrack > 0.8) pill("出界", "bad");
      } else {
        S.offTrack = 0;
        pill("執行中", "live");
      }
    }
    updateHud();
  }

  if (frameWaiters.length) flushWaiters();

  updateRobotMesh(dtReal);
  updateCamera(dtReal);
  controls.update();
  renderer.render(scene, camera);
}

let labelClock = 0;

function updateRobotMesh(dt) {
  if (!robot || !robotMesh) return;
  const g = robotMesh.group;
  g.position.set(robot.x, 0, robot.y);
  g.rotation.y = -robot.th;

  // wheels: spin about the axle (local Z) at the commanded wheel speed
  const r = 0.0205;
  for (const w of robotMesh.wheels) {
    const v = w.side > 0 ? robot.vL : robot.vR;   // +Z side is the left wheel
    w.group.rotation.z -= (v / r) * dt;
  }

  const data = robot.sensorsData;
  labelClock += dt;
  if (labelClock > 0.09) {
    labelClock = 0;
    robotMesh.strip.draw(data.map((d) => d.analog));
  }

  for (let i = 0; i < data.length; i++) {
    const analog = data[i]?.analog ?? 0;
    const f = Math.pow(analog / 100, 0.8);

    // LED on the bar
    const m = robotMesh.led[i]?.material;
    if (m) {
      m.emissive.setRGB(0.05 + 0.10 * f, 0.22 + 0.62 * f, 0.28 + 0.55 * f);
      m.emissiveIntensity = 0.55 + f * 2.6;
      m.color.setScalar(0.10 + 0.25 * f);
    }


    // ground spot where the sensor is looking
    const sp = robotMesh.spots[i];
    if (sp) {
      const pose = robot.sensorPose(i);
      sp.position.set(pose.x, 0.008, pose.y);
      sp.material.opacity = 0.55 + f * 0.45;
      // dark slate ring on the light mat, flipping to signal green when it sees black
      sp.material.color.setRGB(0.12 + 0.05 * f, 0.16 + 0.70 * f, 0.20 + 0.55 * f);
    }
  }

  robotMesh.beacon.material.emissiveIntensity = S.running ? 1.6 + Math.sin(S.time * 9) * 0.6 : 0.7;
}

const camTarget = new THREE.Vector3();
const camPos = new THREE.Vector3();
const camLook = new THREE.Vector3();

function updateCamera(dt) {
  if (!robot) return;
  // OrbitControls.update() recomputes the camera from its own spherical state,
  // so it must stay out of the way while a follow camera is driving.
  if (camMode === "orbit") {
    controls.enabled = true;
    return;
  }
  controls.enabled = false;

  const k = 1 - Math.exp(-dt * 6.0);
  if (camMode === "chase") {
    const back = 0.40, up = 0.44;
    camPos.set(robot.x - Math.cos(robot.th) * back, up, robot.y - Math.sin(robot.th) * back);
    camTarget.set(robot.x + Math.cos(robot.th) * 0.26, 0.01, robot.y + Math.sin(robot.th) * 0.26);
  } else {
    camPos.set(robot.x, 0.95, robot.y + 0.0001);
    camTarget.set(robot.x, 0, robot.y);
  }
  camera.position.lerp(camPos, k);
  camLook.lerp(camTarget, k);
  controls.target.copy(camLook);
  camera.lookAt(camLook);
}

/* ------------------------------------------------------------------ *
 *  HUD
 * ------------------------------------------------------------------ */

const sensorBar = document.getElementById("sensorBar");
const sensorVals = document.getElementById("sensorVals");
for (let i = 0; i < 7; i++) {
  const el = document.createElement("i");
  el.innerHTML = `<em>${i + 1}</em><b></b>`;
  sensorBar.appendChild(el);
  const s = document.createElement("span");
  s.textContent = "–";
  sensorVals.appendChild(s);
}

function updateHud() {
  const lv = LEVELS[levelIndex];
  document.getElementById("statTime").textContent = S.time.toFixed(2);
  document.getElementById("statLaps").textContent = `${Math.min(S.laps, lv.laps)} / ${lv.laps}`;
  const data = robot?.sensorsData ?? [];
  for (let i = 0; i < 7; i++) {
    const a = data[i]?.analog ?? 0;
    const bar = sensorBar.children[i];
    bar.querySelector("b").style.height = Math.max(3, a) + "%";
    bar.classList.toggle("on", a > 45);
    sensorVals.children[i].textContent = Math.round(a);
  }
}

function pill(text, cls) {
  const el = document.getElementById("statusPill");
  el.textContent = text;
  el.className = "overlay-status " + (cls || "");
}

function msg(text, cls) {
  const el = document.getElementById("msg");
  el.textContent = text;
  el.className = "msg " + (cls || "");
}

const bestLabel = (id) => {
  const v = Number(localStorage.getItem("lfr-best-" + id) || 0);
  return v ? v.toFixed(2) + "s" : "—";
};

/* ------------------------------------------------------------------ *
 *  Blockly
 * ------------------------------------------------------------------ */

registerBlocks();
const workspace = Blockly.inject("blockly", {
  toolbox: toolbox(),
  grid: { spacing: 24, length: 2, colour: "#1a2334", snap: true },
  zoom: { controls: true, wheel: true, startScale: 0.85, minScale: 0.4, maxScale: 1.6 },
  trashcan: true,
  move: { scrollbars: true, drag: true, wheel: true },
  theme: Blockly.Theme?.defineTheme?.("lfr", {
    componentStyles: {
      workspaceBackgroundColour: "#0d1220",
      toolboxBackgroundColour: "#0b1120",
      toolboxForegroundColour: "#b9c8de",
      flyoutBackgroundColour: "#0b1120",
      flyoutForegroundColour: "#b9c8de",
      flyoutOpacity: 0.97,
      scrollbarColour: "#2a3854",
      insertionMarkerColour: "#38e1ff",
      insertionMarkerOpacity: 0.4,
      cursorColour: "#38e1ff",
    },
    fontStyle: { family: "Inter, Helvetica Neue, PingFang HK, sans-serif", size: 12 },
  }),
});

/* demo: base speed + proportional steering (P controller) */
// open the first toolbox category so the palette is visible on load
setTimeout(() => {
  try { workspace.getToolbox().selectItemByPosition(0); } catch (e) { /* older/newer API */ }
}, 400);

function loadDemo() {
  const ws = workspace;
  ws.clear();
  const vmap = ws.getVariableMap();
  const base = vmap.createVariable("base", "", "vBase");
  const err = vmap.createVariable("err", "", "vErr");

  const num = (n) => ({ shadow: { type: "math_number", fields: { NUM: n } } });
  const blk = (b) => (b && b.shadow ? b : { block: b });
  const nxt = (b) => ({ block: b });
  const getVar = (v) => ({ type: "variables_get", fields: { VAR: { id: v.getId() } } });
  const arith = (op, a, b) => ({
    type: "math_arithmetic",
    fields: { OP: op },
    inputs: { A: blk(a), B: blk(b) },
  });
  const kGain = (v) => arith("MULTIPLY", getVar(v), num(16));

  const motors = {
    type: "bot_motors",
    inputs: {
      L: blk(arith("ADD", getVar(base), kGain(err))),
      R: blk(arith("MINUS", getVar(base), kGain(err))),
    },
  };
  const setErr = {
    type: "variables_set",
    fields: { VAR: { id: err.getId() } },
    inputs: { VALUE: blk({ type: "bot_error" }) },
    next: nxt(motors),
  };
  const loop = {
    type: "controls_whileUntil",
    fields: { MODE: "WHILE" },
    inputs: {
      BOOL: blk({ type: "logic_boolean", fields: { BOOL: "TRUE" } }),
      DO: blk(setErr),
    },
  };
  const setBase = {
    type: "variables_set", x: 48, y: 48,
    fields: { VAR: { id: base.getId() } },
    inputs: { VALUE: num(60) },
    next: nxt(loop),
  };

  const tree = { blocks: { languageVersion: 0, blocks: [setBase] } };
  try {
    Blockly.serialization.workspaces.load(tree, ws);
    msg("已載入示範程式：base ± 16 × 線位置", "ok");
  } catch (e) {
    msg("示範程式載入失敗：" + e.message, "err");
  }
}

/* ------------------------------------------------------------------ *
 *  UI wiring
 * ------------------------------------------------------------------ */

function renderLevelList() {
  const box = document.getElementById("levelList");
  box.innerHTML = "";
  LEVELS.forEach((lv, i) => {
    const el = document.createElement("div");
    el.className = "lv" + (i === levelIndex ? " on" : "") + (localStorage.getItem("lfr-best-" + lv.id) ? " done" : "");
    el.innerHTML = `<span class="n">${String(lv.id).padStart(2, "0")}</span>
      <span class="t">${lv.name}</span><span class="d">${lv.tag}</span>`;
    el.onclick = () => { stopProgram(); loadLevel(i); };
    box.appendChild(el);
  });
  document.getElementById("levelCount").textContent = `${levelIndex + 1} / ${LEVELS.length}`;
}

document.getElementById("btnRun").onclick = () => { runProgram(); };
document.getElementById("btnStop").onclick = () => stopProgram();
document.getElementById("btnReset").onclick = () => { stopProgram(); sim.reset(); fitCamera(); };
document.getElementById("btnDemo").onclick = () => loadDemo();
document.getElementById("btnClear").onclick = () => { workspace.clear(); msg(""); };

document.getElementById("speed").oninput = (e) => {
  speed = Number(e.target.value);
  document.getElementById("speedVal").textContent = speed.toFixed(1) + "×";
};

document.getElementById("camModes").onclick = (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  camMode = b.dataset.mode;
  for (const x of e.currentTarget.children) x.classList.toggle("on", x === b);
  controls.enabled = camMode === "orbit";
  if (camMode !== "orbit") fitCamera();
};

function resize() {
  const r = canvas.getBoundingClientRect();
  renderer.setSize(r.width, r.height, false);
  camera.aspect = r.width / Math.max(r.height, 1);
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);
new ResizeObserver(resize).observe(canvas.parentElement);

/* ------------------------------------------------------------------ *
 *  boot
 * ------------------------------------------------------------------ */

loadLevel(0);
resize();
requestAnimationFrame(tick);

/* headless test hook */
window.__sim = {
  levels: LEVELS.map((l) => ({ id: l.id, name: l.name, length: null })),
  loadLevel,
  demo: loadDemo,
  run: () => runProgram(),
  stop: () => stopProgram(),
  clear: () => workspace.clear(),
  state: () => ({
    level: LEVELS[levelIndex].id,
    running: S.running,
    time: +S.time.toFixed(2),
    laps: S.laps,
    finished: S.finished,
    x: robot ? +robot.x.toFixed(3) : null,
    y: robot ? +robot.y.toFixed(3) : null,
    sensors: robot ? robot.analog : [],
    error: robot ? robot.lineError() : null,
    trackLength: track ? +track.length.toFixed(2) : null,
    minRadius: track ? +track.minRadius().toFixed(3) : null,
    code: (() => { try { return compileWorkspace(workspace).code; } catch (e) { return "compile-error: " + e.message; } })(),
    msg: document.getElementById("msg").textContent,
  }),
  setSpeed: (v) => { speed = v; },
  spots: () => (robotMesh?.spots ?? []).map((s) => ({
    x: +s.position.x.toFixed(3), z: +s.position.z.toFixed(3),
    o: +s.material.opacity.toFixed(2),
    c: s.material.color.getHexString(),
  })),
  stripVisible: () => {
    const w = robotMesh?.strip?.spr;
    if (!w) return null;
    const p = new THREE.Vector3();
    w.getWorldPosition(p);
    return { x: +p.x.toFixed(3), y: +p.y.toFixed(3), z: +p.z.toFixed(3), visible: w.visible };
  },
  shot: (w = 640) => {
    renderer.render(scene, camera);
    const src = renderer.domElement;
    const c = document.createElement("canvas");
    c.width = w;
    c.height = Math.round((src.height / src.width) * w);
    c.getContext("2d").drawImage(src, 0, 0, c.width, c.height);
    return c.toDataURL("image/png");
  },
  info: () => ({ calls: renderer.info.render.calls, tris: renderer.info.render.triangles }),
  teleport: (s) => { robot.reset(s); },
};