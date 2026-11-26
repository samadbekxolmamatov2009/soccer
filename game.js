/* global THREE */
(function () {
  "use strict";

  const V3 = THREE.Vector3;
  const clamp = THREE.MathUtils.clamp;
  const lerp = THREE.MathUtils.lerp;
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const hdist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
  const flat = (v) => new V3(v.x, 0, v.z);
  const $ = (id) => document.getElementById(id);

  /* ======================= CONSTANTS ======================= */
  const FIELD_W = 64, FIELD_L = 100;
  const HALF_W = FIELD_W / 2, HALF_L = FIELD_L / 2;
  const GOAL_HW = 7, GOAL_H = 5, GOAL_D = 2.6, POST_R = 0.12;
  const BALL_R = 0.33;
  const GRAVITY = -18;
  const GROUND_FRICTION = 0.9;
  const KICK_DUR = 0.28, SLIDE_DUR = 0.55, DIVE_DUR = 0.6;
  const YOU = "you", RIVAL = "rival";

  const DIFFICULTY = {
    easy: { rivalSpeed: 0.86, steal: 0.6, shootErr: 7, gkSave: 0.42, decision: 0.55 },
    normal: { rivalSpeed: 0.97, steal: 1.1, shootErr: 5, gkSave: 0.58, decision: 0.4 },
    hard: { rivalSpeed: 1.08, steal: 1.8, shootErr: 3.2, gkSave: 0.72, decision: 0.28 },
  };

  const TEAM_STYLE = {
    you: { jersey: 0xd62d2d, shorts: 0x161616, socks: 0xd62d2d, gk: 0xf0c419, radar: "#ff5252" },
    rival: { jersey: 0x1f4fc9, shorts: 0xf2f2f2, socks: 0x1f4fc9, gk: 0x2fbf71, radar: "#5b8cff" },
  };
  const SKINS = [0xf1c7a0, 0xe0ac7e, 0xc68a5c, 0x8d5a3b, 0xf5d0b0, 0xd9a273];
  const HAIRS = [0x1c140e, 0x3a2414, 0x6b4423, 0x0e0e0e, 0x9a7b4f, 0x2b1d14];

  // 7-a-side; u = distance from own goal line
  const FORMATION = [
    { role: "gk", x: 0, u: 2.5 },
    { role: "def", x: -11, u: 16 },
    { role: "def", x: 11, u: 16 },
    { role: "mid", x: -15, u: 30 },
    { role: "mid", x: 15, u: 30 },
    { role: "fwd", x: -6, u: 38 },
    { role: "fwd", x: 6, u: 38 },
  ];
  const NUMBERS = { you: [1, 4, 5, 8, 7, 10, 9], rival: [1, 2, 3, 6, 11, 10, 9] };

  const attackDirOf = (team) => (team === YOU ? 1 : -1);
  const ownGoalZ = (team) => -attackDirOf(team) * HALF_L;
  const other = (team) => (team === YOU ? RIVAL : YOU);

  /* ======================= RENDERER / SCENE ======================= */
  const canvas = $("gameCanvas");
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  const maxAniso = renderer.capabilities.getMaxAnisotropy();

  const scene = new THREE.Scene();
  scene.background = (function () {
    const c = document.createElement("canvas");
    c.width = 2; c.height = 256;
    const g = c.getContext("2d");
    const grd = g.createLinearGradient(0, 0, 0, 256);
    grd.addColorStop(0, "#2f6fb5");
    grd.addColorStop(0.55, "#8ec3ea");
    grd.addColorStop(1, "#d9edf8");
    g.fillStyle = grd;
    g.fillRect(0, 0, 2, 256);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })();
  scene.fog = new THREE.Fog(0xbcdcf0, 130, 300);

  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 500);

  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.fov = camera.aspect < 1 ? 64 : 50;
    camera.updateProjectionMatrix();
  }
  window.addEventListener("resize", resize);
  resize();

  /* ======================= LIGHTS ======================= */
  scene.add(new THREE.HemisphereLight(0xffffff, 0x4a6a3a, 1.3));
  const sun = new THREE.DirectionalLight(0xfff6e8, 2.6);
  sun.position.set(30, 55, -22);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -64, right: 64, top: 64, bottom: -64, near: 1, far: 160 });
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.02;
  scene.add(sun);

  /* ======================= PITCH ======================= */
  const MARGIN = 6;
  function buildPitchTexture() {
    const TW = FIELD_W + 2 * MARGIN, TL = FIELD_L + 2 * MARGIN;
    const cw = 1024, ch = Math.round((cw * TL) / TW);
    const cv = document.createElement("canvas");
    cv.width = cw; cv.height = ch;
    const g = cv.getContext("2d");
    const sx = cw / TW;
    const px = (x) => (x + TW / 2) * sx;
    const py = (z) => (z + TL / 2) * sx;

    g.fillStyle = "#3a8c3a";
    g.fillRect(0, 0, cw, ch);
    const bands = 16, bandL = FIELD_L / bands;
    for (let i = -2; i < bands + 2; i++) {
      g.fillStyle = (i + 2) % 2 === 0 ? "#40963f" : "#36863a";
      g.fillRect(0, py(-HALF_L + i * bandL), cw, bandL * sx + 1);
    }
    for (let i = 0; i < 32000; i++) {
      g.fillStyle = Math.random() < 0.5 ? "rgba(255,255,255,0.035)" : "rgba(0,0,0,0.05)";
      g.fillRect(Math.random() * cw, Math.random() * ch, 2, 2);
    }

    g.strokeStyle = "rgba(255,255,255,0.92)";
    g.fillStyle = "rgba(255,255,255,0.92)";
    g.lineWidth = Math.max(2.5, 0.15 * sx);
    const rect = (x0, z0, x1, z1) => g.strokeRect(px(x0), py(z0), px(x1) - px(x0), py(z1) - py(z0));
    const dot = (x, z, r) => { g.beginPath(); g.arc(px(x), py(z), r * sx, 0, Math.PI * 2); g.fill(); };

    rect(-HALF_W, -HALF_L, HALF_W, HALF_L);
    g.beginPath(); g.moveTo(px(-HALF_W), py(0)); g.lineTo(px(HALF_W), py(0)); g.stroke();
    g.beginPath(); g.arc(px(0), py(0), 9 * sx, 0, Math.PI * 2); g.stroke();
    dot(0, 0, 0.3);

    for (const side of [-1, 1]) {
      const gz = side * HALF_L, inward = -side;
      rect(-16, gz, 16, gz + inward * 16);
      rect(-8, gz, 8, gz + inward * 5.5);
      dot(0, gz + inward * 11, 0.25);
      const a = Math.asin(5 / 9);
      g.beginPath();
      if (inward > 0) g.arc(px(0), py(gz + inward * 11), 9 * sx, a, Math.PI - a);
      else g.arc(px(0), py(gz + inward * 11), 9 * sx, Math.PI + a, 2 * Math.PI - a);
      g.stroke();
    }
    g.save();
    g.beginPath();
    g.rect(px(-HALF_W), py(-HALF_L), FIELD_W * sx, FIELD_L * sx);
    g.clip();
    for (const cx of [-1, 1]) for (const cz of [-1, 1]) {
      g.beginPath(); g.arc(px(cx * HALF_W), py(cz * HALF_L), 1.2 * sx, 0, Math.PI * 2); g.stroke();
    }
    g.restore();

    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = maxAniso;
    return tex;
  }

  const pitch = new THREE.Mesh(
    new THREE.PlaneGeometry(FIELD_W + 2 * MARGIN, FIELD_L + 2 * MARGIN),
    new THREE.MeshStandardMaterial({ map: buildPitchTexture(), roughness: 0.95 })
  );
  pitch.rotation.x = -Math.PI / 2;
  pitch.receiveShadow = true;
  scene.add(pitch);

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), new THREE.MeshStandardMaterial({ color: 0x2d5a2b, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.03;
  scene.add(ground);

  /* ======================= GOALS ======================= */
  function netTexture() {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const g = c.getContext("2d");
    g.strokeStyle = "rgba(255,255,255,0.85)";
    g.lineWidth = 2;
    for (let i = 0; i <= 64; i += 16) {
      g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 64); g.stroke();
      g.beginPath(); g.moveTo(0, i); g.lineTo(64, i); g.stroke();
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  }
  const NET_TEX = netTexture();

  function buildGoal(endSign) {
    const grp = new THREE.Group();
    const white = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35 });
    const add = (geo, x, y, z, rx = 0, rz = 0, cast = true) => {
      const m = new THREE.Mesh(geo, white);
      m.position.set(x, y, z);
      m.rotation.x = rx; m.rotation.z = rz;
      m.castShadow = cast;
      grp.add(m);
    };
    const post = new THREE.CylinderGeometry(POST_R, POST_R, GOAL_H, 12);
    add(post, -GOAL_HW, GOAL_H / 2, 0);
    add(post, GOAL_HW, GOAL_H / 2, 0);
    add(new THREE.CylinderGeometry(POST_R, POST_R, GOAL_HW * 2 + POST_R * 2, 12), 0, GOAL_H, 0, 0, Math.PI / 2);
    const thin = new THREE.CylinderGeometry(0.05, 0.05, GOAL_H, 6);
    add(thin, -GOAL_HW, GOAL_H / 2, GOAL_D, 0, 0, false);
    add(thin, GOAL_HW, GOAL_H / 2, GOAL_D, 0, 0, false);
    add(new THREE.CylinderGeometry(0.05, 0.05, GOAL_HW * 2, 6), 0, GOAL_H, GOAL_D, 0, Math.PI / 2, false);
    const side = new THREE.CylinderGeometry(0.05, 0.05, GOAL_D, 6);
    add(side, -GOAL_HW, GOAL_H, GOAL_D / 2, Math.PI / 2, 0, false);
    add(side, GOAL_HW, GOAL_H, GOAL_D / 2, Math.PI / 2, 0, false);

    const netMat = (rx, ry) => {
      const t = NET_TEX.clone();
      t.needsUpdate = true;
      t.repeat.set(rx, ry);
      return new THREE.MeshBasicMaterial({ map: t, transparent: true, side: THREE.DoubleSide, depthWrite: false });
    };
    const back = new THREE.Mesh(new THREE.PlaneGeometry(GOAL_HW * 2, GOAL_H), netMat(14, 5));
    back.position.set(0, GOAL_H / 2, GOAL_D);
    const top = new THREE.Mesh(new THREE.PlaneGeometry(GOAL_HW * 2, GOAL_D), netMat(14, 2.6));
    top.rotation.x = Math.PI / 2;
    top.position.set(0, GOAL_H, GOAL_D / 2);
    grp.add(back, top);
    for (const s of [-1, 1]) {
      const sn = new THREE.Mesh(new THREE.PlaneGeometry(GOAL_D, GOAL_H), netMat(2.6, 5));
      sn.rotation.y = Math.PI / 2;
      sn.position.set(s * GOAL_HW, GOAL_H / 2, GOAL_D / 2);
      grp.add(sn);
    }
    grp.position.z = endSign * HALF_L;
    if (endSign < 0) grp.rotation.y = Math.PI;
    scene.add(grp);
  }
  buildGoal(1);
  buildGoal(-1);

  function buildCornerFlags() {
    const poleM = new THREE.MeshStandardMaterial({ color: 0xffffff });
    const flagM = new THREE.MeshStandardMaterial({ color: 0xffd400, side: THREE.DoubleSide });
    for (const cx of [-1, 1]) for (const cz of [-1, 1]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.6, 6), poleM);
      pole.position.set(cx * HALF_W, 0.8, cz * HALF_L);
      pole.castShadow = true;
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.45, 0.3), flagM);
      flag.position.set(cx * HALF_W - cx * 0.23, 1.45, cz * HALF_L);
      scene.add(pole, flag);
    }
  }
  buildCornerFlags();

  /* ======================= STADIUM ======================= */
  let crowdMesh = null;
  let crowdBase = null;
  const crowdDummy = new THREE.Object3D();

  function boardTexture() {
    const c = document.createElement("canvas");
    c.width = 1024; c.height = 64;
    const g = c.getContext("2d");
    const items = [
      ["#0d47a1", "#ffffff", "DREAM LEAGUE 2026"],
      ["#ffd400", "#111111", "FUTBOL"],
      ["#c62828", "#ffffff", "GOL!"],
      ["#1b5e20", "#ffffff", "SPORT TV"],
      ["#212121", "#ffd400", "O'ZBEKISTON"],
    ];
    const w = c.width / items.length;
    items.forEach(([bg, fg, text], i) => {
      g.fillStyle = bg;
      g.fillRect(i * w, 0, w, 64);
      g.fillStyle = fg;
      g.font = "bold 30px Arial";
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText(text, i * w + w / 2, 34);
    });
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = THREE.RepeatWrapping;
    t.anisotropy = maxAniso;
    return t;
  }

  function buildStadium() {
    const concrete = new THREE.MeshStandardMaterial({ color: 0x6b7480, roughness: 0.95 });
    const rows = 10, rowH = 0.85, rowD = 1.3;
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    for (let r = 0; r < rows; r++) {
      shape.lineTo(r * rowD, (r + 1) * rowH);
      shape.lineTo((r + 1) * rowD, (r + 1) * rowH);
    }
    shape.lineTo(rows * rowD + 1.2, rows * rowH + 3);
    shape.lineTo(rows * rowD + 1.2, 0);
    shape.lineTo(0, 0);

    const stands = [
      { origin: new V3(HALF_W + 8, 0, 0), rotY: 0, len: 118 },
      { origin: new V3(-HALF_W - 8, 0, 0), rotY: Math.PI, len: 118 },
      { origin: new V3(0, 0, HALF_L + 10), rotY: -Math.PI / 2, len: 84 },
      { origin: new V3(0, 0, -HALF_L - 10), rotY: Math.PI / 2, len: 84 },
    ];
    const seats = [];
    const up = new V3(0, 1, 0);
    for (const s of stands) {
      const geo = new THREE.ExtrudeGeometry(shape, { depth: s.len, bevelEnabled: false });
      const mesh = new THREE.Mesh(geo, concrete);
      const along = new V3(0, 0, 1).applyAxisAngle(up, s.rotY);
      const out = new V3(1, 0, 0).applyAxisAngle(up, s.rotY);
      mesh.rotation.y = s.rotY;
      mesh.position.copy(s.origin).addScaledVector(along, -s.len / 2);
      scene.add(mesh);
      for (let r = 0; r < rows; r++) {
        for (let t = -s.len / 2 + 1; t < s.len / 2 - 1; t += 0.75) {
          if (Math.random() < 0.12) continue;
          const p = s.origin.clone().addScaledVector(out, r * rowD + rowD * 0.55).addScaledVector(along, t);
          p.y = (r + 1) * rowH + 0.36;
          seats.push(p.x, p.y, p.z, s.rotY, Math.random() * Math.PI * 2);
        }
      }
    }

    const count = seats.length / 5;
    crowdBase = new Float32Array(seats);
    const colors = [0xc62828, 0x1565c0, 0xf9a825, 0xffffff, 0x2e7d32, 0x37474f, 0xe0e0e0, 0x8e24aa, 0xd84315];
    crowdMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.42, 0.72, 0.34), new THREE.MeshStandardMaterial({ roughness: 0.9 }), count);
    const col = new THREE.Color();
    for (let i = 0; i < count; i++) {
      crowdDummy.position.set(crowdBase[i * 5], crowdBase[i * 5 + 1], crowdBase[i * 5 + 2]);
      crowdDummy.rotation.set(0, crowdBase[i * 5 + 3], 0);
      crowdDummy.updateMatrix();
      crowdMesh.setMatrixAt(i, crowdDummy.matrix);
      crowdMesh.setColorAt(i, col.setHex(pick(colors)));
    }
    scene.add(crowdMesh);

    const tex = boardTexture();
    const boards = [
      { x: HALF_W + 2.6, z: 0, len: FIELD_L + 4, ry: -Math.PI / 2 },
      { x: -HALF_W - 2.6, z: 0, len: FIELD_L + 4, ry: Math.PI / 2 },
      { x: 0, z: HALF_L + 4.2, len: FIELD_W + 4, ry: Math.PI },
      { x: 0, z: -HALF_L - 4.2, len: FIELD_W + 4, ry: 0 },
    ];
    for (const b of boards) {
      const t = tex.clone();
      t.needsUpdate = true;
      t.repeat.set(b.len / 20, 1);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(b.len, 0.9), new THREE.MeshBasicMaterial({ map: t }));
      m.position.set(b.x, 0.45, b.z);
      m.rotation.y = b.ry;
      scene.add(m);
    }

    const poleM = new THREE.MeshStandardMaterial({ color: 0x8a939c, roughness: 0.6 });
    const lampM = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfffbe0, emissiveIntensity: 1.5 });
    for (const cx of [-1, 1]) for (const cz of [-1, 1]) {
      const x = cx * (HALF_W + 24), z = cz * (HALF_L + 22);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.7, 34, 8), poleM);
      pole.position.set(x, 17, z);
      const head = new THREE.Mesh(new THREE.BoxGeometry(6, 3, 0.6), lampM);
      head.position.set(x, 35, z);
      head.lookAt(0, 0, 0);
      scene.add(pole, head);
    }
  }
  buildStadium();

  function animateCrowd(dt) {
    state.crowdT = Math.max(0, state.crowdT - dt);
    const count = crowdBase.length / 5;
    const t = performance.now() * 0.011;
    const k = Math.min(1, state.crowdT);
    for (let i = 0; i < count; i++) {
      const jump = Math.max(0, Math.sin(t + crowdBase[i * 5 + 4])) * 0.45 * k;
      crowdDummy.position.set(crowdBase[i * 5], crowdBase[i * 5 + 1] + jump, crowdBase[i * 5 + 2]);
      crowdDummy.rotation.set(0, crowdBase[i * 5 + 3], 0);
      crowdDummy.updateMatrix();
      crowdMesh.setMatrixAt(i, crowdDummy.matrix);
    }
    crowdMesh.instanceMatrix.needsUpdate = true;
  }

  /* ======================= BALL ======================= */
  function buildBallTexture() {
    const w = 512, h = 256;
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const g = c.getContext("2d");
    g.fillStyle = "#f5f5f5";
    g.fillRect(0, 0, w, h);
    g.fillStyle = "#151515";
    const patch = (cx, cy, r) => {
      g.beginPath();
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
        g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      }
      g.closePath();
      g.fill();
    };
    for (let i = 0; i < 5; i++) {
      patch(i * (w / 5) + w / 10, h * 0.3, 26);
      patch(i * (w / 5), h * 0.7, 26);
    }
    patch(w / 2, 10, 40);
    patch(w / 2, h - 10, 40);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }
  const ballMesh = new THREE.Mesh(
    new THREE.SphereGeometry(BALL_R, 24, 18),
    new THREE.MeshStandardMaterial({ map: buildBallTexture(), roughness: 0.45 })
  );
  ballMesh.castShadow = true;
  scene.add(ballMesh);

  const ball = {
    mesh: ballMesh,
    pos: new V3(0, BALL_R, 0),
    vel: new V3(),
    owner: null,
    lastTouchTeam: YOU,
    lastToucher: null,
    noPickup: null,
    noPickupT: 0,
    isShot: false,
    saveChecked: false,
  };

  /* ======================= HUMANOID MODEL ======================= */
  const GEO = {
    thigh: new THREE.CapsuleGeometry(0.11, 0.3, 4, 10),
    shin: new THREE.CapsuleGeometry(0.088, 0.3, 4, 10),
    shortLeg: new THREE.CylinderGeometry(0.135, 0.125, 0.22, 10),
    sock: new THREE.CylinderGeometry(0.095, 0.085, 0.24, 10),
    boot: new THREE.BoxGeometry(0.16, 0.11, 0.32),
    shorts: new THREE.CylinderGeometry(0.235, 0.255, 0.24, 12),
    torso: new THREE.CapsuleGeometry(0.2, 0.3, 4, 12),
    neck: new THREE.CylinderGeometry(0.06, 0.07, 0.14, 8),
    head: new THREE.SphereGeometry(0.12, 18, 14),
    hair: new THREE.SphereGeometry(0.128, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.55),
    eye: new THREE.SphereGeometry(0.022, 6, 6),
    upperArm: new THREE.CapsuleGeometry(0.062, 0.2, 4, 8),
    sleeve: new THREE.CylinderGeometry(0.08, 0.075, 0.16, 8),
    foreArm: new THREE.CapsuleGeometry(0.052, 0.18, 4, 8),
    hand: new THREE.SphereGeometry(0.058, 8, 8),
    number: new THREE.PlaneGeometry(0.24, 0.24),
  };

  const matCache = new Map();
  function mat(color, rough = 0.8) {
    const key = color + "_" + rough;
    if (!matCache.has(key)) matCache.set(key, new THREE.MeshStandardMaterial({ color, roughness: rough }));
    return matCache.get(key);
  }
  function part(geo, material, cast) {
    const m = new THREE.Mesh(geo, material);
    m.castShadow = !!cast;
    return m;
  }
  function numberTexture(num) {
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const g = c.getContext("2d");
    g.font = "bold 92px Arial";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.lineWidth = 8;
    g.strokeStyle = "rgba(0,0,0,0.55)";
    g.strokeText(num, 64, 70);
    g.fillStyle = "#ffffff";
    g.fillText(num, 64, 70);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  function buildHumanoid(o) {
    const root = new THREE.Group();
    root.rotation.order = "YXZ";
    const body = new THREE.Group();
    root.add(body);
    const jersey = mat(o.jersey, 0.7), shorts = mat(o.shorts, 0.75), socks = mat(o.socks, 0.8);
    const skin = mat(o.skin, 0.65), boots = mat(0x111111, 0.4), hairM = mat(o.hair, 0.9);

    const leg = (side) => {
      const hip = new THREE.Group();
      hip.position.set(side * 0.11, 0.98, 0);
      const sl = part(GEO.shortLeg, shorts, false); sl.position.y = -0.09;
      const thigh = part(GEO.thigh, skin, true); thigh.position.y = -0.24;
      const knee = new THREE.Group(); knee.position.y = -0.47;
      const shin = part(GEO.shin, skin, true); shin.position.y = -0.21;
      const sock = part(GEO.sock, socks, false); sock.position.y = -0.27;
      const boot = part(GEO.boot, boots, false); boot.position.set(0, -0.45, 0.05);
      knee.add(shin, sock, boot);
      hip.add(sl, thigh, knee);
      body.add(hip);
      return { hip, knee };
    };
    const legL = leg(-1), legR = leg(1);

    const shortsTop = part(GEO.shorts, shorts, true);
    shortsTop.position.y = 0.94;
    body.add(shortsTop);

    const upper = new THREE.Group();
    upper.position.y = 0.98;
    body.add(upper);
    const torso = part(GEO.torso, jersey, true);
    torso.position.y = 0.3;
    torso.scale.set(1.22, 1, 0.78);
    const neck = part(GEO.neck, skin, false);
    neck.position.y = 0.66;
    const headG = new THREE.Group();
    headG.position.y = 0.8;
    const head = part(GEO.head, skin, true);
    head.scale.set(1, 1.12, 1.02);
    const hair = part(GEO.hair, hairM, false);
    hair.position.set(0, 0.025, -0.01);
    hair.rotation.x = -0.35;
    headG.add(head, hair);
    const eyeM = mat(0x1a1a1a, 0.3);
    for (const s of [-1, 1]) {
      const e = part(GEO.eye, eyeM, false);
      e.position.set(s * 0.045, 0.02, 0.112);
      headG.add(e);
    }
    const num = new THREE.Mesh(GEO.number, new THREE.MeshBasicMaterial({ map: numberTexture(o.number), transparent: true }));
    num.position.set(0, 0.36, -0.163);
    num.rotation.y = Math.PI;
    upper.add(torso, neck, headG, num);

    const arm = (side) => {
      const sh = new THREE.Group();
      sh.position.set(side * 0.29, 0.54, 0);
      sh.rotation.z = side * 0.12;
      const ua = part(GEO.upperArm, skin, false); ua.position.y = -0.15;
      const sleeve = part(GEO.sleeve, jersey, true); sleeve.position.y = -0.07;
      const elbow = new THREE.Group(); elbow.position.y = -0.3;
      const fa = part(GEO.foreArm, skin, false); fa.position.y = -0.13;
      const hand = part(GEO.hand, o.gloves ? mat(o.gloves, 0.6) : skin, false); hand.position.y = -0.28;
      elbow.add(fa, hand);
      sh.add(ua, sleeve, elbow);
      upper.add(sh);
      return { sh, elbow };
    };
    const armL = arm(-1), armR = arm(1);

    return { root, body, upper, legL, legR, armL, armR };
  }

  /* ======================= PLAYER ======================= */
  let PID = 0;
  class Player {
    constructor(team, slot, number) {
      this.id = PID++;
      this.team = team;
      this.role = slot.role;
      this.isGK = slot.role === "gk";
      this.number = number;
      this.homeX = slot.x;
      this.homeU = slot.u;
      const st = TEAM_STYLE[team];
      this.parts = buildHumanoid({
        jersey: this.isGK ? st.gk : st.jersey,
        shorts: st.shorts,
        socks: this.isGK ? st.gk : st.socks,
        skin: pick(SKINS),
        hair: pick(HAIRS),
        number: String(number),
        gloves: this.isGK ? 0xf5f5f5 : null,
      });
      this.mesh = this.parts.root;
      scene.add(this.mesh);
      this.pos = new V3();
      this.vel = new V3();
      this.home = new V3();
      this.facing = 0;
      this.curSpeed = 0;
      this.baseSpeed = this.isGK ? 6.2 : 7.0;
      this.animPhase = Math.random() * 6;
      this.slideDir = new V3();
      this.resetTimers();
    }
    resetTimers() {
      this.stunT = 0; this.kickT = 0; this.slideT = 0; this.diveT = 0; this.diveSide = 1;
      this.holdT = 0; this.decisionT = 0; this.slideResolved = true; this.celebrate = false;
    }
    setPosition(x, z) {
      this.pos.set(x, 0, z);
      this.vel.set(0, 0, 0);
      this.mesh.position.set(x, 0, z);
    }
    faceTo(x, z) { this.facing = Math.atan2(x - this.pos.x, z - this.pos.z); }
    turnTo(angle, k) {
      const d = Math.atan2(Math.sin(angle - this.facing), Math.cos(angle - this.facing));
      this.facing += d * Math.min(1, k);
    }
    move(dt, dir, speedMul) {
      this.stunT = Math.max(0, this.stunT - dt);
      this.kickT = Math.max(0, this.kickT - dt);
      this.diveT = Math.max(0, this.diveT - dt);
      if (this.slideT > 0) {
        this.slideT -= dt;
        const k = Math.max(0, this.slideT / SLIDE_DUR);
        this.vel.set(this.slideDir.x * (3 + 9 * k), 0, this.slideDir.z * (3 + 9 * k));
        if (this.slideT <= 0) { this.slideT = 0; this.stunT = 0.35; }
      } else {
        let tx = 0, tz = 0;
        if (this.stunT <= 0 && dir) {
          const sp = this.baseSpeed * speedMul;
          tx = dir.x * sp; tz = dir.z * sp;
        }
        const a = Math.min(1, dt * 7);
        this.vel.x += (tx - this.vel.x) * a;
        this.vel.z += (tz - this.vel.z) * a;
      }
      this.pos.x = clamp(this.pos.x + this.vel.x * dt, -HALF_W + 0.3, HALF_W - 0.3);
      this.pos.z = clamp(this.pos.z + this.vel.z * dt, -HALF_L + 0.3, HALF_L - 0.3);
      this.curSpeed = Math.hypot(this.vel.x, this.vel.z);
      if (this.slideT <= 0) {
        if (this.curSpeed > 0.6) this.turnTo(Math.atan2(this.vel.x, this.vel.z), dt * 10);
        else if (ball.owner !== this && !(state.phase === "setpiece" && state.setPiece.taker === this)) {
          this.turnTo(Math.atan2(ball.pos.x - this.pos.x, ball.pos.z - this.pos.z), dt * 4);
        }
      }
    }
    animate(dt) {
      const P = this.parts;
      const sp = this.curSpeed;
      const amp = Math.min(1, sp / 7.5) * 0.9;
      this.animPhase += dt * (3 + sp * 1.35);
      const ph = this.animPhase, s = Math.sin(ph), c = Math.cos(ph);
      let hipL = s * amp, hipR = -s * amp;
      let kneeL = amp * (0.15 + 1.25 * Math.max(0, -c));
      let kneeR = amp * (0.15 + 1.25 * Math.max(0, c));
      let shL = -s * amp * 0.85, shR = s * amp * 0.85;
      let elL = -0.35 - amp * 0.7, elR = -0.35 - amp * 0.7;
      let lean = amp * 0.25, bob = Math.abs(s) * 0.07 * amp;
      let tiltX = 0, tiltZ = 0, lift = 0;

      if (amp < 0.05) {
        const b = Math.sin(performance.now() * 0.002 + this.id) * 0.03;
        lean = b; shL = b; shR = -b;
      }
      if (this.isGK && ball.owner === this) { shL = shR = -1.1; elL = elR = -0.6; }
      if (this.celebrate) { shL = shR = -2.8; elL = elR = 0; }
      if (this.kickT > 0) {
        const k = 1 - this.kickT / KICK_DUR;
        if (k < 0.35) { hipR = 0.8 * (k / 0.35); kneeR = 1.1 * (k / 0.35); }
        else {
          const q = Math.min(1, ((k - 0.35) / 0.65) * 1.6);
          hipR = lerp(0.8, -1.25, q); kneeR = lerp(1.1, 0.05, q);
        }
        shL = -0.6; shR = 0.5; lean = 0.15;
      }
      if (this.slideT > 0) {
        tiltX = -1.1; hipL = -0.1; hipR = 0.15; kneeL = 0.1; kneeR = 0.9;
        shL = -0.9; shR = -0.4; lean = 0; bob = 0;
      }
      if (this.diveT > 0) {
        const k = Math.sin((1 - this.diveT / DIVE_DUR) * Math.PI);
        const localSide = this.diveSide * Math.sign(Math.cos(this.facing) || 1);
        tiltZ = -localSide * 1.3 * Math.min(1, k * 1.6);
        lift = 0.5 * k;
        shL = shR = -2.6; elL = elR = 0;
      }

      P.legL.hip.rotation.x = hipL; P.legR.hip.rotation.x = hipR;
      P.legL.knee.rotation.x = kneeL; P.legR.knee.rotation.x = kneeR;
      P.armL.sh.rotation.x = shL; P.armR.sh.rotation.x = shR;
      P.armL.elbow.rotation.x = elL; P.armR.elbow.rotation.x = elR;
      P.upper.rotation.x = lean;
      P.body.position.y = bob;
      this.mesh.position.set(this.pos.x, lift, this.pos.z);
      this.mesh.rotation.set(tiltX, this.facing, tiltZ);
    }
  }

  const youPlayers = FORMATION.map((f, i) => new Player(YOU, f, NUMBERS.you[i]));
  const rivalPlayers = FORMATION.map((f, i) => new Player(RIVAL, f, NUMBERS.rival[i]));
  const allPlayers = [...youPlayers, ...rivalPlayers];
  const teamPlayers = (team) => (team === YOU ? youPlayers : rivalPlayers);
  let controlled = youPlayers[6];

  function resetPositions() {
    for (const p of allPlayers) {
      const dir = attackDirOf(p.team);
      p.home.set(p.homeX, 0, ownGoalZ(p.team) + dir * p.homeU);
      p.setPosition(p.home.x, p.home.z);
      p.facing = dir > 0 ? 0 : Math.PI;
      p.resetTimers();
    }
    ball.pos.set(0, BALL_R, 0);
    ball.vel.set(0, 0, 0);
    ball.owner = null;
  }

  /* ======================= CONTROLLED MARKER ======================= */
  const marker = new THREE.Group();
  const markerMat = new THREE.MeshBasicMaterial({ color: 0xffe14a, transparent: true, opacity: 0.9, depthWrite: false });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.64, 32), markerMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.03;
  const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.34, 4), new THREE.MeshBasicMaterial({ color: 0xffe14a }));
  arrow.rotation.x = Math.PI;
  marker.add(ring, arrow);
  scene.add(marker);

  function updateMarker(dt) {
    const show = controlled && !["menu", "ended"].includes(state.phase);
    marker.visible = !!show;
    if (!show) return;
    marker.position.set(controlled.pos.x, 0, controlled.pos.z);
    arrow.position.y = 2.35 + Math.sin(performance.now() * 0.006) * 0.08;
    arrow.rotation.y += dt * 2;
  }

  function setControlled(p) {
    if (!p || p.isGK) return;
    controlled = p;
  }

  /* ======================= STATE ======================= */
  const settings = { diff: "normal", time: "300" };
  const state = {
    phase: "menu",
    prevPhase: null,
    phaseT: 0,
    half: 1,
    score: { you: 0, rival: 0 },
    matchSeconds: 300,
    timeLeft: 300,
    diff: DIFFICULTY.normal,
    stamina: 1,
    sprintHeld: false,
    shootCharging: false,
    shootCharge: 0,
    setPiece: null,
    passTarget: null,
    switchCooldown: 0,
    stats: { shots: { you: 0, rival: 0 }, poss: { you: 0, rival: 0 } },
    celebrator: null,
    celebrateSpot: new V3(),
    concede: YOU,
    crowdT: 0,
    muted: false,
  };
  const isPlaying = () => state.phase === "play" || state.phase === "setpiece";

  /* ======================= AUDIO (synthesized) ======================= */
  const sfx = (function () {
    let ctx = null, master = null, crowd = null, noise = null;
    function init() {
      if (ctx) { if (ctx.state === "suspended") ctx.resume(); return; }
      try {
        ctx = new (window.AudioContext || window.webkitAudioContext)();
        master = ctx.createGain();
        master.gain.value = state.muted ? 0 : 0.8;
        master.connect(ctx.destination);
        noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
        const d = noise.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
        const src = ctx.createBufferSource();
        src.buffer = noise;
        src.loop = true;
        const bp = ctx.createBiquadFilter();
        bp.type = "bandpass"; bp.frequency.value = 800; bp.Q.value = 0.5;
        crowd = ctx.createGain();
        crowd.gain.value = 0.045;
        src.connect(bp); bp.connect(crowd); crowd.connect(master);
        src.start();
      } catch (e) { ctx = null; }
    }
    function burst(freq, dur, vol, type) {
      const t = ctx.currentTime;
      const s = ctx.createBufferSource(); s.buffer = noise;
      const f = ctx.createBiquadFilter(); f.type = type || "lowpass"; f.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      s.connect(f); f.connect(g); g.connect(master);
      s.start(t, Math.random()); s.stop(t + dur + 0.02);
    }
    function tone(freq, dur, vol, type, freqEnd) {
      const t = ctx.currentTime;
      const o = ctx.createOscillator(); o.type = type || "sine";
      o.frequency.setValueAtTime(freq, t);
      if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
      const g = ctx.createGain();
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(g); g.connect(master);
      o.start(t); o.stop(t + dur + 0.02);
    }
    return {
      init,
      setMuted(m) { if (master) master.gain.value = m ? 0 : 0.8; },
      kick(s = 1) { if (!ctx) return; burst(1200, 0.07, 0.35 * s); tone(140, 0.12, 0.5 * s, "sine", 50); },
      tackle() { if (!ctx) return; burst(600, 0.15, 0.3); },
      slide() { if (!ctx) return; burst(2500, 0.3, 0.12, "highpass"); },
      post() { if (!ctx) return; tone(880, 0.4, 0.2, "triangle"); tone(1320, 0.3, 0.12, "triangle"); },
      whistle(n = 1, long = false) {
        if (!ctx) return;
        for (let i = 0; i < n; i++) {
          const t0 = ctx.currentTime + i * 0.32;
          const dur = long && i === n - 1 ? 0.9 : 0.22;
          const o = ctx.createOscillator(); o.frequency.value = 2700;
          const lfo = ctx.createOscillator(); lfo.frequency.value = 38;
          const lg = ctx.createGain(); lg.gain.value = 140;
          lfo.connect(lg); lg.connect(o.frequency);
          const g = ctx.createGain();
          g.gain.setValueAtTime(0.0001, t0);
          g.gain.exponentialRampToValueAtTime(0.16, t0 + 0.02);
          g.gain.setValueAtTime(0.16, t0 + dur - 0.04);
          g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
          o.connect(g); g.connect(master);
          o.start(t0); lfo.start(t0); o.stop(t0 + dur + 0.05); lfo.stop(t0 + dur + 0.05);
        }
      },
      cheer(level) {
        if (!ctx) return;
        const t = ctx.currentTime;
        crowd.gain.cancelScheduledValues(t);
        crowd.gain.setValueAtTime(crowd.gain.value, t);
        crowd.gain.linearRampToValueAtTime(level, t + 0.3);
        crowd.gain.linearRampToValueAtTime(0.045, t + 3.5);
      },
    };
  })();

  /* ======================= HUD ======================= */
  const $score = $("score"), $timer = $("timer"), $msg = $("msg");
  const $goalFlash = $("goalFlash"), $goalSub = $("goalSub");
  const $stamina = $("staminaBar"), $power = $("powerBar"), $powerWrap = $("powerWrap");
  const $lblA = $("lblA"), $lblB = $("lblB");
  const root = $("gameRoot");

  function updateScore() { $score.textContent = `${state.score.you} - ${state.score.rival}`; }
  function updateClock() {
    const frac = clamp(1 - state.timeLeft / state.matchSeconds, 0, 1);
    const sec = frac * 90 * 60;
    $timer.textContent = `${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;
  }
  let msgTimer = null;
  function showMessage(text, ms = 1500) {
    $msg.textContent = text;
    $msg.classList.add("show");
    clearTimeout(msgTimer);
    msgTimer = setTimeout(() => $msg.classList.remove("show"), ms);
  }
  let lastMode = "";
  function updateButtons() {
    const sp = state.setPiece;
    let mode;
    if (state.phase === "setpiece" && sp.taker === controlled) mode = sp.type === "corner" ? "corner" : "setpiece";
    else if (ball.owner === controlled) mode = "attack";
    else mode = "defend";
    if (mode === lastMode) return;
    lastMode = mode;
    const L = { attack: ["PAS", "ZARBA"], defend: ["ALMASH", "TO'P OLISH"], setpiece: ["PAS", "PAS"], corner: ["PAS", "KROSS"] }[mode];
    $lblA.textContent = L[0];
    $lblB.textContent = L[1];
  }

  const radar = $("radar"), rctx = radar.getContext("2d");
  function drawRadar() {
    const w = radar.width, h = radar.height, pad = 6;
    const fw = w - pad * 2, fh = h - pad * 2;
    const mx = (x) => pad + (-x / FIELD_W + 0.5) * fw;
    const my = (z) => pad + (-z / FIELD_L + 0.5) * fh;
    rctx.clearRect(0, 0, w, h);
    rctx.fillStyle = "rgba(12,48,24,0.72)";
    rctx.fillRect(0, 0, w, h);
    rctx.strokeStyle = "rgba(255,255,255,0.55)";
    rctx.lineWidth = 1.5;
    rctx.strokeRect(pad, pad, fw, fh);
    rctx.beginPath(); rctx.moveTo(pad, my(0)); rctx.lineTo(pad + fw, my(0)); rctx.stroke();
    rctx.beginPath(); rctx.arc(mx(0), my(0), (9 / FIELD_W) * fw, 0, Math.PI * 2); rctx.stroke();
    for (const s of [-1, 1]) {
      rctx.strokeRect(mx(16), my(s * HALF_L), mx(-16) - mx(16), my(s * HALF_L - s * 16) - my(s * HALF_L));
    }
    for (const p of allPlayers) {
      rctx.beginPath();
      rctx.arc(mx(p.pos.x), my(p.pos.z), p === controlled ? 5 : 3.6, 0, Math.PI * 2);
      rctx.fillStyle = p === controlled ? "#ffe14a" : TEAM_STYLE[p.team].radar;
      rctx.fill();
      if (p === controlled) { rctx.strokeStyle = "#fff"; rctx.lineWidth = 1.5; rctx.stroke(); }
    }
    rctx.beginPath();
    rctx.arc(mx(ball.pos.x), my(ball.pos.z), 3, 0, Math.PI * 2);
    rctx.fillStyle = "#fff";
    rctx.fill();
    rctx.strokeStyle = "#000";
    rctx.lineWidth = 1;
    rctx.stroke();
  }

  /* ======================= INPUT ======================= */
  const joy = { x: 0, y: 0, id: null, cx: 0, cy: 0 };
  const JOY_R = 46;
  const $joyZone = $("joystickZone"), $joyBase = $("joystickBase"), $joyStick = $("joystickStick");

  function updateJoy(px, py) {
    let dx = px - joy.cx, dy = py - joy.cy;
    const len = Math.hypot(dx, dy);
    if (len > JOY_R) { dx = (dx / len) * JOY_R; dy = (dy / len) * JOY_R; }
    $joyStick.style.transform = `translate(${dx}px, ${dy}px)`;
    if (len < 6) { joy.x = 0; joy.y = 0; } else { joy.x = dx / JOY_R; joy.y = -dy / JOY_R; }
  }
  function resetJoy() {
    joy.id = null; joy.x = 0; joy.y = 0;
    $joyStick.style.transform = "";
    $joyBase.classList.remove("active");
    $joyBase.style.left = ""; $joyBase.style.top = ""; $joyBase.style.bottom = "";
  }
  $joyZone.addEventListener("pointerdown", (e) => {
    if (joy.id !== null) return;
    e.preventDefault();
    joy.id = e.pointerId;
    $joyZone.setPointerCapture(e.pointerId);
    const zr = $joyZone.getBoundingClientRect();
    const size = $joyBase.offsetWidth;
    const cx = clamp(e.clientX - zr.left, size / 2, zr.width - size / 2);
    const cy = clamp(e.clientY - zr.top, size / 2, zr.height - size / 2);
    $joyBase.style.left = cx - size / 2 + "px";
    $joyBase.style.top = cy - size / 2 + "px";
    $joyBase.style.bottom = "auto";
    $joyBase.classList.add("active");
    joy.cx = zr.left + cx;
    joy.cy = zr.top + cy;
    updateJoy(e.clientX, e.clientY);
  });
  $joyZone.addEventListener("pointermove", (e) => { if (e.pointerId === joy.id) updateJoy(e.clientX, e.clientY); });
  const joyEnd = (e) => { if (e.pointerId === joy.id) resetJoy(); };
  $joyZone.addEventListener("pointerup", joyEnd);
  $joyZone.addEventListener("pointercancel", joyEnd);

  const keys = {};
  function keyboardVec() {
    let x = 0, y = 0;
    if (keys.arrowleft || keys.a) x -= 1;
    if (keys.arrowright || keys.d) x += 1;
    if (keys.arrowup || keys.w) y += 1;
    if (keys.arrowdown || keys.s) y -= 1;
    return { x, y };
  }
  // The camera looks toward +z, so screen-right is world -x.
  function getInputDir() {
    let x = joy.x, y = joy.y;
    if (x === 0 && y === 0) { const k = keyboardVec(); x = k.x; y = k.y; }
    const v = new V3(-x, 0, y);
    if (v.lengthSq() > 1) v.normalize();
    return v;
  }

  window.addEventListener("keydown", (e) => {
    const k = e.key.toLowerCase();
    keys[k] = true;
    if (["arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(k)) e.preventDefault();
    if (e.repeat) return;
    if (k === "j") onAPress();
    else if (k === "k") onBPress();
    else if (k === "l" || k === "shift") state.sprintHeld = true;
    else if (k === "p" || k === "escape") { if (state.phase === "paused") resumeGame(); else pauseGame(); }
  });
  window.addEventListener("keyup", (e) => {
    const k = e.key.toLowerCase();
    keys[k] = false;
    if (k === "k") onBRelease();
    if (k === "l" || k === "shift") state.sprintHeld = false;
  });
  window.addEventListener("blur", () => {
    for (const k in keys) keys[k] = false;
    state.sprintHeld = false;
  });

  function bindBtn(el, down, up) {
    el.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      el.classList.add("pressed");
      down();
    });
    const end = () => {
      if (!el.classList.contains("pressed")) return;
      el.classList.remove("pressed");
      if (up) up();
    };
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
    el.addEventListener("lostpointercapture", end);
    el.addEventListener("contextmenu", (e) => e.preventDefault());
  }
  bindBtn($("btnA"), onAPress);
  bindBtn($("btnB"), onBPress, onBRelease);
  bindBtn($("btnC"), () => { state.sprintHeld = true; }, () => { state.sprintHeld = false; });

  /* ======================= ACTIONS ======================= */
  function giveBall(p) {
    ball.owner = p;
    ball.vel.set(0, 0, 0);
    ball.lastTouchTeam = p.team;
    ball.lastToucher = p;
    ball.isShot = false;
    state.passTarget = null;
    p.holdT = 0;
    p.decisionT = state.diff.decision * 0.8;
    if (p.team === YOU && !p.isGK) setControlled(p);
  }

  function kickBall(kicker, target, speed, lift, isShot) {
    const dir = new V3(target.x - ball.pos.x, 0, target.z - ball.pos.z).normalize();
    ball.vel.set(dir.x * speed, lift, dir.z * speed);
    ball.owner = null;
    ball.pos.y = Math.max(ball.pos.y, BALL_R);
    ball.noPickup = kicker;
    ball.noPickupT = 0.28;
    ball.lastTouchTeam = kicker.team;
    ball.lastToucher = kicker;
    ball.isShot = !!isShot;
    ball.saveChecked = false;
    kicker.kickT = KICK_DUR;
    kicker.facing = Math.atan2(dir.x, dir.z);
    if (state.phase === "setpiece") { state.phase = "play"; state.setPiece = null; }
    sfx.kick(Math.min(1.2, speed / 25));
  }

  function laneBlocked(team, a, b) {
    const abx = b.x - a.x, abz = b.z - a.z;
    const len2 = abx * abx + abz * abz || 1;
    for (const o of teamPlayers(other(team))) {
      const t = ((o.pos.x - a.x) * abx + (o.pos.z - a.z) * abz) / len2;
      if (t < 0.1 || t > 0.95) continue;
      const cx = a.x + abx * t, cz = a.z + abz * t;
      if (Math.hypot(o.pos.x - cx, o.pos.z - cz) < 1.3) return true;
    }
    return false;
  }

  function clampToField(v) {
    v.x = clamp(v.x, -HALF_W + 1, HALF_W - 1);
    v.z = clamp(v.z, -HALF_L + 1, HALF_L - 1);
    return v;
  }

  function passTo(kicker, mate) {
    const from = ball.pos;
    const target = flat(mate.pos);
    let d = hdist(from, target);
    const lofted = d > 28 || (d > 12 && laneBlocked(kicker.team, from, target));
    let speed, lift;
    if (lofted) {
      lift = clamp(d * 0.25, 6, 10);
      const air = (2 * lift) / -GRAVITY;
      target.addScaledVector(mate.vel, air * 0.8);
      clampToField(target);
      d = hdist(from, target);
      speed = clamp((d / air) * 0.92, 8, 34);
    } else {
      speed = clamp(8 + GROUND_FRICTION * d, 9, 30);
      const t = Math.log(speed / Math.max(2, speed - GROUND_FRICTION * d)) / GROUND_FRICTION;
      target.addScaledVector(mate.vel, Math.min(t, 1.5) * 0.85);
      clampToField(target);
      d = hdist(from, target);
      speed = clamp(8 + GROUND_FRICTION * d, 9, 30);
      lift = 0.5;
    }
    kickBall(kicker, target, speed, lift, false);
    state.passTarget = mate;
    if (mate.team === YOU) setControlled(mate);
  }

  function crossTo(kicker, target) {
    const lift = 8.5;
    const air = (2 * lift) / -GRAVITY;
    const d = hdist(ball.pos, target);
    kickBall(kicker, target, clamp((d / air) * 0.95, 8, 34), lift, false);
    let best = null, bd = Infinity;
    for (const m of teamPlayers(kicker.team)) {
      if (m === kicker || m.isGK) continue;
      const dd = hdist(m.pos, target);
      if (dd < bd) { bd = dd; best = m; }
    }
    state.passTarget = best;
    if (best && best.team === YOU) setControlled(best);
  }

  function userPass() {
    const p = controlled;
    const inDir = getInputDir();
    const aim = inDir.lengthSq() > 0.04 ? inDir.clone().normalize() : new V3(Math.sin(p.facing), 0, Math.cos(p.facing));
    let best = null, bestScore = -Infinity;
    for (const m of youPlayers) {
      if (m === p) continue;
      const to = new V3(m.pos.x - p.pos.x, 0, m.pos.z - p.pos.z);
      const dist = to.length();
      if (dist < 2) continue;
      const cos = to.divideScalar(dist).dot(aim);
      let score = cos * 10 - dist * 0.08;
      if (cos < 0.35) score -= 15;
      if (m.isGK) score -= 6;
      if (laneBlocked(YOU, p.pos, m.pos)) score -= 3;
      if (score > bestScore) { bestScore = score; best = m; }
    }
    if (best) passTo(p, best);
  }

  function userCross() {
    const inDir = getInputDir();
    const tx = clamp(inDir.x * 8 + rand(-1.5, 1.5), -9, 9);
    crossTo(controlled, new V3(tx, 0, HALF_L - rand(6, 10)));
  }

  function releaseShot() {
    state.shootCharging = false;
    $powerWrap.classList.remove("show");
    if (ball.owner !== controlled || state.phase !== "play") return;
    const p = controlled;
    const power = clamp(state.shootCharge, 0.15, 1);
    const inDir = getInputDir();
    let aimX = clamp(-p.pos.x * 0.25, -3, 3) + inDir.x * 7 + rand(-0.5, 0.5) * (1 + power * 2.5);
    aimX = clamp(aimX, -(GOAL_HW + 2), GOAL_HW + 2);
    const dist = Math.hypot(p.pos.x - aimX, HALF_L - p.pos.z);
    const speed = 17 + power * 15;
    const lift = 1.8 + power * power * 8 + dist * 0.035;
    kickBall(p, new V3(aimX, 0, HALF_L), speed, lift, true);
    state.stats.shots.you++;
  }
  function cancelCharge() {
    state.shootCharging = false;
    state.shootCharge = 0;
    $powerWrap.classList.remove("show");
  }

  function doTackle() {
    const p = controlled;
    if (p.slideT > 0 || p.stunT > 0) return;
    const target = new V3(ball.pos.x + ball.vel.x * 0.25, 0, ball.pos.z + ball.vel.z * 0.25);
    const toBall = new V3(target.x - p.pos.x, 0, target.z - p.pos.z);
    const inDir = getInputDir();
    let dir;
    if (toBall.length() < 7) dir = toBall.normalize();
    else if (inDir.lengthSq() > 0.04) dir = inDir.clone().normalize();
    else dir = new V3(Math.sin(p.facing), 0, Math.cos(p.facing));
    p.slideT = SLIDE_DUR;
    p.slideDir.copy(dir);
    p.slideResolved = false;
    p.facing = Math.atan2(dir.x, dir.z);
    sfx.slide();
  }

  function manualSwitch() {
    let best = null, bd = Infinity;
    for (const m of youPlayers) {
      if (m === controlled || m.isGK) continue;
      const d = hdist(m.pos, ball.pos);
      if (d < bd) { bd = d; best = m; }
    }
    if (best) { setControlled(best); state.switchCooldown = 0.8; }
  }

  function onAPress() {
    if (!isPlaying()) return;
    if (state.phase === "setpiece") { if (state.setPiece.taker === controlled) userPass(); return; }
    if (ball.owner === controlled) userPass();
    else manualSwitch();
  }
  function onBPress() {
    if (!isPlaying()) return;
    if (state.phase === "setpiece") {
      const sp = state.setPiece;
      if (sp.taker !== controlled) return;
      if (sp.type === "corner") userCross(); else userPass();
      return;
    }
    if (ball.owner === controlled) {
      state.shootCharging = true;
      state.shootCharge = 0;
      $power.style.width = "0%";
      $powerWrap.classList.add("show");
    } else doTackle();
  }
  function onBRelease() { if (state.shootCharging) releaseShot(); }

  /* ======================= AI ======================= */
  const roles = { presser: {}, chaser: {}, cover: {} };
  const NONE = { dir: null, mul: 1 };

  function dirTo(from, to, slow = 2) {
    const d = new V3(to.x - from.x, 0, to.z - from.z);
    const len = d.length();
    if (len < 0.45) return null;
    return d.multiplyScalar(Math.min(1, len / slow) / len);
  }
  function toward(p, target, mul) { return { dir: dirTo(p.pos, target), mul }; }

  function computeRoles() {
    const owner = ball.owner;
    for (const T of [YOU, RIVAL]) {
      roles.presser[T] = null; roles.chaser[T] = null; roles.cover[T] = null;
      const ai = teamPlayers(T)
        .filter((p) => !p.isGK && p !== controlled && p.stunT <= 0)
        .sort((a, b) => hdist(a.pos, ball.pos) - hdist(b.pos, ball.pos));
      const userD = hdist(controlled.pos, ball.pos);
      if (owner && owner.team !== T) {
        if (owner.isGK) continue;
        let pr = ai[0] || null;
        if (T === YOU && pr && userD < hdist(pr.pos, ball.pos) + 2) pr = null;
        roles.presser[T] = pr;
        roles.cover[T] = pr ? ai[1] || null : ai[0] || null;
      } else if (!owner) {
        let ch = ai[0] || null;
        if (T === YOU && ch && userD < hdist(ch.pos, ball.pos) + 3) ch = null;
        if (state.passTarget && state.passTarget.team === T) ch = state.passTarget === controlled ? null : state.passTarget;
        roles.chaser[T] = ch;
      }
    }
  }

  function shapeTarget(p) {
    const dir = attackDirOf(p.team), og = ownGoalZ(p.team);
    const inPoss = ball.owner && ball.owner.team === p.team;
    const uBall = (ball.pos.z - og) * dir;
    let u, x;
    if (p.role === "def") {
      u = inPoss ? clamp(uBall - 18, 12, 55) : clamp(uBall * 0.5, 9, 38);
      x = inPoss ? p.homeX * 1.5 + ball.pos.x * 0.25 : p.homeX * 0.8 + ball.pos.x * 0.4;
    } else if (p.role === "mid") {
      u = inPoss ? clamp(uBall + 2, 24, 76) : clamp(uBall * 0.72, 16, 50);
      x = inPoss ? p.homeX * 1.35 + ball.pos.x * 0.2 : p.homeX * 0.85 + ball.pos.x * 0.4;
    } else {
      u = inPoss ? clamp(uBall + 12, 30, 88) : clamp(uBall - 10, 28, 62);
      x = inPoss ? p.homeX * 1.9 + ball.pos.x * 0.2 : p.homeX + ball.pos.x * 0.35;
    }
    if (inPoss) x += Math.sin(performance.now() * 0.0005 + p.id) * 3;
    return new V3(clamp(x, -HALF_W + 3, HALF_W - 3), 0, og + dir * u);
  }

  function inOwnBox(team, pos) {
    const u = (pos.z - ownGoalZ(team)) * attackDirOf(team);
    return u >= -1 && u < 16.5 && Math.abs(pos.x) < 16.5;
  }

  function gkTarget(p) {
    const dir = attackDirOf(p.team), og = ownGoalZ(p.team);
    if (ball.owner === p) return { pos: new V3(0, 0, og + dir * 6), mul: 0.4 };
    const uBall = (ball.pos.z - og) * dir;
    if (!ball.owner && ball.lastTouchTeam !== p.team && ball.vel.z * -dir > 4) {
      const t = (og - ball.pos.z) / ball.vel.z;
      if (t > 0 && t < 1.6) {
        const cx = clamp(ball.pos.x + ball.vel.x * t, -GOAL_HW + 0.4, GOAL_HW - 0.4);
        if (t < 0.55 && Math.abs(cx - p.pos.x) > 1.2 && p.diveT <= 0) {
          p.diveT = DIVE_DUR;
          p.diveSide = Math.sign(cx - p.pos.x) || 1;
        }
        return { pos: new V3(cx, 0, og + dir * 1.2), mul: 1.9 };
      }
    }
    if (!ball.owner && uBall < 16 && Math.abs(ball.pos.x) < 14 && Math.hypot(ball.vel.x, ball.vel.z) < 12) {
      return { pos: flat(ball.pos), mul: 1.2 };
    }
    if (ball.owner && ball.owner.team !== p.team && uBall < 22) {
      const v = new V3(ball.pos.x, 0, ball.pos.z - og);
      v.normalize().multiplyScalar(Math.min(4, uBall * 0.35));
      return { pos: new V3(v.x, 0, og + v.z), mul: 1.1 };
    }
    const x = clamp(ball.pos.x * 0.2, -GOAL_HW + 1.5, GOAL_HW - 1.5);
    return { pos: new V3(x, 0, og + dir * (1.5 + clamp(uBall * 0.03, 0, 2.5))), mul: 0.8 };
  }

  function aiPass(p, opts) {
    const dir = attackDirOf(p.team);
    let best = null, bestScore = -Infinity;
    for (const m of teamPlayers(p.team)) {
      if (m === p || m.isGK) continue;
      const d = hdist(m.pos, p.pos);
      if (d < 5) continue;
      const fwd = (m.pos.z - p.pos.z) * dir;
      if (opts.forward && fwd < 3) continue;
      let open = 8;
      for (const o of teamPlayers(other(p.team))) open = Math.min(open, hdist(o.pos, m.pos));
      let score = fwd * 0.3 + open - (d > 35 ? (d - 35) * 0.3 : 0);
      if (laneBlocked(p.team, p.pos, m.pos)) score -= 6;
      if (opts.long) score += d * 0.1;
      if (score > bestScore) { bestScore = score; best = m; }
    }
    if (!best || bestScore < -2) return false;
    passTo(p, best);
    return true;
  }

  function aiShoot(p) {
    const goalZ = attackDirOf(p.team) * HALF_L;
    const gk = teamPlayers(other(p.team)).find((m) => m.isGK);
    let side = gk.pos.x > 0 ? -1 : 1;
    if (Math.random() < 0.25) side = -side;
    const aimX = side * (GOAL_HW - 1.3) + rand(-0.5, 0.5) * state.diff.shootErr;
    kickBall(p, new V3(aimX, 0, goalZ), rand(21, 28), rand(1.8, 5.5), true);
    state.stats.shots[p.team]++;
  }

  function carrierAI(p, dt) {
    const dir = attackDirOf(p.team);
    const goal = new V3(0, 0, dir * HALF_L);
    const want = new V3(goal.x - p.pos.x, 0, goal.z - p.pos.z).normalize();
    const avoid = new V3();
    let pressure = Infinity;
    for (const o of teamPlayers(other(p.team))) {
      if (o.isGK) continue;
      const d = hdist(o.pos, p.pos);
      pressure = Math.min(pressure, d);
      if (d < 7 && d > 0.01) {
        const ahead = (o.pos.x - p.pos.x) * want.x + (o.pos.z - p.pos.z) * want.z > -1;
        if (ahead) avoid.add(new V3(p.pos.x - o.pos.x, 0, p.pos.z - o.pos.z).multiplyScalar((((7 - d) / 7) * 1.6) / d));
      }
    }
    if (Math.abs(p.pos.x) > HALF_W - 5) avoid.x -= Math.sign(p.pos.x);
    p.decisionT -= dt;
    if (p.decisionT <= 0) {
      p.decisionT = state.diff.decision * rand(0.7, 1.3);
      const distGoal = hdist(p.pos, goal);
      if (distGoal < 27) {
        const prob = distGoal < 15 ? 0.85 : distGoal < 21 ? 0.5 : 0.22;
        if (Math.random() < prob) { aiShoot(p); return null; }
      }
      if (pressure < 2.6 && Math.random() < 0.55) { if (aiPass(p, {})) return null; }
      else if (Math.random() < 0.08) { if (aiPass(p, { forward: true })) return null; }
    }
    return want.add(avoid).normalize();
  }

  function gkHold(p, dt) {
    p.holdT += dt;
    if (p.holdT > 1.3 && state.phase === "play") {
      if (!aiPass(p, { long: true })) {
        const dir = attackDirOf(p.team);
        kickBall(p, new V3(rand(-12, 12), 0, ownGoalZ(p.team) + dir * 50), 24, 9, false);
      }
    }
  }

  function aiSetPieceKick(p, sp) {
    const dir = attackDirOf(p.team);
    if (sp.type === "corner") {
      crossTo(p, new V3(rand(-6, 6), 0, dir * HALF_L - dir * rand(6, 10)));
    } else if (sp.type === "goalkick") {
      if (!aiPass(p, { long: true })) kickBall(p, new V3(rand(-12, 12), 0, ownGoalZ(p.team) + dir * 50), 24, 9, false);
    } else if (!aiPass(p, {})) {
      let best = null, bd = Infinity;
      for (const m of teamPlayers(p.team)) {
        if (m === p) continue;
        const d = hdist(m.pos, p.pos);
        if (d < bd) { bd = d; best = m; }
      }
      passTo(p, best);
    }
  }

  function aiDecide(p, dt) {
    const sp = state.setPiece;
    if (state.phase === "setpiece") {
      if (sp.taker === p) {
        if (sp.t > (sp.type === "kickoff" ? 1.2 : 1.0)) aiSetPieceKick(p, sp);
        return NONE;
      }
      if (sp.type === "kickoff") return NONE;
    }
    if (p.isGK) {
      if (ball.owner === p) gkHold(p, dt);
      const g = gkTarget(p);
      return toward(p, g.pos, g.mul);
    }
    const teamMul = p.team === RIVAL ? state.diff.rivalSpeed : 1;
    if (ball.owner === p) {
      const mv = carrierAI(p, dt);
      return mv ? { dir: mv, mul: teamMul * 0.9 } : NONE;
    }
    if (state.phase === "play") {
      if (roles.presser[p.team] === p) {
        const o = ball.owner;
        return toward(p, new V3(o.pos.x + Math.sin(o.facing) * 0.7, 0, o.pos.z + Math.cos(o.facing) * 0.7), teamMul);
      }
      if (roles.chaser[p.team] === p) {
        const t = Math.min(1.2, hdist(p.pos, ball.pos) / 8);
        const target = clampToField(new V3(ball.pos.x + ball.vel.x * t * 0.8, 0, ball.pos.z + ball.vel.z * t * 0.8));
        return toward(p, target, teamMul);
      }
      if (roles.cover[p.team] === p) {
        const v = new V3(0, 0, ownGoalZ(p.team)).sub(flat(ball.pos)).normalize().multiplyScalar(6);
        return toward(p, flat(ball.pos).add(v), teamMul * 0.9);
      }
    }
    const t = shapeTarget(p);
    if (state.phase === "setpiece" && p.team !== sp.team) {
      if (hdist(t, ball.pos) < 7) {
        const away = new V3(t.x - ball.pos.x, 0, t.z - ball.pos.z);
        if (away.lengthSq() < 0.01) away.set(0, 0, -attackDirOf(sp.team));
        t.copy(flat(ball.pos).add(away.normalize().multiplyScalar(7)));
        clampToField(t);
      }
    }
    return toward(p, t, teamMul * (hdist(p.pos, t) > 10 ? 0.95 : 0.72));
  }

  function autoSwitch(dt) {
    state.switchCooldown -= dt;
    if (ball.owner && ball.owner.team === YOU) return;
    if (state.passTarget && !ball.owner) return;
    if (state.switchCooldown > 0 || controlled.slideT > 0) return;
    let best = null, bd = Infinity;
    for (const p of youPlayers) {
      if (p.isGK) continue;
      const d = hdist(p.pos, ball.pos);
      if (d < bd) { bd = d; best = p; }
    }
    if (best && best !== controlled && hdist(controlled.pos, ball.pos) - bd > 5) {
      setControlled(best);
      state.switchCooldown = 0.8;
    }
  }

  /* ======================= PHYSICS ======================= */
  const rollAxis = new V3();
  function updateBall(dt) {
    const px = ball.pos.x, pz = ball.pos.z;
    ball.noPickupT = Math.max(0, ball.noPickupT - dt);
    if (ball.owner) {
      const o = ball.owner;
      const fx = Math.sin(o.facing), fz = Math.cos(o.facing);
      if (o.isGK) {
        ball.pos.set(o.pos.x + fx * 0.38, 1.15, o.pos.z + fz * 0.38);
      } else {
        const touch = 0.55 + Math.min(1, o.curSpeed / 8) * (0.2 + 0.18 * Math.max(0, Math.sin(o.animPhase * 0.5)));
        ball.pos.set(
          clamp(o.pos.x + fx * touch, -HALF_W + 0.1, HALF_W - 0.1),
          BALL_R,
          clamp(o.pos.z + fz * touch, -HALF_L + 0.1, HALF_L - 0.1)
        );
      }
      ball.vel.set(o.vel.x, 0, o.vel.z);
    } else {
      ball.vel.y += GRAVITY * dt;
      ball.pos.addScaledVector(ball.vel, dt);
      if (ball.pos.y <= BALL_R) {
        ball.pos.y = BALL_R;
        if (ball.vel.y < -1.5) {
          ball.vel.y = -ball.vel.y * 0.45;
          ball.vel.x *= 0.85;
          ball.vel.z *= 0.85;
        } else {
          ball.vel.y = 0;
          const f = Math.exp(-GROUND_FRICTION * dt);
          ball.vel.x *= f;
          ball.vel.z *= f;
          if (Math.hypot(ball.vel.x, ball.vel.z) < 0.05) ball.vel.set(0, 0, 0);
        }
      } else {
        const f = Math.exp(-0.08 * dt);
        ball.vel.x *= f;
        ball.vel.z *= f;
      }
      collideGoalFrames();
      if (state.phase === "goal") containInNet();
    }
    const dx = ball.pos.x - px, dz = ball.pos.z - pz;
    const dist = Math.hypot(dx, dz);
    if (dist > 1e-4 && dist < 3) {
      rollAxis.set(dz, 0, -dx).normalize();
      ball.mesh.rotateOnWorldAxis(rollAxis, dist / BALL_R);
    }
    ball.mesh.position.copy(ball.pos);
  }

  function reflect(nx, ny, nz, e) {
    const vn = ball.vel.x * nx + ball.vel.y * ny + ball.vel.z * nz;
    if (vn >= 0) return 0;
    ball.vel.x -= (1 + e) * vn * nx;
    ball.vel.y -= (1 + e) * vn * ny;
    ball.vel.z -= (1 + e) * vn * nz;
    return -vn;
  }

  function collideGoalFrames() {
    const r = POST_R + BALL_R;
    for (const s of [-1, 1]) {
      const gz = s * HALF_L;
      if (Math.abs(ball.pos.z - gz) > 1.5) continue;
      if (ball.pos.y < GOAL_H + r) {
        for (const postX of [-GOAL_HW, GOAL_HW]) {
          const dx = ball.pos.x - postX, dz = ball.pos.z - gz;
          const d = Math.hypot(dx, dz);
          if (d < r && d > 1e-4) {
            const nx = dx / d, nz = dz / d;
            ball.pos.x = postX + nx * r;
            ball.pos.z = gz + nz * r;
            if (reflect(nx, 0, nz, 0.6) > 3) { sfx.post(); ball.isShot = false; }
          }
        }
      }
      if (Math.abs(ball.pos.x) < GOAL_HW) {
        const dy = ball.pos.y - GOAL_H, dz = ball.pos.z - gz;
        const d = Math.hypot(dy, dz);
        if (d < r && d > 1e-4) {
          const ny = dy / d, nz = dz / d;
          ball.pos.y = GOAL_H + ny * r;
          ball.pos.z = gz + nz * r;
          if (reflect(0, ny, nz, 0.6) > 3) { sfx.post(); ball.isShot = false; }
        }
      }
    }
  }

  function containInNet() {
    if (Math.abs(ball.pos.z) <= HALF_L) return;
    const s = Math.sign(ball.pos.z);
    const maxZ = HALF_L + GOAL_D - BALL_R;
    if (Math.abs(ball.pos.z) > maxZ) { ball.pos.z = s * maxZ; ball.vel.z *= -0.15; ball.vel.x *= 0.5; }
    if (Math.abs(ball.pos.x) > GOAL_HW - BALL_R) { ball.pos.x = Math.sign(ball.pos.x) * (GOAL_HW - BALL_R); ball.vel.x *= -0.2; }
    if (ball.pos.y > GOAL_H - BALL_R) { ball.pos.y = GOAL_H - BALL_R; ball.vel.y = -Math.abs(ball.vel.y) * 0.2; }
  }

  function separatePlayers() {
    const minD = 0.8;
    for (let i = 0; i < allPlayers.length; i++) {
      const a = allPlayers[i];
      for (let j = i + 1; j < allPlayers.length; j++) {
        const b = allPlayers[j];
        const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
        const d = Math.hypot(dx, dz);
        if (d < minD && d > 1e-4) {
          const push = (minD - d) / 2;
          const nx = dx / d, nz = dz / d;
          a.pos.x -= nx * push; a.pos.z -= nz * push;
          b.pos.x += nx * push; b.pos.z += nz * push;
        }
      }
    }
  }

  function pokeBall(p) {
    ball.owner = null;
    ball.vel.set(p.slideDir.x * 8 + rand(-1, 1), 1, p.slideDir.z * 8 + rand(-1, 1));
    ball.lastTouchTeam = p.team;
    ball.lastToucher = p;
    ball.isShot = false;
    ball.noPickup = p;
    ball.noPickupT = 0.4;
    sfx.tackle();
  }

  function parry(gk) {
    const out = attackDirOf(gk.team);
    if (Math.random() < 0.3) ball.vel.set(rand(-3, 3), rand(4, 6), -out * rand(2, 5));
    else ball.vel.set(Math.sign(ball.pos.x || 1) * rand(3, 8), rand(2, 4), out * rand(5, 9));
    ball.lastTouchTeam = gk.team;
    ball.lastToucher = gk;
    ball.isShot = false;
    ball.noPickup = gk;
    ball.noPickupT = 0.6;
    sfx.kick(0.5);
    showMessage("SEYV!", 900);
  }

  function handlePickup() {
    let best = null, bestD = Infinity;
    for (const p of allPlayers) {
      if (p.stunT > 0) continue;
      if (p === ball.noPickup && ball.noPickupT > 0) continue;
      const d = hdist(p.pos, ball.pos);
      if (p.slideT > 0) {
        if (d < 1.25 && ball.pos.y < 0.9) { pokeBall(p); return; }
        continue;
      }
      const hands = p.isGK && inOwnBox(p.team, ball.pos);
      const reach = hands ? (p.diveT > 0 ? 2.4 : 1.55) : 0.95;
      const hmax = hands ? 2.7 : 1.3;
      if (d < reach && ball.pos.y < hmax && d < bestD) { best = p; bestD = d; }
    }
    if (!best) return;
    const hs = Math.hypot(ball.vel.x, ball.vel.z);
    if (best.isGK && inOwnBox(best.team, ball.pos) && ball.lastTouchTeam !== best.team) {
      if (ball.isShot) {
        if (ball.saveChecked) return;
        ball.saveChecked = true;
        const base = best.team === RIVAL ? state.diff.gkSave : 0.6;
        const prob = clamp(base + 0.2 - Math.max(0, hs - 15) * 0.03 - bestD * 0.12, 0.1, 0.93);
        if (Math.abs(ball.pos.x - best.pos.x) > 0.8 && best.diveT <= 0) {
          best.diveT = DIVE_DUR;
          best.diveSide = Math.sign(ball.pos.x - best.pos.x) || 1;
        }
        if (Math.random() < prob) { giveBall(best); sfx.kick(0.3); showMessage("SEYV!", 900); return; }
        if (Math.random() < 0.55) { parry(best); return; }
        ball.noPickup = best;
        ball.noPickupT = 0.6;
        return;
      }
      giveBall(best);
      return;
    }
    if (!best.isGK && hs > 23 && Math.random() < 0.4) {
      ball.vel.set(-ball.vel.x * 0.25 + rand(-3, 3), rand(1, 3), -ball.vel.z * 0.25);
      ball.lastTouchTeam = best.team;
      ball.lastToucher = best;
      ball.isShot = false;
      ball.noPickup = best;
      ball.noPickupT = 0.3;
      sfx.tackle();
      return;
    }
    giveBall(best);
  }

  function handleSteals(dt) {
    const owner = ball.owner;
    if (owner.isGK) return;
    for (const p of allPlayers) {
      if (p.team === owner.team || p.isGK) continue;
      const d = hdist(p.pos, ball.pos);
      if (p.slideT > 0) {
        if (!p.slideResolved && d < 1.35) {
          p.slideResolved = true;
          if (Math.random() < 0.78) { owner.stunT = 0.9; pokeBall(p); return; }
        }
        continue;
      }
      if (p.stunT > 0 || d > 1.0) continue;
      const rate = p === controlled ? 1.6 : p.team === RIVAL ? state.diff.steal : 1.0;
      if (Math.random() < 1 - Math.exp(-rate * dt)) {
        owner.stunT = 0.45;
        giveBall(p);
        sfx.tackle();
        return;
      }
    }
  }

  /* ======================= MATCH FLOW ======================= */
  function nearestOutfield(team, pos) {
    let best = null, bd = Infinity;
    for (const p of teamPlayers(team)) {
      if (p.isGK) continue;
      const d = hdist(p.pos, pos);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }

  function startKickoff(team) {
    resetPositions();
    const dir = attackDirOf(team);
    const fwds = teamPlayers(team).filter((p) => p.role === "fwd");
    fwds[0].setPosition(0, -dir * 0.8);
    fwds[0].facing = dir > 0 ? 0 : Math.PI;
    fwds[1].setPosition(dir * 3.5, -dir * 1.4);
    giveBall(fwds[0]);
    if (team === RIVAL) setControlled(nearestOutfield(YOU, ball.pos));
    updateBall(0);
    state.setPiece = { type: "kickoff", team, taker: fwds[0], t: 0 };
    state.phase = "setpiece";
    state.celebrator = null;
    cancelCharge();
    sfx.whistle(1);
  }

  const SETPIECE_LABEL = { throw: "AUT", corner: "BURCHAK ZARBASI", goalkick: "DARVOZADAN ZARBA" };
  function startSetPiece(type, team, spot) {
    ball.vel.set(0, 0, 0);
    ball.owner = null;
    state.passTarget = null;
    cancelCharge();
    const dir = attackDirOf(team);
    let taker;
    if (type === "goalkick") {
      taker = teamPlayers(team).find((p) => p.isGK);
      spot = new V3(0, 0, ownGoalZ(team) + dir * 5);
    } else {
      taker = nearestOutfield(team, spot);
    }
    taker.resetTimers();
    taker.setPosition(spot.x, spot.z);
    if (type === "throw") taker.faceTo(0, taker.pos.z + dir * 8);
    else taker.faceTo(0, dir * HALF_L * 0.5);
    giveBall(taker);
    for (const p of teamPlayers(other(team))) {
      if (hdist(p.pos, spot) < 6) {
        const away = new V3(p.pos.x - spot.x, 0, p.pos.z - spot.z);
        if (away.lengthSq() < 0.01) away.set(0, 0, -dir);
        away.normalize().multiplyScalar(6);
        p.setPosition(clamp(spot.x + away.x, -HALF_W + 0.5, HALF_W - 0.5), clamp(spot.z + away.z, -HALF_L + 0.5, HALF_L - 0.5));
      }
    }
    updateBall(0);
    state.setPiece = { type, team, taker, t: 0 };
    state.phase = "setpiece";
    showMessage(SETPIECE_LABEL[type], 1300);
    sfx.whistle(1);
  }

  function checkGoalAndOut() {
    const b = ball.pos;
    if (Math.abs(b.z) > HALF_L + BALL_R) {
      if (Math.abs(b.x) < GOAL_HW - BALL_R * 0.3 && b.y < GOAL_H) {
        scoreGoal(b.z > 0 ? YOU : RIVAL);
        return true;
      }
      const endSign = Math.sign(b.z);
      const defending = endSign > 0 ? RIVAL : YOU;
      if (ball.lastTouchTeam === defending) {
        startSetPiece("corner", other(defending), new V3(Math.sign(b.x || 1) * (HALF_W - 0.4), 0, endSign * (HALF_L - 0.4)));
      } else {
        startSetPiece("goalkick", defending);
      }
      return true;
    }
    if (Math.abs(b.x) > HALF_W + BALL_R) {
      startSetPiece("throw", other(ball.lastTouchTeam), new V3(Math.sign(b.x) * (HALF_W - 0.4), 0, clamp(b.z, -HALF_L + 3, HALF_L - 3)));
      return true;
    }
    return false;
  }

  function scoreGoal(team) {
    state.score[team]++;
    updateScore();
    const scorer = ball.lastToucher;
    const own = ball.lastTouchTeam !== team;
    $goalSub.textContent = own ? "O'z darvozasiga" : scorer ? `#${scorer.number} — ${team === YOU ? "SIZ" : "RAQIB"}` : "";
    $goalFlash.classList.remove("show");
    void $goalFlash.offsetWidth;
    $goalFlash.classList.add("show");
    sfx.whistle(1);
    sfx.cheer(team === YOU ? 0.55 : 0.25);
    state.crowdT = 3;
    state.phase = "goal";
    state.phaseT = 0;
    state.concede = other(team);
    state.passTarget = null;
    cancelCharge();
    state.celebrator = own ? null : scorer;
    if (scorer && !own) {
      scorer.celebrate = true;
      state.celebrateSpot.set(Math.sign(scorer.pos.x || 1) * (HALF_W - 3), 0, attackDirOf(team) * (HALF_L - 4));
    }
  }

  function goalPhase(dt) {
    state.phaseT += dt;
    updateBall(dt);
    for (const p of allPlayers) {
      if (p === state.celebrator) p.move(dt, dirTo(p.pos, state.celebrateSpot), 1.1);
      else p.move(dt, null, 1);
    }
    if (state.phaseT > 3) {
      if (state.timeLeft <= 0) endMatch();
      else startKickoff(state.concede);
    }
  }

  function startHalftime() {
    state.half = 2;
    state.phase = "halftime";
    state.phaseT = 0;
    cancelCharge();
    sfx.whistle(2);
    showMessage("TANAFFUS — 1-TAYM TUGADI", 2400);
  }
  function halftimePhase(dt) {
    state.phaseT += dt;
    for (const p of allPlayers) p.move(dt, null, 1);
    if (state.phaseT > 2.6) {
      state.stamina = 1;
      startKickoff(RIVAL);
      showMessage("2-TAYM BOSHLANDI", 1500);
    }
  }

  function simulate(dt) {
    const sp = state.setPiece;
    if (state.phase === "setpiece") sp.t += dt;

    const inDir = getInputDir();
    const moving = inDir.lengthSq() > 0.01;

    if (state.shootCharging) {
      if (ball.owner !== controlled || state.phase !== "play") cancelCharge();
      else {
        state.shootCharge = Math.min(1, state.shootCharge + dt / 0.85);
        $power.style.width = state.shootCharge * 100 + "%";
        if (state.shootCharge >= 1) releaseShot();
      }
    }

    autoSwitch(dt);
    computeRoles();

    const sprinting = state.sprintHeld && moving && state.stamina > 0.02;
    state.stamina = sprinting ? Math.max(0, state.stamina - dt * 0.3) : Math.min(1, state.stamina + dt * 0.14);
    let uDir = inDir, uMul = sprinting ? 1.45 : 1;
    if (ball.owner === controlled) uMul *= 0.93;
    if (state.phase === "setpiece" && (sp.taker === controlled || sp.type === "kickoff")) {
      if (sp.taker === controlled && moving) controlled.turnTo(Math.atan2(inDir.x, inDir.z), dt * 8);
      uDir = null;
    } else if (state.passTarget === controlled && !ball.owner && !moving) {
      uDir = dirTo(controlled.pos, new V3(ball.pos.x + ball.vel.x * 0.25, 0, ball.pos.z + ball.vel.z * 0.25), 0.8);
    }
    controlled.move(dt, uDir, uMul);

    for (const p of allPlayers) {
      if (p === controlled) continue;
      const d = aiDecide(p, dt);
      p.move(dt, d.dir, d.mul);
    }
    separatePlayers();

    updateBall(dt);
    if (state.phase === "play") {
      if (!ball.owner) {
        if (checkGoalAndOut()) return;
        handlePickup();
      } else {
        handleSteals(dt);
      }
      if (ball.owner) state.stats.poss[ball.owner.team] += dt;
    }

    state.timeLeft -= dt;
    updateClock();
    const frac = 1 - state.timeLeft / state.matchSeconds;
    if (state.half === 1 && frac >= 0.5) startHalftime();
    else if (frac >= 1) endMatch();

    $stamina.style.width = state.stamina * 100 + "%";
    updateButtons();
  }

  /* ======================= CAMERA ======================= */
  const camFocus = new V3(), camLook = new V3();
  let menuAngle = 0;
  function focusTarget() {
    if (state.phase === "goal" && state.celebrator) {
      return new V3().lerpVectors(flat(ball.pos), state.celebrator.pos, Math.min(1, state.phaseT / 1.2));
    }
    return new V3().lerpVectors(controlled.pos, flat(ball.pos), 0.5);
  }
  function followCamera(dt, snap) {
    const portrait = camera.aspect < 1;
    const height = portrait ? 20 : 12.5, back = portrait ? 15.5 : 13;
    const f = focusTarget();
    f.z = clamp(f.z, -HALF_L + 6, HALF_L - 2);
    const a = snap ? 1 : Math.min(1, dt * 3.2);
    camFocus.lerp(f, a);
    camera.position.lerp(new V3(camFocus.x * 0.8, height, camFocus.z - back), snap ? 1 : Math.min(1, dt * 3));
    camLook.lerp(new V3(camFocus.x * 0.92, 0, camFocus.z + (portrait ? 6 : 4)), a);
    camera.lookAt(camLook);
  }
  function orbitCamera(dt) {
    menuAngle += dt * 0.07;
    camera.position.set(Math.sin(menuAngle) * 62, 30, Math.cos(menuAngle) * 62);
    camera.lookAt(0, 0, 0);
  }

  /* ======================= SCREENS ======================= */
  const $startScreen = $("startScreen"), $pauseScreen = $("pauseScreen"), $endScreen = $("endScreen");

  document.querySelectorAll(".chips").forEach((group) => {
    group.addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      group.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
      settings[group.dataset.group] = b.dataset.v;
    });
  });

  function tryFullscreen() {
    if (!window.matchMedia("(pointer: coarse)").matches) return;
    const el = document.documentElement;
    const req = el.requestFullscreen || el.webkitRequestFullscreen;
    if (!req) return;
    try {
      const r = req.call(el);
      if (r && r.then) {
        r.then(() => {
          if (screen.orientation && screen.orientation.lock) screen.orientation.lock("landscape").catch(() => {});
        }).catch(() => {});
      }
    } catch (e) { /* fullscreen not supported */ }
  }

  function hideOverlays() {
    $startScreen.classList.add("hidden");
    $pauseScreen.classList.add("hidden");
    $endScreen.classList.add("hidden");
  }

  function newMatch() {
    state.diff = DIFFICULTY[settings.diff];
    state.matchSeconds = Number(settings.time);
    state.timeLeft = state.matchSeconds;
    state.score.you = 0;
    state.score.rival = 0;
    state.stats = { shots: { you: 0, rival: 0 }, poss: { you: 0, rival: 0 } };
    state.half = 1;
    state.stamina = 1;
    state.sprintHeld = false;
    state.crowdT = 0;
    resetJoy();
    updateScore();
    updateClock();
    hideOverlays();
    root.classList.remove("menu-mode");
    startKickoff(YOU);
    followCamera(0, true);
    showMessage("O'YIN BOSHLANDI!", 1600);
  }

  function toMenu() {
    state.phase = "menu";
    hideOverlays();
    $startScreen.classList.remove("hidden");
    root.classList.add("menu-mode");
    resetPositions();
    updateBall(0);
  }

  function pauseGame() {
    if (!["play", "setpiece", "goal", "halftime"].includes(state.phase)) return;
    state.prevPhase = state.phase;
    state.phase = "paused";
    resetJoy();
    state.sprintHeld = false;
    cancelCharge();
    $pauseScreen.classList.remove("hidden");
  }
  function resumeGame() {
    if (state.phase !== "paused") return;
    state.phase = state.prevPhase;
    $pauseScreen.classList.add("hidden");
    clock.getDelta();
  }

  function endMatch() {
    if (state.phase === "ended") return;
    state.phase = "ended";
    cancelCharge();
    resetJoy();
    sfx.whistle(3, true);
    const { you, rival } = state.score;
    $("resultTitle").textContent = you > rival ? "G'ALABA!" : you < rival ? "MAG'LUBIYAT" : "DURANG";
    $("finalScore").textContent = `SIZ ${you} : ${rival} RAQIB`;
    const total = state.stats.poss.you + state.stats.poss.rival || 1;
    const py = Math.round((state.stats.poss.you / total) * 100);
    $("statShots").innerHTML = `<b>${state.stats.shots.you}</b><span>Zarbalar</span><b>${state.stats.shots.rival}</b>`;
    $("statPoss").innerHTML = `<b>${py}%</b><span>To'p nazorati</span><b>${100 - py}%</b>`;
    root.classList.add("menu-mode");
    $endScreen.classList.remove("hidden");
  }

  $("startBtn").addEventListener("click", () => { sfx.init(); tryFullscreen(); newMatch(); });
  $("resumeBtn").addEventListener("click", resumeGame);
  $("pauseRestartBtn").addEventListener("click", newMatch);
  $("pauseMenuBtn").addEventListener("click", toMenu);
  $("restartBtn").addEventListener("click", () => { sfx.init(); newMatch(); });
  $("endMenuBtn").addEventListener("click", toMenu);
  $("pauseBtn").addEventListener("click", pauseGame);
  $("muteBtn").addEventListener("click", () => {
    state.muted = !state.muted;
    sfx.setMuted(state.muted);
    $("muteBtn").classList.toggle("muted", state.muted);
  });
  document.addEventListener("visibilitychange", () => { if (document.hidden) pauseGame(); });

  /* ======================= MAIN LOOP ======================= */
  const clock = new THREE.Clock();
  function tick() {
    requestAnimationFrame(tick);
    const dt = Math.min(clock.getDelta(), 1 / 30);
    const ph = state.phase;
    if (ph === "play" || ph === "setpiece") simulate(dt);
    else if (ph === "goal") goalPhase(dt);
    else if (ph === "halftime") halftimePhase(dt);

    if (state.phase !== "paused") {
      for (const p of allPlayers) p.animate(dt);
      updateMarker(dt);
    }
    if (state.phase === "menu" || state.phase === "ended") orbitCamera(dt);
    else if (state.phase !== "paused") followCamera(dt, false);
    if (state.crowdT > 0) animateCrowd(dt);
    if (state.phase !== "menu") drawRadar();
    renderer.render(scene, camera);
  }

  resetPositions();
  updateBall(0);
  tick();

  window.__dls = { state, ball, allPlayers, get controlled() { return controlled; } };
})();
