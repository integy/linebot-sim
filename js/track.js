// Track geometry: closed centripetal Catmull-Rom spline, arc-length resampled.
// Everything is in metres on the XZ plane (three.js), track space is (x, z).

const STEP = 0.005;        // resample step, 5 mm

function catmull(p0, p1, p2, p3, t) {
  // centripetal Catmull-Rom (alpha = 0.5), handles uneven spacing without cusps
  const tj = (pi, pj, ti) => {
    const d = Math.hypot(pj.x - pi.x, pj.y - pi.y);
    return ti + Math.pow(Math.max(d, 1e-6), 0.5);
  };
  const t0 = 0;
  const t1 = tj(p0, p1, t0);
  const t2 = tj(p1, p2, t1);
  const t3 = tj(p2, p3, t2);
  const tt = t1 + (t2 - t1) * t;
  const lerp = (a, b, ta, tb) => {
    const w = (tt - ta) / (tb - ta);
    return { x: a.x + (b.x - a.x) * w, y: a.y + (b.y - a.y) * w };
  };
  const A1 = lerp(p0, p1, t0, t1);
  const A2 = lerp(p1, p2, t1, t2);
  const A3 = lerp(p2, p3, t2, t3);
  const B1 = lerp(A1, A2, t0, t2);
  const B2 = lerp(A2, A3, t1, t3);
  return lerp(B1, B2, t1, t2);
}

export class Track {
  constructor(points, { width = 0.025, name = "" } = {}) {
    this.width = width;
    this.name = name;
    this.pts = [];       // {x, y, s, tx, ty}
    this.length = 0;
    this._build(points);
  }

  _build(raw) {
    // long control spans make Catmull-Rom bulge: keep every gap <= 0.2 m
    const points = [];
    const MAXGAP = 0.2;
    for (let i = 0; i < raw.length; i++) {
      const a = raw[i], b = raw[(i + 1) % raw.length];
      points.push(a);
      const d = Math.hypot(b.x - a.x, b.y - a.y);
      const k = Math.floor(d / MAXGAP);
      for (let j = 1; j <= k; j++) {
        const t = j / (k + 1);
        points.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      }
    }
    const n = points.length;
    const dense = [];
    const SEG = 26;
    for (let i = 0; i < n; i++) {
      const p0 = points[(i - 1 + n) % n];
      const p1 = points[i];
      const p2 = points[(i + 1) % n];
      const p3 = points[(i + 2) % n];
      for (let k = 0; k < SEG; k++) dense.push(catmull(p0, p1, p2, p3, k / SEG));
    }
    // arc length of the dense polyline
    let total = 0;
    const cum = [0];
    for (let i = 1; i <= dense.length; i++) {
      const a = dense[i - 1];
      const b = dense[i % dense.length];
      total += Math.hypot(b.x - a.x, b.y - a.y);
      cum.push(total);
    }
    // resample at uniform spacing
    const count = Math.max(64, Math.round(total / STEP));
    const step = total / count;
    const at = (s) => {
      // binary search cum
      let lo = 0, hi = cum.length - 1;
      while (lo < hi - 1) {
        const mid = (lo + hi) >> 1;
        if (cum[mid] <= s) lo = mid; else hi = mid;
      }
      const a = dense[lo % dense.length];
      const b = dense[(lo + 1) % dense.length];
      const span = cum[lo + 1] - cum[lo] || 1e-9;
      const w = (s - cum[lo]) / span;
      return { x: a.x + (b.x - a.x) * w, y: a.y + (b.y - a.y) * w };
    };
    for (let i = 0; i < count; i++) {
      const s = i * step;
      const p = at(s);
      const q = at((s + 0.01) % total);
      const tx = q.x - p.x, ty = q.y - p.y;
      const m = Math.hypot(tx, ty) || 1;
      this.pts.push({ x: p.x, y: p.y, s, tx: tx / m, ty: ty / m });
    }
    this.step = step;
    this.length = total;
  }

