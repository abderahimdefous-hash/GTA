// 3D talking head rendered with plain WebGL (no library needed).
// app.js drives it through window.Da9awiFace.state.
(() => {
  "use strict";

  const canvas = document.getElementById("face3d");
  const gl = canvas.getContext("webgl", { antialias: true, alpha: true, premultipliedAlpha: true });

  const state = {
    speaking: false,   // mouth moves while true
    wordPulse: 0,      // extra mouth kick on each spoken word
    mode: "idle",      // idle | listening | thinking | speaking
  };
  window.Da9awiFace = { state, supported: !!gl };

  if (!gl) {
    canvas.replaceWith(Object.assign(document.createElement("div"), {
      className: "no-webgl",
      textContent: "المتصفح ديالك ما كيدعمش WebGL 3D",
    }));
    return;
  }

  /* ---------------- tiny matrix helpers (column-major) ---------------- */

  const M = {
    ident: () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    mul(a, b) {
      const o = new Array(16);
      for (let c = 0; c < 4; c++)
        for (let r = 0; r < 4; r++)
          o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
      return o;
    },
    persp(fov, aspect, near, far) {
      const f = 1 / Math.tan(fov / 2), nf = 1 / (near - far);
      return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0];
    },
    trans: (x, y, z) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1],
    rx(a) { const c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]; },
    ry(a) { const c = Math.cos(a), s = Math.sin(a); return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]; },
    rz(a) { const c = Math.cos(a), s = Math.sin(a); return [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; },
    chain(...ms) { return ms.reduce((acc, m) => M.mul(acc, m)); },
  };

  /* ---------------- geometry ---------------- */

  const gauss = (dx, dy, sx, sy) => Math.exp(-((dx / sx) ** 2 + (dy / sy) ** 2));
  const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

  // Turns a unit sphere into a stylised human head (face looks toward +z).
  function headShape(x, y, z) {
    x *= 0.78; y *= 1.04; z *= 0.86;
    if (y < 0) {                                  // narrow jaw and chin
      const t = -y / 1.04;
      x *= 1 - 0.2 * t * t;
      z *= 1 - 0.08 * t * t;
    }
    if (z < 0) z *= 1.1;                          // rounder back of the skull
    const front = smooth(0.05, 0.45, z);
    const ax = Math.abs(x);
    z += front * (
      0.17 * gauss(x, y + 0.13, 0.075, 0.17)      // nose
      + 0.06 * gauss(x, y + 0.3, 0.06, 0.04)      // nose tip
      - 0.08 * gauss(ax - 0.28, y - 0.13, 0.15, 0.1)   // eye sockets
      + 0.05 * gauss(ax - 0.28, y - 0.31, 0.2, 0.05)   // brow ridge
      + 0.04 * gauss(ax - 0.36, y + 0.12, 0.12, 0.12)  // cheekbones
      + 0.05 * gauss(x, y + 0.82, 0.18, 0.12)     // chin
      - 0.03 * gauss(x, y + 0.62, 0.22, 0.05)     // under-lip dip
    );
    return [x, y, z];
  }

  function sphere(lat, lon, deform) {
    const pos = [], idx = [];
    for (let i = 0; i <= lat; i++) {
      const th = (i / lat) * Math.PI;
      for (let j = 0; j < lon; j++) {
        const ph = (j / lon) * Math.PI * 2;
        const p = [Math.sin(th) * Math.sin(ph), Math.cos(th), Math.sin(th) * Math.cos(ph)];
        pos.push(...(deform ? deform(...p) : p));
      }
    }
    for (let i = 0; i < lat; i++)
      for (let j = 0; j < lon; j++) {
        const a = i * lon + j, b = i * lon + ((j + 1) % lon);
        const c = a + lon, d = b + lon;
        idx.push(a, c, b, b, c, d);
      }
    // Smooth normals from face normals, flipped to point outward.
    const nrm = new Float32Array(pos.length);
    for (let t = 0; t < idx.length; t += 3) {
      const [a, b, c] = [idx[t] * 3, idx[t + 1] * 3, idx[t + 2] * 3];
      const u = [pos[b] - pos[a], pos[b + 1] - pos[a + 1], pos[b + 2] - pos[a + 2]];
      const v = [pos[c] - pos[a], pos[c + 1] - pos[a + 1], pos[c + 2] - pos[a + 2]];
      const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      for (const k of [a, b, c]) { nrm[k] += n[0]; nrm[k + 1] += n[1]; nrm[k + 2] += n[2]; }
    }
    for (let k = 0; k < nrm.length; k += 3) {
      let [nx, ny, nz] = [nrm[k], nrm[k + 1], nrm[k + 2]];
      const len = Math.hypot(nx, ny, nz) || 1;
      const s = nx * pos[k] + ny * pos[k + 1] + nz * pos[k + 2] < 0 ? -1 : 1;
      nrm[k] = (nx / len) * s; nrm[k + 1] = (ny / len) * s; nrm[k + 2] = (nz / len) * s;
    }
    return { pos: new Float32Array(pos), nrm, idx: new Uint16Array(idx) };
  }

  function upload(geo) {
    const mk = (target, data) => { const b = gl.createBuffer(); gl.bindBuffer(target, b); gl.bufferData(target, data, gl.STATIC_DRAW); return b; };
    return { pos: mk(gl.ARRAY_BUFFER, geo.pos), nrm: mk(gl.ARRAY_BUFFER, geo.nrm), idx: mk(gl.ELEMENT_ARRAY_BUFFER, geo.idx), count: geo.idx.length };
  }

  const headGeo = sphere(72, 72, headShape);
  const head = upload(headGeo);
  const ball = upload(sphere(32, 32));

  // Depth of the face surface at (x, y), used to seat the eyes and mouth.
  function surfaceZ(x, y) {
    const p = headGeo.pos;
    let best = Infinity, z = 0;
    for (let k = 0; k < p.length; k += 3) {
      if (p[k + 2] <= 0) continue;
      const d = (p[k] - x) ** 2 + (p[k + 1] - y) ** 2;
      if (d < best) { best = d; z = p[k + 2]; }
    }
    return z;
  }
  const EYE = { x: 0.27, y: 0.13, r: 0.125 };
  EYE.z = surfaceZ(EYE.x, EYE.y) - 0.035;
  const MOUTH = { y: -0.5 };
  MOUTH.z = surfaceZ(0, MOUTH.y) - 0.035;
  const BROW = { x: 0.28, y: 0.29 };
  BROW.z = surfaceZ(BROW.x, BROW.y) - 0.012;

  /* ---------------- shaders ---------------- */

  function program(vsSrc, fsSrc) {
    const sh = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, vsSrc));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fsSrc));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const u = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const name = gl.getActiveUniform(p, i).name; u[name] = gl.getUniformLocation(p, name); }
    return { p, u, aPos: gl.getAttribLocation(p, "aPos"), aNrm: gl.getAttribLocation(p, "aNrm") };
  }

  const meshProg = program(`
    attribute vec3 aPos;
    attribute vec3 aNrm;
    uniform mat4 uModel, uVP;
    uniform vec4 uShape;           // xyz = scale, w = smile bend
    varying vec3 vObj, vN, vW;
    void main() {
      vec3 p = aPos * uShape.xyz;
      p.y += uShape.w * aPos.x * aPos.x;
      vec4 w = uModel * vec4(p, 1.0);
      vW = w.xyz;
      vObj = aPos;
      vN = normalize(mat3(uModel) * (aNrm / uShape.xyz));
      gl_Position = uVP * w;
    }`, `
    precision mediump float;
    uniform int uKind;             // 0 head, 1 eye, 2 mouth, 3 brow
    uniform vec3 uCam;
    uniform float uTime, uGlow;
    varying vec3 vObj, vN, vW;

    float line(float v, float w) { float f = abs(fract(v) - 0.5); return smoothstep(0.5 - w, 0.5, f); }

    void main() {
      vec3 N = normalize(vN);
      vec3 V = normalize(uCam - vW);
      vec3 L1 = normalize(vec3(-0.5, 0.7, 0.9));
      vec3 L2 = normalize(vec3(0.9, -0.1, 0.4));
      float ndv = max(dot(N, V), 0.0);
      float fres = pow(1.0 - ndv, 2.4);
      vec3 cyan = vec3(0.37, 0.95, 1.0);
      vec3 violet = vec3(0.64, 0.36, 1.0);
      vec3 rim = mix(violet, cyan, clamp(vObj.y * 0.5 + 0.55, 0.0, 1.0));
      vec3 col;

      if (uKind == 0) {
        float dif = max(dot(N, L1), 0.0) * 0.9 + max(dot(N, L2), 0.0) * 0.35;
        col = vec3(0.05, 0.08, 0.19) * (0.35 + dif * 1.7);
        col += pow(max(dot(N, normalize(L1 + V)), 0.0), 36.0) * vec3(0.55, 0.8, 1.0) * 0.55;
        float ang = atan(vObj.x, vObj.z) / 3.14159;
        float grid = max(line(vObj.y * 15.0, 0.035), line(ang * 18.0, 0.035));
        col += rim * grid * (0.12 + fres * 0.7);
        float scanY = 1.25 - mod(uTime * 0.45, 2.7);
        col += rim * exp(-pow((vObj.y - scanY) * 9.0, 2.0)) * 0.35;
        col += rim * fres * (1.2 + uGlow * 0.8);
      } else if (uKind == 1) {
        vec3 d = normalize(vObj);
        float t = smoothstep(0.78, 1.0, d.z);
        float streak = 0.12 * sin(atan(d.y, d.x) * 22.0);
        vec3 iris = mix(vec3(0.05, 0.3, 1.0), vec3(0.75, 1.0, 1.0), t * t + streak);
        vec3 sclera = vec3(0.06, 0.09, 0.2) * (0.5 + max(dot(N, L1), 0.0) * 1.2);
        col = mix(sclera, iris * (1.2 + uGlow * 0.5), smoothstep(0.76, 0.8, d.z));
        col = mix(col, vec3(0.01, 0.01, 0.03), smoothstep(0.94, 0.95, d.z));
        col += pow(max(dot(N, normalize(L1 + V)), 0.0), 90.0) * 1.2;
        col += cyan * fres * 0.35;
      } else if (uKind == 2) {
        col = vec3(0.02, 0.01, 0.06) + rim * pow(fres, 0.6) * 2.4 + violet * uGlow * 0.12;
      } else {
        col = cyan * (0.9 + fres + uGlow * 0.4);
      }
      gl_FragColor = vec4(col, 1.0);
    }`);

  const pointProg = program(`
    attribute vec3 aPos;
    uniform mat4 uVP;
    uniform float uTime, uDpr;
    varying float vA;
    void main() {
      float a = uTime * (0.15 + 0.1 * fract(aPos.x * 7.0));
      float c = cos(a), s = sin(a);
      vec3 p = vec3(aPos.x * c + aPos.z * s, aPos.y, -aPos.x * s + aPos.z * c);
      vec4 clip = uVP * vec4(p, 1.0);
      gl_Position = clip;
      gl_PointSize = uDpr * 3.2 * (4.3 / clip.w);
      vA = 0.35 + 0.65 * (0.5 + 0.5 * sin(uTime * 2.0 + aPos.y * 40.0));
    }`, `
    precision mediump float;
    varying float vA;
    void main() {
      float d = length(gl_PointCoord - 0.5);
      if (d > 0.5) discard;
      float k = (1.0 - d * 2.0) * vA;
      gl_FragColor = vec4(vec3(0.37, 0.95, 1.0) * k, k);
    }`);

  const ring = (() => {
    const pts = [];
    for (let i = 0; i < 260; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 0.9 + Math.random() * 0.45;
      // Hologram base ring under the chin.
      pts.push(Math.cos(a) * r, -1.2 + (Math.random() - 0.5) * 0.06, Math.sin(a) * r);
    }
    const b = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(pts), gl.STATIC_DRAW);
    return { buf: b, count: pts.length / 3 };
  })();

  /* ---------------- input ---------------- */

  const anim = {
    yaw: 0, pitch: 0, tYaw: 0, tPitch: 0,
    eyeX: 0, eyeY: 0,
    blink: 0, nextBlink: 1500,
    mouth: 0, smile: 0.02,
    lastMove: -1e9,
  };

  function aim(clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    const dx = (clientX - (r.left + r.width / 2)) / (window.innerWidth / 2);
    const dy = (clientY - (r.top + r.height * 0.45)) / (window.innerHeight / 2);
    anim.tYaw = Math.max(-1, Math.min(1, dx));
    anim.tPitch = Math.max(-1, Math.min(1, dy));
    anim.lastMove = performance.now();
  }
  window.addEventListener("pointermove", (e) => aim(e.clientX, e.clientY));
  window.addEventListener("touchmove", (e) => { const t = e.touches[0]; if (t) aim(t.clientX, t.clientY); }, { passive: true });

  /* ---------------- render loop ---------------- */

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(canvas.clientWidth * dpr), h = Math.round(canvas.clientHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    return dpr;
  }

  function bindMesh(mesh) {
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.pos);
    gl.enableVertexAttribArray(meshProg.aPos);
    gl.vertexAttribPointer(meshProg.aPos, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.nrm);
    gl.enableVertexAttribArray(meshProg.aNrm);
    gl.vertexAttribPointer(meshProg.aNrm, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.idx);
  }

  function draw(mesh, kind, model, shape) {
    gl.uniform1i(meshProg.u.uKind, kind);
    gl.uniformMatrix4fv(meshProg.u.uModel, false, model);
    gl.uniform4fv(meshProg.u.uShape, shape);
    gl.drawElements(gl.TRIANGLES, mesh.count, gl.UNSIGNED_SHORT, 0);
  }

  const CAM = [0, 0.02, 4.4];
  let prev = performance.now();

  function frame(now) {
    const dt = Math.min(0.05, (now - prev) / 1000);
    prev = now;
    const time = now / 1000;
    const a = anim;
    const k = 1 - Math.pow(0.002, dt);         // frame-rate independent easing

    // Where to look: pointer, or a slow idle wander, overridden by mode.
    let ty = a.tYaw, tp = a.tPitch;
    if (now - a.lastMove > 4000) { ty = Math.sin(time * 0.4) * 0.35; tp = Math.sin(time * 0.27) * 0.15; }
    if (state.mode === "thinking") { ty = -0.35 + Math.sin(time * 0.8) * 0.05; tp = -0.4; }
    a.yaw += (ty * 0.75 - a.yaw) * k;
    a.pitch += (tp * 0.4 - a.pitch) * k;
    a.eyeX += (ty - a.eyeX) * Math.min(1, k * 2);
    a.eyeY += (tp - a.eyeY) * Math.min(1, k * 2);

    if (now > a.nextBlink) { a.blink = 1; a.nextBlink = now + 2200 + Math.random() * 3500; }
    a.blink = Math.max(0, a.blink - dt * 7);
    const lid = 1 - Math.sin(a.blink * Math.PI) * 0.92;

    let mouthTarget = 0;
    if (state.speaking) {
      mouthTarget = Math.min(1, Math.max(0.1, (Math.sin(time * 14) + Math.sin(time * 23 + 1.3)) * 0.25 + 0.45 + state.wordPulse));
      state.wordPulse *= Math.pow(0.02, dt);
    }
    a.mouth += (mouthTarget - a.mouth) * Math.min(1, dt * 18);
    const smileTarget = state.mode === "thinking" ? -0.02 : state.speaking ? 0.035 : 0.025;
    a.smile += (smileTarget - a.smile) * k;

    const talkNod = state.speaking ? Math.sin(time * 5.5) * 0.035 : 0;
    const roll = state.mode === "listening" ? 0.12 : -a.yaw * 0.08;
    const bob = Math.sin(time * 1.2) * 0.03;
    const headM = M.chain(M.trans(0, bob, 0), M.ry(a.yaw), M.rx(a.pitch + talkNod), M.rz(roll));

    const dpr = resize();
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
    gl.disable(gl.BLEND);

    const vp = M.mul(M.persp(0.62, canvas.width / canvas.height, 0.1, 20), M.trans(-CAM[0], -CAM[1], -CAM[2]));
    const glow = state.speaking ? 0.5 + a.mouth * 0.5 : state.mode === "listening" ? 0.6 : 0.15;

    gl.useProgram(meshProg.p);
    gl.uniformMatrix4fv(meshProg.u.uVP, false, vp);
    gl.uniform3fv(meshProg.u.uCam, CAM);
    gl.uniform1f(meshProg.u.uTime, time);
    gl.uniform1f(meshProg.u.uGlow, glow);

    bindMesh(head);
    draw(head, 0, headM, [1, 1, 1, 0]);

    bindMesh(ball);
    // Neck follows the head only halfway, like a real one.
    draw(ball, 0, M.chain(M.trans(0, -1.05 + bob, -0.18), M.ry(a.yaw * 0.5)), [0.3, 0.55, 0.28, 0]);
    for (const side of [-1, 1]) {
      draw(ball, 0, M.chain(headM, M.trans(side * 0.74, 0.02, -0.06), M.rz(side * 0.1)), [0.06, 0.16, 0.1, 0]);
    }

    const eyeRot = M.chain(M.ry(a.eyeX * 0.4), M.rx(a.eyeY * 0.3));
    for (const side of [-1, 1]) {
      draw(ball, 1, M.chain(headM, M.trans(side * EYE.x, EYE.y, EYE.z), eyeRot), [EYE.r, EYE.r * lid, EYE.r, 0]);
      const browLift = (state.speaking ? Math.sin(time * 4) * 0.012 + 0.01 : 0) + (state.mode === "thinking" ? 0.03 : 0);
      draw(ball, 3, M.chain(headM, M.trans(side * BROW.x, BROW.y + browLift, BROW.z), M.ry(side * 0.45), M.rz(side * -0.12)), [0.13, 0.016, 0.03, 0]);
    }
    const open = a.mouth;
    draw(ball, 2, M.chain(headM, M.trans(0, MOUTH.y - open * 0.03, MOUTH.z)), [0.19 - open * 0.035, 0.014 + open * 0.07, 0.06, a.smile]);

    // Glowing particle ring around the head.
    gl.useProgram(pointProg.p);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.depthMask(false);
    gl.uniformMatrix4fv(pointProg.u.uVP, false, vp);
    gl.uniform1f(pointProg.u.uTime, time);
    gl.uniform1f(pointProg.u.uDpr, dpr);
    gl.disableVertexAttribArray(meshProg.aNrm);
    gl.bindBuffer(gl.ARRAY_BUFFER, ring.buf);
    gl.enableVertexAttribArray(pointProg.aPos);
    gl.vertexAttribPointer(pointProg.aPos, 3, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.POINTS, 0, ring.count);

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
