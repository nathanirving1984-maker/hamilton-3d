// Novato 3D - connected city engine. One continuous map: the city is cut into square tiles
// (areas/novato/tiles/<ix>_<iz>.json + .jpg, listed in window.CITY) and the engine loads the ones
// near where you are looking, in full detail, and drops them again when you move away. Farther out
// you see tile photos, and beyond those a wide regional photo (window.AREA_BACKDROP).
// Units: feet; x = east, z = south; origin = city centre. Config: window.CITY_CONFIG.
(function () {
  var C = window.CITY, CFG = window.CITY_CONFIG || {}, T = C.T, BASE = CFG.base || 'areas/novato/';
  var MOBILE = Math.min(window.innerWidth, window.innerHeight) < 700;
  var MAX_DETAIL = MOBILE ? 8 : 16, MAX_PHOTO = MOBILE ? 22 : 44;
  var host = document.getElementById('scene');
  var renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  host.appendChild(renderer.domElement);
  var scene = new THREE.Scene();
  scene.background = new THREE.Color(0xcfe3f3);
  scene.fog = new THREE.Fog(0xcfe3f3, 11000, 26000);
  var camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 2, 60000);
  var controls = new THREE.MapControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.dampingFactor = 0.08;
  controls.minDistance = 25; controls.maxDistance = 15000; controls.maxPolarAngle = Math.PI / 2 - 0.08;
  controls.screenSpacePanning = false; controls.zoomSpeed = 1.2; controls.panSpeed = 1.0;
  scene.add(new THREE.HemisphereLight(0xeef6ff, 0x7d8a5e, 0.8));
  var sun = new THREE.DirectionalLight(0xfff3df, 0.9); sun.position.set(0.5, 1, 0.35); scene.add(sun);
  var MAXA = renderer.capabilities.getMaxAnisotropy();
  var FT = 3.28084, MLAT = 111320, MLON = 111320 * Math.cos(C.origin[0] * Math.PI / 180);
  function toXZ(lat, lon) { return [(lon - C.origin[1]) * MLON * FT, -(lat - C.origin[0]) * MLAT * FT]; }

  // ---------- helpers ----------
  function bbox(pts) { var b = [1e9, 1e9, -1e9, -1e9]; pts.forEach(function (p) { if (p[0] < b[0]) b[0] = p[0]; if (p[1] < b[1]) b[1] = p[1]; if (p[0] > b[2]) b[2] = p[0]; if (p[1] > b[3]) b[3] = p[1]; }); return b; }
  function inside(pts, x, z) { var c = false; for (var i = 0, j = pts.length - 1; i < pts.length; j = i++) { var a = pts[i], b = pts[j]; if (((a[1] > z) !== (b[1] > z)) && (x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0])) c = !c; } return c; }
  function area(pts) { var s = 0; for (var i = 0; i < pts.length; i++) { var p = pts[i], q = pts[(i + 1) % pts.length]; s += p[0] * q[1] - q[0] * p[1]; } return Math.abs(s / 2); }
  function centroid(pts) { var x = 0, z = 0; pts.forEach(function (p) { x += p[0]; z += p[1]; }); return [x / pts.length, z / pts.length]; }
  function obb(pts) {
    var best = null;
    for (var i = 0; i < pts.length; i++) {
      var p = pts[i], q = pts[(i + 1) % pts.length], ang = Math.atan2(q[1] - p[1], q[0] - p[0]);
      var ux = Math.cos(ang), uz = Math.sin(ang), vx = -uz, vz = ux, a0 = 1e9, a1 = -1e9, b0 = 1e9, b1 = -1e9;
      pts.forEach(function (r) { var a = r[0] * ux + r[1] * uz, b = r[0] * vx + r[1] * vz; if (a < a0) a0 = a; if (a > a1) a1 = a; if (b < b0) b0 = b; if (b > b1) b1 = b; });
      var ar = (a1 - a0) * (b1 - b0);
      if (!best || ar < best.ar) best = { ar: ar, ux: ux, uz: uz, vx: vx, vz: vz, a0: a0, a1: a1, b0: b0, b1: b1 };
    }
    var ca = (best.a0 + best.a1) / 2, cb = (best.b0 + best.b1) / 2, la = best.a1 - best.a0, lb = best.b1 - best.b0;
    var o = { cx: ca * best.ux + cb * best.vx, cz: ca * best.uz + cb * best.vz };
    if (la >= lb) { o.ux = best.ux; o.uz = best.uz; o.L = la; o.W = lb; } else { o.ux = best.vx; o.uz = best.vz; o.L = lb; o.W = la; }
    return o;
  }
  function textSprite(text, worldW) {
    var cv = document.createElement('canvas'); cv.width = 512; cv.height = 96;
    var g = cv.getContext('2d'); g.font = 'bold 46px Arial'; g.textAlign = 'center'; g.lineWidth = 10;
    g.strokeStyle = 'rgba(255,255,255,0.92)'; g.strokeText(text, 256, 62); g.fillStyle = '#26303f'; g.fillText(text, 256, 62);
    var sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), depthWrite: false, depthTest: false }));
    sp.scale.set(worldW, worldW * 96 / 512, 1); return sp;
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function findAt(list, x, z) { for (var i = 0; i < list.length; i++) { var b = list[i].bb; if (x >= b[0] && x <= b[2] && z >= b[1] && z <= b[3] && inside(list[i].pts, x, z)) return list[i]; } return null; }
  // Storeys are estimated from footprint unless a lidar roof height came with the data (b.hp).
  function heightOf(b, fp) {
    if (b.h) { var h = parseFloat(b.h) * 3.28084; if (h > 6) return { wall: Math.max(8, h - 7), est: false }; }
    if (b.l) { var l = parseFloat(b.l); if (l > 0) return { wall: l * 9.5 + 1, est: false }; }
    if (fp < 350) return { wall: 8.5, est: true };
    if (fp < 900) return { wall: 10.5, est: true };
    var mix = Math.abs(Math.round(b.p[0][0] * 7 + b.p[0][1] * 13)) % 10;
    if (fp < 4500) return { wall: (fp < 1350 ? mix < 6 : mix < 2) ? 19 : 11, est: true };
    return { wall: fp > 20000 ? 26 : 18, est: true };
  }

  // ---------- ground + regional backdrop ----------
  var ground = new THREE.Mesh(new THREE.PlaneGeometry(200000, 200000), new THREE.MeshLambertMaterial({ color: 0x8f9a7c }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -0.6; scene.add(ground);
  var BD = window.AREA_BACKDROP, backdrop = null;
  if (BD) {
    backdrop = new THREE.Mesh(new THREE.PlaneGeometry(BD.x1 - BD.x0, BD.z1 - BD.z0), new THREE.MeshLambertMaterial({ color: 0x9aa58a }));
    backdrop.rotation.x = -Math.PI / 2; backdrop.position.set((BD.x0 + BD.x1) / 2, -0.3, (BD.z0 + BD.z1) / 2); scene.add(backdrop);
    new THREE.TextureLoader().load((CFG.root || '') + BD.src, function (t) { t.anisotropy = MAXA; backdrop.material.map = t; backdrop.material.color.set(0xffffff); backdrop.material.needsUpdate = true; });
  }

  // ---------- shared textures, palettes, materials ----------
  function canvasTex(draw, repeatU, repeatV) {
    var cv = document.createElement('canvas'); cv.width = 64; cv.height = 64; draw(cv.getContext('2d'));
    var t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeatU, repeatV); t.anisotropy = MAXA; return t;
  }
  var sidingTex = canvasTex(function (g) {
    g.fillStyle = '#fff'; g.fillRect(0, 0, 64, 64);
    g.fillStyle = 'rgba(0,0,0,0.16)'; for (var y = 0; y < 64; y += 16) g.fillRect(0, y, 64, 2);
    g.fillStyle = 'rgba(0,0,0,0.05)'; for (var x = 0; x < 64; x += 11) g.fillRect(x, 0, 1, 64);
  }, 1 / 8, 1 / 2.4);
  var roofTex = canvasTex(function (g) {
    g.fillStyle = '#fff'; g.fillRect(0, 0, 64, 64);
    for (var row = 0; row < 4; row++) { var off = (row % 2) * 8; for (var x = -off; x < 64; x += 16) { g.fillStyle = 'rgba(0,0,0,' + (0.04 + ((x + row * 7) % 3) * 0.03) + ')'; g.fillRect(x + 1, row * 16, 15, 14); } g.fillStyle = 'rgba(0,0,0,0.2)'; g.fillRect(0, row * 16 + 14, 64, 2); }
  }, 1 / 6, 1 / 3.2);
  var tileTex = canvasTex(function (g) {
    g.fillStyle = '#fff'; g.fillRect(0, 0, 64, 64);
    for (var x = 0; x < 64; x += 16) { var gr = g.createLinearGradient(x, 0, x + 16, 0); gr.addColorStop(0, 'rgba(0,0,0,0.32)'); gr.addColorStop(0.45, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,0.26)'); g.fillStyle = gr; g.fillRect(x, 0, 16, 64); }
    g.fillStyle = 'rgba(0,0,0,0.14)'; for (var y = 0; y < 64; y += 21) g.fillRect(0, y, 64, 2);
  }, 1 / 4, 1 / 3);
  var windowTex = canvasTex(function (g) {
    g.fillStyle = '#f4f3ef'; g.fillRect(0, 0, 64, 64);
    var gr = g.createLinearGradient(0, 0, 64, 64); gr.addColorStop(0, '#4c5d6e'); gr.addColorStop(1, '#2b3540');
    g.fillStyle = gr; g.fillRect(7, 7, 50, 50);
    g.fillStyle = '#f4f3ef'; g.fillRect(30, 7, 4, 50); g.fillRect(7, 28, 50, 4);
  }, 1, 1);
  windowTex.wrapS = windowTex.wrapT = THREE.ClampToEdgeWrapping;
  var WALLS = [0xe3d8c4, 0xd6c9ae, 0xc9c3b8, 0xb7a88d, 0x9aa39a, 0xa9b1b8, 0xc4b59a, 0xe8e2d6, 0x8e97a2, 0xd8c6a6, 0x9da7ae, 0xb3ae9a];
  var STUCCO = [0xf1e9d8, 0xe9dcc3, 0xf4efe6, 0xe6d5b8, 0xead9c9, 0xdccbb0, 0xe2d7c5, 0xd9c7a8];
  var DOORS = [0xb0442c, 0x3e5a74, 0x2f3f55, 0x5a6b45, 0x7a3b2e, 0x8a6a4a];
  var COMM = [0xd9d2c4, 0xcfc8ba, 0xc4bcae, 0xddd6cb, 0xbdb7ab, 0xd2c7b3], AWN = [0x8a3b2e, 0x2f4a6b, 0x3f5d49, 0x7a5a2e, 0x5b3a52];
  var TRIM = new THREE.Color(0xf4f3ef);
  var MAT = {
    wall: new THREE.MeshLambertMaterial({ vertexColors: true, map: sidingTex, side: THREE.DoubleSide }),
    roof: new THREE.MeshLambertMaterial({ vertexColors: true, map: roofTex, side: THREE.DoubleSide }),
    tile: new THREE.MeshLambertMaterial({ vertexColors: true, map: tileTex, side: THREE.DoubleSide }),
    trim: new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }),
    win: new THREE.MeshLambertMaterial({ map: windowTex, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    road: new THREE.MeshLambertMaterial({ color: 0x63666b, side: THREE.DoubleSide }),
    walk: new THREE.MeshLambertMaterial({ color: 0xd9d4c9, side: THREE.DoubleSide }),
    lot: new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.38, depthWrite: false }),
    crown: new THREE.MeshLambertMaterial({ color: 0xffffff }), trunk: new THREE.MeshLambertMaterial({ color: 0x6b4f36 })
  };
  var crownGeo = new THREE.IcosahedronGeometry(1, 1), trunkGeo = new THREE.CylinderGeometry(0.35, 0.5, 1, 6);

  // ---------- geometry accumulators (reset for each tile) ----------
  function Acc(withColor) { return { p: [], n: [], u: [], c: withColor ? [] : null }; }
  var gWall, gRoof, gTile, gTrim, gWin, roadGrid, CELL = 250;
  function tri(acc, a, b, c, ua, ub, uc, col) {
    var ax = b[0] - a[0], ay = b[1] - a[1], az = b[2] - a[2], bx = c[0] - a[0], by = c[1] - a[1], bz = c[2] - a[2];
    var nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx, l = Math.hypot(nx, ny, nz) || 1;
    [a, b, c].forEach(function (v, k) {
      acc.p.push(v[0], v[1], v[2]); acc.n.push(nx / l, ny / l, nz / l);
      var uv = [ua, ub, uc][k] || [0, 0]; acc.u.push(uv[0], uv[1]);
      if (acc.c) acc.c.push(col.r, col.g, col.b);
    });
  }
  function quad(acc, a, b, c, d, ua, ub, uc, ud, col) { tri(acc, a, b, c, ua, ub, uc, col); tri(acc, a, c, d, ua, uc, ud, col); }
  function wallRect(acc, x, z, nx, nz, y0, w, h, off, col) {
    var tx = -nz, tz = nx, hw = w / 2; x += nx * off; z += nz * off;
    quad(acc, [x - tx * hw, y0, z - tz * hw], [x + tx * hw, y0, z + tz * hw], [x + tx * hw, y0 + h, z + tz * hw], [x - tx * hw, y0 + h, z - tz * hw], [0, 0], [1, 0], [1, 1], [0, 1], col);
  }
  function boxGeo(acc, cx, cy, cz, sx, sy, sz, rotY, col) {
    var g = new THREE.BoxGeometry(sx, sy, sz).toNonIndexed(); g.rotateY(rotY); g.translate(cx, cy, cz);
    var p = g.attributes.position.array;
    for (var i = 0; i < p.length; i += 9) tri(acc, [p[i], p[i + 1], p[i + 2]], [p[i + 3], p[i + 4], p[i + 5]], [p[i + 6], p[i + 7], p[i + 8]], null, null, null, col);
    g.dispose();
  }
  function nearestRoad(x, z) {
    var best = null, bd = 1e9, cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    for (var gx = cx - 1; gx <= cx + 1; gx++) for (var gz = cz - 1; gz <= cz + 1; gz++) (roadGrid[gx + ',' + gz] || []).forEach(function (s) {
      var a = s[0], b = s[1], dx = b[0] - a[0], dz = b[1] - a[1], t = ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz || 1);
      t = Math.max(0, Math.min(1, t)); var px = a[0] + dx * t, pz = a[1] + dz * t, d = Math.hypot(px - x, pz - z);
      if (d < bd) { bd = d; best = [px - x, pz - z, d]; }
    });
    return best;
  }
  function flatRoof(acc, pts, y, col) {
    var c = pts.map(function (p) { return new THREE.Vector2(p[0], p[1]); });
    if (c.length > 3 && c[0].equals(c[c.length - 1])) c.pop();
    THREE.ShapeUtils.triangulateShape(c, []).forEach(function (f) {
      var a = [c[f[0]].x, y, c[f[0]].y], b = [c[f[1]].x, y, c[f[1]].y], d = [c[f[2]].x, y, c[f[2]].y];
      var up = (b[2] - a[2]) * (d[0] - a[0]) - (b[0] - a[0]) * (d[2] - a[2]);
      if (up < 0) tri(acc, a, d, b, null, null, null, col); else tri(acc, a, b, d, null, null, null, col);
    });
  }
  function addCanopy(B) {
    var o = obb(B.pts), top = 17, rot = Math.atan2(-o.uz, o.ux), vx = -o.uz, vz = o.ux;
    B.ht.wall = top;
    boxGeo(gTrim, o.cx, top, o.cz, o.L, 1.8, o.W, rot, TRIM);
    boxGeo(gTrim, o.cx, top - 0.2, o.cz, o.L + 0.3, 0.7, o.W + 0.3, rot, new THREE.Color(0xb23a2e));
    [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(function (s) {
      var a = s[0] * Math.max(2, o.L / 2 - 4), b = s[1] * Math.max(2, o.W / 2 - 4);
      boxGeo(gTrim, o.cx + a * o.ux + b * vx, top / 2, o.cz + a * o.uz + b * vz, 1.2, top, 1.2, rot, new THREE.Color(0xd8d8d8));
    });
  }
  function addCommercial(B, i, roofColor) {
    var pts = B.pts, top = B.ht.src === 'lidar' ? Math.max(13, Math.min(B.ht.peak, 70)) : Math.max(15, B.ht.wall);
    B.ht.wall = top;
    var wallC = new THREE.Color(COMM[i % COMM.length]), cap = wallC.clone().multiplyScalar(0.8), awn = new THREE.Color(AWN[i % AWN.length]);
    var sgn = 0, k; for (k = 0; k < pts.length; k++) { var p = pts[k], q = pts[(k + 1) % pts.length]; sgn += p[0] * q[1] - q[0] * p[1]; }
    var o = obb(pts), nr = nearestRoad(o.cx, o.cz), edges = [], longest = -1, ll = 0;
    for (k = 0; k < pts.length; k++) {
      var a = pts[k], b = pts[(k + 1) % pts.length], dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz);
      if (len < 0.5) continue;
      var nx = dz / len, nz = -dx / len; if (sgn < 0) { nx = -nx; nz = -nz; }
      quad(gTrim, [a[0], 0, a[1]], [b[0], 0, b[1]], [b[0], top - 2.4, b[1]], [a[0], top - 2.4, a[1]], null, null, null, null, wallC);
      quad(gTrim, [a[0], top - 2.4, a[1]], [b[0], top - 2.4, b[1]], [b[0], top, b[1]], [a[0], top, a[1]], null, null, null, null, cap);
      var e = { a: a, dx: dx, dz: dz, len: len, nx: nx, nz: nz, face: nr ? (nx * nr[0] + nz * nr[1]) / (nr[2] || 1) : 0 };
      edges.push(e); if (len > ll) { ll = len; longest = edges.length - 1; }
    }
    var anyFront = edges.some(function (e) { return e.face > 0.3 && e.len >= 14; });
    var floors = Math.max(1, Math.floor(top / 12.5)), wins = 0;
    edges.forEach(function (e, idx) {
      if (e.len < 14) return;
      var front = anyFront ? e.face > 0.3 : idx === longest, n, w, t;
      if (front) {
        n = Math.max(1, Math.floor((e.len - 3) / 11));
        for (w = 0; w < n && wins < 160; w++) { t = (w + 0.5) / n; wallRect(gWin, e.a[0] + e.dx * t, e.a[1] + e.dz * t, e.nx, e.nz, 0.8, 8.4, 8.4, 0.15, null); wins++; }
        boxGeo(gTrim, e.a[0] + e.dx / 2 + e.nx * 1.7, 10.4, e.a[1] + e.dz / 2 + e.nz * 1.7, Math.max(6, e.len - 3), 0.55, 3.4, Math.atan2(e.nx, e.nz), awn);
      }
      for (var f = 1; f < floors; f++) {
        n = Math.max(1, Math.floor((e.len - 3) / 12));
        for (w = 0; w < n && wins < 160; w++) { t = (w + 0.5) / n; wallRect(gWin, e.a[0] + e.dx * t, e.a[1] + e.dz * t, e.nx, e.nz, f * 12.5 + 2.6, 4.4, 5.4, 0.15, null); wins++; }
      }
    });
    flatRoof(gTrim, pts, top - 1.6, roofColor);
  }
  function addBuilding(B, i, roofColor) {
    if (B.kind === 'canopy') { addCanopy(B); return; }
    if (B.kind === 'commercial') { addCommercial(B, i, roofColor); return; }
    var pts = B.pts, h = B.ht.wall, wallC = new THREE.Color(WALLS[i % WALLS.length]), city = B.ht.src === 'city';
    var sgn = 0; for (var k = 0; k < pts.length; k++) { var p = pts[k], q = pts[(k + 1) % pts.length]; sgn += p[0] * q[1] - q[0] * p[1]; }
    var seedN = ((i * 2654435761) >>> 0) % 1000 / 1000, hs = {}; roofColor.getHSL(hs);
    var tile = !city && (hs.h < 0.075 || hs.h > 0.97) && hs.s > 0.22 && hs.l > 0.2;
    var stucco = tile || (seedN < 0.28 && !city);
    var wAcc = stucco ? gTrim : gWall, rAcc = tile ? gTile : gRoof;
    if (stucco) wallC = new THREE.Color(STUCCO[i % STUCCO.length]);
    if (tile) roofColor = roofColor.clone().lerp(new THREE.Color(0xb5653f), 0.55);
    var two = h >= 17, hm = two ? h * 0.52 : h, upC = two && !stucco ? wallC.clone().multiplyScalar(i % 2 ? 0.9 : 1.07) : wallC;
    var run = 0;
    for (k = 0; k < pts.length; k++) {
      var a = pts[k], b = pts[(k + 1) % pts.length], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      quad(wAcc, [a[0], 0, a[1]], [b[0], 0, b[1]], [b[0], hm, b[1]], [a[0], hm, a[1]], [run, 0], [run + len, 0], [run + len, hm], [run, hm], wallC);
      if (two) {
        quad(wAcc, [a[0], hm, a[1]], [b[0], hm, b[1]], [b[0], h, b[1]], [a[0], h, a[1]], [run, hm], [run + len, hm], [run + len, h], [run, h], upC);
        if (len > 1) { var bnx = (b[1] - a[1]) / len, bnz = -(b[0] - a[0]) / len; if (sgn < 0) { bnx = -bnx; bnz = -bnz; } wallRect(gTrim, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, bnx, bnz, hm - 0.35, len + 0.2, 0.7, 0.1, TRIM); }
      }
      run += len;
    }
    var o = obb(pts), fill = B.fp / (o.L * o.W), vx = -o.uz, vz = o.ux;
    function P(a2, b2, y) { return [o.cx + a2 * o.ux + b2 * vx, y, o.cz + a2 * o.uz + b2 * vz]; }
    var houseLike = B.fp >= 500 && B.fp <= 4500;
    var ranchHip = !two && !B.kind && o.W > 24 && seedN > 0.55 && !city;
    if (fill > 0.68 && o.W < 70 && B.fp < 7000 && !ranchHip) {
      var rise = B.ht.peak ? Math.max(2, Math.min(16, B.ht.peak - h)) : Math.max(3, Math.min(11, o.W * 0.36)), oh = 1.4, La = o.L / 2 + oh, Wb = o.W / 2 + oh, drop = oh * rise / (o.W / 2);
      var slopeLen = Math.hypot(Wb, rise + drop);
      [1, -1].forEach(function (s) {
        quad(rAcc, P(-La, s * Wb, h - drop), P(La, s * Wb, h - drop), P(La, 0, h + rise), P(-La, 0, h + rise), [-La, 0], [La, 0], [La, slopeLen], [-La, slopeLen], roofColor);
        quad(gTrim, P(-La, s * Wb, h - drop - 0.7), P(La, s * Wb, h - drop - 0.7), P(La, s * Wb, h - drop), P(-La, s * Wb, h - drop), null, null, null, null, TRIM);
      });
      [1, -1].forEach(function (e) {
        var A0 = e * o.L / 2, Ae = e * La;
        tri(wAcc, P(A0, -o.W / 2, h), P(A0, o.W / 2, h), P(A0, 0, h + rise), [0, h], [o.W, h], [o.W / 2, h + rise], upC);
        [1, -1].forEach(function (s) { quad(gTrim, P(Ae, s * Wb, h - drop), P(Ae, 0, h + rise), P(Ae, 0, h + rise + 0.6), P(Ae, s * Wb, h - drop + 0.6), null, null, null, null, TRIM); });
      });
    } else {
      var r2 = B.ht.peak ? Math.max(2, Math.min(14, B.ht.peak - h)) : Math.max(3, Math.min(9, o.W * 0.22));
      var c4 = [P(-o.L / 2 - 1, -o.W / 2 - 1, h), P(o.L / 2 + 1, -o.W / 2 - 1, h), P(o.L / 2 + 1, o.W / 2 + 1, h), P(-o.L / 2 - 1, o.W / 2 + 1, h)];
      var ridgeHalf = Math.max(0, o.L / 2 - o.W / 2), r0 = P(-ridgeHalf, 0, h + r2), r1 = P(ridgeHalf, 0, h + r2), sl2 = Math.hypot(o.W / 2, r2);
      quad(rAcc, c4[0], c4[1], r1, r0, [0, 0], [o.L, 0], [o.L, sl2], [0, sl2], roofColor);
      quad(rAcc, c4[2], c4[3], r0, r1, [0, 0], [o.L, 0], [o.L, sl2], [0, sl2], roofColor);
      tri(rAcc, c4[1], c4[2], r1, [0, 0], [o.W, 0], [o.W / 2, sl2], roofColor);
      tri(rAcc, c4[3], c4[0], r0, [0, 0], [o.W, 0], [o.W / 2, sl2], roofColor);
    }
    if (houseLike && !B.kind && !city && (i * 7919) % 10 < 4) {
      var chTop = h + (B.ht.peak ? Math.max(2, Math.min(14, B.ht.peak - h)) : 6) + 2.5, cp = P(o.L * 0.22, o.W * 0.18, 0), chH = chTop - h + 2;
      boxGeo(gTrim, cp[0], h - 2 + chH / 2, cp[2], 3.2, chH, 2.6, Math.atan2(-o.uz, o.ux), stucco ? wallC : new THREE.Color(0x9a5f4a));
    }
    if (B.kind === 'church') {
      var rotC = Math.atan2(-o.uz, o.ux), tp = P(-o.L / 2 + 6, 0, 0), th = h + 16;
      boxGeo(gTrim, tp[0], th / 2, tp[2], 10, th, 10, rotC, wallC.clone().multiplyScalar(1.05));
      boxGeo(gTrim, tp[0], th + 4, tp[2], 6, 8, 6, rotC, TRIM);
      boxGeo(gTrim, tp[0], th + 12, tp[2], 2.4, 9, 2.4, rotC, roofColor);
    }
    var front = -1, nr = houseLike ? nearestRoad(o.cx, o.cz) : null;
    if (nr && nr[2] < 220) {
      var best = -2;
      for (k = 0; k < pts.length; k++) {
        var a3 = pts[k], b3 = pts[(k + 1) % pts.length], dx = b3[0] - a3[0], dz = b3[1] - a3[1], l3 = Math.hypot(dx, dz); if (l3 < 8) continue;
        var nx = dz / l3, nz = -dx / l3; if (sgn < 0) { nx = -nx; nz = -nz; }
        var dot = (nx * nr[0] + nz * nr[1]) / nr[2]; if (dot > best) { best = dot; front = k; }
      }
    }
    var floors = h >= 17 ? 2 : 1; if (h > 22) floors = Math.max(2, Math.floor(h / 10));
    var winCount = 0;
    for (k = 0; k < pts.length; k++) {
      var a4 = pts[k], b4 = pts[(k + 1) % pts.length], ddx = b4[0] - a4[0], ddz = b4[1] - a4[1], len4 = Math.hypot(ddx, ddz);
      if (len4 < 7) continue;
      var nx4 = ddz / len4, nz4 = -ddx / len4; if (sgn < 0) { nx4 = -nx4; nz4 = -nz4; }
      var doorT = -1, garT = -1, gw = 0;
      if (k === front) {
        if (!city && len4 > 26 && B.fp > 1100) {
          gw = len4 > 38 ? 16 : 8.6; garT = 1 - (gw / 2 + 2.2) / len4;
          if ((garT - 0.28) * len4 < gw / 2 + 4) { garT = -1; gw = 0; }
        }
        doorT = garT > 0 ? 0.28 : (len4 > 22 ? 0.35 : 0.5);
        var dxp = a4[0] + ddx * doorT, dzp = a4[1] + ddz * doorT, tx4 = ddx / len4, tz4 = ddz / len4, toRoad = nr[0] * nx4 + nr[1] * nz4;
        var flat = (function (nx4, nz4, tx4, tz4) { return function (cx, cz, w, y, col) {
          var out = toRoad - ((cx - o.cx) * nx4 + (cz - o.cz) * nz4) - 13;
          if (out < 5 || out > 120) return;
          quad(gTrim, [cx - tx4 * w / 2, y, cz - tz4 * w / 2], [cx + tx4 * w / 2, y, cz + tz4 * w / 2],
            [cx + tx4 * w / 2 + nx4 * out, y, cz + tz4 * w / 2 + nz4 * out], [cx - tx4 * w / 2 + nx4 * out, y, cz - tz4 * w / 2 + nz4 * out], null, null, null, null, col);
        }; })(nx4, nz4, tx4, tz4);
        flat(dxp, dzp, 3.8, 0.74, new THREE.Color(0xcfc9bd));
        if (garT > 0) {
          var gx = a4[0] + ddx * garT, gz = a4[1] + ddz * garT, garC = (i % 2) ? new THREE.Color(0xeeeae0) : wallC.clone().multiplyScalar(0.84);
          wallRect(gTrim, gx, gz, nx4, nz4, 0, gw + 0.9, 7.9, 0.1, TRIM);
          wallRect(gTrim, gx, gz, nx4, nz4, 0, gw, 7.4, 0.18, garC);
          for (var yy = 1.85; yy < 6; yy += 1.85) wallRect(gTrim, gx, gz, nx4, nz4, yy, gw, 0.14, 0.24, garC.clone().multiplyScalar(0.78));
          flat(gx, gz, gw + 2, 0.72, new THREE.Color(0xbfb9ad));
        }
        wallRect(gTrim, dxp, dzp, nx4, nz4, 0, 4.2, 7.8, 0.12, TRIM);
        wallRect(gTrim, dxp, dzp, nx4, nz4, 0, 3.2, 7.2, 0.2, new THREE.Color(DOORS[i % DOORS.length]));
        var rot = Math.atan2(nx4, nz4), pc = 5;
        boxGeo(gTrim, dxp + nx4 * pc / 2, 9.4, dzp + nz4 * pc / 2, 10, 0.5, pc, rot, roofColor);
        for (var sp = -1; sp <= 1; sp += 2) boxGeo(gTrim, dxp + nx4 * (pc - 0.4) + (-nz4) * sp * 4.4, 4.7, dzp + nz4 * (pc - 0.4) + nx4 * sp * 4.4, 0.6, 9.4, 0.6, rot, TRIM);
        boxGeo(gTrim, dxp + nx4 * pc / 2, 0.4, dzp + nz4 * pc / 2, 10, 0.8, pc, rot, new THREE.Color(0xb9b2a5));
      }
      var n4 = Math.max(1, Math.floor((len4 - 2) / 10));
      for (var f = 0; f < floors && winCount < 48; f++) {
        var y0 = 3.2 + f * (h / floors);
        for (var w = 0; w < n4 && winCount < 48; w++) {
          var t = (w + 0.5) / n4;
          if (f === 0 && doorT >= 0 && Math.abs(t - doorT) * len4 < 4.5) continue;
          if (f === 0 && garT > 0 && Math.abs(t - garT) * len4 < gw / 2 + 2.4) continue;
          wallRect(gWin, a4[0] + ddx * t, a4[1] + ddz * t, nx4, nz4, y0, 3.4, 4.2, 0.12, null);
          winCount++;
        }
      }
    }
  }
  function finish(acc, material, group) {
    if (!acc.p.length) return null;
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(acc.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(acc.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(acc.u, 2));
    if (acc.c) g.setAttribute('color', new THREE.Float32BufferAttribute(acc.c, 3));
    var m = new THREE.Mesh(g, material); group.add(m); return m;
  }

  // ---------- places (one citywide list) + rail ----------
  var PL = window.AREA_PLACES || null, places = PL ? PL.places : [];
  var NONRES = { food: 1, shopping: 1, services: 1, arts: 1, community: 1, schools: 1 };
  var COMM_T = { commercial: 1, retail: 1, industrial: 1, hotel: 1, school: 1, government: 1, hangar: 1, supermarket: 1, warehouse: 1, office: 1, service: 1, public: 1, civic: 1, kindergarten: 1, hospital: 1, train_station: 1 };
  var placesByTile = {};
  places.forEach(function (p, i) {
    p.i = i; p.minor = p.n === p.s || p.s === 'EV charging'; p.v = new THREE.Vector3(p.x, 16, p.z);
    var k = Math.floor(p.x / T) + '_' + Math.floor(p.z / T); (placesByTile[k] = placesByTile[k] || []).push(p);
  });
  (function () {
    if (!PL) return;
    var bed = [], steel = [], plat = [];
    function strip(arr, a, b, off, w, y) {
      var dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz); if (l < 0.5) return;
      var px = -dz / l, pz = dx / l, o1 = off - w / 2, o2 = off + w / 2;
      arr.push(a[0] + px * o1, y, a[1] + pz * o1, b[0] + px * o1, y, b[1] + pz * o1, b[0] + px * o2, y, b[1] + pz * o2,
               a[0] + px * o1, y, a[1] + pz * o1, b[0] + px * o2, y, b[1] + pz * o2, a[0] + px * o2, y, a[1] + pz * o2);
    }
    (PL.rails || []).forEach(function (r) { for (var i = 0; i < r.length - 1; i++) { strip(bed, r[i], r[i + 1], 0, 11, 0.9); strip(steel, r[i], r[i + 1], 2.4, 0.6, 1.3); strip(steel, r[i], r[i + 1], -2.4, 0.6, 1.3); } });
    (PL.platforms || []).forEach(function (pl) {
      var a = pl[0], b = pl[pl.length - 1], closed = pl.length > 3 && Math.hypot(a[0] - b[0], a[1] - b[1]) < 1;
      if (closed) { var far = a, fd = 0; pl.forEach(function (q) { var d = Math.hypot(q[0] - a[0], q[1] - a[1]); if (d > fd) { fd = d; far = q; } }); b = far; strip(plat, a, b, 0, 14, 3.2); }
      else for (var i = 0; i < pl.length - 1; i++) strip(plat, pl[i], pl[i + 1], 0, 14, 3.2);
      var dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1, mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2, sl = Math.min(90, l * 0.4);
      if (l < 60) return;
      var roof = new THREE.Mesh(new THREE.BoxGeometry(sl, 0.8, 12), new THREE.MeshLambertMaterial({ color: 0x2f6f5e }));
      roof.position.set(mx, 15, mz); roof.rotation.y = Math.atan2(-dz, dx); scene.add(roof);
      [-1, 1].forEach(function (s) { var post = new THREE.Mesh(new THREE.BoxGeometry(0.9, 12, 0.9), new THREE.MeshLambertMaterial({ color: 0xe8e8e8 })); post.position.set(mx + s * (sl / 2 - 3) * dx / l, 9, mz + s * (sl / 2 - 3) * dz / l); scene.add(post); });
    });
    [[bed, 0x8d8679], [steel, 0x3a3d42], [plat, 0xcfc9bb]].forEach(function (d) {
      if (!d[0].length) return;
      var g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(d[0], 3)); g.computeVertexNormals();
      scene.add(new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: d[1], side: THREE.DoubleSide })));
    });
  })();

  // ---------- tiles ----------
  var tiles = {}, streetLabels = [], lotsVisible = true, photosVisible = true, pickMeshes = [];
  Object.keys(C.tiles).forEach(function (k) {
    var s = k.split('_'), ix = +s[0], iz = +s[1];
    tiles[k] = { k: k, ix: ix, iz: iz, cx: (ix + 0.5) * T, cz: (iz + 0.5) * T, nb: C.tiles[k][0], hasPhoto: !!C.tiles[k][1], photo: null, photoState: 0, data: null, dataState: 0, detail: null, pix: null };
  });
  var photoGeo = new THREE.PlaneGeometry(T, T); photoGeo.rotateX(-Math.PI / 2);
  function loadPhoto(t) {
    if (t.photoState || !t.hasPhoto) return;
    t.photoState = 1;
    new THREE.TextureLoader().load(BASE + 'tiles/' + t.k + '.jpg', function (tex) {
      if (t.photoState !== 1) { tex.dispose(); return; }
      tex.anisotropy = MAXA; t.photoState = 2;
      t.photo = new THREE.Mesh(photoGeo, new THREE.MeshLambertMaterial({ map: tex }));
      t.photo.position.set(t.cx, 0, t.cz); t.photo.visible = photosVisible; scene.add(t.photo);
    }, undefined, function () { t.photoState = 3; });
  }
  function dropPhoto(t) {
    if (t.photo) { scene.remove(t.photo); t.photo.material.map.dispose(); t.photo.material.dispose(); t.photo = null; }
    t.photoState = 0; t.pix = null;
  }
  function loadData(t) {
    if (t.dataState) return;
    t.dataState = 1;
    fetch(BASE + 'tiles/' + t.k + '.json').then(function (r) { if (!r.ok) throw 0; return r.json(); }).then(function (d) { t.data = d; t.dataState = 2; }).catch(function () { t.dataState = 3; });
  }
  function pixels(t) {
    if (t.pix || !t.photo) return t.pix;
    var img = t.photo.material.map.image, cv = document.createElement('canvas'); cv.width = 256; cv.height = Math.round(256 * img.height / img.width);
    var g = cv.getContext('2d'); g.drawImage(img, 0, 0, cv.width, cv.height);
    t.pix = { d: g.getImageData(0, 0, cv.width, cv.height).data, w: cv.width, h: cv.height };
    return t.pix;
  }
  function sampler(t) {
    var px = pixels(t); if (!px) return function () { return new THREE.Color(0x777777); };
    return function (x, z) {
      var u = Math.min(0.999, Math.max(0, (x - t.ix * T) / T)), v = Math.min(0.999, Math.max(0, (z - t.iz * T) / T));
      var k = (Math.floor(v * px.h) * px.w + Math.floor(u * px.w)) * 4, c = new THREE.Color(px.d[k] / 255, px.d[k + 1] / 255, px.d[k + 2] / 255);
      if (c.g > c.r * 1.08 && c.g > c.b * 1.08) c.lerp(new THREE.Color(0x6b6b68), 0.6);
      var hsl = {}; c.getHSL(hsl);
      return new THREE.Color().setHSL(hsl.h, hsl.s < 0.18 ? hsl.s * 0.5 : Math.min(0.85, hsl.s * 1.2), Math.min(0.6, hsl.l * 0.92));
    };
  }
  var RW = { motorway: 60, trunk: 50, primary: 46, secondary: 42, tertiary: 40, residential: 28, unclassified: 24, living_street: 22, service: 16, motorway_link: 24, trunk_link: 24, primary_link: 22, secondary_link: 20, tertiary_link: 20 };
  var SIDEWALK = { primary: 1, secondary: 1, tertiary: 1, residential: 1, unclassified: 1, living_street: 1 };
  function buildTile(t) {
    var d = t.data, G = new THREE.Group(), D = { group: G, buildings: [], parcels: [], labels: [], pick: [], lots: null };
    var x0 = t.ix * T, z0 = t.iz * T, x1 = x0 + T, z1 = z0 + T;
    function inTile(x, z) { return x >= x0 && x < x1 && z >= z0 && z < z1; }
    // streets (drawn by the tile that holds each segment's midpoint, so nothing is drawn twice)
    var road = [], walk = [], names = {}; roadGrid = {};
    function strip(arr, a, b, off, w, y) {
      var dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz); if (l < 0.5) return;
      var px = -dz / l, pz = dx / l, o1 = off - w / 2, o2 = off + w / 2;
      arr.push(a[0] + px * o1, y, a[1] + pz * o1, b[0] + px * o1, y, b[1] + pz * o1, b[0] + px * o2, y, b[1] + pz * o2,
               a[0] + px * o1, y, a[1] + pz * o1, b[0] + px * o2, y, b[1] + pz * o2, a[0] + px * o2, y, a[1] + pz * o2);
    }
    d.r.forEach(function (r) {
      var w = RW[r.t]; if (!w) return;
      for (var i = 0; i < r.p.length - 1; i++) {
        var a = r.p[i], b = r.p[i + 1], l = Math.hypot(b[0] - a[0], b[1] - a[1]); if (l < 0.5) continue;
        var mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
        if (r.t !== 'service' && r.t.indexOf('motorway') < 0) {
          var gx0 = Math.floor(Math.min(a[0], b[0]) / CELL), gx1 = Math.floor(Math.max(a[0], b[0]) / CELL), gz0 = Math.floor(Math.min(a[1], b[1]) / CELL), gz1 = Math.floor(Math.max(a[1], b[1]) / CELL), seg = [a, b];
          for (var gx = gx0; gx <= gx1; gx++) for (var gz = gz0; gz <= gz1; gz++) (roadGrid[gx + ',' + gz] = roadGrid[gx + ',' + gz] || []).push(seg);
        }
        if (!inTile(mx, mz)) continue;
        strip(road, a, b, 0, w, 0.7);
        if (SIDEWALK[r.t]) { strip(walk, a, b, w / 2 + 3.5, 5, 0.6); strip(walk, a, b, -(w / 2 + 3.5), 5, 0.6); }
        if (r.n && w >= 28 && (!names[r.n] || l > names[r.n].l)) names[r.n] = { l: l, x: mx, z: mz };
      }
    });
    [[road, MAT.road], [walk, MAT.walk]].forEach(function (q) {
      if (!q[0].length) return;
      var g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(q[0], 3)); g.computeVertexNormals(); G.add(new THREE.Mesh(g, q[1]));
    });
    Object.keys(names).forEach(function (n) {
      if (names[n].l < 120) return;
      var s = textSprite(n.replace(/ Drive$/, ' Dr').replace(/ Avenue$/, ' Ave').replace(/ Boulevard$/, ' Blvd').replace(/ Parkway$/, ' Pkwy').replace(/ Lane$/, ' Ln').replace(/ Street$/, ' St').replace(/ Road$/, ' Rd').replace(/ Court$/, ' Ct'), 150);
      s.position.set(names[n].x, 30, names[n].z); s.renderOrder = 5; G.add(s); D.labels.push(s); streetLabels.push(s);
    });
    // lots
    D.parcels = d.p.map(function (p) { return { apn: p.a, size: p.s, pts: p.p, bb: bbox(p.p) }; });
    var pos = [];
    D.parcels.forEach(function (p) { for (var i = 0; i < p.pts.length; i++) { var a = p.pts[i], b = p.pts[(i + 1) % p.pts.length]; pos.push(a[0], 1.2, a[1], b[0], 1.2, b[1]); } });
    if (pos.length) { var lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); D.lots = new THREE.LineSegments(lg, MAT.lot); D.lots.renderOrder = 2; D.lots.visible = lotsVisible; G.add(D.lots); }
    // buildings
    D.buildings = d.b.map(function (b) {
      var fp = area(b.p), ht = heightOf(b, fp), c = centroid(b.p), P = findAt(D.parcels, c[0], c[1]);
      if (P && P.apn.indexOf('157-860') === 0) ht = { wall: 17.5, peak: 26.7, est: false, src: 'city' };
      else if (b.hp) { var o0 = obb(b.p), rise0 = Math.max(3, Math.min(11, o0.W * 0.36)), peak = Math.min(b.hp, 110); ht = { wall: Math.max(7.5, peak - rise0), peak: peak, est: false, src: 'lidar' }; }
      return { src: b, pts: b.p, bb: bbox(b.p), fp: fp, ht: ht, c: c };
    });
    (placesByTile[t.k] || []).forEach(function (p) {
      var B = findAt(D.buildings, p.x, p.z);
      if (B && NONRES[p.k] && p.s !== 'EV charging') { (B.places = B.places || []).push(p); p.B = B; }
    });
    D.buildings.forEach(function (B) {
      var ty = B.src.t, named = B.src.n && !/^[\d\s-]+$/.test(B.src.n);
      if (B.ht.src === 'city') return;
      var gas = B.fp < 7000 && (/fuel|gas station/i.test(B.src.n || '') || (B.places && B.places.every(function (p) { return p.s === 'Gas station'; })));
      if (ty === 'roof' || gas) B.kind = 'canopy';
      else if (ty === 'religious' || ty === 'church' || (B.places && B.places.some(function (p) { return p.s === 'Church' || p.s === 'Place of worship'; }))) B.kind = 'church';
      else if (COMM_T[ty] || B.places || (named && B.fp > 1500) || (ty === 'yes' && B.fp > 12000)) B.kind = 'commercial';
    });
    gWall = Acc(true); gRoof = Acc(true); gTile = Acc(true); gTrim = Acc(true); gWin = Acc(false);
    var sample = sampler(t);
    D.buildings.forEach(function (B) {
      var i = Math.abs(Math.round(B.c[0] * 3 + B.c[1] * 7));
      addBuilding(B, i, sample(B.c[0], B.c[1]));
    });
    // backyard fences along lot lines, open toward the street
    var fenced = {};
    D.buildings.forEach(function (B) {
      if (B.kind || B.fp < 500 || B.ht.src === 'city') return;
      var P = findAt(D.parcels, B.c[0], B.c[1]);
      if (!P || fenced[P.apn] || P.size < 3000 || P.size > 22000) return;
      fenced[P.apn] = 1;
      for (var e = 0; e < P.pts.length; e++) {
        var a = P.pts[e], b = P.pts[(e + 1) % P.pts.length], len = Math.hypot(b[0] - a[0], b[1] - a[1]); if (len < 6) continue;
        var n = Math.max(1, Math.round(len / 12)), col = new THREE.Color((Math.abs(Math.round(a[0] + b[0] + a[1] + b[1])) % 4) ? 0x9c8566 : 0xe6e2d8);
        for (var s = 0; s < n; s++) {
          var p0 = [a[0] + (b[0] - a[0]) * s / n, a[1] + (b[1] - a[1]) * s / n], p1 = [a[0] + (b[0] - a[0]) * (s + 1) / n, a[1] + (b[1] - a[1]) * (s + 1) / n];
          var nr = nearestRoad((p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2);
          if (nr && nr[2] < 48) continue;
          quad(gTrim, [p0[0], 0, p0[1]], [p1[0], 0, p1[1]], [p1[0], 5.5, p1[1]], [p0[0], 5.5, p0[1]], null, null, null, null, col);
        }
      }
    });
    [[gWall, MAT.wall], [gRoof, MAT.roof], [gTile, MAT.tile], [gTrim, MAT.trim]].forEach(function (q) { var m = finish(q[0], q[1], G); if (m) D.pick.push(m); });
    finish(gWin, MAT.win, G);
    gWall = gRoof = gTile = gTrim = gWin = null;
    plantTrees(t, D);
    scene.add(G);
    D.pick.forEach(function (m) { pickMeshes.push(m); });
    return D;
  }
  function plantTrees(t, D) {
    var px = pixels(t); if (!px) return;
    var x0 = t.ix * T, z0 = t.iz * T, spots = [], STEP = 26, seed = (Math.abs(t.ix * 73 + t.iz * 151) % 9973) + 7;
    function rnd() { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }
    var bGrid = {}, BC = 150;
    D.buildings.forEach(function (B) { for (var gx = Math.floor(B.bb[0] / BC); gx <= Math.floor(B.bb[2] / BC); gx++) for (var gz = Math.floor(B.bb[1] / BC); gz <= Math.floor(B.bb[3] / BC); gz++) (bGrid[gx + ',' + gz] = bGrid[gx + ',' + gz] || []).push(B); });
    function inBuilding(x, z) { var l = bGrid[Math.floor(x / BC) + ',' + Math.floor(z / BC)] || []; for (var i = 0; i < l.length; i++) { var b = l[i].bb; if (x > b[0] - 4 && x < b[2] + 4 && z > b[1] - 4 && z < b[3] + 4 && inside(l[i].pts, x, z)) return true; } return false; }
    for (var z = STEP / 2; z < T; z += STEP) for (var x = STEP / 2; x < T; x += STEP) {
      var jx = x + (rnd() - 0.5) * STEP * 0.8, jz = z + (rnd() - 0.5) * STEP * 0.8;
      var k = (Math.min(px.h - 1, Math.floor(jz / T * px.h)) * px.w + Math.min(px.w - 1, Math.floor(jx / T * px.w))) * 4;
      var r = px.d[k], g = px.d[k + 1], b = px.d[k + 2], lum = (r + g + b) / 3;
      if (g > r * 1.05 && g > b * 1.12 && lum < 105 && lum > 25 && !inBuilding(x0 + jx, z0 + jz)) spots.push([x0 + jx, z0 + jz, r, g, b, lum]);
    }
    var cap = MOBILE ? 500 : 900;
    if (spots.length > cap) { var keep = cap / spots.length; spots = spots.filter(function () { return rnd() < keep; }); }
    if (!spots.length) return;
    var crowns = new THREE.InstancedMesh(crownGeo, MAT.crown, spots.length), trunks = new THREE.InstancedMesh(trunkGeo, MAT.trunk, spots.length);
    var m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), v = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), c = new THREE.Color();
    spots.forEach(function (sp, i) {
      var size = 9 + (105 - sp[5]) / 80 * 7 + rnd() * 4, ht = size * (1.5 + rnd() * 0.4);
      m.compose(v.set(sp[0], ht * 0.32, sp[1]), q.identity(), s.set(1.6, ht * 0.64, 1.6)); trunks.setMatrixAt(i, m);
      m.compose(v.set(sp[0], ht * 0.72, sp[1]), q.setFromAxisAngle(up, rnd() * 6.28), s.set(size * 0.6, size * 0.62, size * 0.6)); crowns.setMatrixAt(i, m);
      c.setRGB(sp[2] / 255, sp[3] / 255, sp[4] / 255); var hsl = {}; c.getHSL(hsl);
      c.setHSL(hsl.h, Math.min(0.75, hsl.s * 1.25 + 0.1), Math.min(0.42, hsl.l * 1.35 + 0.08)); crowns.setColorAt(i, c);
    });
    crowns.instanceMatrix.needsUpdate = true; trunks.instanceMatrix.needsUpdate = true; if (crowns.instanceColor) crowns.instanceColor.needsUpdate = true;
    crowns.frustumCulled = trunks.frustumCulled = false;
    D.group.add(trunks); D.group.add(crowns);
  }
  function dropDetail(t) {
    var D = t.detail; if (!D) return;
    if (current && (D.buildings.indexOf(current.B) >= 0 || D.parcels.indexOf(current.P) >= 0)) clearSelection();
    D.buildings.forEach(function (B) { if (B.places) B.places.forEach(function (p) { p.B = null; }); });
    D.labels.forEach(function (s) { var i = streetLabels.indexOf(s); if (i >= 0) streetLabels.splice(i, 1); s.material.map.dispose(); s.material.dispose(); });
    D.pick.forEach(function (m) { var i = pickMeshes.indexOf(m); if (i >= 0) pickMeshes.splice(i, 1); });
    D.group.traverse(function (o) { if (o.geometry && o.geometry !== crownGeo && o.geometry !== trunkGeo) o.geometry.dispose(); if (o.isInstancedMesh) o.dispose(); });
    scene.remove(D.group); t.detail = null;
  }
  // Decide which tiles to show, a few times a second; build at most one tile per pass so moving stays smooth.
  var lastKey = '', firstDetail = false;
  function updateTiles() {
    var tg = controls.target, dist = camera.position.distanceTo(tg);
    var detailR = Math.max(2400, Math.min(5600, dist * 0.95)), photoR = Math.max(6000, Math.min(20000, dist * 1.9));
    var list = Object.keys(tiles).map(function (k) { var t = tiles[k]; t.d = Math.hypot(t.cx - tg.x, t.cz - tg.z); return t; }).sort(function (a, b) { return a.d - b.d; });
    var nPhoto = 0, nDetail = 0, built = false, pending = 0;
    list.forEach(function (t) {
      var wantPhoto = t.d < photoR + T && nPhoto < MAX_PHOTO, wantDetail = t.d < detailR + T * 0.7 && nDetail < MAX_DETAIL && dist < 9000;
      if (wantPhoto) { nPhoto++; loadPhoto(t); } else if (t.photoState && t.d > photoR * 1.25 + T && !t.detail) dropPhoto(t);
      if (wantDetail) {
        nDetail++; loadData(t); loadPhoto(t);
        if (!t.detail) {
          var photoDone = !t.hasPhoto || t.photoState >= 2;
          if (t.dataState === 2 && photoDone && !built) { t.detail = buildTile(t); built = true; firstDetail = true; }
          else if (t.dataState < 3) pending++;
        }
      } else if (t.detail && (t.d > detailR * 1.3 + T || dist > 11000)) dropDetail(t);
    });
    var ld = document.getElementById('loading');
    if (ld) { if (!firstDetail) ld.style.display = ''; else { ld.style.display = pending ? '' : 'none'; ld.classList.add('chip'); } }
  }
  setInterval(updateTiles, 220);

  // ---------- selection + info panel ----------
  var selGroup = new THREE.Group(); scene.add(selGroup);
  var info = document.getElementById('info'), infoBody = document.getElementById('info-body');
  var LEAD = CFG.leadForm || null, current = null;
  function outline(pts, color, y) {
    var v = pts.concat([pts[0]]).map(function (p) { return new THREE.Vector3(p[0], y, p[1]); });
    var l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(v), new THREE.LineBasicMaterial({ color: color, depthTest: false }));
    l.renderOrder = 10; return l;
  }
  function clearSelection() { while (selGroup.children.length) selGroup.remove(selGroup.children[0]); info.classList.remove('open'); markPin(null); current = null; }
  function eachDetail(fn) { for (var k in tiles) if (tiles[k].detail) { var r = fn(tiles[k].detail); if (r) return r; } return null; }
  function nearestAddress(x, z, maxD) { var best = null, bd = maxD; eachDetail(function (D) { }); for (var k in tiles) { var t = tiles[k]; if (!t.detail || !t.data.a) continue; t.data.a.forEach(function (a) { var d = Math.hypot(a.p[0] - x, a.p[1] - z); if (d < bd) { bd = d; best = a.n; } }); } return best; }
  function heightText(B) {
    return B.ht.src === 'lidar' ? 'roof peak about ' + Math.round(B.ht.peak) + ' ft above ground (measured by 2018 USGS lidar)'
      : B.ht.src === 'city' ? 'up to 27 ft per the City-approved plans'
      : B.ht.est ? (B.ht.wall >= 18 ? 'likely two storeys (estimated)' : 'likely one storey (estimated)') : 'height from map data';
  }
  function showDetails() {
    var s = current, P = s.P, B = s.B, rows = [];
    rows.push('<h3>' + esc(s.addr || (B && B.src.n) || 'Selected home') + '</h3>');
    if (P) rows.push('<p><b>APN</b> ' + esc(P.apn) + ' &middot; <b>Lot</b> about ' + P.size.toLocaleString() + ' sq ft</p>');
    if (B) rows.push('<p><b>Building footprint</b> about ' + Math.round(B.fp).toLocaleString() + ' sq ft &middot; ' + heightText(B) + '</p>');
    if (LEAD && P) rows.push('<p class="btns"><button class="btn cta" id="lead-open">What&rsquo;s my home worth? &rarr;</button></p>');
    rows.push(nearbyHtml(s.x, s.z));
    rows.push('<p class="fine">Lot sizes from the county parcel map (not survey accurate). Building outlines &copy; OpenStreetMap contributors.</p>');
    infoBody.innerHTML = rows.join('');
    var lo = document.getElementById('lead-open'); if (lo) lo.addEventListener('click', showLeadForm);
  }
  function showLeadForm() {
    var s = current, P = s.P, B = s.B;
    infoBody.innerHTML =
      '<h3>Free home value report</h3><p>Get a free comparative market analysis for your Novato home from ' + esc(LEAD.agent) + '. No cost, no obligation.</p>' +
      '<form id="lead-form" novalidate>' +
      '<label>Property address<input name="address" required autocomplete="street-address" placeholder="123 Main St, Novato" value="' + esc(s.addr || '') + '"></label>' +
      '<label>Your name<input name="name" required autocomplete="name"></label>' +
      '<label>Email<input name="email" type="email" autocomplete="email"></label>' +
      '<label>Phone<input name="phone" type="tel" autocomplete="tel"></label>' +
      '<label>Thinking about selling?<select name="timeframe"><option>Just curious</option><option>In the next 3 months</option><option>3&ndash;12 months</option><option>More than a year out</option></select></label>' +
      '<label>Anything else? (optional)<textarea name="message" rows="2"></textarea></label>' +
      '<input type="hidden" name="apn" value="' + esc(P ? P.apn : '') + '"><input type="hidden" name="lot_sqft" value="' + (P ? P.size : '') + '">' +
      '<input type="hidden" name="footprint_sqft" value="' + (B ? Math.round(B.fp) : '') + '">' +
      '<input type="hidden" name="_subject" value="Home value request (Novato 3D map)"><input type="hidden" name="source" value="Novato 3D map">' +
      '<input type="text" name="_gotcha" class="hp" tabindex="-1" autocomplete="off">' +
      '<p class="err" id="lead-err" role="alert"></p>' +
      '<button type="submit" class="btn cta">Request my free report</button> <button type="button" class="btn alt" id="lead-back">Back</button>' +
      '<p class="fine">' + LEAD.consent + '</p></form>';
    document.getElementById('lead-back').addEventListener('click', showDetails);
    var f = document.getElementById('lead-form'), err = document.getElementById('lead-err');
    f.addEventListener('input', function () { err.textContent = ''; });
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var d = new FormData(f);
      if (!String(d.get('address')).trim()) { err.textContent = 'Enter the property address.'; return; }
      if (!String(d.get('name')).trim()) { err.textContent = 'Enter your name.'; return; }
      var em = String(d.get('email')).trim(), ph = String(d.get('phone')).trim();
      if (!em && !ph) { err.textContent = 'Add an email or a phone number so Nathan can reach you.'; return; }
      if (em && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) { err.textContent = 'That email doesn’t look right.'; return; }
      var btn = f.querySelector('button[type=submit]'); btn.disabled = true; btn.textContent = 'Sending…';
      fetch(LEAD.endpoint, { method: 'POST', body: d, headers: { Accept: 'application/json' } }).then(function (r) {
        if (!r.ok) throw new Error('status ' + r.status);
        infoBody.innerHTML = '<h3>Thanks, request received</h3><p>' + esc(LEAD.agent) + ' will be in touch shortly with your home value report.</p><p class="btns"><button class="btn alt" id="lead-done">Back to the map</button></p>';
        document.getElementById('lead-done').addEventListener('click', clearSelection);
      }).catch(function () { btn.disabled = false; btn.textContent = 'Try again'; err.innerHTML = 'Couldn’t send just now. You can also call or text ' + esc(LEAD.phone) + '.'; });
    });
  }
  function select(x, z) {
    while (selGroup.children.length) selGroup.remove(selGroup.children[0]);
    var B = eachDetail(function (D) { return findAt(D.buildings, x, z); }), P = eachDetail(function (D) { return findAt(D.parcels, x, z); });
    if (!B && !P) { clearSelection(); return; }
    if (B && B.places && B.kind) { selectPlace(B.places[0], false); return; }
    markPin(null);
    if (P) selGroup.add(outline(P.pts, 0x3fa7ff, 1.6));
    if (B) selGroup.add(outline(B.pts, 0xffffff, B.ht.wall + 0.5));
    current = { P: P, B: B, addr: (B && B.src.a) || nearestAddress(x, z, 40), x: x, z: z };
    if (B && !B.kind) lastHome = { x: x, z: z, label: current.addr || 'the home you picked' };
    showDetails(); info.classList.add('open');
  }

  // ---------- places: pins, filter chips, cards, "what's nearby" ----------
  var CATS = {
    food: { l: 'Food & drink', c: '#b4532a', e: '🍴' }, shopping: { l: 'Shopping', c: '#7a4fa3', e: '🛍️' },
    parks: { l: 'Parks & play', c: '#2f7d4f', e: '🌳' }, arts: { l: 'Arts & history', c: '#a8324a', e: '🎭' },
    community: { l: 'Community', c: '#2f5f9e', e: '🏛️' }, schools: { l: 'Schools', c: '#b07d00', e: '🎓' },
    transit: { l: 'Transit', c: '#1f7a8c', e: '🚆' }, services: { l: 'Services', c: '#5b6474', e: '📍' }
  };
  var SUB_E = { 'Café': '☕', 'Church': '⛪', 'Place of worship': '⛪', 'Library': '📚', 'Playground': '🧒', 'Gas station': '⛽',
    'Hotel': '🏨', 'Bank': '🏦', 'EV charging': '🔌', 'Grocery store': '🛒', 'Fire station': '🚒', 'Freeway bus stop': '🚌',
    'Dentist': '🦷', 'Sports field': '⚾', 'Skatepark': '🛹', 'Gym': '💪', 'Nature preserve': '🦆', 'Garden': '🌷',
    'Viewpoint': '🔭', 'Quick bite': '🍔', 'Restaurant': '🍽️', 'Pet shop': '🐾', 'Sports center': '🏊', 'Shipping': '📦',
    'Museum': '🏛️', 'Community center': '🤝', 'Pharmacy': '💊', 'Police': '🚓', 'Post office': '📮', 'City hall': '🏛️', 'Dog park': '🐕' };
  function emo(p) { return SUB_E[p.s] || CATS[p.k].e; }
  var lastHome = null, selPlace = null, placeCat = 'all', plWrap = null;
  function walkText(d) { var min = Math.round(d * 1.3 / 272); return min <= 30 ? 'about ' + Math.max(1, min) + ' min walk' : 'about ' + (d * 1.3 / 5280).toFixed(1) + ' mi'; }
  function hoursText(h) {
    var D = { Mo: 'Mon', Tu: 'Tue', We: 'Wed', Th: 'Thu', Fr: 'Fri', Sa: 'Sat', Su: 'Sun' };
    return h.split(';').map(function (s) { return s.trim(); }).filter(function (s) { return s && !/\[|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|PH/.test(s); })
      .map(function (s) { return s.replace(/\b(Mo|Tu|We|Th|Fr|Sa|Su)\b/g, function (m) { return D[m]; }).replace(/\boff\b/g, 'closed').replace(/-/g, '–'); }).join('; ');
  }
  function pinEl(p) {
    if (p.el) return p.el;
    var el = document.createElement('button'); el.type = 'button'; el.className = 'pl'; el.style.setProperty('--c', CATS[p.k].c); el.title = p.n; el.style.display = 'none';
    el.innerHTML = '<span class="ic">' + emo(p) + '</span><span class="nm">' + esc(p.n) + '</span>';
    el.addEventListener('click', function () { selectPlace(p, true); });
    plWrap.appendChild(el); p.el = el; p.shown = false; return el;
  }
  function markPin(p) { if (selPlace && selPlace.el) selPlace.el.classList.remove('sel'); selPlace = p; if (p) pinEl(p).classList.add('sel'); }
  function nearest(x, z, test) { var best = null, bd = 1e9; places.forEach(function (p) { if (p.minor || !test(p)) return; var d = Math.hypot(p.x - x, p.z - z); if (d < bd) { bd = d; best = p; } }); return best ? { p: best, d: bd } : null; }
  function nearbyHtml(x, z) {
    if (!places.length) return '';
    var picks = [
      nearest(x, z, function (p) { return p.s === 'Café'; }), nearest(x, z, function (p) { return p.s === 'Grocery store'; }),
      nearest(x, z, function (p) { return p.k === 'food' && p.s !== 'Café'; }), nearest(x, z, function (p) { return p.k === 'parks'; }),
      nearest(x, z, function (p) { return p.k === 'schools'; }), nearest(x, z, function (p) { return p.k === 'arts'; }),
      nearest(x, z, function (p) { return p.s === 'Train station'; })
    ].filter(Boolean);
    return '<div class="nearby"><h4>What&rsquo;s nearby</h4>' + picks.map(function (n) {
      return '<button type="button" class="near-row" data-pl="' + n.p.i + '"><span class="e">' + emo(n.p) + '</span><span><b>' + esc(n.p.n) + '</b><small>' + esc(n.p.s) + ' &middot; ' + walkText(n.d) + '</small></span></button>';
    }).join('') + (CFG.trackerLink ? '<a class="near-link" href="' + esc(CFG.trackerLink) + '">See what&rsquo;s being built in Novato &rarr;</a>' : '') + '</div>';
  }
  function showPlace(p) {
    var c = CATS[p.k], rows = ['<div class="tag" style="background:' + c.c + '">' + emo(p) + ' ' + esc(p.s) + '</div><h3>' + esc(p.n) + '</h3>'], bits = [];
    if (p.c) bits.push(esc(p.c.charAt(0).toUpperCase() + p.c.slice(1)));
    if (p.a) bits.push(esc(p.a) + ', Novato');
    if (bits.length) rows.push('<p>' + bits.join(' &middot; ') + '</p>');
    var ht = p.h ? hoursText(p.h) : ''; if (ht) rows.push('<p><b>Hours</b> ' + esc(ht) + '</p>');
    if (p.p) rows.push('<p><b>Phone</b> <a href="tel:' + esc(p.p.replace(/[^\d+]/g, '')) + '">' + esc(p.p) + '</a></p>');
    if (lastHome) rows.push('<p>' + walkText(Math.hypot(p.x - lastHome.x, p.z - lastHome.z)).replace(/^a/, 'A') + ' from ' + esc(lastHome.label) + '.</p>');
    var others = p.B && p.B.places ? p.B.places.filter(function (q) { return q !== p; }) : [];
    if (others.length) rows.push('<p><b>Also here:</b> ' + others.map(function (q) { return '<a href="#" data-pl="' + q.i + '">' + esc(q.n) + '</a>'; }).join(', ') + '</p>');
    var btns = [];
    if (p.w) btns.push('<a class="btn" href="' + esc(p.w) + '" target="_blank" rel="noopener">Website &rarr;</a>');
    btns.push('<a class="btn alt" href="https://www.google.com/maps/dir/?api=1&destination=' + p.ll[0] + ',' + p.ll[1] + '" target="_blank" rel="noopener">Directions</a>');
    rows.push('<p class="btns">' + btns.join(' ') + '</p><p class="fine">Place details come from OpenStreetMap volunteers and can be out of date. Check hours before you go.</p>');
    infoBody.innerHTML = rows.join('');
  }
  function flyTo(x, z, d, ms) {
    var q = new THREE.Vector3(x, 0, z), off = camera.position.clone().sub(controls.target); if (d) off.setLength(d);
    anim = { t0: performance.now(), dur: ms || 1300, p0: camera.position.clone(), p1: q.clone().add(off), q0: controls.target.clone(), q1: q };
  }
  function selectPlace(p, fly) {
    while (selGroup.children.length) selGroup.remove(selGroup.children[0]);
    if (p.B) selGroup.add(outline(p.B.pts, 0xffffff, p.B.ht.wall + 0.5));
    current = null; markPin(p);
    if (placeCat !== 'all' && placeCat !== p.k) setPlaceCat('all');
    showPlace(p); info.classList.add('open');
    if (fly) flyTo(p.x, p.z, Math.max(320, Math.min(camera.position.distanceTo(controls.target), 700)), 1100);
  }
  infoBody.addEventListener('click', function (e) { var t = e.target.closest('[data-pl]'); if (!t) return; e.preventDefault(); selectPlace(places[+t.getAttribute('data-pl')], true); });
  function setPlaceCat(k) { placeCat = k; document.querySelectorAll('#placebar button').forEach(function (b) { b.classList.toggle('on', b.dataset.k === k); }); }
  if (places.length) {
    plWrap = document.createElement('div'); plWrap.id = 'places'; document.body.appendChild(plWrap);
    var bar = document.createElement('div'); bar.id = 'placebar'; bar.className = 'views';
    bar.innerHTML = '<button data-k="all" class="on">All places</button>' + Object.keys(CATS).map(function (k) { return '<button data-k="' + k + '">' + CATS[k].e + ' ' + CATS[k].l + '</button>'; }).join('') + '<button data-k="none">Hide places</button>';
    document.body.appendChild(bar);
    bar.addEventListener('click', function (e) { var b = e.target.closest('button'); if (b) setPlaceCat(b.dataset.k); });
  }

  // ---------- pointer: tap to select, wheel zoom to pointer, double-click to fly ----------
  var ray = new THREE.Raycaster(), mouse = new THREE.Vector2(), downAt = null, tapTimer = null, anim = null;
  var groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), gp = new THREE.Vector3();
  function groundAt(cx, cy) { mouse.set(cx / window.innerWidth * 2 - 1, -(cy / window.innerHeight) * 2 + 1); ray.setFromCamera(mouse, camera); return ray.ray.intersectPlane(groundPlane, gp) ? gp.clone() : null; }
  renderer.domElement.addEventListener('pointerdown', function (e) { downAt = [e.clientX, e.clientY]; });
  renderer.domElement.addEventListener('pointerup', function (e) {
    if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 6) return;
    mouse.set(e.clientX / window.innerWidth * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1); ray.setFromCamera(mouse, camera);
    var hit = ray.intersectObjects(pickMeshes, false)[0], pt = hit ? hit.point : (ray.ray.intersectPlane(groundPlane, gp) ? gp : null);
    if (pt) { var hx = pt.x, hz = pt.z; clearTimeout(tapTimer); tapTimer = setTimeout(function () { select(hx, hz); }, 260); }
  });
  var LIM = { x0: C.bounds.x0 - 1500, x1: C.bounds.x1 + 1500, z0: C.bounds.z0 - 1500, z1: C.bounds.z1 + 1500 };
  function clampTarget() {
    var t = controls.target, dx = 0, dz = 0;
    if (t.x < LIM.x0) dx = LIM.x0 - t.x; if (t.x > LIM.x1) dx = LIM.x1 - t.x;
    if (t.z < LIM.z0) dz = LIM.z0 - t.z; if (t.z > LIM.z1) dz = LIM.z1 - t.z;
    if (dx || dz) { t.x += dx; t.z += dz; camera.position.x += dx; camera.position.z += dz; }
  }
  controls.addEventListener('change', clampTarget);
  renderer.domElement.addEventListener('wheel', function (e) {
    e.preventDefault(); e.stopImmediatePropagation();
    var p = groundAt(e.clientX, e.clientY); if (!p) return;
    anim = null;
    var dy = e.deltaMode === 1 ? e.deltaY * 33 : (e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY), s = Math.exp(dy * 0.0016), dist = camera.position.distanceTo(controls.target);
    s = Math.min(Math.max(s, controls.minDistance / dist), controls.maxDistance / dist);
    controls.target.sub(p).multiplyScalar(s).add(p); camera.position.sub(p).multiplyScalar(s).add(p); controls.target.y = 0; clampTarget();
  }, { passive: false, capture: true });
  renderer.domElement.addEventListener('dblclick', function (e) {
    clearTimeout(tapTimer);
    var p = groundAt(e.clientX, e.clientY); if (!p) return;
    flyTo(p.x, p.z, Math.max(180, Math.min(camera.position.distanceTo(controls.target) * 0.45, 900)), 1100);
  });
  document.getElementById('info-close').addEventListener('click', clearSelection);

  // ---------- neighborhood jump buttons + toggles ----------
  var JUMPS = (CFG.jumps || []).map(function (j) { var p = toXZ(j.ll[0], j.ll[1]); return { id: j.id, label: j.label, x: p[0], z: p[1], d: j.d || 2600 }; });
  var views = document.getElementById('views');
  JUMPS.forEach(function (j) {
    var b = document.createElement('button'); b.textContent = j.label; b.dataset.jump = j.id;
    b.addEventListener('click', function () { flyTo(j.x, j.z, j.d, 1800); views.querySelectorAll('[data-jump]').forEach(function (o) { o.classList.toggle('on', o === b); }); });
    views.insertBefore(b, views.firstChild ? document.getElementById('tgAerial') : null);
  });
  document.getElementById('tgAerial').addEventListener('click', function () { photosVisible = !photosVisible; this.classList.toggle('on', photosVisible); for (var k in tiles) if (tiles[k].photo) tiles[k].photo.visible = photosVisible; if (backdrop) backdrop.visible = photosVisible; });
  document.getElementById('tgLots').addEventListener('click', function () { lotsVisible = !lotsVisible; this.classList.toggle('on', lotsVisible); for (var k in tiles) if (tiles[k].detail && tiles[k].detail.lots) tiles[k].detail.lots.visible = lotsVisible; });
  controls.addEventListener('start', function () { anim = null; views.querySelectorAll('[data-jump]').forEach(function (o) { o.classList.remove('on'); }); });
  function placeViews() {
    var pb = document.getElementById('placebar');
    views.style.top = (document.querySelector('.topbar').offsetHeight + 8) + 'px';
    if (pb) pb.style.top = (views.offsetTop + views.offsetHeight + 6) + 'px';
  }
  placeViews();
  window.addEventListener('resize', function () { camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix(); renderer.setSize(window.innerWidth, window.innerHeight); placeViews(); });

  // ---------- start position: ?at=<jump id>, else the first jump ----------
  var at = (/[?&]at=([\w-]+)/.exec(location.search) || [])[1], start = JUMPS.filter(function (j) { return j.id === at; })[0] || JUMPS[0] || { x: 0, z: 0, d: 2600 };
  controls.target.set(start.x, 0, start.z);
  var tall = window.innerWidth / window.innerHeight < 1.1 ? 1.5 : 1;
  camera.position.set(start.x + 0.22 * start.d * tall, 0.62 * start.d * tall, start.z + 0.75 * start.d * tall);
  controls.update(); updateTiles();
  views.querySelectorAll('[data-jump]').forEach(function (o) { o.classList.toggle('on', o.dataset.jump === start.id); });

  var tmp = new THREE.Vector3();
  function ease(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
  function loop(now) {
    if (anim) { var k = Math.min(1, (now - anim.t0) / anim.dur), e = ease(k); camera.position.lerpVectors(anim.p0, anim.p1, e); controls.target.lerpVectors(anim.q0, anim.q1, e); if (k >= 1) anim = null; }
    controls.update();
    for (var li = 0; li < streetLabels.length; li++) {
      var lab = streetLabels[li], ld = camera.position.distanceTo(lab.position);
      lab.visible = ld > 260 && ld < 7000;
      var lw = Math.max(60, Math.min(170, ld * 0.11)); lab.scale.set(lw, lw * 96 / 512, 1);
    }
    renderer.render(scene, camera);
    if (plWrap) {
      var W2 = window.innerWidth, H2 = window.innerHeight, reach = placeCat === 'all' ? 7000 : 14000;
      for (var pi = 0; pi < places.length; pi++) {
        var pp = places[pi], show = placeCat === 'all' || placeCat === pp.k || pp === selPlace, pd = 0;
        if (show) { pp.v.y = (pp.B ? pp.B.ht.wall : 0) + 16; pd = camera.position.distanceTo(pp.v); if (pd > reach && pp !== selPlace) show = false; else if (pp.minor && pd > 2400 && pp !== selPlace) show = false; }
        if (show) { tmp.copy(pp.v).project(camera); if (tmp.z > 1 || Math.abs(tmp.x) > 1.02 || Math.abs(tmp.y) > 1.02) show = false; }
        if (show) {
          var el = pinEl(pp);
          el.style.transform = 'translate(' + ((tmp.x + 1) / 2 * W2).toFixed(1) + 'px,' + ((1 - tmp.y) / 2 * H2).toFixed(1) + 'px) translate(-50%,-100%)';
          var far = pd > (placeCat === 'all' ? 2600 : 5200) && pp !== selPlace;
          if (pp.far !== far) { pp.far = far; el.classList.toggle('far', far); }
        }
        if (pp.el && pp.shown !== show) { pp.shown = show; pp.el.style.display = show ? '' : 'none'; }
      }
    }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
  window.__city = { camera: camera, controls: controls, select: select, selectPlace: selectPlace, places: places, tiles: tiles, flyTo: flyTo, jumps: JUMPS };
})();
