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
  var HAS_HEIGHTS = !!(window.AREA_HEIGHTS && window.AREA_HEIGHTS.h && window.AREA_HEIGHTS.h.length);
  var AREA_NAME = A.name || 'Novato';
  // Estimated storeys (only a handful of map entries carry real heights).
  function heightOf(b, fp) {
    if (b.h) { var h = parseFloat(b.h) * 3.28084; if (h > 6) return { wall: Math.max(8, h - 7), est: false }; }
    if (b.l) { var l = parseFloat(b.l); if (l > 0) return { wall: l * 9.5 + 1, est: false }; }
    if (fp < 350) return { wall: 8.5, est: true };          // shed / small garage
    if (fp < 900) return { wall: 10.5, est: true };         // garage or small cottage
    if (!HAS_HEIGHTS) {
      // No measured heights for this area: older Novato streets are mostly single-storey, so guess
      // from footprint (compact footprints are more often two-storey) with a steady per-home mix.
      var mix = Math.abs(Math.round(b.p[0][0] * 7 + b.p[0][1] * 13)) % 10;
      if (fp < 4500) return { wall: (fp < 1350 ? mix < 6 : mix < 2) ? 19 : 11, est: true };
      return { wall: fp > 20000 ? 26 : 18, est: true };
    }
    if (fp < 4500) return { wall: 19, est: true };          // typical Hamilton home: two storeys
    return { wall: 24, est: true };                         // large building / hangar
  }

  // ---------- ground + aerial ----------
  var ground = new THREE.Mesh(new THREE.PlaneGeometry(60000, 60000), new THREE.MeshLambertMaterial({ color: 0x8aa864 }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -0.5; scene.add(ground);
  var AE = A.aerial;
  var aerial = new THREE.Mesh(new THREE.PlaneGeometry(AE.x1 - AE.x0, AE.z1 - AE.z0), new THREE.MeshLambertMaterial({ color: 0xffffff }));
  aerial.rotation.x = -Math.PI / 2; aerial.position.set((AE.x0 + AE.x1) / 2, 0, (AE.z0 + AE.z1) / 2); scene.add(aerial);
  // Wide regional photo underneath (areas/<area>/backdrop.js), and soft edges on the detailed photo,
  // so the map melts into its real surroundings and the haze instead of ending in a hard square.
  var BD = window.AREA_BACKDROP;
  if (BD) {
    var bdMesh = new THREE.Mesh(new THREE.PlaneGeometry(BD.x1 - BD.x0, BD.z1 - BD.z0), new THREE.MeshLambertMaterial({ color: 0x9aa58a }));
    bdMesh.rotation.x = -Math.PI / 2; bdMesh.position.set((BD.x0 + BD.x1) / 2, -0.3, (BD.z0 + BD.z1) / 2); scene.add(bdMesh);
    new THREE.TextureLoader().load((CFG.base || '') + BD.src, function (t) {
      t.anisotropy = renderer.capabilities.getMaxAnisotropy();
      bdMesh.material.map = t; bdMesh.material.color.set(0xffffff); bdMesh.material.needsUpdate = true;
    });
    var fc = document.createElement('canvas'); fc.width = fc.height = 256;
    var fg = fc.getContext('2d'); fg.fillStyle = '#000'; fg.fillRect(0, 0, 256, 256);
    for (var fi = 0; fi < 20; fi++) { var fv = Math.round(255 * (fi + 1) / 20); fg.fillStyle = 'rgb(' + fv + ',' + fv + ',' + fv + ')'; fg.fillRect(fi, fi, 256 - 2 * fi, 256 - 2 * fi); }
    aerial.material.alphaMap = new THREE.CanvasTexture(fc); aerial.material.transparent = true; aerial.material.depthWrite = false;
    aerial.renderOrder = 1;
    ground.material.color.set(0x8f9a7c);
  }

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
  if (homeParcel && (CFG.listings || []).length) scene.add(outline(homeParcel.pts, 0xf0b429, 1.5));

  // ---------- rail line, station platform + shelter (from places.js) ----------
  (function () {
    var R = window.AREA_PLACES; if (!R) return;
    var bed = [], steel = [], plat = [];
    function strip(arr, a, b, off, w, y) {
      var dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz); if (l < 0.5) return;
      var px = -dz / l, pz = dx / l, o1 = off - w / 2, o2 = off + w / 2;
      arr.push(a[0] + px * o1, y, a[1] + pz * o1, b[0] + px * o1, y, b[1] + pz * o1, b[0] + px * o2, y, b[1] + pz * o2,
               a[0] + px * o1, y, a[1] + pz * o1, b[0] + px * o2, y, b[1] + pz * o2, a[0] + px * o2, y, a[1] + pz * o2);
    }
    (R.rails || []).forEach(function (r) {
      for (var i = 0; i < r.length - 1; i++) { strip(bed, r[i], r[i + 1], 0, 11, 0.9); strip(steel, r[i], r[i + 1], 2.4, 0.6, 1.3); strip(steel, r[i], r[i + 1], -2.4, 0.6, 1.3); }
    });
    var shelters = new THREE.Group(); scene.add(shelters);
    (R.platforms || []).forEach(function (pl) {
      var closed = pl.length > 3 && Math.hypot(pl[0][0] - pl[pl.length - 1][0], pl[0][1] - pl[pl.length - 1][1]) < 1;
      var a = pl[0], b = pl[closed ? Math.floor(pl.length / 2) : pl.length - 1];
      if (!closed) for (var i = 0; i < pl.length - 1; i++) strip(plat, pl[i], pl[i + 1], 0, 14, 3.2);
      else { var c = centroid(pl); strip(plat, a, b, 0, 14, 3.2); a = [a[0] * 0.5 + c[0] * 0.5, a[1] * 0.5 + c[1] * 0.5]; }
      // shelter canopy over the middle third of the platform
      var dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1, mx = (pl[0][0] + b[0]) / 2, mz = (pl[0][1] + b[1]) / 2, rot = Math.atan2(-dz, dx), sl = Math.min(90, l * 0.4);
      var roof = new THREE.Mesh(new THREE.BoxGeometry(sl, 0.8, 12), new THREE.MeshLambertMaterial({ color: 0x2f6f5e }));
      roof.position.set(mx, 15, mz); roof.rotation.y = rot; shelters.add(roof);
      [-1, 1].forEach(function (s) {
        var post = new THREE.Mesh(new THREE.BoxGeometry(0.9, 12, 0.9), new THREE.MeshLambertMaterial({ color: 0xe8e8e8 }));
        post.position.set(mx + s * (sl / 2 - 3) * dx / l, 9, mz + s * (sl / 2 - 3) * dz / l); shelters.add(post);
      });
    });
    [[bed, 0x8d8679], [steel, 0x3a3d42], [plat, 0xcfc9bb]].forEach(function (d) {
      if (!d[0].length) return;
      var g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(d[0], 3)); g.computeVertexNormals();
      scene.add(new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: d[1], side: THREE.DoubleSide })));
    });
  })();

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
  // Local places (areas/<area>/places.js, from OpenStreetMap): tie each one to the building it sits in,
  // then decide which buildings are shops / civic buildings / canopies so they don't get drawn as houses.
  var PL = window.AREA_PLACES || null, places = PL ? PL.places : [];
  var NONRES = { food: 1, shopping: 1, services: 1, arts: 1, community: 1, schools: 1 };
  var COMM_T = { commercial: 1, retail: 1, industrial: 1, hotel: 1, school: 1, government: 1, hangar: 1, supermarket: 1, warehouse: 1, office: 1, service: 1, public: 1, civic: 1, kindergarten: 1, hospital: 1, train_station: 1 };
  places.forEach(function (p, i) {
    p.i = i; p.minor = p.n === p.s || p.s === 'EV charging';
    var B = findAt(buildings, p.x, p.z);
    if (B && NONRES[p.k] && p.s !== 'EV charging') { (B.places = B.places || []).push(p); p.B = B; }
  });
  buildings.forEach(function (B) {
    var t = B.src.t, named = B.src.n && !/^[\d\s-]+$/.test(B.src.n);
    if (B.ht.src === 'city') return;
    var gas = B.fp < 7000 && (/fuel|gas station/i.test(B.src.n || '') || (B.places && B.places.every(function (p) { return p.s === 'Gas station'; })));
    if (t === 'roof' || gas) B.kind = 'canopy';
    else if (t === 'religious' || t === 'church' || (B.places && B.places.some(function (p) { return p.s === 'Church' || p.s === 'Place of worship'; }))) B.kind = 'church';
    else if (COMM_T[t] || B.places || (named && B.fp > 1500) || (t === 'yes' && B.fp > 12000)) B.kind = 'commercial';
  });
  var COMM = [0xd9d2c4, 0xcfc8ba, 0xc4bcae, 0xddd6cb, 0xbdb7ab, 0xd2c7b3], AWN = [0x8a3b2e, 0x2f4a6b, 0x3f5d49, 0x7a5a2e, 0x5b3a52];
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
  // Clay barrel tile: rounded rows running down the slope (about 1 ft apart), with course lines.
  var tileTex = canvasTex(function (g) {
    g.fillStyle = '#fff'; g.fillRect(0, 0, 64, 64);
    for (var x = 0; x < 64; x += 16) { var gr = g.createLinearGradient(x, 0, x + 16, 0); gr.addColorStop(0, 'rgba(0,0,0,0.32)'); gr.addColorStop(0.45, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,0.26)'); g.fillStyle = gr; g.fillRect(x, 0, 16, 64); }
    g.fillStyle = 'rgba(0,0,0,0.14)'; for (var y = 0; y < 64; y += 21) g.fillRect(0, y, 64, 2);
  }, 1 / 4, 1 / 3);
  var STUCCO = [0xf1e9d8, 0xe9dcc3, 0xf4efe6, 0xe6d5b8, 0xead9c9, 0xdccbb0, 0xe2d7c5, 0xd9c7a8];
  var windowTex = canvasTex(function (g) {
    g.fillStyle = '#f4f3ef'; g.fillRect(0, 0, 64, 64);
    var gr = g.createLinearGradient(0, 0, 64, 64); gr.addColorStop(0, '#4c5d6e'); gr.addColorStop(1, '#2b3540');
    g.fillStyle = gr; g.fillRect(7, 7, 50, 50);
    g.fillStyle = '#f4f3ef'; g.fillRect(30, 7, 4, 50); g.fillRect(7, 28, 50, 4);
  }, 1, 1);
  windowTex.wrapS = windowTex.wrapT = THREE.ClampToEdgeWrapping;

  // Geometry accumulators (non-indexed triangles).
  function Acc(withColor) { return { p: [], n: [], u: [], c: withColor ? [] : null }; }
  var gWall = Acc(true), gRoof = Acc(true), gTile = Acc(true), gTrim = Acc(true), gWin = Acc(false);
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

  // Flat roof over any footprint shape (triangulated), facing up.
  function flatRoof(acc, pts, y, col) {
    var c = pts.map(function (p) { return new THREE.Vector2(p[0], p[1]); });
    if (c.length > 3 && c[0].equals(c[c.length - 1])) c.pop();
    THREE.ShapeUtils.triangulateShape(c, []).forEach(function (f) {
      var a = [c[f[0]].x, y, c[f[0]].y], b = [c[f[1]].x, y, c[f[1]].y], d = [c[f[2]].x, y, c[f[2]].y];
      var up = (b[2] - a[2]) * (d[0] - a[0]) - (b[0] - a[0]) * (d[2] - a[2]);
      if (up < 0) tri(acc, a, d, b, null, null, null, col); else tri(acc, a, b, d, null, null, null, col);
    });
  }
  // Gas-station style canopy: a flat slab on posts, no walls.
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
  // Shops, offices, schools, hotels: plain stucco walls with a darker cap, flat roof behind a parapet,
  // big storefront glass and an awning on the side that faces the street, window rows upstairs.
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
    var pts = B.pts, h = B.ht.wall, wallC = new THREE.Color(WALLS[i % WALLS.length]);
    var sgn = 0; for (var k = 0; k < pts.length; k++) { var p = pts[k], q = pts[(k + 1) % pts.length]; sgn += p[0] * q[1] - q[0] * p[1]; }
    // House style, so streets don't look copy-pasted:
    //  - clay-tile roof + stucco where the aerial photo shows a red/orange roof (Hamilton's Spanish style)
    //  - otherwise lap siding or plain stucco with a shingle roof; two-storey homes get a trim belt
    //    and a slightly different shade upstairs; some single-storey homes get a low hip roof.
    var seedN = ((i * 2654435761) >>> 0) % 1000 / 1000, hs = {}; roofColor.getHSL(hs);
    var tile = (hs.h < 0.075 || hs.h > 0.97) && hs.s > 0.22 && hs.l > 0.2;
    if (B.ht.src === 'city') tile = false;                       // Hamilton Cottages keep their own siding look
    var stucco = tile || (seedN < 0.28 && B.ht.src !== 'city');
    var wAcc = stucco ? gTrim : gWall, rAcc = tile ? gTile : gRoof;
    if (stucco) wallC = new THREE.Color(STUCCO[i % STUCCO.length]);
    if (tile) roofColor = roofColor.clone().lerp(new THREE.Color(0xb5653f), 0.55);
    var two = h >= 17, hm = two ? h * 0.52 : h, upC = two && !stucco ? wallC.clone().multiplyScalar(i % 2 ? 0.9 : 1.07) : wallC;
    // walls (u = distance along the wall, v = height)
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
    var ranchHip = !two && !B.kind && o.W > 24 && seedN > 0.55 && B.ht.src !== 'city';
    if (fill > 0.68 && o.W < 70 && B.fp < 7000 && !ranchHip) {
      // Gable roof, ridge along the long side, 1.4 ft overhang, white rakes and fascia.
      var rise = B.ht.peak ? Math.max(2, Math.min(16, B.ht.peak - h)) : Math.max(3, Math.min(11, o.W * 0.36)), oh = 1.4, La = o.L / 2 + oh, Wb = o.W / 2 + oh, drop = oh * rise / (o.W / 2);
      var slopeLen = Math.hypot(Wb, rise + drop);
      [1, -1].forEach(function (s) {
        quad(rAcc, P(-La, s * Wb, h - drop), P(La, s * Wb, h - drop), P(La, 0, h + rise), P(-La, 0, h + rise),
          [-La, 0], [La, 0], [La, slopeLen], [-La, slopeLen], roofColor);
        // fascia board under the eave
        quad(gTrim, P(-La, s * Wb, h - drop - 0.7), P(La, s * Wb, h - drop - 0.7), P(La, s * Wb, h - drop), P(-La, s * Wb, h - drop), null, null, null, null, TRIM);
      });
      [1, -1].forEach(function (e) {
        var A0 = e * o.L / 2;
        // gable-end wall triangle (siding continues up)
        tri(wAcc, P(A0, -o.W / 2, h), P(A0, o.W / 2, h), P(A0, 0, h + rise), [0, h], [o.W, h], [o.W / 2, h + rise], upC);
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
      var sl2 = Math.hypot(o.W / 2, r2);
      quad(rAcc, c4[0], c4[1], r1, r0, [0, 0], [o.L, 0], [o.L, sl2], [0, sl2], roofColor);
      quad(rAcc, c4[2], c4[3], r0, r1, [0, 0], [o.L, 0], [o.L, sl2], [0, sl2], roofColor);
      tri(rAcc, c4[1], c4[2], r1, [0, 0], [o.W, 0], [o.W / 2, sl2], roofColor);
      tri(rAcc, c4[3], c4[0], r0, [0, 0], [o.W, 0], [o.W / 2, sl2], roofColor);
    }
    // Chimney on some homes.
    if (houseLike && !B.kind && B.ht.src !== 'city' && (i * 7919) % 10 < 4) {
      var chTop = h + (B.ht.peak ? Math.max(2, Math.min(14, B.ht.peak - h)) : 6) + 2.5, cp = P(o.L * 0.22, o.W * 0.18, 0), chH = chTop - h + 2;
      boxGeo(gTrim, cp[0], h - 2 + chH / 2, cp[2], 3.2, chH, 2.6, Math.atan2(-o.uz, o.ux), stucco ? wallC : new THREE.Color(0x9a5f4a));
    }
    if (B.kind === 'church') {
      // Bell tower with a small spire at one end.
      var rotC = Math.atan2(-o.uz, o.ux), tp = P(-o.L / 2 + 6, 0, 0), th = h + 16;
      boxGeo(gTrim, tp[0], th / 2, tp[2], 10, th, 10, rotC, wallC.clone().multiplyScalar(1.05));
      boxGeo(gTrim, tp[0], th + 4, tp[2], 6, 8, 6, rotC, TRIM);
      boxGeo(gTrim, tp[0], th + 12, tp[2], 2.4, 9, 2.4, rotC, roofColor);
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
      var doorT = -1, garT = -1, gw = 0;
      if (k === front) {
        // Garage door at the far end of the front wall, with a driveway out to the street.
        if (B.ht.src !== 'city' && len4 > 26 && B.fp > 1100) {
          gw = len4 > 38 ? 16 : 8.6; garT = 1 - (gw / 2 + 2.2) / len4;
          if ((garT - 0.28) * len4 < gw / 2 + 4) { garT = -1; gw = 0; }
        }
        doorT = garT > 0 ? 0.28 : (len4 > 22 ? 0.35 : 0.5); door = true;
        var dxp = a4[0] + ddx * doorT, dzp = a4[1] + ddz * doorT;
        var tx4 = ddx / len4, tz4 = ddz / len4, toRoad = nr[0] * nx4 + nr[1] * nz4;
        var flat = function (cx, cz, w, y, col) {      // paved strip from the wall out toward the street
          var out = toRoad - ((cx - o.cx) * nx4 + (cz - o.cz) * nz4) - 13;
          if (out < 5 || out > 120) return;
          quad(gTrim, [cx - tx4 * w / 2, y, cz - tz4 * w / 2], [cx + tx4 * w / 2, y, cz + tz4 * w / 2],
            [cx + tx4 * w / 2 + nx4 * out, y, cz + tz4 * w / 2 + nz4 * out], [cx - tx4 * w / 2 + nx4 * out, y, cz - tz4 * w / 2 + nz4 * out], null, null, null, null, col);
        };
        flat(dxp, dzp, 3.8, 0.74, new THREE.Color(0xcfc9bd));
        if (garT > 0) {
          var gx = a4[0] + ddx * garT, gz = a4[1] + ddz * garT, garC = (i % 2) ? new THREE.Color(0xeeeae0) : wallC.clone().multiplyScalar(0.84);
          wallRect(gTrim, gx, gz, nx4, nz4, 0, gw + 0.9, 7.9, 0.1, TRIM);
          wallRect(gTrim, gx, gz, nx4, nz4, 0, gw, 7.4, 0.18, garC);
          [1.85, 3.7, 5.55].forEach(function (yy) { wallRect(gTrim, gx, gz, nx4, nz4, yy, gw, 0.14, 0.24, garC.clone().multiplyScalar(0.78)); });
          flat(gx, gz, gw + 2, 0.72, new THREE.Color(0xbfb9ad));
        }
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
          if (f === 0 && garT > 0 && Math.abs(t - garT) * len4 < gw / 2 + 2.4) continue;
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
    // Backyard fences along lot lines, left open toward the street.
    (function () {
      var done = {};
      buildings.forEach(function (B) {
        if (B.kind || B.fp < 500 || B.ht.src === 'city') return;
        var c = centroid(B.pts), P = findAt(parcels, c[0], c[1]);
        if (!P || done[P.apn] || P.size < 3000 || P.size > 22000) return;
        done[P.apn] = 1;
        for (var e = 0; e < P.pts.length; e++) {
          var a = P.pts[e], b = P.pts[(e + 1) % P.pts.length], len = Math.hypot(b[0] - a[0], b[1] - a[1]); if (len < 6) continue;
          var n = Math.max(1, Math.round(len / 12));
          var col = new THREE.Color((Math.abs(Math.round(a[0] + b[0] + a[1] + b[1])) % 4) ? 0x9c8566 : 0xe6e2d8);
          for (var s = 0; s < n; s++) {
            var p0 = [a[0] + (b[0] - a[0]) * s / n, a[1] + (b[1] - a[1]) * s / n], p1 = [a[0] + (b[0] - a[0]) * (s + 1) / n, a[1] + (b[1] - a[1]) * (s + 1) / n];
            var nr = nearestRoad((p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2);
            if (nr && nr[2] < 48) continue;
            quad(gTrim, [p0[0], 0, p0[1]], [p1[0], 0, p1[1]], [p1[0], 5.5, p1[1]], [p0[0], 5.5, p0[1]], null, null, null, null, col);
          }
        }
      });
    })();
    wallMesh = finish(gWall, new THREE.MeshLambertMaterial({ vertexColors: true, map: sidingTex, side: THREE.DoubleSide }));
    roofMesh = finish(gRoof, new THREE.MeshLambertMaterial({ vertexColors: true, map: roofTex, side: THREE.DoubleSide }));
    if (gTile.p.length) pickMeshes.push(finish(gTile, new THREE.MeshLambertMaterial({ vertexColors: true, map: tileTex, side: THREE.DoubleSide })));
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
    if (!L) rows.push(nearbyHtml(s.x, s.z));
    rows.push('<p class="fine">Lot sizes from the county parcel map (not survey accurate). Building outlines &copy; OpenStreetMap contributors.</p>');
    infoBody.innerHTML = rows.join('');
    var lo = document.getElementById('lead-open'); if (lo) lo.addEventListener('click', showLeadForm);
  }
  function showLeadForm() {
    var s = current, L = s.listing, P = s.P, B = s.B;
    var title = L ? 'Ask about ' + esc(L.title) : 'Free home value report';
    var intro = L ? 'Questions, a private showing, or open house details. Nathan will get back to you.'
      : 'Get a free comparative market analysis for your ' + esc(AREA_NAME) + ' home from ' + esc(LEAD.agent) + '. No cost, no obligation.';
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
      '<input type="hidden" name="_subject" value="' + esc((L ? 'Inquiry: ' + L.title : 'Home value request') + ' (' + AREA_NAME + ' 3D map)') + '">' +
      '<input type="hidden" name="source" value="' + esc(AREA_NAME) + ' 3D map">' +
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
    if (!B && !P) { info.classList.remove('open'); markPin(null); return; }
    if (B && B.places && B.kind) { selectPlace(B.places[0], false); return; }   // a shop, museum, church ...
    markPin(null);
    if (P) selGroup.add(outline(P.pts, 0x3fa7ff, 1.6));
    if (B) selGroup.add(outline(B.pts, 0xffffff, B.ht.wall + 0.5));
    var listing = P ? LISTINGS.filter(function (l) { return l.apn === P.apn; })[0] : null;
    current = { P: P, B: B, listing: listing, addr: (B && B.src.a) || nearestAddress(x, z, 40), x: x, z: z };
    if (B && !B.kind) lastHome = { x: x, z: z, label: current.addr || 'the home you picked' };
    showDetails();
    info.classList.add('open');
  }

  // ---------- local places: pins, filter chips, cards, "what's nearby" ----------
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
    'Museum': '🏛️', 'Community center': '🤝' };
  function emo(p) { return SUB_E[p.s] || CATS[p.k].e; }
  var lastHome = null, selPlace = null, placeCat = 'all', plWrap = null;
  function walkText(d) { var min = Math.round(d * 1.3 / 272); return min <= 30 ? 'about ' + Math.max(1, min) + ' min walk' : 'about ' + (d * 1.3 / 5280).toFixed(1) + ' mi'; }
  function hoursText(h) {
    var D = { Mo: 'Mon', Tu: 'Tue', We: 'Wed', Th: 'Thu', Fr: 'Fri', Sa: 'Sat', Su: 'Sun' };
    return h.split(';').map(function (s) { return s.trim(); }).filter(function (s) { return s && !/\[|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|PH/.test(s); })
      .map(function (s) { return s.replace(/\b(Mo|Tu|We|Th|Fr|Sa|Su)\b/g, function (m) { return D[m]; }).replace(/\boff\b/g, 'closed').replace(/-/g, '–'); }).join('; ');
  }
  function markPin(p) { if (selPlace && selPlace.el) selPlace.el.classList.remove('sel'); selPlace = p; if (p && p.el) p.el.classList.add('sel'); }
  function nearest(x, z, test) { var best = null, bd = 1e9; places.forEach(function (p) { if (p.minor || !test(p)) return; var d = Math.hypot(p.x - x, p.z - z); if (d < bd) { bd = d; best = p; } }); return best ? { p: best, d: bd } : null; }
  function nearbyHtml(x, z) {
    if (!places.length) return '';
    var picks = [
      nearest(x, z, function (p) { return p.s === 'Café'; }), nearest(x, z, function (p) { return p.s === 'Grocery store'; }),
      nearest(x, z, function (p) { return p.k === 'food' && p.s !== 'Café'; }), nearest(x, z, function (p) { return p.k === 'parks'; }),
      nearest(x, z, function (p) { return p.k === 'schools'; }), nearest(x, z, function (p) { return p.k === 'arts'; }),
      nearest(x, z, function (p) { return p.s === 'Train station'; })
    ].filter(Boolean);
    var rows = picks.map(function (n) {
      return '<button type="button" class="near-row" data-pl="' + n.p.i + '"><span class="e">' + emo(n.p) + '</span><span><b>' + esc(n.p.n) + '</b><small>' + esc(n.p.s) + ' &middot; ' + walkText(n.d) + '</small></span></button>';
    }).join('');
    return '<div class="nearby"><h4>What&rsquo;s nearby</h4>' + rows +
      (CFG.trackerLink ? '<a class="near-link" href="' + esc(CFG.trackerLink) + '">See what&rsquo;s being built in Novato &rarr;</a>' : '') + '</div>';
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
    rows.push('<p class="btns">' + btns.join(' ') + '</p>');
    rows.push('<p class="fine">Place details come from OpenStreetMap volunteers and can be out of date. Check hours before you go.</p>');
    infoBody.innerHTML = rows.join('');
  }
  function selectPlace(p, fly) {
    while (selGroup.children.length) selGroup.remove(selGroup.children[0]);
    if (p.B) selGroup.add(outline(p.B.pts, 0xffffff, p.B.ht.wall + 0.5));
    current = null; markPin(p);
    if (placeCat !== 'all' && placeCat !== p.k) setPlaceCat('all');
    showPlace(p); info.classList.add('open');
    if (fly) {
      var q = new THREE.Vector3(p.x, 0, p.z), off = camera.position.clone().sub(controls.target); off.setLength(Math.max(320, Math.min(off.length(), 700)));
      anim = { t0: performance.now(), dur: 1100, p0: camera.position.clone(), p1: q.clone().add(off), q0: controls.target.clone(), q1: q };
    }
  }
  infoBody.addEventListener('click', function (e) {
    var t = e.target.closest('[data-pl]'); if (!t) return;
    e.preventDefault(); selectPlace(places[+t.getAttribute('data-pl')], true);
  });
  function setPlaceCat(k) {
    placeCat = k;
    document.querySelectorAll('#placebar button').forEach(function (b) { b.classList.toggle('on', b.dataset.k === k); });
  }
  if (places.length) {
    plWrap = document.createElement('div'); plWrap.id = 'places'; document.body.appendChild(plWrap);
    places.forEach(function (p) {
      var el = document.createElement('button'); el.type = 'button'; el.className = 'pl'; el.style.setProperty('--c', CATS[p.k].c); el.title = p.n;
      el.innerHTML = '<span class="ic">' + emo(p) + '</span><span class="nm">' + esc(p.n) + '</span>';
      el.addEventListener('click', function () { selectPlace(p, true); });
      plWrap.appendChild(el); p.el = el; p.v = new THREE.Vector3();
    });
    var bar = document.createElement('div'); bar.id = 'placebar'; bar.className = 'views';
    var used = {}; places.forEach(function (p) { used[p.k] = 1; });
    bar.innerHTML = '<button data-k="all" class="on">All places</button>' +
      Object.keys(CATS).filter(function (k) { return used[k]; }).map(function (k) { return '<button data-k="' + k + '">' + CATS[k].e + ' ' + CATS[k].l + '</button>'; }).join('') +
      '<button data-k="none">Hide places</button>';
    document.body.appendChild(bar);
    bar.addEventListener('click', function (e) { var b = e.target.closest('button'); if (b) setPlaceCat(b.dataset.k); });
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

  document.getElementById('info-close').addEventListener('click', function () { info.classList.remove('open'); markPin(null); while (selGroup.children.length) selGroup.remove(selGroup.children[0]); });

  // ---------- home marker (only on pages that include one) ----------
  var pin = document.getElementById('home-pin'), pinV = new THREE.Vector3(0, 70, 0);
  if (pin) pin.addEventListener('click', function () { select(0, 0); goTo('home'); });

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
  function placeViews() {
    var v = document.getElementById('views'), pb = document.getElementById('placebar');
    v.style.top = (document.querySelector('.topbar').offsetHeight + 8) + 'px';
    if (pb) pb.style.top = (v.offsetTop + v.offsetHeight + 6) + 'px';
  }
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
    if (pin) {
      tmp.copy(pinV).project(camera);
      var off = tmp.z > 1 || Math.abs(tmp.x) > 1.05 || Math.abs(tmp.y) > 1.05;
      pin.style.display = off ? 'none' : '';
      if (!off) { pin.style.left = ((tmp.x + 1) / 2 * window.innerWidth) + 'px'; pin.style.top = ((1 - tmp.y) / 2 * window.innerHeight) + 'px'; }
    }
    // Place pins: follow the map; names appear as you get closer, minor ones only up close.
    for (var pi = 0; pi < places.length; pi++) {
      var pp = places[pi], el = pp.el; if (!el) continue;
      var show = placeCat === 'all' || placeCat === pp.k || pp === selPlace;
      if (show) {
        pp.v.set(pp.x, (pp.B ? pp.B.ht.wall : 0) + 16, pp.z);
        var pd = camera.position.distanceTo(pp.v);
        if (pp.minor && pd > 2400 && pp !== selPlace) show = false;
        else {
          tmp.copy(pp.v).project(camera);
          if (tmp.z > 1 || Math.abs(tmp.x) > 1.02 || Math.abs(tmp.y) > 1.02) show = false;
          else {
            el.style.transform = 'translate(' + ((tmp.x + 1) / 2 * window.innerWidth).toFixed(1) + 'px,' + ((1 - tmp.y) / 2 * window.innerHeight).toFixed(1) + 'px) translate(-50%,-100%)';
            var far = pd > (placeCat === 'all' ? 2600 : 5200) && pp !== selPlace;
            if (pp.far !== far) { pp.far = far; el.classList.toggle('far', far); }
          }
        }
      }
      if (pp.shown !== show) { pp.shown = show; el.style.display = show ? '' : 'none'; }
    }
    requestAnimationFrame(loop);
  }
  controls.target.fromArray(VIEWS.overview.t); camera.position.copy(viewPos(VIEWS.overview)); controls.update();
  window.__area = { camera: camera, controls: controls, select: select, buildings: buildings, parcels: parcels, places: places, selectPlace: selectPlace };
  requestAnimationFrame(loop);
})();