  /** nearest point on the centreline; windowed around `hint` for speed */
  nearest(x, y, hint = -1) {
    const pts = this.pts;
    const n = pts.length;
    let best = -1, bd = Infinity;
    const scan = (i0, i1) => {
      for (let i = i0; i < i1; i++) {
        const p = pts[((i % n) + n) % n];
        const dx = p.x - x, dy = p.y - y;
        const d = dx * dx + dy * dy;
        if (d < bd) { bd = d; best = ((i % n) + n) % n; }
      }
    };
    if (hint >= 0 && hint < n) {
      scan(hint - 90, hint + 90);
      if (bd > 0.09 * 0.09) { bd = Infinity; best = -1; scan(0, n); }
    } else {
      scan(0, n);
    }
    const p = pts[best];
    return { dist: Math.sqrt(bd), idx: best, s: p.s, nx: -p.ty, ny: p.tx, tx: p.tx, ty: p.ty };
  }

  /** signed lateral offset (left of travel = negative) */
  lateral(x, y, hint = -1) {
    const r = this.nearest(x, y, hint);
    const p = this.pts[r.idx];
    const sign = Math.sign((x - p.x) * r.nx + (y - p.y) * r.ny) || 1;
    return { ...r, lateral: r.dist * sign };
  }

  pointAtS(s) {
    const n = this.pts.length;
    const i = Math.floor((((s % this.length) + this.length) % this.length) / this.step) % n;
    return this.pts[i];
  }

  get bounds() {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const p of this.pts) {
      x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x);
      y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
    }
    return { x0, x1, y0, y1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0 };
  }

  /** smallest radius of curvature along the track (difficulty proxy) */
  minRadius() {
    // sagitta over a 60 mm window: R = c²/(8h) + h/2, ignoring near-straight spans
    const n = this.pts.length;
    const W = 12;
    let rmin = Infinity;
    for (let i = 0; i < n; i++) {
      const a = this.pts[(i - W + n) % n], c = this.pts[(i + W) % n];
      const chord = Math.hypot(c.x - a.x, c.y - a.y);
      if (chord < 1e-6) continue;
      // distance of the midpoint sample from the chord
      const mid = this.pts[i];
      const area2 = Math.abs((c.x - a.x) * (mid.y - a.y) - (mid.x - a.x) * (c.y - a.y));
      const h = area2 / chord;
      if (h < 0.0006) continue;              // straighter than 1.2 mm sagitta
      const R = (chord * chord) / (8 * h) + h / 2;
      rmin = Math.min(rmin, R);
    }
    return rmin === Infinity ? 100 : rmin;
  }
}

/* ---------------- level authoring helpers ---------------- */

const ellipse = (rx, ry, n = 16) => {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    out.push({ x: Math.cos(a) * rx, y: Math.sin(a) * ry });
  }
  return out;
};

const roundedRect = (w, h, r, per = 6) => {
  const out = [];
  const hx = w / 2 - r, hy = h / 2 - r;
  // arcs must start where the incoming straight ends: bottom-right corner
  // starts at -90°, top-right at 0°, top-left at 90°, bottom-left at 180°
  const corners = [
    [hx, -hy, -Math.PI / 2], [hx, hy, 0], [-hx, hy, Math.PI / 2], [-hx, -hy, Math.PI],
  ];
  for (const [cx, cy, a0] of corners) {
    for (let i = 0; i <= per; i++) {
      const a = a0 + (i / per) * (Math.PI / 2);
      out.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
    }
  }
  return out;
};

// Closed serpentine: wavy outbound side, semicircular cap, wavy return side.
// amp/waves are chosen so the smallest radius stays drivable (> ~0.10 m).
const wave = ({ w = 2.2, h = 1.0, amp = 0.24, waves = 2, n = 26, cap = 12 }) => {
  const out = [];
  const taper = (t) => Math.pow(Math.sin(Math.PI * t), 0.55);
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    out.push({ x: -w / 2 + w * t, y: h / 2 + amp * Math.sin(t * Math.PI * 2 * waves) * taper(t) });
  }
  for (let i = 1; i < cap; i++) {
    const a = Math.PI / 2 - (i / cap) * Math.PI;   // top → bottom, bulging right
    out.push({ x: w / 2 + Math.cos(a) * (h / 2), y: Math.sin(a) * (h / 2) });
  }
  for (let i = 0; i < n; i++) {
    const t = 1 - i / (n - 1);
    out.push({ x: -w / 2 + w * t, y: -h / 2 - amp * Math.sin(t * Math.PI * 2 * waves) * taper(t) });
  }
  for (let i = 1; i < cap; i++) {
    const a = -Math.PI / 2 - (i / cap) * Math.PI;  // bottom → top, bulging left
    out.push({ x: -w / 2 + Math.cos(a) * (h / 2), y: Math.sin(a) * (h / 2) });
  }
  return out;
};

