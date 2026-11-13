// Novato 3D Explorer - area engine (neighbourhood scale).
// Reads window.AREA (area-data.js) and window.AREA_CONFIG. Every building is merged into a few
// big meshes so thousands of homes stay smooth. Roof colours are sampled from the aerial photo.
// Units: feet; x = east, z = south; origin = 24 Cottage Ln.
(function () {
  var A = window.AREA, CFG = window.AREA_CONFIG || {};
  var host = document.getElementById('scene');
  var renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  host.appendChild(renderer.domElement);
  var scene = new THREE.Scene();
  scene.background = new THREE.Color(0xcfe3f3);
  scene.fog = new THREE.Fog(0xcfe3f3, 9000, 20000);
  var camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 2, 40000);
  // Map-style controls: left-drag (one finger) moves around, right-drag (two fingers) tilts/rotates,
  // and the wheel zooms toward whatever is under the pointer (added below).
  var controls = new THREE.MapControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.dampingFactor = 0.08;
  controls.minDistance = 25; controls.maxDistance = 12000; controls.maxPolarAngle = Math.PI / 2 - 0.08;
  controls.screenSpacePanning = false; controls.zoomSpeed = 1.2; controls.panSpeed = 1.0;
  scene.add(new THREE.HemisphereLight(0xeef6ff, 0x7d8a5e, 0.8));
  var sun = new THREE.DirectionalLight(0xfff3df, 0.9); sun.position.set(0.5, 1, 0.35); scene.add(sun);

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
  function colorAttr(geo, c) {
    var n = geo.attributes.position.count, arr = new Float32Array(n * 3);
    for (var i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
    geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    return geo;
  }
  function onlyPNC(geo) { // keep position/normal/color so geometries merge cleanly
    var g = geo.index ? geo.toNonIndexed() : geo;
    ['uv', 'uv2'].forEach(function (k) { if (g.attributes[k]) g.deleteAttribute(k); });
    g.clearGroups();
    return g;
  }
  function textSprite(text, worldW) {
    var cv = document.createElement('canvas'); cv.width = 512; cv.height = 96;
    var g = cv.getContext('2d'); g.font = 'bold 46px Arial'; g.textAlign = 'center'; g.lineWidth = 10;
    g.strokeStyle = 'rgba(255,255,255,0.92)'; g.strokeText(text, 256, 62); g.fillStyle = '#26303f'; g.fillText(text, 256, 62);
    var sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), depthWrite: false, depthTest: false }));
    sp.scale.set(worldW, worldW * 96 / 512, 1); return sp;
  }
  // Estimated storeys (only a handful of map entries carry real heights).
  function heightOf(b, fp) {
    if (b.h) { var h = parseFloat(b.h) * 3.28084; if (h > 6) return { wall: Math.max(8, h - 7), est: false }; }
    if (b.l) { var l = parseFloat(b.l); if (l > 0) return { wall: l * 9.5 + 1, est: false }; }
    if (fp < 350) return { wall: 8.5, est: true };          // shed / small garage
    if (fp < 900) return { wall: 10.5, est: true };         // garage or small cottage
    if (fp < 4500) return { wall: 19, est: true };          // typical Hamilton home: two storeys
    return { wall: 24, est: true };                         // large building / hangar
  }

  // ---------- ground + aerial ----------
  var ground = new THREE.Mesh(new THREE.PlaneGeometry(60000, 60000), new THREE.MeshLambertMaterial({ color: 0x8aa864 }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -0.5; scene.add(ground);
  var AE = A.aerial;
  var aerial = new THREE.Mesh(new THREE.PlaneGeometry(AE.x1 - AE.x0, AE.z1 - AE.z0), new THREE.MeshLambertMaterial({ color: 0xffffff }));
  aerial.rotation.x = -Math.PI / 2; aerial.position.set((AE.x0 + AE.x1) / 2, 0, (AE.z0 + AE.z1) / 2); scene.add(aerial);

  // ---------- streets: solid asphalt with sidewalks (merged) + names ----------
  var roadSegs = [], streetLabels = [];  // road segments: "which way does this house face?"
  (function () {
    var W = { motorway: 60, trunk: 50, primary: 46, secondary: 42, tertiary: 40, residential: 28, unclassified: 24, living_street: 22, service: 16, motorway_link: 24, trunk_link: 24 };
    var SIDEWALK = { primary: 1, secondary: 1, tertiary: 1, residential: 1, unclassified: 1, living_street: 1 };
    var road = [], walk = [], names = {};
    function strip(arr, a, b, off, w, y) {
      var dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz); if (l < 0.5) return;
      var px = -dz / l, pz = dx / l, o1 = off - w / 2, o2 = off + w / 2;
      arr.push(a[0] + px * o1, y, a[1] + pz * o1, b[0] + px * o1, y, b[1] + pz * o1, b[0] + px * o2, y, b[1] + pz * o2,
               a[0] + px * o1, y, a[1] + pz * o1, b[0] + px * o2, y, b[1] + pz * o2, a[0] + px * o2, y, a[1] + pz * o2);
    }
    A.roads.forEach(function (r) {
      var w = W[r.t]; if (!w) return;
      for (var i = 0; i < r.p.length - 1; i++) {
        var a = r.p[i], b = r.p[i + 1], l = Math.hypot(b[0] - a[0], b[1] - a[1]); if (l < 0.5) continue;
        strip(road, a, b, 0, w, 0.7);
        if (SIDEWALK[r.t]) { strip(walk, a, b, w / 2 + 3.5, 5, 0.6); strip(walk, a, b, -(w / 2 + 3.5), 5, 0.6); }
        if (r.t !== 'service' && r.t.indexOf('motorway') < 0) roadSegs.push([a, b]);
        if (r.n && w >= 28 && (!names[r.n] || l > names[r.n].l)) names[r.n] = { l: l, x: (a[0] + b[0]) / 2, z: (a[1] + b[1]) / 2 };
      }
    });
    [[road, 0x63666b], [walk, 0xd9d4c9]].forEach(function (d) {
      var g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(d[0], 3)); g.computeVertexNormals();
      scene.add(new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: d[1], side: THREE.DoubleSide })));
    });
    Object.keys(names).forEach(function (n) { if (names[n].l < 120) return; var s = textSprite(n.replace(/ Drive$/, ' Dr').replace(/ Avenue$/, ' Ave').replace(/ Boulevard$/, ' Blvd').replace(/ Parkway$/, ' Pkwy').replace(/ Lane$/, ' Ln').replace(/ Street$/, ' St').replace(/ Road$/, ' Rd'), 150); s.position.set(names[n].x, 30, names[n].z); s.renderOrder = 5; scene.add(s); streetLabels.push(s); });
  })();

  // ---------- parcels: lot lines + lookup index ----------
  var parcels = A.parcels.map(function (p) { return { apn: p.a, size: p.s, pts: p.p, bb: bbox(p.p) }; });
  var homeParcel = parcels.filter(function (p) { return p.apn === A.homeApn; })[0];
  var lotLines = (function () {
    var pos = [];
    parcels.forEach(function (p) { for (var i = 0; i < p.pts.length; i++) { var a = p.pts[i], b = p.pts[(i + 1) % p.pts.length]; pos.push(a[0], 1.2, a[1], b[0], 1.2, b[1]); } });
    var g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    var m = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.38, depthWrite: false }));
    m.renderOrder = 2; scene.add(m); return m;
  })();
  function outline(pts, color, y) {
    var v = pts.concat([pts[0]]).map(function (p) { return new THREE.Vector3(p[0], y, p[1]); });
    var l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(v), new THREE.LineBasicMaterial({ color: color, depthTest: false }));
    l.renderOrder = 10; return l;
  }
  if (homeParcel) scene.add(outline(homeParcel.pts, 0xf0b429, 1.5));

  // ---------- buildings in the "cottage model" style ----------
  // Lap-siding walls, gable roofs along each building's length with shingle texture and white
  // trim, framed windows on every storey, and a front door + porch roof on the side facing the
  // street. Everything is merged into a handful of meshes. Roof colours come from the aerial photo.
  // Heights: lidar measurement when available (areas/<area>/heights.js), else the City-approved 27 ft
  // for Hamilton Cottages (built after the 2018 survey), else an estimate from footprint size.
  var HM = (window.AREA_HEIGHTS && window.AREA_HEIGHTS.h) || [], HSRC = (window.AREA_HEIGHTS && window.AREA_HEIGHTS.dataset) || '';
  var buildings = A.buildings.map(function (b, idx) {
    var fp = area(b.p), ht = heightOf(b, fp), m = HM[idx], c = centroid(b.p), P = findAt(parcels, c[0], c[1]);
    if (P && P.apn.indexOf('157-860') === 0) {
      ht = { wall: 17.5, peak: 26.7, est: false, src: 'city' };   // Hamilton Cottages: built after the survey
    } else if (m) {
      // The roof peak is the reliable lidar number. Homes that mix two-storey and one-storey parts
      // (garages, porches) drag the low "eave" reading down, so set the walls a normal roof's depth
      // below the measured peak instead.
      var o0 = obb(b.p), rise0 = Math.max(3, Math.min(11, o0.W * 0.36)), peak = Math.min(m[1], 110);
      ht = { wall: Math.max(7.5, peak - rise0), peak: peak, est: false, src: 'lidar', n: m[2] };
    }
    return { src: b, pts: b.p, bb: bbox(b.p), fp: fp, ht: ht };
  });
  var WALLS = [0xe3d8c4, 0xd6c9ae, 0xc9c3b8, 0xb7a88d, 0x9aa39a, 0xa9b1b8, 0xc4b59a, 0xe8e2d6, 0x8e97a2, 0xd8c6a6, 0x9da7ae, 0xb3ae9a];
  var DOORS = [0xb0442c, 0x3e5a74, 0x2f3f55, 0x5a6b45, 0x7a3b2e, 0x8a6a4a];
  var TRIM = new THREE.Color(0xf4f3ef);
  var pickMeshes = [];

  function canvasTex(draw, repeatU, repeatV) {
    var cv = document.createElement('canvas'); cv.width = 64; cv.height = 64; draw(cv.getContext('2d'));
    var t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeatU, repeatV);
    t.anisotropy = renderer.capabilities.getMaxAnisotropy(); return t;
  }
  // UVs are in feet: siding boards ~0.6 ft, shingle rows ~0.8 ft.
  var sidingTex = canvasTex(function (g) {
    g.fillStyle = '#fff'; g.fillRect(0, 0, 64, 64);
    g.fillStyle = 'rgba(0,0,0,0.16)'; for (var y = 0; y < 64; y += 16) g.fillRect(0, y, 64, 2);
    g.fillStyle = 'rgba(0,0,0,0.05)'; for (var x = 0; x < 64; x += 11) g.fillRect(x, 0, 1, 64);
  }, 1 / 8, 1 / 2.4);
  var roofTex = canvasTex(function (g) {
    g.fillStyle = '#fff'; g.fillRect(0, 0, 64, 64);
    for (var row = 0; row < 4; row++) { var off = (row % 2) * 8; for (var x = -off; x < 64; x += 16) { g.fillStyle = 'rgba(0,0,0,' + (0.04 + ((x + row * 7) % 3) * 0.03) + ')'; g.fillRect(x + 1, row * 16, 15, 14); } g.fillStyle = 'rgba(0,0,0,0.2)'; g.fillRect(0, row * 16 + 14, 64, 2); }
  }, 1 / 6, 1 / 3.2);
  var windowTex = canvasTex(function (g) {
    g.fillStyle = '#f4f3ef'; g.fillRect(0, 0, 64, 64);
    var gr = g.createLinearGradient(0, 0, 64, 64); gr.addColorStop(0, '#4c5d6e'); gr.addColorStop(1, '#2b3540');
    g.fillStyle = gr; g.fillRect(7, 7, 50, 50);
    g.fillStyle = '#f4f3ef'; g.fillRect(30, 7, 4, 50); g.fillRect(7, 28, 50, 4);
  }, 1, 1);
  windowTex.wrapS = windowTex.wrapT = THREE.ClampToEdgeWrapping;

  // Geometry accumulators (non-indexed triangles).
  function Acc(withColor) { return { p: [], n: [], u: [], c: withColor ? [] : null }; }
  var gWall = Acc(true), gRoof = Acc(true), gTrim = Acc(true), gWin = Acc(false);
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
  // A vertical rectangle on a wall: centre (x,z), outward normal (nx,nz), bottom y0, size w x h.
  function wallRect(acc, x, z, nx, nz, y0, w, h, off, col) {
    var tx = -nz, tz = nx, hw = w / 2; x += nx * off; z += nz * off;
    quad(acc, [x - tx * hw, y0, z - tz * hw], [x + tx * hw, y0, z + tz * hw], [x + tx * hw, y0 + h, z + tz * hw], [x - tx * hw, y0 + h, z - tz * hw],
      [0, 0], [1, 0], [1, 1], [0, 1], col);
  }
  function boxGeo(acc, cx, cy, cz, sx, sy, sz, rotY, col) {
    var g = new THREE.BoxGeometry(sx, sy, sz).toNonIndexed(); g.rotateY(rotY); g.translate(cx, cy, cz);
    var p = g.attributes.position.array;
    for (var i = 0; i < p.length; i += 9) tri(acc, [p[i], p[i + 1], p[i + 2]], [p[i + 3], p[i + 4], p[i + 5]], [p[i + 6], p[i + 7], p[i + 8]], null, null, null, col);
  }

  // Nearest street, for deciding which wall is the front (grid index for speed).
  var CELL = 250, roadGrid = {};
  roadSegs.forEach(function (s) {
    var x0 = Math.floor(Math.min(s[0][0], s[1][0]) / CELL), x1 = Math.floor(Math.max(s[0][0], s[1][0]) / CELL);
    var z0 = Math.floor(Math.min(s[0][1], s[1][1]) / CELL), z1 = Math.floor(Math.max(s[0][1], s[1][1]) / CELL);
    for (var gx = x0; gx <= x1; gx++) for (var gz = z0; gz <= z1; gz++) (roadGrid[gx + ',' + gz] = roadGrid[gx + ',' + gz] || []).push(s);
  });
  function nearestRoad(x, z) {
    var best = null, bd = 1e9, cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    for (var gx = cx - 1; gx <= cx + 1; gx++) for (var gz = cz - 1; gz <= cz + 1; gz++) (roadGrid[gx + ',' + gz] || []).forEach(function (s) {
      var a = s[0], b = s[1], dx = b[0] - a[0], dz = b[1] - a[1], t = ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz || 1);
      t = Math.max(0, Math.min(1, t)); var px = a[0] + dx * t, pz = a[1] + dz * t, d = Math.hypot(px - x, pz - z);
      if (d < bd) { bd = d; best = [px - x, pz - z, d]; }
    });
    return best;
  }

  function addBuilding(B, i, roofColor) {
    var pts = B.pts, h = B.ht.wall, wallC = new THREE.Color(WALLS[i % WALLS.length]);
    var sgn = 0; for (var k = 0; k < pts.length; k++) { var p = pts[k], q = pts[(k + 1) % pts.length]; sgn += p[0] * q[1] - q[0] * p[1]; }
    // walls (u = distance along the wall, v = height), plus a foundation strip
    var run = 0;
    for (k = 0; k < pts.length; k++) {
      var a = pts[k], b = pts[(k + 1) % pts.length], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      quad(gWall, [a[0], 0, a[1]], [b[0], 0, b[1]], [b[0], h, b[1]], [a[0], h, a[1]], [run, 0], [run + len, 0], [run + len, h], [run, h], wallC);
      run += len;
    }
    var o = obb(pts), fill = B.fp / (o.L * o.W), vx = -o.uz, vz = o.ux;
    function P(a2, b2, y) { return [o.cx + a2 * o.ux + b2 * vx, y, o.cz + a2 * o.uz + b2 * vz]; }
    var houseLike = B.fp >= 500 && B.fp <= 4500;
    if (fill > 0.68 && o.W < 70 && B.fp < 7000) {
      // Gable roof, ridge along the long side, 1.4 ft overhang, white rakes and fascia.
      var rise = B.ht.peak ? Math.max(2, Math.min(16, B.ht.peak - h)) : Math.max(3, Math.min(11, o.W * 0.36)), oh = 1.4, La = o.L / 2 + oh, Wb = o.W / 2 + oh, drop = oh * rise / (o.W / 2);
      var slopeLen = Math.hypot(Wb, rise + drop);
      [1, -1].forEach(function (s) {
        quad(gRoof, P(-La, s * Wb, h - drop), P(La, s * Wb, h - drop), P(La, 0, h + rise), P(-La, 0, h + rise),
          [-La, 0], [La, 0], [La, slopeLen], [-La, slopeLen], roofColor);
        // fascia board under the eave
        quad(gTrim, P(-La, s * Wb, h - drop - 0.7), P(La, s * Wb, h - drop - 0.7), P(La, s * Wb, h - drop), P(-La, s * Wb, h - drop), null, null, null, null, TRIM);
      });
      [1, -1].forEach(function (e) {
        var A0 = e * o.L / 2;
        // gable-end wall triangle (siding continues up)
        tri(gWall, P(A0, -o.W / 2, h), P(A0, o.W / 2, h), P(A0, 0, h + rise), [0, h], [o.W, h], [o.W / 2, h + rise], wallC);
        // white rake trim along both roof edges at this end
        var Ae = e * La;
        [1, -1].forEach(function (s) {
          quad(gTrim, P(Ae, s * Wb, h - drop), P(Ae, 0, h + rise), P(Ae, 0, h + rise + 0.6), P(Ae, s * Wb, h - drop + 0.6), null, null, null, null, TRIM);
        });
      });
    } else {
      // Big or irregular buildings: low hip roof.
      var r2 = B.ht.peak ? Math.max(2, Math.min(14, B.ht.peak - h)) : Math.max(3, Math.min(9, o.W * 0.22));
      var c4 = [P(-o.L / 2 - 1, -o.W / 2 - 1, h), P(o.L / 2 + 1, -o.W / 2 - 1, h), P(o.L / 2 + 1, o.W / 2 + 1, h), P(-o.L / 2 - 1, o.W / 2 + 1, h)];
      var ridgeHalf = Math.max(0, o.L / 2 - o.W / 2), r0 = P(-ridgeHalf, 0, h + r2), r1 = P(ridgeHalf, 0, h + r2);
      quad(gRoof, c4[0], c4[1], r1, r0, [0, 0], [o.L, 0], [o.L, 6], [0, 6], roofColor);
      quad(gRoof, c4[2], c4[3], r0, r1, [0, 0], [o.L, 0], [o.L, 6], [0, 6], roofColor);
      tri(gRoof, c4[1], c4[2], r1, [0, 0], [o.W, 0], [o.W / 2, 6], roofColor);
      tri(gRoof, c4[3], c4[0], r0, [0, 0], [o.W, 0], [o.W / 2, 6], roofColor);
    }
    // Front wall: the edge whose outward normal points most toward the nearest street.
    var front = -1, door = null;
    var nr = houseLike ? nearestRoad(o.cx, o.cz) : null;
    if (nr && nr[2] < 220) {
      var best = -2;
      for (k = 0; k < pts.length; k++) {
        var a3 = pts[k], b3 = pts[(k + 1) % pts.length], dx = b3[0] - a3[0], dz = b3[1] - a3[1], l3 = Math.hypot(dx, dz); if (l3 < 8) continue;
        var nx = dz / l3, nz = -dx / l3; if (sgn < 0) { nx = -nx; nz = -nz; }
        var dot = (nx * nr[0] + nz * nr[1]) / nr[2]; if (dot > best) { best = dot; front = k; }
      }
    }
    // Windows on every wall and storey; door + porch roof on the front wall.
    var floors = h >= 17 ? 2 : 1; if (h > 22) floors = Math.max(2, Math.floor(h / 10));
    var winCount = 0;
    for (k = 0; k < pts.length; k++) {
      var a4 = pts[k], b4 = pts[(k + 1) % pts.length], ddx = b4[0] - a4[0], ddz = b4[1] - a4[1], len4 = Math.hypot(ddx, ddz);
      if (len4 < 7) continue;
      var nx4 = ddz / len4, nz4 = -ddx / len4; if (sgn < 0) { nx4 = -nx4; nz4 = -nz4; }
      var doorT = -1;
      if (k === front) {
        doorT = len4 > 22 ? 0.35 : 0.5; door = true;
        var dxp = a4[0] + ddx * doorT, dzp = a4[1] + ddz * doorT;
        wallRect(gTrim, dxp, dzp, nx4, nz4, 0, 4.2, 7.8, 0.12, TRIM);
        wallRect(gTrim, dxp, dzp, nx4, nz4, 0, 3.2, 7.2, 0.2, new THREE.Color(DOORS[i % DOORS.length]));
        // porch roof + posts
        var rot = Math.atan2(nx4, nz4), pc = 5;
        boxGeo(gTrim, dxp + nx4 * pc / 2, 9.4, dzp + nz4 * pc / 2, 10, 0.5, pc, rot, roofColor);
        [-1, 1].forEach(function (s) { boxGeo(gTrim, dxp + nx4 * (pc - 0.4) + (-nz4) * s * 4.4, 4.7, dzp + nz4 * (pc - 0.4) + nx4 * s * 4.4, 0.6, 9.4, 0.6, rot, TRIM); });
        boxGeo(gTrim, dxp + nx4 * pc / 2, 0.4, dzp + nz4 * pc / 2, 10, 0.8, pc, rot, new THREE.Color(0xb9b2a5));
      }
      var n4 = Math.max(1, Math.floor((len4 - 2) / 10));
      for (var f = 0; f < floors && winCount < 48; f++) {
        var y0 = 3.2 + f * (h / floors);
        for (var w = 0; w < n4 && winCount < 48; w++) {
          var t = (w + 0.5) / n4;
          if (f === 0 && doorT >= 0 && Math.abs(t - doorT) * len4 < 4.5) continue;
          wallRect(gWin, a4[0] + ddx * t, a4[1] + ddz * t, nx4, nz4, y0, 3.4, 4.2, 0.12, null);
          winCount++;
        }
      }
    }
  }

  function finish(acc, material) {
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(acc.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(acc.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(acc.u, 2));
    if (acc.c) g.setAttribute('color', new THREE.Float32BufferAttribute(acc.c, 3));
    var m = new THREE.Mesh(g, material); scene.add(m); return m;
  }
  var wallMesh = null, roofMesh = null;
  function buildBuildings(sample) {
    buildings.forEach(function (B, i) {
      var o = obb(B.pts);
      addBuilding(B, i, sample ? sample(o.cx, o.cz) : new THREE.Color(0x777777));
    });
    wallMesh = finish(gWall, new THREE.MeshLambertMaterial({ vertexColors: true, map: sidingTex, side: THREE.DoubleSide }));
    roofMesh = finish(gRoof, new THREE.MeshLambertMaterial({ vertexColors: true, map: roofTex, side: THREE.DoubleSide }));
    var trimMesh = finish(gTrim, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
    finish(gWin, new THREE.MeshLambertMaterial({ map: windowTex, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    pickMeshes.push(roofMesh, wallMesh, trimMesh);
    document.getElementById('loading').style.display = 'none';
  }

  // ---------- 3D trees where the aerial photo shows tree canopy ----------
  var treeGroup = new THREE.Group(); scene.add(treeGroup);
  function plantTrees(data, W, H) {
    var bGrid = {}, BC = 150;
    buildings.forEach(function (B) {
      for (var gx = Math.floor(B.bb[0] / BC); gx <= Math.floor(B.bb[2] / BC); gx++) for (var gz = Math.floor(B.bb[1] / BC); gz <= Math.floor(B.bb[3] / BC); gz++) (bGrid[gx + ',' + gz] = bGrid[gx + ',' + gz] || []).push(B);
    });
    function inBuilding(x, z) { var l = bGrid[Math.floor(x / BC) + ',' + Math.floor(z / BC)] || []; for (var i = 0; i < l.length; i++) { var b = l[i].bb; if (x > b[0] - 4 && x < b[2] + 4 && z > b[1] - 4 && z < b[3] + 4 && inside(l[i].pts, x, z)) return true; } return false; }
    var spots = [], STEP = 26, seed = 7;
    function rnd() { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }
    for (var z = AE.z0 + STEP / 2; z < AE.z1; z += STEP) for (var x = AE.x0 + STEP / 2; x < AE.x1; x += STEP) {
      var jx = x + (rnd() - 0.5) * STEP * 0.8, jz = z + (rnd() - 0.5) * STEP * 0.8;
      var px = Math.round((jx - AE.x0) / (AE.x1 - AE.x0) * (W - 1)), py = Math.round((jz - AE.z0) / (AE.z1 - AE.z0) * (H - 1)), k = (py * W + px) * 4;
      var r = data[k], g = data[k + 1], b = data[k + 2], lum = (r + g + b) / 3;
      // Tree canopy in the photo: darker, clearly green pixels (lawns are lighter and flatter).
      if (g > r * 1.05 && g > b * 1.12 && lum < 105 && lum > 25 && !inBuilding(jx, jz)) spots.push([jx, jz, r, g, b, lum]);
    }
    if (spots.length > 9000) { var keep = 9000 / spots.length; spots = spots.filter(function () { return rnd() < keep; }); }
    var crownGeo = new THREE.IcosahedronGeometry(1, 1), trunkGeo = new THREE.CylinderGeometry(0.35, 0.5, 1, 6);
    var crowns = new THREE.InstancedMesh(crownGeo, new THREE.MeshLambertMaterial({ color: 0xffffff }), spots.length);
    var trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshLambertMaterial({ color: 0x6b4f36 }), spots.length);
    var m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), v = new THREE.Vector3(), c = new THREE.Color();
    spots.forEach(function (sp, i) {
      var size = 9 + (105 - sp[5]) / 80 * 7 + rnd() * 4, ht = size * (1.5 + rnd() * 0.4);
      m.compose(v.set(sp[0], ht * 0.32, sp[1]), q.identity(), s.set(1.6, ht * 0.64, 1.6)); trunks.setMatrixAt(i, m);
      m.compose(v.set(sp[0], ht * 0.72, sp[1]), q.setFromAxisAngle(v.clone().set(0, 1, 0), rnd() * 6.28), s.set(size * 0.6, size * 0.62, size * 0.6)); crowns.setMatrixAt(i, m);
      c.setRGB(sp[2] / 255, sp[3] / 255, sp[4] / 255); var hsl = {}; c.getHSL(hsl);
      c.setHSL(hsl.h, Math.min(0.75, hsl.s * 1.25 + 0.1), Math.min(0.42, hsl.l * 1.35 + 0.08)); crowns.setColorAt(i, c);
    });
    crowns.instanceMatrix.needsUpdate = true; trunks.instanceMatrix.needsUpdate = true; if (crowns.instanceColor) crowns.instanceColor.needsUpdate = true;
    treeGroup.add(trunks); treeGroup.add(crowns);
    return spots.length;
  }

  new THREE.TextureLoader().load(CFG.aerial, function (tex) {
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    aerial.material.map = tex; aerial.material.needsUpdate = true;
    var img = tex.image, cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height;
    var g = cv.getContext('2d'); g.drawImage(img, 0, 0); var data = g.getImageData(0, 0, cv.width, cv.height).data;
    buildBuildings(function (x, z) {
      var u = (x - AE.x0) / (AE.x1 - AE.x0), v = (z - AE.z0) / (AE.z1 - AE.z0);
      if (u < 0 || u > 1 || v < 0 || v > 1) return new THREE.Color(0x777777);
      var px = Math.round(u * (cv.width - 1)), py = Math.round(v * (cv.height - 1)), r = 0, gg = 0, b = 0, n = 0;
      for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) {
        var xx = Math.min(cv.width - 1, Math.max(0, px + dx)), yy = Math.min(cv.height - 1, Math.max(0, py + dy)), k = (yy * cv.width + xx) * 4;
        r += data[k]; gg += data[k + 1]; b += data[k + 2]; n++;
      }
      var c = new THREE.Color(r / n / 255, gg / n / 255, b / n / 255);
      if (c.g > c.r * 1.08 && c.g > c.b * 1.08) c.lerp(new THREE.Color(0x6b6b68), 0.6);
      var hsl = {}; c.getHSL(hsl);
      var s = hsl.s < 0.18 ? hsl.s * 0.5 : Math.min(0.85, hsl.s * 1.2);
      return new THREE.Color().setHSL(hsl.h, s, Math.min(0.6, hsl.l * 0.92));
    });
    window.__trees = plantTrees(data, cv.width, cv.height);
  }, undefined, function () { buildBuildings(null); });

  // ---------- selection + info panel ----------
  var selGroup = new THREE.Group(); scene.add(selGroup);
  var info = document.getElementById('info'), infoBody = document.getElementById('info-body');
  function findAt(list, x, z) { for (var i = 0; i < list.length; i++) { var b = list[i].bb; if (x >= b[0] && x <= b[2] && z >= b[1] && z <= b[3] && inside(list[i].pts, x, z)) return list[i]; } return null; }
  function nearestAddress(x, z, maxD) { var best = null, bd = maxD; (A.addresses || []).forEach(function (a) { var d = Math.hypot(a.p[0] - x, a.p[1] - z); if (d < bd) { bd = d; best = a.n; } }); return best; }
  // Listings and the lead form come from the page (window.AREA_CONFIG), so the same engine runs the
  // private explorer and the public "home value" map.
  var LISTINGS = CFG.listings || [];
  var LEAD = CFG.leadForm || null;
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function heightText(B) {
    return B.ht.src === 'lidar' ? 'roof peak about ' + Math.round(B.ht.peak) + ' ft above ground (measured by 2018 USGS lidar)'
      : B.ht.src === 'city' ? 'up to 27 ft per the City-approved plans'
      : B.ht.est ? (B.ht.wall >= 18 ? 'likely two storeys (estimated)' : 'likely one storey (estimated)') : 'height from map data';
  }
  var current = null;   // what's selected: { P, B, listing, addr }
  function showDetails() {
    var s = current, P = s.P, B = s.B, L = s.listing, rows = [];
    if (L) rows.push('<div class="tag">' + esc(L.tag || 'For sale') + '</div><h3>' + esc(L.title) + '</h3><p>' + L.html + '</p>');
    else rows.push('<h3>' + esc(s.addr || (B && B.src.n) || 'Selected home') + '</h3>');
    if (P) rows.push('<p><b>APN</b> ' + esc(P.apn) + ' &middot; <b>Lot</b> about ' + P.size.toLocaleString() + ' sq ft</p>');
    if (B) rows.push('<p><b>Building footprint</b> about ' + Math.round(B.fp).toLocaleString() + ' sq ft &middot; ' + heightText(B) + '</p>');
    var btns = [];
    if (L && L.links) L.links.forEach(function (k, i) { btns.push('<a class="btn' + (i ? ' alt' : '') + '" href="' + esc(k.href) + '"' + (k.newTab ? ' target="_blank" rel="noopener"' : '') + '>' + esc(k.label) + ' &rarr;</a>'); });
    if (LEAD && P) btns.push('<button class="btn cta" id="lead-open">' + (L ? 'Ask about this home' : 'What&rsquo;s my home worth?') + ' &rarr;</button>');
    if (btns.length) rows.push('<p class="btns">' + btns.join(' ') + '</p>');
    rows.push('<p class="fine">Lot sizes from the county parcel map (not survey accurate). Building outlines &copy; OpenStreetMap contributors.</p>');
    infoBody.innerHTML = rows.join('');
    var lo = document.getElementById('lead-open'); if (lo) lo.addEventListener('click', showLeadForm);
  }
  function showLeadForm() {
    var s = current, L = s.listing, P = s.P, B = s.B;
    var title = L ? 'Ask about ' + esc(L.title) : 'Free home value report';
    var intro = L ? 'Questions, a private showing, or open house details. Nathan will get back to you.'
      : 'Get a free comparative market analysis for your Hamilton home from ' + esc(LEAD.agent) + '. No cost, no obligation.';
    infoBody.innerHTML =
      '<h3>' + title + '</h3><p>' + intro + '</p>' +
      '<form id="lead-form" novalidate>' +
      '<label>Property address<input name="address" required autocomplete="street-address" placeholder="123 Main St, Novato" value="' + esc(L ? L.title : (s.addr || '')) + '"></label>' +
      '<label>Your name<input name="name" required autocomplete="name"></label>' +
      '<label>Email<input name="email" type="email" autocomplete="email"></label>' +
      '<label>Phone<input name="phone" type="tel" autocomplete="tel"></label>' +
      (L ? '' : '<label>Thinking about selling?<select name="timeframe"><option>Just curious</option><option>In the next 3 months</option><option>3&ndash;12 months</option><option>More than a year out</option></select></label>') +
      '<label>Anything else? (optional)<textarea name="message" rows="2"></textarea></label>' +
      '<input type="hidden" name="apn" value="' + esc(P ? P.apn : '') + '">' +
      '<input type="hidden" name="lot_sqft" value="' + (P ? P.size : '') + '">' +
      '<input type="hidden" name="footprint_sqft" value="' + (B ? Math.round(B.fp) : '') + '">' +
      '<input type="hidden" name="_subject" value="' + esc((L ? 'Inquiry: ' + L.title : 'Home value request') + ' (Hamilton map)') + '">' +
      '<input type="hidden" name="source" value="Hamilton Home Explorer">' +
      '<input type="text" name="_gotcha" class="hp" tabindex="-1" autocomplete="off">' +
      '<p class="err" id="lead-err" role="alert"></p>' +
      '<button type="submit" class="btn cta">' + (L ? 'Send' : 'Request my free report') + '</button> <button type="button" class="btn alt" id="lead-back">Back</button>' +
      '<p class="fine">' + LEAD.consent + '</p>' +
      '</form>';
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
        infoBody.innerHTML = '<h3>Thanks, request received</h3><p>' + esc(LEAD.agent) + ' will be in touch shortly' + (L ? '.' : ' with your home value report.') + '</p><p class="btns"><button class="btn alt" id="lead-done">Back to the map</button></p>';
        document.getElementById('lead-done').addEventListener('click', function () { info.classList.remove('open'); });
      }).catch(function () {
        btn.disabled = false; btn.textContent = 'Try again';
        err.innerHTML = 'Couldn’t send just now. You can also call or text ' + esc(LEAD.phone) + '.';
      });
    });
  }
  function select(x, z) {
    while (selGroup.children.length) selGroup.remove(selGroup.children[0]);
    var B = findAt(buildings, x, z), P = findAt(parcels, x, z);
    if (!B && !P) { info.classList.remove('open'); return; }
    if (P) selGroup.add(outline(P.pts, 0x3fa7ff, 1.6));
    if (B) selGroup.add(outline(B.pts, 0xffffff, B.ht.wall + 0.5));
    var listing = P ? LISTINGS.filter(function (l) { return l.apn === P.apn; })[0] : null;
    current = { P: P, B: B, listing: listing, addr: (B && B.src.a) || nearestAddress(x, z, 40) };
    showDetails();
    info.classList.add('open');
  }
  var ray = new THREE.Raycaster(), mouse = new THREE.Vector2(), downAt = null, tapTimer = null;
  renderer.domElement.addEventListener('pointerdown', function (e) { downAt = [e.clientX, e.clientY]; });
  renderer.domElement.addEventListener('pointerup', function (e) {
    if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 6) return; // a drag, not a tap
    mouse.set(e.clientX / window.innerWidth * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
    ray.setFromCamera(mouse, camera);
    var targets = pickMeshes.concat([aerial]);
    var hit = ray.intersectObjects(targets, false)[0];
    // Wait a moment so a double-click (fly there) doesn't also select a lot.
    if (hit) { var hx = hit.point.x, hz = hit.point.z; clearTimeout(tapTimer); tapTimer = setTimeout(function () { select(hx, hz); }, 260); }
  });
  // ---------- zoom toward the pointer, double-click to fly there ----------
  var groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), gp = new THREE.Vector3();
  function groundAt(clientX, clientY) {
    mouse.set(clientX / window.innerWidth * 2 - 1, -(clientY / window.innerHeight) * 2 + 1);
    ray.setFromCamera(mouse, camera);
    return ray.ray.intersectPlane(groundPlane, gp) ? gp.clone() : null;
  }
  // Keep the view over Hamilton so nobody gets lost off the edge of the map.
  var LIM = { x0: AE.x0 - 1500, x1: AE.x1 + 1500, z0: AE.z0 - 1500, z1: AE.z1 + 1500 };
  function clampTarget() {
    var t = controls.target, dx = 0, dz = 0;
    if (t.x < LIM.x0) dx = LIM.x0 - t.x; if (t.x > LIM.x1) dx = LIM.x1 - t.x;
    if (t.z < LIM.z0) dz = LIM.z0 - t.z; if (t.z > LIM.z1) dz = LIM.z1 - t.z;
    if (dx || dz) { t.x += dx; t.z += dz; camera.position.x += dx; camera.position.z += dz; }
  }
  controls.addEventListener('change', clampTarget);
  // Wheel zoom (mouse / trackpad): scale the view about the ground point under the pointer, so that
  // spot stays put while everything zooms around it. Pinch-zoom on phones still uses the controls.
  renderer.domElement.addEventListener('wheel', function (e) {
    e.preventDefault(); e.stopImmediatePropagation();
    var p = groundAt(e.clientX, e.clientY); if (!p) return;
    anim = null;
    var dy = e.deltaMode === 1 ? e.deltaY * 33 : (e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY);
    var s = Math.exp(dy * 0.0016);                       // < 1 zooms in, > 1 zooms out
    var dist = camera.position.distanceTo(controls.target);
    s = Math.min(Math.max(s, controls.minDistance / dist), controls.maxDistance / dist);
    controls.target.sub(p).multiplyScalar(s).add(p);
    camera.position.sub(p).multiplyScalar(s).add(p);
    controls.target.y = 0;
    clampTarget();
  }, { passive: false, capture: true });
  renderer.domElement.addEventListener('dblclick', function (e) {
    clearTimeout(tapTimer);
    var p = groundAt(e.clientX, e.clientY); if (!p) return;
    var off = camera.position.clone().sub(controls.target), d = Math.max(180, Math.min(off.length() * 0.45, 900));
    off.setLength(d);
    anim = { t0: performance.now(), dur: 1100, p0: camera.position.clone(), p1: p.clone().add(off), q0: controls.target.clone(), q1: p.clone() };
  });

  document.getElementById('info-close').addEventListener('click', function () { info.classList.remove('open'); while (selGroup.children.length) selGroup.remove(selGroup.children[0]); });

  // ---------- home marker ----------
  var pin = document.getElementById('home-pin'), pinV = new THREE.Vector3(0, 70, 0);
  pin.addEventListener('click', function () { select(0, 0); goTo('home'); });

  // ---------- camera views ----------
  var VIEWS = {
    overview: { p: [1800, 5200, 7600], t: [0, 0, 400] },
    cottages: { p: [380, 520, 760], t: [40, 0, 90] },
    home: { p: [70, 120, 210], t: [0, 10, 5] }
  };
  function viewPos(v) { var p = new THREE.Vector3().fromArray(v.p), t = new THREE.Vector3().fromArray(v.t), a = window.innerWidth / window.innerHeight; if (a < 1.1) p.sub(t).multiplyScalar(Math.min(2.2, Math.pow(1.1 / a, 0.85))).add(t); return p; }
  var anim = null;
  function goTo(name) {
    var v = VIEWS[name];
    anim = { t0: performance.now(), dur: 1600, p0: camera.position.clone(), p1: viewPos(v), q0: controls.target.clone(), q1: new THREE.Vector3().fromArray(v.t) };
    document.querySelectorAll('#views button[data-v]').forEach(function (b) { b.classList.toggle('on', b.dataset.v === name); });
  }
  document.querySelectorAll('#views button[data-v]').forEach(function (b) { b.addEventListener('click', function () { goTo(b.dataset.v); }); });
  document.getElementById('tgAerial').addEventListener('click', function () { aerial.visible = !aerial.visible; this.classList.toggle('on', aerial.visible); });
  document.getElementById('tgLots').addEventListener('click', function () { lotLines.visible = !lotLines.visible; this.classList.toggle('on', lotLines.visible); });
  controls.addEventListener('start', function () { anim = null; document.querySelectorAll('#views button[data-v]').forEach(function (b) { b.classList.remove('on'); }); });
  function placeViews() { document.getElementById('views').style.top = (document.querySelector('.topbar').offsetHeight + 8) + 'px'; }
  placeViews();
  window.addEventListener('resize', function () { camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix(); renderer.setSize(window.innerWidth, window.innerHeight); placeViews(); });

  var tmp = new THREE.Vector3();
  function ease(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
  function loop(now) {
    if (anim) { var k = Math.min(1, (now - anim.t0) / anim.dur), e = ease(k); camera.position.lerpVectors(anim.p0, anim.p1, e); controls.target.lerpVectors(anim.q0, anim.q1, e); if (k >= 1) anim = null; }
    controls.update();
    // Street names: about the same size on screen from far away, hidden when you're at street level.
    for (var li = 0; li < streetLabels.length; li++) {
      var lab = streetLabels[li], ld = camera.position.distanceTo(lab.position);
      lab.visible = ld > 260;
      var lw = Math.max(60, Math.min(170, ld * 0.11)); lab.scale.set(lw, lw * 96 / 512, 1);
    }
    renderer.render(scene, camera);
    tmp.copy(pinV).project(camera);
    var off = tmp.z > 1 || Math.abs(tmp.x) > 1.05 || Math.abs(tmp.y) > 1.05;
    pin.style.display = off ? 'none' : '';
    if (!off) { pin.style.left = ((tmp.x + 1) / 2 * window.innerWidth) + 'px'; pin.style.top = ((1 - tmp.y) / 2 * window.innerHeight) + 'px'; }
    requestAnimationFrame(loop);
  }
  controls.target.fromArray(VIEWS.overview.t); camera.position.copy(viewPos(VIEWS.overview)); controls.update();
  window.__area = { camera: camera, controls: controls, select: select, buildings: buildings, parcels: parcels };
  requestAnimationFrame(loop);
})();