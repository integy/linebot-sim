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

function buildRobotMesh() {
  const g = new THREE.Group();

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.115, 0.026, 0.088),
    new THREE.MeshStandardMaterial({ color: 0x5a6b86, roughness: 0.42, metalness: 0.35 })
  );
  body.position.y = 0.021;
  body.castShadow = true;
  g.add(body);

  const plate = new THREE.Mesh(
    new THREE.BoxGeometry(0.082, 0.006, 0.062),
    new THREE.MeshStandardMaterial({ color: 0x1f6f8b, emissive: 0x1f6f8b, emissiveIntensity: 0.35, roughness: 0.5 })
  );
  plate.position.y = 0.037;
  plate.castShadow = true;
  g.add(plate);

  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x161c26, roughness: 0.9 });
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.0205, 0.0205, 0.012, 18), wheelMat);
      w.rotation.z = Math.PI / 2;
      w.position.set(sx * 0.048, 0.0205, sz * 0.028);
      w.castShadow = true;
      g.add(w);
    }
  }

  const barMat = new THREE.MeshStandardMaterial({ color: 0x0d1220, roughness: 0.7 });
  const bar = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.008, ROBOT.barWidth), barMat);
  bar.position.set(ROBOT.sensorReach, 0.006, 0);
  g.add(bar);

  const led = [];
  for (let i = 0; i < 7; i++) {
    const off = (i - 3) * ROBOT.sensorSpacing;
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(0.0032, 10, 8),
      new THREE.MeshStandardMaterial({ color: 0x22303f, emissive: 0x000000, roughness: 0.4 })
    );
    m.position.set(ROBOT.sensorReach + 0.004, 0.005, off);
    g.add(m);
    led.push(m);
  }

  const beacon = new THREE.Mesh(
    new THREE.SphereGeometry(0.006, 12, 10),
    new THREE.MeshStandardMaterial({ color: 0x38e1ff, emissive: 0x38e1ff, emissiveIntensity: 1.6 })
  );
  beacon.position.set(-0.03, 0.046, 0);
  g.add(beacon);

  scene.add(g);
  return { group: g, led, beacon };
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

  if (robotMesh) scene.remove(robotMesh.group);
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

function updateRobotMesh(dt) {
  if (!robot || !robotMesh) return;
  const g = robotMesh.group;
  g.position.set(robot.x, 0, robot.y);
  g.rotation.y = -robot.th;

  const data = robot.sensorsData;
  for (let i = 0; i < robotMesh.led.length; i++) {
    const a = (data[i]?.analog ?? 0) / 100;
    const m = robotMesh.led[i].material;
    m.emissive.setRGB(0.15 + 0.05 * a, 0.75 * a + 0.05, 0.9 * a + 0.1);
    m.emissiveIntensity = 0.2 + a * 2.4;
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