/* 10 levels, easy → hard */
export const LEVELS = [
  {
    id: 1, name: "大橢圓", tag: "EASY", laps: 1,
    goal: "沿黑線完成 1 圈。先試 set motors 60/60，再看感測器數值修正。",
    width: 0.030,
    points: ellipse(1.15, 0.62, 20),
  },
  {
    id: 2, name: "圓角矩形", tag: "EASY", laps: 1,
    goal: "四隻直角彎。兩邊馬達同時轉只會行直線，彎前要收油。",
    width: 0.028,
    points: roundedRect(1.9, 1.2, 0.34, 7),
  },
  {
    id: 3, name: "雙波浪", tag: "NORMAL", laps: 1,
    goal: "曲率不斷變。用 line position 做比例控制（P）會穩好多。",
    width: 0.026,
    points: wave({ w: 2.0, h: 1.12, amp: 0.24, waves: 2, n: 26 }),
  },
  {
    id: 4, name: "S 彎走廊", tag: "NORMAL", laps: 1,
    goal: "連續 S 彎，轉向要早半個身位。",
    width: 0.026,
    points: wave({ w: 2.2, h: 1.15, amp: 0.45, waves: 1, n: 18 }),
  },
  {
    id: 5, name: "窄彎方框", tag: "HARD", laps: 1,
    goal: "半徑收窄到 18 cm。太快一定衝出線，試 reduce speed。",
    width: 0.024,
    points: roundedRect(1.7, 1.05, 0.18, 8),
  },
  {
    id: 6, name: "雙髮夾", tag: "HARD", laps: 1,
    goal: "兩條長直路 ＋ 兩個 180° 髮夾。進彎前要減速，出彎再加速。",
    width: 0.024,
    points: roundedRect(2.3, 0.60, 0.19, 8),
  },
  {
    id: 7, name: "連續減速彎", tag: "HARD", laps: 1,
    goal: "三段連續 chicane，要用微分（D）預判，否則會左右彈。",
    width: 0.022,
    points: wave({ w: 2.35, h: 1.02, amp: 0.155, waves: 3, n: 34 }),
  },
  {
    id: 8, name: "曲別針", tag: "EXPERT", laps: 1,
    goal: "半徑只有 11 cm 的四個死彎。直路全速，入彎前一刻要急收。",
    width: 0.022,
    points: roundedRect(1.55, 0.98, 0.115, 8),
  },
  {
    id: 9, name: "8 字交叉", tag: "EXPERT", laps: 2,
    goal: "賽道自己交叉。交叉點感測器會全黑，要憑慣性直行過。",
    width: 0.024,
    points: [
      { x: -1.05, y: -0.62 }, { x: -0.35, y: -0.62 }, { x: 0.0, y: 0.0 },
      { x: 0.35, y: 0.62 }, { x: 1.05, y: 0.62 }, { x: 1.25, y: 0.2 },
      { x: 1.0, y: -0.3 }, { x: 0.0, y: 0.0 }, { x: -1.0, y: 0.3 },
      { x: -1.25, y: -0.2 },
    ],
  },
  {
    id: 10, name: "總決賽", tag: "EXPERT", laps: 2,
    goal: "全部元素：長直路、chicane、髮夾、交叉。最快圈速者勝。",
    width: 0.022,
    points: [
      { x: -1.3, y: -0.8 }, { x: 0.3, y: -0.8 }, { x: 0.55, y: -0.5 },
      { x: 0.3, y: -0.2 }, { x: 0.6, y: 0.05 }, { x: 1.15, y: 0.05 },
      { x: 1.25, y: 0.45 }, { x: 0.9, y: 0.75 }, { x: 0.35, y: 0.55 },
      { x: 0.0, y: 0.2 }, { x: -0.35, y: 0.55 }, { x: -0.9, y: 0.75 },
      { x: -1.3, y: 0.45 }, { x: -1.35, y: 0.0 },
    ],
  },
];

export function makeTrack(level) {
  const t = new Track(level.points, { width: level.width, name: level.name });
  return t;
}