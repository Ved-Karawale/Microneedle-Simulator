import { useState, useMemo, useRef, useEffect, useCallback } from "react";
// Three.js loaded from CDN in TPMSVisualizer via script tag
import {
  AreaChart,
  Area,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";

// ═══════════════════════════════════════════════════════════════
//  PHYSICS ENGINE  v5  — all 8 bugs from v4 fixed
// ═══════════════════════════════════════════════════════════════
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const safe = (x, fallback = 0) => (isFinite(x) && !isNaN(x) ? x : fallback);
const deg2rad = (d) => (d * Math.PI) / 180;

const GEOMETRIES = {
  planar: {
    label: "Planar Film",
    icon: "▬",
    kind: "film",
    tpms: false,
    porosity: 0,
    tortuosity: 1.0,
    poreRadiusUm: 0,
    rEffUm: 5,
    saFactor: 1.0,
    releaseFactor: 1.0,
    insertionFactor: 0.2,
    color: "#64748b",
  },
  conical: {
    label: "Conical",
    icon: "△",
    kind: "solid",
    tpms: false,
    porosity: 0,
    tortuosity: 1.0,
    poreRadiusUm: 0,
    rEffUm: 3,
    saFactor: 0.85,
    releaseFactor: 0.95,
    insertionFactor: 1.15,
    color: "#38bdf8",
  },
  pyramidal: {
    label: "Pyramidal",
    icon: "◇",
    kind: "solid",
    tpms: false,
    porosity: 0,
    tortuosity: 1.0,
    poreRadiusUm: 0,
    rEffUm: 3.5,
    saFactor: 0.92,
    releaseFactor: 1.0,
    insertionFactor: 1.05,
    color: "#fbbf24",
  },
  star: {
    label: "Star",
    icon: "✦",
    kind: "solid",
    tpms: false,
    porosity: 0,
    tortuosity: 1.0,
    poreRadiusUm: 0,
    rEffUm: 4.5,
    saFactor: 1.25,
    releaseFactor: 1.1,
    insertionFactor: 1.05,
    color: "#fb923c",
  },
  tpms_gyroid: {
    label: "TPMS Gyroid",
    icon: "⬡",
    kind: "tpms",
    tpms: true,
    porosity: 0.65,
    tortuosity: 1.5,
    poreRadiusUm: 12.5,
    rEffUm: 12.5,
    saFactor: 3.5,
    releaseFactor: 1.45,
    insertionFactor: 0.95,
    color: "#818cf8",
  },
  tpms_primitive: {
    label: "TPMS Primitive",
    icon: "⊕",
    kind: "tpms",
    tpms: true,
    porosity: 0.7,
    tortuosity: 1.3,
    poreRadiusUm: 17.5,
    rEffUm: 17.5,
    saFactor: 2.8,
    releaseFactor: 1.55,
    insertionFactor: 1.0,
    color: "#c084fc",
  },
  tpms_diamond: {
    label: "TPMS Diamond",
    icon: "◈",
    kind: "tpms",
    tpms: true,
    porosity: 0.68,
    tortuosity: 2.1,
    poreRadiusUm: 10.0,
    rEffUm: 10.0,
    saFactor: 4.0,
    releaseFactor: 1.25,
    insertionFactor: 0.9,
    color: "#e879f9",
  },
  cone_tpms_core: {
    label: "Cone+TPMS",
    icon: "⬡△",
    kind: "hybrid",
    tpms: true,
    porosity: 0.62,
    tortuosity: 1.6,
    poreRadiusUm: 14.0,
    rEffUm: 14.0,
    saFactor: 2.4,
    releaseFactor: 1.35,
    insertionFactor: 1.1,
    color: "#34d399",
  },
};

// FIX: D_water now depends on HPMC grade AND concentration (Bug 2)
function effectiveDwater(hpmcGrade, hpmcConc) {
  const viscRef = { E5: 5, E15: 15, E50: 50, K4M: 4000 }[hpmcGrade] ?? 15;
  const gradeEffect = Math.pow(5 / viscRef, 0.28); // K4M: ×0.24, E5: ×1.0
  const concEffect = Math.exp(-0.03 * hpmcConc); // 5%: ×0.86, 9%: ×0.76, 15%: ×0.64
  return 1e-10 * gradeEffect * concEffect; // m²/s
}

function materialModel({
  sdType = "CCS",
  sdConc = 3,
  hpmcGrade = "E15",
  hpmcConc = 5,
  glycerol = 10,
  tween80 = 0.1,
  drugMW = 300,
}) {
  const hpmcViscRef = { E5: 5, E15: 15, E50: 50, K4M: 4000 }[hpmcGrade] ?? 15;
  const hpmcNShift =
    { E5: 0.0, E15: 0.03, E50: 0.06, K4M: 0.12 }[hpmcGrade] ?? 0.03;

  const viscosity_mPas = hpmcViscRef * Math.pow(hpmcConc / 2, 2.2);
  const surfaceTension_mNm =
    tween80 <= 0 ? 72 : clamp(72 - 35 * Math.log10(1 + tween80 / 0.01), 28, 72);

  const sdMap = {
    SSG: {
      k0: 0.11,
      n0: 0.65,
      burst: 0.22,
      gelThresh: 8.0,
      kBurst: 0.9,
      color: "#f97316",
    },
    CCS: {
      k0: 0.14,
      n0: 0.55,
      burst: 0.27,
      gelThresh: 5.0,
      kBurst: 2.0,
      color: "#06b6d4",
    }, // calibrated: T80=15-17min at Jin et al. conditions
    PVPP: {
      k0: 0.23,
      n0: 0.4,
      burst: 0.38,
      gelThresh: 999,
      kBurst: 3.5,
      color: "#a78bfa",
    },
  };
  const sd = sdMap[sdType] ?? sdMap.CCS;

  const gelPenalty =
    sdConc > sd.gelThresh ? Math.pow(0.75, sdConc - sd.gelThresh) : 1.0;
  const gelPenalty_sqrt = Math.sqrt(gelPenalty);
  const aboveCMC = tween80 > 0.0017;
  // FIX Bug 7: cmcBoost ONLY on drug dissolution k_KP, not on kHyd
  const cmcBoost = aboveCMC ? 1 + 0.15 * Math.log10(tween80 / 0.0017 + 1) : 1.0;
  const wettingFactor = 1 + 0.06 * tween80; // affects kHyd only (wetting, not micelles)
  const mwNShift = 0.0002 * (drugMW - 300); // Peppas-Reinhart
  const hpmcConcNShift = hpmcConc * 0.006;

  return {
    viscosity_mPas,
    surfaceTension_mNm,
    kBase: sd.k0,
    nBase: sd.n0 + hpmcNShift + hpmcConcNShift + mwNShift,
    burstBase: sd.burst,
    kBurst: sd.kBurst,
    gelThresh: sd.gelThresh,
    gelPenalty,
    gelPenalty_sqrt,
    sdColor: sd.color,
    aboveCMC,
    cmcBoost,
    wettingFactor,
    plasticizerFactor: 1.03 + 0.007 * glycerol, // baseline softening even at 1% glycerol
    disintegrantFactor: 1 + 0.06 * Math.min(sdConc, sd.gelThresh),
    D_water: effectiveDwater(hpmcGrade, hpmcConc), // FIX Bug 2
  };
}

function geometryModel({
  geoKey = "conical",
  H = 600,
  R = 150,
  coatThickUm = 20,
  drugLoadFrac = 0.3,
}) {
  const g = GEOMETRIES[geoKey] ?? GEOMETRIES.conical;
  const aspectRatio = H / R;
  const tipAngleDeg =
    geoKey === "planar" ? null : (Math.atan(R / H) * 180) / Math.PI;
  const insertionScore = clamp(
    g.insertionFactor * (0.8 + 0.25 * clamp(aspectRatio / 3, 0.5, 1.5)),
    0.2,
    2.0
  );
  const thicknessFactor = clamp(
    Math.pow(20 / Math.max(coatThickUm, 5), 2),
    0.25,
    4.0
  );
  const D_eff_ratio = g.tpms ? g.porosity / (g.tortuosity * g.tortuosity) : 1.0;

  // ── Geometry-specific surface area (exact formulae, µm²) ──────────────────
  const rt = 5; // tip radius µm
  let SA_base_um2;
  switch (geoKey) {
    case "planar":
      SA_base_um2 = Math.PI * R * R;
      break;
    case "conical":
    case "cone_tpms_core": {
      const sl = Math.sqrt(H * H + (R - rt) * (R - rt));
      SA_base_um2 = Math.PI * (R + rt) * sl * g.saFactor;
      break;
    }
    case "pyramidal": {
      const a = R * 2,
        sl2 = Math.sqrt(H * H + (a / 2) * (a / 2));
      SA_base_um2 = 4 * 0.5 * a * sl2;
      break;
    }
    case "star": {
      const sl = Math.sqrt(H * H + (R - rt) * (R - rt));
      SA_base_um2 = Math.PI * (R + rt) * sl * 1.45;
      break;
    }
    default: {
      // TPMS: frustum lateral × saFactor (internal pore surface included)
      const sl = Math.sqrt(H * H + (R - rt) * (R - rt));
      SA_base_um2 = Math.PI * (R + rt) * sl * g.saFactor;
      break;
    }
  }

  // ── Non-uniform coating volume factor ─────────────────────────────────────
  // TPMS: coating pools in concave crevices → net volume > SA×L_uniform
  // Star: slight thinning at edges → 0.92
  // Convex solid: uniform → 1.0
  const volumeFactor = g.tpms
    ? 1.0 + 0.4 * g.porosity
    : geoKey === "star"
    ? 0.92
    : 1.0;

  // Coating volume µm³, mass µg (film density 1.2 g/cm³ = 1.2e-12 µg/µm³)
  const coatVol_um3 = SA_base_um2 * coatThickUm * volumeFactor;
  // Density: 1.2 g/cm³ = 1.2e-6 µg/µm³  (1 cm³ = 1e12 µm³, 1 g = 1e6 µg)
  const M_coat_ug = coatVol_um3 * 1.2e-6;
  const M_drug_ug = M_coat_ug * drugLoadFrac;

  // Moving-boundary SA evolution tag (used in insights)
  const saEvolution = g.tpms ? "increase_then_decrease" : "monotone_decrease";

  return {
    ...g,
    H,
    R,
    aspectRatio,
    tipAngleDeg,
    insertionScore,
    thicknessFactor,
    D_eff_ratio,
    coatThickUm,
    effectiveCapillaryRadiusUm: g.tpms ? g.poreRadiusUm : g.rEffUm,
    SA_base_um2,
    coatVol_um3,
    M_coat_ug,
    M_drug_ug,
    volumeFactor,
    saEvolution,
    drugLoadFrac,
  };
}

function simulateWicking({ geometry, viscosity_mPas, surfaceTension_mNm }) {
  const eta_ISF = 1.5e-3,
    gamma_ISF = 40e-3,
    theta_ISF = deg2rad(30);
  const eta_coat = Math.max(viscosity_mPas, 1) * 1e-3;
  const gamma_coat = Math.max(surfaceTension_mNm, 1) * 1e-3;
  const theta_manuf = deg2rad(15); // FIX P10: metal surface ~15°
  const rEff = geometry.effectiveCapillaryRadiusUm * 1e-6;
  const tau = geometry.tortuosity ?? 1.0;
  const C_ISF = Math.max(
    (rEff * gamma_ISF * Math.cos(theta_ISF)) / (2 * eta_ISF * tau * tau),
    0
  );
  const C_manuf = Math.max(
    (rEff * gamma_coat * Math.cos(theta_manuf)) / (2 * eta_coat * tau * tau),
    0
  );
  return Array.from({ length: 61 }, (_, i) => {
    const t = i * 0.5;
    return {
      t,
      inskin: +Math.min(
        geometry.H,
        safe(Math.sqrt(C_ISF * t) * 1e6, 0)
      ).toFixed(1),
      manuf: +Math.min(
        geometry.H,
        safe(Math.sqrt(C_manuf * t) * 1e6, 0)
      ).toFixed(1),
    };
  });
}

function simulateRelease({ material, geometry, tEnd = 30, dt = 0.1 }) {
  const kind = geometry.kind;
  const L_m = Math.max(geometry.coatThickUm, 5) * 1e-6;

  // FIX Bug 2: D_water now grade+conc dependent from materialModel
  const kHyd_base = (material.D_water / (L_m * L_m)) * 60; // min⁻¹

  // FIX Bug 5: saV_mod — remove hard floor, use H directly
  const H_norm = geometry.H / 400;
  const saV_mod = geometry.saFactor / Math.max(H_norm, 0.3); // FIX Bug 5

  // FIX Bug 7: wettingFactor (not cmcBoost) on kHyd
  const kHyd = (() => {
    const base =
      kHyd_base *
      material.wettingFactor *
      material.disintegrantFactor *
      material.gelPenalty_sqrt;
    if (kind === "film") return safe(base * 1.6, 0.5);
    if (kind === "solid") return safe(base * saV_mod, 0.3);
    return safe(
      base * saV_mod * geometry.D_eff_ratio * (1 + geometry.porosity),
      0.2
    );
  })();

  // FIX Bug 6: guards for NaN/Infinity in k_KP
  const k_KP_raw =
    material.kBase *
    material.plasticizerFactor *
    material.cmcBoost *
    geometry.releaseFactor *
    geometry.thicknessFactor *
    geometry.D_eff_ratio *
    material.gelPenalty;
  const k_KP = safe(k_KP_raw, 0.05);

  const n = clamp(
    safe(
      material.nBase +
        (geometry.tpms ? 0.06 : 0) +
        (kind === "film" ? -0.05 : 0),
      0.35
    ),
    0.2,
    0.95
  );

  // FIX Bug 3: gelPenalty on burstFrac
  const burstFrac = clamp(
    material.burstBase *
      material.wettingFactor *
      (geometry.tpms ? 1.15 : 1.0) *
      material.gelPenalty,
    0,
    0.75
  );

  // FIX Bug 3: kBurst_eff applies gelPenalty (gel barrier slows even burst)
  const kBurst_denom = Math.max(
    kHyd + material.kBurst * material.gelPenalty,
    1e-6
  );
  const kBurst_eff =
    (kHyd * material.kBurst * material.gelPenalty) / kBurst_denom;

  // K-P splice at f=0.6
  let t60 = Infinity,
    lambda60 = 0;
  if (k_KP > 1e-5 && n > 0.1) {
    t60 = safe(Math.pow(0.6 / k_KP, 1 / n), Infinity);
    if (isFinite(t60) && t60 > 0) {
      const slope60 = n * k_KP * safe(Math.pow(t60, n - 1), 0);
      lambda60 = safe(slope60 / 0.4, 0.1);
    }
  }

  const M_drug = geometry.M_drug_ug ?? 0;
  const times = Array.from(
    { length: Math.floor(tEnd / dt) + 1 },
    (_, i) => i * dt
  );
  return times.map((t) => {
    if (t === 0)
      return {
        t: 0,
        release: 0,
        burst: 0,
        sustained: 0,
        hydration: 0,
        kpRegion: 1,
        absRelease: 0,
        absBurst: 0,
        absSustained: 0,
      };
    const f_burst = burstFrac * (1 - Math.exp(-kBurst_eff * t));
    const f_kp_raw = k_KP * Math.pow(t, n);
    let f_sust_norm, kpRegion;
    if (!isFinite(t60) || f_kp_raw <= 0.6) {
      f_sust_norm = Math.min(f_kp_raw, 0.6);
      kpRegion = 1;
    } else {
      const dt_past = Math.max(t - t60, 0);
      f_sust_norm = safe(1 - 0.4 * Math.exp(-lambda60 * dt_past), 0.6);
      kpRegion = 0;
    }
    const f_total = clamp(f_burst + (1 - burstFrac) * f_sust_norm, 0, 1);
    const f_sust_total = (1 - burstFrac) * f_sust_norm;
    const hydration = 1 - Math.exp(-kHyd * t);
    return {
      t: +t.toFixed(2),
      release: +(100 * f_total).toFixed(1),
      burst: +(100 * f_burst).toFixed(1),
      sustained: +(100 * f_sust_total).toFixed(1),
      hydration: +hydration.toFixed(3),
      kpRegion,
      absRelease: +(M_drug * f_total).toFixed(3),
      absBurst: +(M_drug * f_burst).toFixed(3),
      absSustained: +(M_drug * f_sust_total).toFixed(3),
    };
  });
}

function buildSim(input) {
  const material = materialModel(input);
  const geometry = geometryModel(input);
  return {
    material,
    geometry,
    release: simulateRelease({ material, geometry }),
    wicking: simulateWicking({
      geometry,
      viscosity_mPas: material.viscosity_mPas,
      surfaceTension_mNm: material.surfaceTension_mNm,
    }),
  };
}

// ═══════════════════════════════════════════════════════════════
//  TPMS 3D VISUALIZER — Three.js loaded from CDN
// ═══════════════════════════════════════════════════════════════
const TPMS_FNS = {
  tpms_gyroid: (x, y, z) =>
    Math.sin(x) * Math.cos(y) +
    Math.sin(y) * Math.cos(z) +
    Math.sin(z) * Math.cos(x),
  tpms_primitive: (x, y, z) => Math.cos(x) + Math.cos(y) + Math.cos(z),
  tpms_diamond: (x, y, z) =>
    Math.sin(x) * Math.sin(y) * Math.sin(z) +
    Math.sin(x) * Math.cos(y) * Math.cos(z) +
    Math.cos(x) * Math.sin(y) * Math.cos(z) +
    Math.cos(x) * Math.cos(y) * Math.sin(z),
  cone_tpms_core: (x, y, z) =>
    Math.sin(x) * Math.cos(y) +
    Math.sin(y) * Math.cos(z) +
    Math.sin(z) * Math.cos(x),
};

function TPMSVisualizer({ geoKey: initialGeoKey }) {
  const mountRef = useRef(null);
  const stateRef = useRef({
    clipPct: 100,
    showFlow: false,
    isDrag: false,
    prevMouse: { x: 0, y: 0 },
    animId: null,
  });
  const [vizGeoKey, setVizGeoKey] = useState(
    TPMS_FNS[initialGeoKey] ? initialGeoKey : "tpms_gyroid"
  );
  const [clipPct, setClipPct] = useState(100);
  const [showFlow, setShowFlow] = useState(false);
  const [pointCount, setPointCount] = useState(0);
  const [threeReady, setThreeReady] = useState(false);
  const sceneRef = useRef({});

  // Load Three.js from CDN once
  useEffect(() => {
    if (window.THREE) {
      setThreeReady(true);
      return;
    }
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js";
    s.onload = () => setThreeReady(true);
    document.head.appendChild(s);
  }, []);

  // Build scene whenever Three.js is ready or vizGeoKey changes
  useEffect(() => {
    if (!threeReady || !mountRef.current || !window.THREE) return;
    const THREE = window.THREE;
    const fn = TPMS_FNS[vizGeoKey];
    if (!fn) return;

    // Teardown previous scene
    const prev = sceneRef.current;
    if (prev.animId) cancelAnimationFrame(prev.animId);
    if (prev.renderer && mountRef.current.contains(prev.renderer.domElement))
      mountRef.current.removeChild(prev.renderer.domElement);
    if (prev.renderer) prev.renderer.dispose();

    const W = mountRef.current.clientWidth || 520,
      H = 400;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.localClippingEnabled = true;
    mountRef.current.appendChild(renderer.domElement);
    renderer.domElement.style.cursor = "grab";

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(48, W / H, 0.01, 200);
    camera.position.set(0, 0, 16);
    const group = new THREE.Group();
    scene.add(group);

    const N = 34,
      cells = 2,
      half = Math.PI * cells;
    const surf_pos = [],
      surf_col = [],
      pore_pos = [];
    const gDef = GEOMETRIES[vizGeoKey];
    const col = gDef?.color ?? "#818cf8";
    const rgb = [
      parseInt(col.slice(1, 3), 16) / 255,
      parseInt(col.slice(3, 5), 16) / 255,
      parseInt(col.slice(5, 7), 16) / 255,
    ];

    for (let i = 0; i < N; i++)
      for (let j = 0; j < N; j++)
        for (let k = 0; k < N; k++) {
          const x = (i / (N - 1) - 0.5) * 2 * half,
            y = (j / (N - 1) - 0.5) * 2 * half,
            z = (k / (N - 1) - 0.5) * 2 * half;
          const fv = fn(x, y, z),
            af = Math.abs(fv);
          if (af < 0.25) {
            surf_pos.push(x, y, z);
            const t = (y + half) / (2 * half);
            surf_col.push(
              rgb[0] * 0.5 + rgb[0] * 0.5 * t + af * 0.1,
              rgb[1] * 0.7 + 0.2 * (1 - t),
              rgb[2] * 0.85
            );
          }
          if (af > 0.6 && i % 3 === 0 && j % 3 === 0 && k % 3 === 0)
            pore_pos.push(x, y, z);
        }
    setPointCount(surf_pos.length / 3);

    const clipPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), half);

    const mkPoints = (pos, mat) => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      const pts = new THREE.Points(geo, mat);
      group.add(pts);
      return { geo, pts };
    };

    const surfMat = new THREE.PointsMaterial({
      size: 0.13,
      vertexColors: true,
      transparent: true,
      opacity: 0.88,
      sizeAttenuation: true,
      clippingPlanes: [clipPlane],
    });
    const surfGeo = new THREE.BufferGeometry();
    surfGeo.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(surf_pos, 3)
    );
    surfGeo.setAttribute(
      "color",
      new THREE.Float32BufferAttribute(surf_col, 3)
    );
    const surfPts = new THREE.Points(surfGeo, surfMat);
    group.add(surfPts);

    const poreMat = new THREE.PointsMaterial({
      size: 0.08,
      color: 0x22d3ee,
      transparent: true,
      opacity: 0.25,
      clippingPlanes: [clipPlane],
    });
    const poreGeo = new THREE.BufferGeometry();
    poreGeo.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(pore_pos, 3)
    );
    const porePts = new THREE.Points(poreGeo, poreMat);
    porePts.visible = false;
    group.add(porePts);

    const bbox = new THREE.LineSegments(
      new THREE.EdgesGeometry(
        new THREE.BoxGeometry(2 * half, 2 * half, 2 * half)
      ),
      new THREE.LineBasicMaterial({
        color: 0x334155,
        transparent: true,
        opacity: 0.3,
      })
    );
    group.add(bbox);

    const NFLOW = 200;
    const fa = new Float32Array(NFLOW * 3);
    for (let i = 0; i < NFLOW; i++) {
      let px,
        py,
        pz,
        tries = 0;
      do {
        px = (Math.random() - 0.5) * 2 * half;
        py = (Math.random() - 0.5) * 2 * half;
        pz = (Math.random() - 0.5) * 2 * half;
        tries++;
      } while (Math.abs(fn(px, py, pz)) < 0.5 && tries < 40);
      fa[i * 3] = px;
      fa[i * 3 + 1] = py;
      fa[i * 3 + 2] = pz;
    }
    const flowGeo = new THREE.BufferGeometry();
    flowGeo.setAttribute("position", new THREE.Float32BufferAttribute(fa, 3));
    const flowMat = new THREE.PointsMaterial({
      size: 0.22,
      color: 0x22d3ee,
      transparent: true,
      opacity: 0.8,
      clippingPlanes: [clipPlane],
    });
    const flowPts = new THREE.Points(flowGeo, flowMat);
    flowPts.visible = false;
    group.add(flowPts);

    // Mouse
    const el = renderer.domElement;
    const onDown = (e) => {
      stateRef.current.isDrag = true;
      stateRef.current.prevMouse = { x: e.clientX, y: e.clientY };
      el.style.cursor = "grabbing";
    };
    const onMove = (e) => {
      if (!stateRef.current.isDrag) return;
      const dx = e.clientX - stateRef.current.prevMouse.x,
        dy = e.clientY - stateRef.current.prevMouse.y;
      group.rotation.y += dx * 0.007;
      group.rotation.x += dy * 0.007;
      stateRef.current.prevMouse = { x: e.clientX, y: e.clientY };
    };
    const onUp = () => {
      stateRef.current.isDrag = false;
      el.style.cursor = "grab";
    };
    el.addEventListener("mousedown", onDown);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);

    const animate = () => {
      stateRef.current.animId = requestAnimationFrame(animate);
      if (!stateRef.current.isDrag) group.rotation.y += 0.004;
      clipPlane.constant = half - (stateRef.current.clipPct / 100) * 2 * half;
      const sf = stateRef.current.showFlow;
      flowPts.visible = sf;
      porePts.visible = sf;
      if (sf) {
        const p = flowGeo.attributes.position.array;
        for (let i = 0; i < NFLOW; i++) {
          p[i * 3 + 2] += 0.07;
          if (p[i * 3 + 2] > half) p[i * 3 + 2] = -half;
        }
        flowGeo.attributes.position.needsUpdate = true;
      }
      renderer.render(scene, camera);
    };
    animate();

    sceneRef.current = {
      renderer,
      animId: null,
      cleanup: () => {
        el.removeEventListener("mousedown", onDown);
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        [surfGeo, poreGeo, flowGeo].forEach((g) => g.dispose());
        [surfMat, poreMat, flowMat].forEach((m) => m.dispose());
      },
    };

    return () => {
      sceneRef.current.cleanup?.();
      cancelAnimationFrame(stateRef.current.animId);
      renderer.dispose();
      if (mountRef.current?.contains(el)) mountRef.current.removeChild(el);
    };
  }, [threeReady, vizGeoKey]);

  // Sync clip & flow into ref (no re-render of Three scene needed)
  const handleClip = (v) => {
    setClipPct(v);
    stateRef.current.clipPct = v;
  };
  const handleFlow = (v) => {
    setShowFlow(v);
    stateRef.current.showFlow = v;
  };

  const g = GEOMETRIES[vizGeoKey];

  return (
    <div
      style={{
        background: "rgba(0,0,0,0.3)",
        borderRadius: 8,
        border: `1px solid ${g?.color}30`,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          gap: 4,
          padding: "8px 10px",
          borderBottom: `1px solid ${g?.color}20`,
          flexWrap: "wrap",
        }}
      >
        {Object.keys(TPMS_FNS).map((k) => {
          const gd = GEOMETRIES[k];
          if (!gd) return null;
          return (
            <button
              key={k}
              onClick={() => setVizGeoKey(k)}
              style={{
                padding: "4px 10px",
                background:
                  vizGeoKey === k ? `${gd.color}22` : "rgba(255,255,255,0.03)",
                border: `1px solid ${
                  vizGeoKey === k ? gd.color : "rgba(255,255,255,0.08)"
                }`,
                borderRadius: 4,
                cursor: "pointer",
                color: vizGeoKey === k ? gd.color : "#64748b",
                fontSize: 9,
                fontFamily: "'Space Mono',monospace",
              }}
            >
              {gd.icon} {gd.label.replace("TPMS ", "")}
            </button>
          );
        })}
      </div>
      <div
        ref={mountRef}
        style={{ width: "100%", height: 400, background: "rgba(2,8,23,0.8)" }}
      >
        {!threeReady && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              height: "100%",
              color: "#64748b",
              fontSize: 9,
              fontFamily: "'Space Mono',monospace",
            }}
          >
            Loading Three.js...
          </div>
        )}
      </div>
      <div
        style={{
          padding: "10px 14px",
          borderTop: "1px solid rgba(255,255,255,0.06)",
          display: "flex",
          gap: 16,
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <div style={{ flex: 1, minWidth: 160 }}>
          <div
            style={{
              fontSize: 9,
              color: "#64748b",
              fontFamily: "'Space Mono',monospace",
              marginBottom: 3,
            }}
          >
            CROSS-SECTION {clipPct}%
          </div>
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={clipPct}
            onChange={(e) => handleClip(parseInt(e.target.value))}
            style={{
              width: "100%",
              accentColor: g?.color,
              height: 3,
              cursor: "pointer",
            }}
          />
        </div>
        <button
          onClick={() => handleFlow(!showFlow)}
          style={{
            padding: "5px 12px",
            background: showFlow
              ? "rgba(34,211,238,0.15)"
              : "rgba(255,255,255,0.03)",
            border: `1px solid ${
              showFlow ? "#22d3ee" : "rgba(255,255,255,0.08)"
            }`,
            borderRadius: 4,
            cursor: "pointer",
            color: showFlow ? "#22d3ee" : "#64748b",
            fontSize: 9,
            fontFamily: "'Space Mono',monospace",
          }}
        >
          {showFlow ? "◼ Hide flow" : "▶ ISF flow"}
        </button>
        <div
          style={{
            fontSize: 9,
            fontFamily: "'Space Mono',monospace",
            color: "#475569",
            lineHeight: 1.7,
          }}
        >
          <span style={{ color: g?.color }}>
            φ={((GEOMETRIES[vizGeoKey]?.porosity ?? 0) * 100).toFixed(0)}%
          </span>
          {" · "}τ={GEOMETRIES[vizGeoKey]?.tortuosity}
          {" · "}r={GEOMETRIES[vizGeoKey]?.poreRadiusUm}µm
          {" · "}
          {pointCount.toLocaleString()} pts
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
//  AI FORMULATION SUGGESTER
// ═══════════════════════════════════════════════════════════════
const AI_GOALS = [
  {
    id: "fastest",
    label: "Fastest release",
    desc: "Minimise T80, maximise burst",
  },
  {
    id: "sustained",
    label: "Sustained (≥20 min)",
    desc: "Slow kRel, minimal burst",
  },
  {
    id: "coating",
    label: "Best coating quality",
    desc: "Optimal viscosity 50–300 mPa·s",
  },
  {
    id: "tpms",
    label: "TPMS-optimised",
    desc: "Formulation for porous microneedle",
  },
];

async function callAI(params, sim, goal) {
  const mat = sim.material,
    geo = sim.geometry;
  const t80 = sim.release.find((d) => d.release >= 80)?.t ?? ">30";
  const prompt = `You are an expert pharmaceutical formulation scientist specialising in superdisintegrant films for coated microneedles.

Current formulation:
- SD: ${params.sdType} ${params.sdConc}% w/w (gel threshold: ${mat.gelThresh}%)
- HPMC: ${params.hpmcGrade} ${params.hpmcConc}% w/w
- Glycerol: ${params.glycerol}%, Tween 80: ${params.tween80}% w/v
- Drug MW: ${params.drugMW} Da, Coat thickness: ${params.coatThickUm}µm
- Geometry: ${params.geoKey}, H=${params.H}µm, R=${params.R}µm

Computed metrics:
- Viscosity: ${Math.round(
    mat.viscosity_mPas
  )} mPa·s, Surface tension: ${Math.round(mat.surfaceTension_mNm)} mN/m
- Peppas n: ${mat.nBase.toFixed(3)}, T80: ${t80} min
- D_water: ${mat.D_water.toExponential(2)} m²/s, kBurst: ${mat.kBurst} min⁻¹

Optimisation goal: ${goal}

Suggest ONE optimal formulation. Respond ONLY with raw JSON (no markdown, no backticks):
{"suggestion":{"sdType":"CCS","sdConc":3,"hpmcGrade":"E15","hpmcConc":5,"glycerol":10,"tween80":0.1,"coatThickUm":20},"reasoning":"one sentence","keyChanges":["change 1","change 2"],"expectedT80":"~X min","viscosityNote":"X mPa·s","warning":"or empty string","ref":"author et al. year"}`;

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 800,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  const data = await resp.json();
  const text =
    data.content
      ?.filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("") ?? "";
  return JSON.parse(text.replace(/```json|```/g, "").trim());
}

function AIPanel({ params, sim, onApply }) {
  const [goal, setGoal] = useState("fastest");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  const handleSuggest = async () => {
    setLoading(true);
    setError("");
    setResult(null);
    try {
      setResult(await callAI(params, sim, goal));
    } catch (e) {
      setError("API error: " + e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <div
        style={{
          fontSize: 9,
          color: "#475569",
          fontFamily: "'Space Mono',monospace",
          letterSpacing: "0.1em",
          marginBottom: 10,
        }}
      >
        ◈ OPTIMISATION GOAL
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 5,
          marginBottom: 14,
        }}
      >
        {AI_GOALS.map((g) => (
          <button
            key={g.id}
            onClick={() => setGoal(g.id)}
            style={{
              background:
                goal === g.id
                  ? "rgba(56,189,248,0.12)"
                  : "rgba(255,255,255,0.02)",
              border: `1px solid ${
                goal === g.id ? "#38bdf8" : "rgba(255,255,255,0.07)"
              }`,
              borderRadius: 5,
              padding: "7px 10px",
              cursor: "pointer",
              textAlign: "left",
            }}
          >
            <div
              style={{
                fontSize: 10,
                color: goal === g.id ? "#38bdf8" : "#94a3b8",
                fontWeight: 500,
              }}
            >
              {g.label}
            </div>
            <div style={{ fontSize: 8, color: "#475569", marginTop: 1 }}>
              {g.desc}
            </div>
          </button>
        ))}
      </div>
      <button
        onClick={handleSuggest}
        disabled={loading}
        style={{
          width: "100%",
          padding: "10px",
          marginBottom: 14,
          background: loading
            ? "rgba(56,189,248,0.06)"
            : "rgba(56,189,248,0.15)",
          border: "1px solid #38bdf8",
          borderRadius: 6,
          cursor: loading ? "default" : "pointer",
          color: "#38bdf8",
          fontSize: 11,
          fontFamily: "'Space Mono',monospace",
          fontWeight: 700,
          letterSpacing: "0.08em",
        }}
      >
        {loading ? "⏳  ANALYSING FORMULATION..." : "⬡  GET AI SUGGESTION"}
      </button>
      {error && (
        <div
          style={{
            color: "#f87171",
            fontSize: 9,
            fontFamily: "'Space Mono',monospace",
            padding: 8,
            background: "rgba(248,113,113,0.08)",
            border: "1px solid rgba(248,113,113,0.2)",
            borderRadius: 4,
            marginBottom: 10,
          }}
        >
          {error}
        </div>
      )}
      {result && (
        <div
          style={{
            background: "rgba(56,189,248,0.04)",
            border: "1px solid rgba(56,189,248,0.15)",
            borderRadius: 7,
            padding: 14,
          }}
        >
          <div
            style={{
              fontSize: 10,
              color: "#38bdf8",
              fontFamily: "'Space Mono',monospace",
              fontWeight: 700,
              marginBottom: 8,
            }}
          >
            ⬡ SUGGESTED FORMULATION
          </div>
          <div
            style={{
              fontSize: 10,
              color: "#94a3b8",
              lineHeight: 1.8,
              marginBottom: 10,
            }}
          >
            {result.reasoning}
          </div>
          <div style={{ marginBottom: 10 }}>
            {(result.keyChanges || []).map((c, i) => (
              <div
                key={i}
                style={{
                  fontSize: 9,
                  color: "#22c55e",
                  fontFamily: "'Space Mono',monospace",
                  marginBottom: 2,
                }}
              >
                ↑ {c}
              </div>
            ))}
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr 1fr",
              gap: 6,
              marginBottom: 10,
            }}
          >
            {[
              ["Expected T80", result.expectedT80 ?? "–"],
              ["Viscosity", result.viscosityNote ?? "–"],
              ["Reference", result.ref ?? "–"],
            ].map(([k, v]) => (
              <div
                key={k}
                style={{
                  background: "rgba(255,255,255,0.03)",
                  borderRadius: 4,
                  padding: "6px 8px",
                  border: "1px solid rgba(255,255,255,0.07)",
                }}
              >
                <div
                  style={{
                    fontSize: 8,
                    color: "#64748b",
                    fontFamily: "'Space Mono',monospace",
                  }}
                >
                  {k}
                </div>
                <div style={{ fontSize: 10, color: "#e2e8f0", marginTop: 2 }}>
                  {v}
                </div>
              </div>
            ))}
          </div>
          {result.warning && (
            <div
              style={{
                fontSize: 9,
                color: "#f97316",
                fontFamily: "'Space Mono',monospace",
                padding: "6px 8px",
                background: "rgba(249,115,22,0.08)",
                borderRadius: 4,
                marginBottom: 10,
              }}
            >
              ⚠ {result.warning}
            </div>
          )}
          {result.suggestion && (
            <button
              onClick={() => onApply(result.suggestion)}
              style={{
                width: "100%",
                padding: "8px",
                background: "rgba(34,197,94,0.15)",
                border: "1px solid #22c55e",
                borderRadius: 5,
                cursor: "pointer",
                color: "#22c55e",
                fontSize: 10,
                fontFamily: "'Space Mono',monospace",
                fontWeight: 700,
              }}
            >
              ✓ APPLY SUGGESTION TO SIMULATOR
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
//  SMALL UI ATOMS
// ═══════════════════════════════════════════════════════════════
const SLOT_COLORS = ["#38bdf8", "#f97316", "#a78bfa"];
const nMech = (n) =>
  n <= 0.45
    ? { t: "Fickian", c: "#22c55e" }
    : n <= 0.89
    ? { t: "Anomalous", c: "#f97316" }
    : { t: "Case II", c: "#ef4444" };

const Chip = ({ label, value, unit, sub, color = "#38bdf8", warn }) => (
  <div
    style={{
      background: "rgba(255,255,255,0.03)",
      borderLeft: `3px solid ${warn ? "#ef4444" : color}`,
      border: "1px solid rgba(255,255,255,0.06)",
      borderRadius: 6,
      padding: "8px 10px",
      flex: "1 1 90px",
      minWidth: 90,
    }}
  >
    <div
      style={{
        fontSize: 8,
        color: "#64748b",
        fontFamily: "'Space Mono',monospace",
      }}
    >
      {label}
    </div>
    <div
      style={{
        fontSize: 15,
        fontFamily: "'Space Mono',monospace",
        color: warn ? "#ef4444" : color,
        fontWeight: 700,
        lineHeight: 1.2,
      }}
    >
      {value}
      <span style={{ fontSize: 9, color: "#94a3b8", marginLeft: 2 }}>
        {unit}
      </span>
    </div>
    {sub && (
      <div
        style={{
          fontSize: 8,
          color: warn ? "#f87171" : "#64748b",
          marginTop: 1,
        }}
      >
        {sub}
      </div>
    )}
  </div>
);

const Slab = ({ label, value, min, max, step, unit, onChange, info, warn }) => (
  <div style={{ marginBottom: 9 }}>
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        marginBottom: 2,
      }}
    >
      <span
        style={{
          fontSize: 8,
          color: "#64748b",
          fontFamily: "'Space Mono',monospace",
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: 10,
          fontFamily: "'Space Mono',monospace",
          color: warn ? "#f97316" : "#e2e8f0",
          fontWeight: 600,
        }}
      >
        {value}
        {unit}
        {warn && (
          <span style={{ color: "#f97316", fontSize: 7, marginLeft: 3 }}>
            ⚠{warn}
          </span>
        )}
      </span>
    </div>
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(parseFloat(e.target.value))}
      style={{
        width: "100%",
        accentColor: "#38bdf8",
        height: 3,
        cursor: "pointer",
      }}
    />
    {info && (
      <div
        style={{
          fontSize: 7,
          color: "#475569",
          marginTop: 1,
          fontStyle: "italic",
        }}
      >
        {info}
      </div>
    )}
  </div>
);

const SL = ({ children }) => (
  <div
    style={{
      fontSize: 8,
      color: "#475569",
      letterSpacing: "0.12em",
      fontFamily: "'Space Mono',monospace",
      marginBottom: 6,
      marginTop: 2,
    }}
  >
    ◈ {children}
  </div>
);
const Tab = ({ active, onClick, children, color = "#38bdf8" }) => (
  <button
    onClick={onClick}
    style={{
      padding: "5px 11px",
      cursor: "pointer",
      fontSize: 9,
      fontFamily: "'Space Mono',monospace",
      letterSpacing: "0.05em",
      borderRadius: 4,
      transition: "all 0.12s",
      background: active ? `${color}14` : "rgba(255,255,255,0.02)",
      border: `1px solid ${active ? color : "rgba(255,255,255,0.07)"}`,
      color: active ? color : "#64748b",
    }}
  >
    {children}
  </button>
);
const TT = ({ active, payload, label, unit = "%" }) => {
  if (!active || !payload?.length) return null;
  return (
    <div
      style={{
        background: "#0f172a",
        border: "1px solid #1e3a5f",
        borderRadius: 5,
        padding: "6px 10px",
        fontSize: 9,
        fontFamily: "'Space Mono',monospace",
      }}
    >
      <div style={{ color: "#64748b", marginBottom: 2 }}>t={label} min</div>
      {payload.map((p) => (
        <div key={p.dataKey || p.name} style={{ color: p.color || p.stroke }}>
          {p.name}:{" "}
          <strong>
            {p.value}
            {unit}
          </strong>
        </div>
      ))}
    </div>
  );
};

const HPMC_OPTS = {
  E5: "E5 (5mPa·s)",
  E15: "E15 (15mPa·s)",
  E50: "E50 (50mPa·s)",
  K4M: "K4M (4000mPa·s)",
};
const SD_COLORS = { SSG: "#f97316", CCS: "#06b6d4", PVPP: "#a78bfa" };

const DEFAULT_FORM = {
  sdType: "CCS",
  sdConc: 1,
  hpmcGrade: "E15",
  hpmcConc: 5,
  glycerol: 1,
  tween80: 0.1,
  drugMW: 300,
  coatThickUm: 20,
  geoKey: "conical",
  H: 600,
  R: 150,
};

// ═══════════════════════════════════════════════════════════════
//  FORMULATION CONTROLS (shared for single + compare modes)
// ═══════════════════════════════════════════════════════════════
function FormControls({ form, onChange }) {
  const F = (k, v) => onChange({ ...form, [k]: v });
  const gelWarn =
    form.sdConc > (form.sdType === "SSG" ? 8 : form.sdType === "CCS" ? 5 : 99);
  const arWarn = form.H / form.R < 2;
  const mat = useMemo(() => materialModel(form), [form]);
  const viscWarn =
    mat.viscosity_mPas > 1200 ? "Thick" : mat.viscosity_mPas < 15 ? "Thin" : "";

  return (
    <div style={{ padding: "12px 10px", overflowY: "auto", height: "100%" }}>
      <SL>GEOMETRY</SL>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 3,
          marginBottom: 8,
        }}
      >
        {Object.entries(GEOMETRIES).map(([k, g]) => (
          <button
            key={k}
            onClick={() => F("geoKey", k)}
            style={{
              background:
                form.geoKey === k ? `${g.color}18` : "rgba(255,255,255,0.02)",
              border: `1px solid ${
                form.geoKey === k ? g.color : "rgba(255,255,255,0.06)"
              }`,
              borderRadius: 4,
              padding: "4px 5px",
              textAlign: "left",
              cursor: "pointer",
              color: form.geoKey === k ? g.color : "#64748b",
              fontSize: 8,
              fontFamily: "'Space Mono',monospace",
              transition: "all 0.12s",
            }}
          >
            <span style={{ fontSize: 11, display: "block", marginBottom: 1 }}>
              {g.icon}
            </span>
            {g.label}
          </button>
        ))}
      </div>
      <Slab
        label="HEIGHT H"
        value={form.H}
        min={200}
        max={1500}
        step={25}
        unit="µm"
        onChange={(v) => F("H", v)}
        info="300–900µm typical"
      />
      <Slab
        label="BASE RADIUS R"
        value={form.R}
        min={30}
        max={300}
        step={5}
        unit="µm"
        onChange={(v) => F("R", v)}
        warn={arWarn ? "AR<2" : ""}
        info={`AR=${(form.H / form.R).toFixed(1)}`}
      />
      <Slab
        label="COAT THICKNESS L"
        value={form.coatThickUm}
        min={5}
        max={80}
        step={5}
        unit="µm"
        onChange={(v) => F("coatThickUm", v)}
        info="k_KP ∝ 1/L² (capped ×4)"
      />
      <div
        style={{
          height: 1,
          background: "rgba(255,255,255,0.06)",
          margin: "8px 0",
        }}
      />
      <SL>SUPERDISINTEGRANT</SL>
      <div style={{ display: "flex", gap: 3, marginBottom: 6 }}>
        {["SSG", "CCS", "PVPP"].map((s) => (
          <button
            key={s}
            onClick={() => F("sdType", s)}
            style={{
              flex: 1,
              padding: "4px 0",
              background:
                form.sdType === s
                  ? `${SD_COLORS[s]}18`
                  : "rgba(255,255,255,0.02)",
              border: `1px solid ${
                form.sdType === s ? SD_COLORS[s] : "rgba(255,255,255,0.06)"
              }`,
              borderRadius: 3,
              cursor: "pointer",
              color: form.sdType === s ? SD_COLORS[s] : "#64748b",
              fontSize: 9,
              fontFamily: "'Space Mono',monospace",
              fontWeight: 700,
            }}
          >
            {s}
          </button>
        ))}
      </div>
      <Slab
        label="SD CONC"
        value={form.sdConc}
        min={0.5}
        max={12}
        step={0.5}
        unit="% w/w"
        onChange={(v) => F("sdConc", v)}
        warn={gelWarn ? "Gel barrier" : ""}
      />
      <div
        style={{
          height: 1,
          background: "rgba(255,255,255,0.06)",
          margin: "8px 0",
        }}
      />
      <SL>FILM FORMER</SL>
      <select
        value={form.hpmcGrade}
        onChange={(e) => F("hpmcGrade", e.target.value)}
        style={{
          width: "100%",
          background: "rgba(255,255,255,0.04)",
          border: "1px solid rgba(56,189,248,0.18)",
          borderRadius: 4,
          color: "#e2e8f0",
          padding: "5px 7px",
          fontSize: 8,
          fontFamily: "'Space Mono',monospace",
          marginBottom: 6,
          cursor: "pointer",
          WebkitAppearance: "none",
        }}
      >
        {Object.entries(HPMC_OPTS).map(([k, v]) => (
          <option key={k} value={k} style={{ background: "#0a1628" }}>
            {v}
          </option>
        ))}
      </select>
      <Slab
        label="HPMC CONC"
        value={form.hpmcConc}
        min={1}
        max={20}
        step={0.5}
        unit="% w/w"
        onChange={(v) => F("hpmcConc", v)}
        warn={viscWarn}
        info={`η=${Math.round(
          mat.viscosity_mPas
        )}mPa·s · D_w=${mat.D_water.toExponential(1)}m²/s`}
      />
      <div
        style={{
          height: 1,
          background: "rgba(255,255,255,0.06)",
          margin: "8px 0",
        }}
      />
      <SL>EXCIPIENTS + DRUG</SL>
      <Slab
        label="GLYCEROL"
        value={form.glycerol}
        min={0}
        max={40}
        step={1}
        unit="% w/w"
        onChange={(v) => F("glycerol", v)}
        warn={form.glycerol > 30 ? "Tacky" : ""}
      />
      <Slab
        label="TWEEN 80"
        value={form.tween80}
        min={0}
        max={2}
        step={0.05}
        unit="% w/v"
        onChange={(v) => F("tween80", v)}
        info={form.tween80 > 0.0017 ? "▲ CMC crossed" : "▼ wetting only"}
      />
      <Slab
        label="DRUG MW"
        value={form.drugMW}
        min={50}
        max={600}
        step={25}
        unit="Da"
        onChange={(v) => F("drugMW", v)}
        info="n-shift (Peppas-Reinhart)"
      />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
//  MAIN APP
// ═══════════════════════════════════════════════════════════════
export default function SimV5() {
  const [tab, setTab] = useState("sim"); // sim | compare | tpms | ai
  const [form, setForm] = useState({ ...DEFAULT_FORM });
  const [slots, setSlots] = useState([
    { ...DEFAULT_FORM, label: "A" },
    {
      ...DEFAULT_FORM,
      sdType: "SSG",
      sdConc: 4,
      hpmcGrade: "E5",
      hpmcConc: 3,
      label: "B",
    },
    { ...DEFAULT_FORM, sdType: "PVPP", sdConc: 2, glycerol: 15, label: "C" },
  ]);
  const [activeSlot, setActiveSlot] = useState(0);
  const [showBurst, setShowBurst] = useState(true);
  const [showSust, setShowSust] = useState(true);
  const [showHyd, setShowHyd] = useState(false);
  const [chartMode, setChartMode] = useState("area"); // area | line

  const [absMode, setAbsMode] = useState(false);
  const [drugLoad, setDrugLoad] = useState(30);
  const sim = useMemo(
    () => buildSim({ ...form, drugLoadFrac: drugLoad / 100 }),
    [form, drugLoad]
  );
  const conicalRef = useMemo(
    () =>
      geometryModel({
        geoKey: "conical",
        H: form.H,
        R: form.R,
        coatThickUm: form.coatThickUm,
        drugLoadFrac: drugLoad / 100,
      }),
    [form.H, form.R, form.coatThickUm, drugLoad]
  );
  const slotSims = useMemo(
    () => slots.map((s) => buildSim({ ...s, drugLoadFrac: drugLoad / 100 })),
    [slots, drugLoad]
  );

  const {
    material: mat,
    geometry: geo,
    release: relData,
    wicking: wickData,
  } = sim;
  const gDef = GEOMETRIES[form.geoKey];
  const effN = clamp(
    mat.nBase + (geo.tpms ? 0.06 : 0) + (geo.kind === "film" ? -0.05 : 0),
    0.2,
    0.95
  );
  const mech = nMech(effN);
  const t80 = relData.find((d) => d.release >= 80)?.t ?? ">30";
  const t50 = relData.find((d) => d.release >= 50)?.t ?? ">30";
  const t60pt = relData.find((d) => d.kpRegion === 0);
  const w5 = wickData.find((d) => d.t >= 5);

  // Compare: merge release data
  const compareData = useMemo(() => {
    const len = slotSims[0].release.length;
    return Array.from({ length: len }, (_, i) => ({
      t: slotSims[0].release[i].t,
      A: slotSims[0].release[i].release,
      B: slotSims[1].release[i].release,
      C: slotSims[2].release[i].release,
      A_ug: slotSims[0].release[i].absRelease,
      B_ug: slotSims[1].release[i].absRelease,
      C_ug: slotSims[2].release[i].absRelease,
    }));
  }, [slotSims]);

  const applyAISuggestion = useCallback((s) => {
    setForm((f) => ({ ...f, ...s }));
    setTab("sim");
  }, []);

  return (
    <div
      style={{
        minHeight: "100vh",
        background:
          "linear-gradient(155deg,#020817 0%,#071020 55%,#0d1a2e 100%)",
        color: "#e2e8f0",
        fontFamily: "'DM Sans',sans-serif",
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=DM+Sans:wght@300;400;500;600&family=Bebas+Neue&display=swap');
        *{box-sizing:border-box}
        input[type=range]{-webkit-appearance:none;appearance:none;background:rgba(56,189,248,0.10);border-radius:2px}
        input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:11px;height:11px;border-radius:50%;background:#38bdf8;cursor:pointer}
        ::-webkit-scrollbar{width:3px}::-webkit-scrollbar-thumb{background:#1e3a5f;border-radius:2px}
        button{border:none;outline:none}
      `}</style>

      {/* HEADER */}
      <div
        style={{
          background: "rgba(56,189,248,0.03)",
          borderBottom: "1px solid rgba(56,189,248,0.09)",
          padding: "11px 20px",
          display: "flex",
          alignItems: "center",
          gap: 12,
        }}
      >
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: 6,
            background: "linear-gradient(135deg,#0ea5e9,#8b5cf6,#ec4899)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 14,
          }}
        >
          ⬡
        </div>
        <div>
          <div
            style={{
              fontFamily: "'Bebas Neue',sans-serif",
              fontSize: 17,
              letterSpacing: "0.1em",
            }}
          >
            SD FILM · MICRONEEDLE SIMULATOR&nbsp;
            <span
              style={{
                fontSize: 10,
                color: "#334155",
                fontFamily: "'Space Mono',monospace",
              }}
            >
              v5
            </span>
          </div>
          <div
            style={{
              fontSize: 8,
              color: "#64748b",
              fontFamily: "'Space Mono',monospace",
            }}
          >
            True K-P · Millington-Quirk · SD-specific kBurst ·
            D_water(grade,conc) · 3-way compare · TPMS 3D viz · AI suggest
          </div>
        </div>
        {/* Top-level nav */}
        <div style={{ marginLeft: "auto", display: "flex", gap: 5 }}>
          {[
            ["sim", "▶ Simulator"],
            ["compare", "⇌ Compare"],
            ["tpms", "⬡ TPMS Viz"],
            ["ai", "⬡ AI Suggest"],
          ].map(([k, l]) => (
            <Tab key={k} active={tab === k} onClick={() => setTab(k)}>
              {l}
            </Tab>
          ))}
        </div>
      </div>

      <div style={{ display: "flex", minHeight: "calc(100vh - 56px)" }}>
        {/* ══ LEFT PANEL ══ */}
        <div
          style={{
            width: 272,
            minWidth: 272,
            borderRight: "1px solid rgba(56,189,248,0.07)",
            overflowY: "auto",
          }}
        >
          {tab === "compare" ? (
            <div>
              <div
                style={{
                  display: "flex",
                  gap: 0,
                  borderBottom: "1px solid rgba(255,255,255,0.06)",
                }}
              >
                {slots.map((s, i) => (
                  <button
                    key={i}
                    onClick={() => setActiveSlot(i)}
                    style={{
                      flex: 1,
                      padding: "8px",
                      background:
                        activeSlot === i
                          ? `${SLOT_COLORS[i]}14`
                          : "transparent",
                      border: "none",
                      borderBottom:
                        activeSlot === i
                          ? `2px solid ${SLOT_COLORS[i]}`
                          : "2px solid transparent",
                      cursor: "pointer",
                      color: activeSlot === i ? SLOT_COLORS[i] : "#64748b",
                      fontSize: 12,
                      fontFamily: "'Space Mono',monospace",
                      fontWeight: 700,
                    }}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
              <FormControls
                form={slots[activeSlot]}
                onChange={(s) =>
                  setSlots((prev) => {
                    const n = [...prev];
                    n[activeSlot] = s;
                    return n;
                  })
                }
              />
            </div>
          ) : (
            <FormControls form={form} onChange={setForm} />
          )}
        </div>

        {/* ══ RIGHT PANEL ══ */}
        <div style={{ flex: 1, padding: "16px 18px", overflowY: "auto" }}>
          {/* ── SIMULATOR TAB ── */}
          {tab === "sim" && (
            <>
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 6,
                  marginBottom: 8,
                }}
              >
                <Chip
                  label="VISCOSITY"
                  value={
                    mat.viscosity_mPas > 9999
                      ? ">10k"
                      : Math.round(mat.viscosity_mPas)
                  }
                  unit="mPa·s"
                  sub="coating solution"
                  warn={mat.viscosity_mPas > 1200 || mat.viscosity_mPas < 15}
                  color="#38bdf8"
                />
                <Chip
                  label="γ"
                  value={Math.round(mat.surfaceTension_mNm * 10) / 10}
                  unit="mN/m"
                  sub={mat.aboveCMC ? "Above CMC" : "Below CMC"}
                  color="#22c55e"
                />
                <Chip
                  label="D_water"
                  value={mat.D_water.toExponential(1)}
                  unit="m²/s"
                  sub={`${form.hpmcGrade} ${form.hpmcConc}%`}
                  color="#22d3ee"
                />
                <Chip
                  label="n (Peppas)"
                  value={effN.toFixed(3)}
                  unit=""
                  sub={mech.t}
                  color={mech.c}
                />
                <Chip
                  label="T₅₀"
                  value={t50}
                  unit={typeof t50 === "number" ? "min" : ""}
                  sub="50% release"
                  color="#fbbf24"
                />
                <Chip
                  label="T₈₀"
                  value={t80}
                  unit={typeof t80 === "number" ? "min" : ""}
                  sub="80% release"
                  color="#f97316"
                  warn={typeof t80 === "number" && t80 > 20}
                />
                <Chip
                  label="WICK 5s"
                  value={Math.round(w5?.manuf ?? 0)}
                  unit="µm"
                  sub="manuf. up shaft"
                  color="#f87171"
                  warn={(w5?.manuf ?? 0) > 100}
                />
                <Chip
                  label="M_drug / needle"
                  value={geo.M_drug_ug?.toFixed(2) ?? "-"}
                  unit="µg"
                  sub={`coat ${geo.M_coat_ug?.toFixed(2) ?? "-"}µg · ×${
                    geo.volumeFactor?.toFixed(2) ?? 1
                  }`}
                  color="#818cf8"
                />
                <Chip
                  label="SA (coat surface)"
                  value={(geo.SA_base_um2 / 1e6)?.toFixed(1) ?? "-"}
                  unit="×10⁶µm²"
                  sub={`L=${form.coatThickUm}µm · ${
                    form.drugLoad ?? 30
                  }%w/w drug`}
                  color="#34d399"
                />
              </div>
              {/* Drug loading slider inline */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  marginBottom: 10,
                  padding: "6px 10px",
                  background: "rgba(129,140,248,0.06)",
                  border: "1px solid rgba(129,140,248,0.18)",
                  borderRadius: 5,
                }}
              >
                <span
                  style={{
                    fontSize: 8,
                    color: "#818cf8",
                    fontFamily: "'Space Mono',monospace",
                    whiteSpace: "nowrap",
                  }}
                >
                  DRUG LOADING
                </span>
                <input
                  type="range"
                  min={5}
                  max={60}
                  step={5}
                  value={drugLoad}
                  onChange={(e) => setDrugLoad(parseInt(e.target.value))}
                  style={{
                    flex: 1,
                    accentColor: "#818cf8",
                    height: 3,
                    cursor: "pointer",
                  }}
                />
                <span
                  style={{
                    fontSize: 10,
                    color: "#818cf8",
                    fontFamily: "'Space Mono',monospace",
                    fontWeight: 700,
                    minWidth: 36,
                  }}
                >
                  {drugLoad}% w/w
                </span>
                <span
                  style={{
                    fontSize: 8,
                    color: "#475569",
                    fontFamily: "'Space Mono',monospace",
                  }}
                >
                  M_drug={geo.M_drug_ug?.toFixed(2) ?? "-"}µg/needle
                </span>
              </div>

              <div
                style={{
                  display: "flex",
                  gap: 6,
                  marginBottom: 10,
                  flexWrap: "wrap",
                  alignItems: "center",
                }}
              >
                <Tab
                  active={chartMode === "area"}
                  onClick={() => setChartMode("area")}
                >
                  % Released
                </Tab>
                <Tab
                  active={chartMode === "abs"}
                  onClick={() => setChartMode("abs")}
                  color="#818cf8"
                >
                  µg Released
                </Tab>
                <Tab
                  active={chartMode === "wicking"}
                  onClick={() => setChartMode("wicking")}
                >
                  Wicking
                </Tab>
                <div
                  style={{
                    width: 1,
                    background: "rgba(255,255,255,0.07)",
                    margin: "0 3px",
                  }}
                />
                {[
                  ["Burst", "#f97316", showBurst, setShowBurst],
                  ["Sustained", "#a78bfa", showSust, setShowSust],
                  ["Hydration", "#22c55e", showHyd, setShowHyd],
                ].map(([l, c, s, set]) => (
                  <button
                    key={l}
                    onClick={() => set((v) => !v)}
                    style={{
                      padding: "3px 8px",
                      background: s ? `${c}14` : "rgba(255,255,255,0.02)",
                      border: `1px solid ${s ? c : "rgba(255,255,255,0.06)"}`,
                      borderRadius: 4,
                      cursor: "pointer",
                      color: s ? c : "#475569",
                      fontSize: 8,
                      fontFamily: "'Space Mono',monospace",
                      transition: "all 0.12s",
                    }}
                  >
                    {l}
                  </button>
                ))}
              </div>

              {chartMode === "area" && (
                <div
                  style={{
                    background: "rgba(255,255,255,0.02)",
                    border: "1px solid rgba(56,189,248,0.08)",
                    borderRadius: 7,
                    padding: "12px 10px",
                    marginBottom: 12,
                  }}
                >
                  <div
                    style={{
                      fontSize: 8,
                      color: "#475569",
                      fontFamily: "'Space Mono',monospace",
                      marginBottom: 8,
                      letterSpacing: "0.07em",
                      lineHeight: 1.6,
                    }}
                  >
                    CUMULATIVE RELEASE · {gDef.icon} {gDef.label} · K-P f=k·tⁿ
                    (solid) → 1st-order continuation (dashed at{" "}
                    {t60pt ? `t=${t60pt.t}min` : "no splice in window"})
                    {` · n=${effN.toFixed(3)} · T₅₀=${t50}${
                      typeof t50 === "number" ? "min" : ""
                    } · T₈₀=${t80}${typeof t80 === "number" ? "min" : ""}`}
                  </div>
                  <ResponsiveContainer width="100%" height={270}>
                    <AreaChart
                      data={relData}
                      margin={{ top: 4, right: 10, left: 0, bottom: 14 }}
                    >
                      <defs>
                        <linearGradient id="gR" x1="0" y1="0" x2="0" y2="1">
                          <stop
                            offset="5%"
                            stopColor="#38bdf8"
                            stopOpacity={0.2}
                          />
                          <stop
                            offset="95%"
                            stopColor="#38bdf8"
                            stopOpacity={0}
                          />
                        </linearGradient>
                      </defs>
                      <CartesianGrid
                        strokeDasharray="2 4"
                        stroke="rgba(255,255,255,0.04)"
                      />
                      <XAxis
                        dataKey="t"
                        stroke="#334155"
                        tick={{
                          fill: "#475569",
                          fontSize: 8,
                          fontFamily: "Space Mono",
                        }}
                        label={{
                          value: "Time (min)",
                          position: "insideBottom",
                          offset: -4,
                          fill: "#475569",
                          fontSize: 8,
                        }}
                      />
                      <YAxis
                        domain={[0, 100]}
                        stroke="#334155"
                        tick={{
                          fill: "#475569",
                          fontSize: 8,
                          fontFamily: "Space Mono",
                        }}
                        label={{
                          value: "% Released",
                          angle: -90,
                          position: "insideLeft",
                          fill: "#475569",
                          fontSize: 8,
                        }}
                      />
                      <Tooltip content={<TT />} />
                      <ReferenceLine
                        y={80}
                        stroke="rgba(248,113,113,0.20)"
                        strokeDasharray="4 3"
                        label={{
                          value: "80%",
                          fill: "#ef4444",
                          fontSize: 7,
                          fontFamily: "Space Mono",
                        }}
                      />
                      {t60pt && (
                        <ReferenceLine
                          x={t60pt.t}
                          stroke="rgba(250,191,36,0.25)"
                          strokeDasharray="3 3"
                          label={{
                            value: "K-P→",
                            fill: "#fbbf24",
                            fontSize: 7,
                            fontFamily: "Space Mono",
                          }}
                        />
                      )}
                      <Area
                        type="monotone"
                        dataKey="release"
                        name="Total"
                        stroke="#38bdf8"
                        strokeWidth={2}
                        fill="url(#gR)"
                        dot={false}
                      />
                      {showBurst && (
                        <Line
                          type="monotone"
                          dataKey="burst"
                          name="Burst"
                          stroke="#f97316"
                          strokeWidth={1.5}
                          dot={false}
                          strokeDasharray="4 2"
                        />
                      )}
                      {showSust && (
                        <Line
                          type="monotone"
                          dataKey="sustained"
                          name="Sustained"
                          stroke="#a78bfa"
                          strokeWidth={1.5}
                          dot={false}
                          strokeDasharray="2 2"
                        />
                      )}
                      {showHyd && (
                        <Line
                          type="monotone"
                          dataKey="hydration"
                          name="Hydration"
                          stroke="#22c55e"
                          strokeWidth={1}
                          dot={false}
                          strokeDasharray="1 2"
                        />
                      )}
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}

              {chartMode === "abs" && (
                <div
                  style={{
                    background: "rgba(129,140,248,0.04)",
                    border: "1px solid rgba(129,140,248,0.18)",
                    borderRadius: 7,
                    padding: "12px 10px",
                    marginBottom: 12,
                  }}
                >
                  <div
                    style={{
                      fontSize: 8,
                      color: "#818cf8",
                      fontFamily: "'Space Mono',monospace",
                      marginBottom: 4,
                      letterSpacing: "0.07em",
                      lineHeight: 1.8,
                    }}
                  >
                    ABSOLUTE DRUG MASS RELEASED · µg per needle · {gDef.icon}{" "}
                    {gDef.label}
                    {" · "}M_drug={geo.M_drug_ug?.toFixed(2) ?? "-"}µg (
                    {drugLoad}%w/w drug in {geo.M_coat_ug?.toFixed(2) ?? "-"}µg
                    coat)
                    {" · "}SA={((geo.SA_base_um2 ?? 0) / 1e6).toFixed(1)}×10⁶µm²
                    · volumeFactor=×{geo.volumeFactor?.toFixed(2) ?? 1}
                    {geo.saEvolution === "increase_then_decrease" &&
                      " · ⚠ TPMS: SA(t) increases before decreasing (crevice pooling)"}
                  </div>
                  <div
                    style={{
                      fontSize: 8,
                      color: "#334155",
                      fontFamily: "'Space Mono',monospace",
                      marginBottom: 10,
                      padding: "5px 8px",
                      background: "rgba(129,140,248,0.08)",
                      borderRadius: 4,
                      lineHeight: 1.7,
                    }}
                  >
                    Why this matters: at {form.coatThickUm}µm coat thickness, a{" "}
                    {gDef.label} needle holds {geo.M_drug_ug?.toFixed(2) ?? "-"}
                    µg drug vs {conicalRef.M_drug_ug.toFixed(2)}µg for a conical
                    reference (same H, R, L). 60% release delivers{" "}
                    {((geo.M_drug_ug ?? 0) * 0.6).toFixed(2)}µg vs{" "}
                    {(conicalRef.M_drug_ug * 0.6).toFixed(2)}µg from conical —
                    the same "60%" hides a{" "}
                    {((geo.M_drug_ug ?? 0) / conicalRef.M_drug_ug || 1).toFixed(
                      1
                    )}
                    × difference in delivered dose.
                  </div>
                  <ResponsiveContainer width="100%" height={270}>
                    <AreaChart
                      data={relData}
                      margin={{ top: 4, right: 10, left: 0, bottom: 14 }}
                    >
                      <defs>
                        <linearGradient id="gAbs" x1="0" y1="0" x2="0" y2="1">
                          <stop
                            offset="5%"
                            stopColor="#818cf8"
                            stopOpacity={0.22}
                          />
                          <stop
                            offset="95%"
                            stopColor="#818cf8"
                            stopOpacity={0}
                          />
                        </linearGradient>
                      </defs>
                      <CartesianGrid
                        strokeDasharray="2 4"
                        stroke="rgba(255,255,255,0.04)"
                      />
                      <XAxis
                        dataKey="t"
                        stroke="#334155"
                        tick={{
                          fill: "#475569",
                          fontSize: 8,
                          fontFamily: "Space Mono",
                        }}
                        label={{
                          value: "Time (min)",
                          position: "insideBottom",
                          offset: -4,
                          fill: "#475569",
                          fontSize: 8,
                        }}
                      />
                      <YAxis
                        stroke="#334155"
                        tick={{
                          fill: "#475569",
                          fontSize: 8,
                          fontFamily: "Space Mono",
                        }}
                        label={{
                          value: "Drug released (µg)",
                          angle: -90,
                          position: "insideLeft",
                          fill: "#818cf8",
                          fontSize: 8,
                        }}
                        domain={[0, (d) => Math.ceil(d * 1.1 * 10) / 10]}
                      />
                      <Tooltip content={<TT unit=" µg" />} />
                      <ReferenceLine
                        y={+(geo.M_drug_ug * 0.8).toFixed(3)}
                        stroke="rgba(248,113,113,0.22)"
                        strokeDasharray="4 3"
                        label={{
                          value: "80% dose",
                          fill: "#ef4444",
                          fontSize: 7,
                          fontFamily: "Space Mono",
                        }}
                      />
                      {t60pt && (
                        <ReferenceLine
                          x={t60pt.t}
                          stroke="rgba(250,191,36,0.25)"
                          strokeDasharray="3 3"
                          label={{
                            value: "K-P→",
                            fill: "#fbbf24",
                            fontSize: 7,
                            fontFamily: "Space Mono",
                          }}
                        />
                      )}
                      <Area
                        type="monotone"
                        dataKey="absRelease"
                        name="Total (µg)"
                        stroke="#818cf8"
                        strokeWidth={2}
                        fill="url(#gAbs)"
                        dot={false}
                      />
                      {showBurst && (
                        <Line
                          type="monotone"
                          dataKey="absBurst"
                          name="Burst (µg)"
                          stroke="#f97316"
                          strokeWidth={1.5}
                          dot={false}
                          strokeDasharray="4 2"
                        />
                      )}
                      {showSust && (
                        <Line
                          type="monotone"
                          dataKey="absSustained"
                          name="Sustained (µg)"
                          stroke="#a78bfa"
                          strokeWidth={1.5}
                          dot={false}
                          strokeDasharray="2 2"
                        />
                      )}
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}

              {chartMode === "wicking" && (
                <div
                  style={{
                    background: "rgba(255,255,255,0.02)",
                    border: "1px solid rgba(56,189,248,0.08)",
                    borderRadius: 7,
                    padding: "12px 10px",
                    marginBottom: 12,
                  }}
                >
                  <div
                    style={{
                      fontSize: 8,
                      color: "#475569",
                      fontFamily: "'Space Mono',monospace",
                      marginBottom: 8,
                      letterSpacing: "0.07em",
                    }}
                  >
                    WASHBURN L=√(r·γ·cosθ/2ητ²·t) · θ_ISF=30° θ_manuf=15° ·
                    r_eff={geo.effectiveCapillaryRadiusUm}µm · τ=
                    {geo.tortuosity}
                  </div>
                  <ResponsiveContainer width="100%" height={270}>
                    <LineChart
                      data={wickData}
                      margin={{ top: 4, right: 10, left: 0, bottom: 14 }}
                    >
                      <CartesianGrid
                        strokeDasharray="2 4"
                        stroke="rgba(255,255,255,0.04)"
                      />
                      <XAxis
                        dataKey="t"
                        stroke="#334155"
                        tick={{
                          fill: "#475569",
                          fontSize: 8,
                          fontFamily: "Space Mono",
                        }}
                        label={{
                          value: "Time (s)",
                          position: "insideBottom",
                          offset: -4,
                          fill: "#475569",
                          fontSize: 8,
                        }}
                      />
                      <YAxis
                        stroke="#334155"
                        tick={{
                          fill: "#475569",
                          fontSize: 8,
                          fontFamily: "Space Mono",
                        }}
                        label={{
                          value: "Distance (µm)",
                          angle: -90,
                          position: "insideLeft",
                          fill: "#475569",
                          fontSize: 8,
                        }}
                      />
                      <Tooltip
                        formatter={(v, n) => [`${v}µm`, n]}
                        labelFormatter={(l) => `t=${l}s`}
                        contentStyle={{
                          background: "#0f172a",
                          border: "1px solid #1e3a5f",
                          borderRadius: 5,
                          fontSize: 9,
                          fontFamily: "Space Mono",
                        }}
                      />
                      <ReferenceLine
                        y={form.H}
                        stroke="rgba(56,189,248,0.2)"
                        strokeDasharray="3 3"
                        label={{
                          value: `H=${form.H}µm`,
                          fill: "#38bdf8",
                          fontSize: 7,
                          fontFamily: "Space Mono",
                        }}
                      />
                      <Line
                        type="monotone"
                        dataKey="inskin"
                        name="ISF (θ=30°)"
                        stroke="#22d3ee"
                        strokeWidth={2}
                        dot={false}
                      />
                      <Line
                        type="monotone"
                        dataKey="manuf"
                        name="Manuf (θ=15°)"
                        stroke="#f87171"
                        strokeWidth={2}
                        dot={false}
                        strokeDasharray="5 3"
                      />
                    </LineChart>
                  </ResponsiveContainer>
                  <div
                    style={{
                      fontSize: 8,
                      color: "#334155",
                      fontFamily: "'Space Mono',monospace",
                      marginTop: 6,
                    }}
                  >
                    η_coat={Math.round(mat.viscosity_mPas)}mPa·s · γ=
                    {Math.round(mat.surfaceTension_mNm)}mN/m · Manuf @5s:{" "}
                    {Math.round(w5?.manuf ?? 0)}µm{" "}
                    {(w5?.manuf ?? 0) > 100
                      ? "⚠ exceeds 100µm shaft limit"
                      : "✓ within safe range"}
                  </div>
                </div>
              )}
              {/* ── INSIGHT CARDS ── */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 8,
                  marginTop: 4,
                }}
              >
                {/* Always-on: mechanism explanation */}
                <div
                  style={{
                    padding: "10px 12px",
                    background: `${mech.c}09`,
                    border: `1px solid ${mech.c}28`,
                    borderRadius: 6,
                  }}
                >
                  <div
                    style={{
                      fontSize: 9,
                      color: mech.c,
                      fontFamily: "'Space Mono',monospace",
                      fontWeight: 700,
                      marginBottom: 3,
                    }}
                  >
                    {mech.t} · n = {effN.toFixed(3)}
                  </div>
                  <div
                    style={{ fontSize: 9, color: "#94a3b8", lineHeight: 1.7 }}
                  >
                    {effN <= 0.45 &&
                      "Pure Fickian diffusion. Water uptake rate-limiting. Wicking through coating microporosity dominates. Increase SD or reduce HPMC to shift toward anomalous."}
                    {effN > 0.45 &&
                      effN <= 0.89 &&
                      `Anomalous (non-Fickian) transport. Both diffusion and polymer relaxation/swelling contribute. n=${effN.toFixed(
                        2
                      )} — ${
                        effN < 0.65
                          ? "closer to diffusion-controlled"
                          : "closer to swelling-controlled"
                      }.`}
                    {effN > 0.89 &&
                      "Case II or Super Case II transport. Polymer relaxation rate-limiting — swelling front moves at constant velocity. Typical of highly swellable SD at high concentration."}
                  </div>
                </div>

                {/* Always-on: coating solution properties */}
                <div
                  style={{
                    padding: "10px 12px",
                    background: "rgba(56,189,248,0.05)",
                    border: "1px solid rgba(56,189,248,0.18)",
                    borderRadius: 6,
                  }}
                >
                  <div
                    style={{
                      fontSize: 9,
                      color: "#38bdf8",
                      fontFamily: "'Space Mono',monospace",
                      fontWeight: 700,
                      marginBottom: 3,
                    }}
                  >
                    Coating solution · {form.hpmcGrade} {form.hpmcConc}% w/w
                  </div>
                  <div
                    style={{ fontSize: 9, color: "#94a3b8", lineHeight: 1.7 }}
                  >
                    η = {Math.round(mat.viscosity_mPas)} mPa·s
                    {mat.viscosity_mPas < 50 &&
                      " — below 50 mPa·s: thin coat, significant shaft wicking risk during dip coating."}
                    {mat.viscosity_mPas >= 50 &&
                      mat.viscosity_mPas <= 400 &&
                      " — optimal dip-coating window (50–400 mPa·s). Uniform tip deposition expected."}
                    {mat.viscosity_mPas > 400 &&
                      mat.viscosity_mPas <= 1200 &&
                      " — high viscosity: reduced wicking but may give non-uniform drip pattern on withdrawal."}
                    {mat.viscosity_mPas > 1200 &&
                      " ⚠ >1200 mPa·s: too viscous for uniform dip coating. Reduce HPMC conc or switch to lower grade."}{" "}
                    D_water = {mat.D_water.toExponential(1)} m²/s through this
                    matrix.
                  </div>
                </div>

                {/* Gel barrier warning */}
                {form.sdConc > mat.gelThresh && (
                  <div
                    style={{
                      padding: "10px 12px",
                      background: "rgba(249,115,22,0.07)",
                      border: "1px solid rgba(249,115,22,0.25)",
                      borderRadius: 6,
                    }}
                  >
                    <div
                      style={{
                        fontSize: 9,
                        color: "#f97316",
                        fontFamily: "'Space Mono',monospace",
                        fontWeight: 700,
                        marginBottom: 3,
                      }}
                    >
                      ⚠ {form.sdType} gel barrier active ({form.sdConc}% {">"}{" "}
                      {mat.gelThresh}%)
                    </div>
                    <div
                      style={{ fontSize: 9, color: "#94a3b8", lineHeight: 1.7 }}
                    >
                      Above the gel threshold, {form.sdType} forms a viscous gel
                      layer on water contact. This paradoxically retards both
                      water ingress (kHyd × √{mat.gelPenalty.toFixed(2)} = ×
                      {mat.gelPenalty_sqrt.toFixed(3)}) and burst release
                      (burstFrac penalised by ×{mat.gelPenalty.toFixed(3)}).
                      Reduce SD to ≤{mat.gelThresh}% for optimal disintegration.
                      If high SD loading is required, consider PVPP (no gel
                      threshold).
                    </div>
                  </div>
                )}

                {/* Tween 80 CMC crossing */}
                {mat.aboveCMC && (
                  <div
                    style={{
                      padding: "10px 12px",
                      background: "rgba(34,197,94,0.05)",
                      border: "1px solid rgba(34,197,94,0.18)",
                      borderRadius: 6,
                    }}
                  >
                    <div
                      style={{
                        fontSize: 9,
                        color: "#22c55e",
                        fontFamily: "'Space Mono',monospace",
                        fontWeight: 700,
                        marginBottom: 3,
                      }}
                    >
                      ✓ Tween 80 above CMC — micellar region
                    </div>
                    <div
                      style={{ fontSize: 9, color: "#94a3b8", lineHeight: 1.7 }}
                    >
                      CMC ≈ 0.0017% w/v. At {form.tween80}% w/v, micelles form
                      and solubilize hydrophobic drug into their core. cmcBoost
                      = ×{mat.cmcBoost.toFixed(3)} applied to k_KP (drug
                      dissolution rate), NOT to kHyd. Surface tension reduced to{" "}
                      {Math.round(mat.surfaceTension_mNm)} mN/m → improved
                      wetting of needle substrate.
                    </div>
                  </div>
                )}

                {/* TPMS geometry insight */}
                {geo.tpms && (
                  <div
                    style={{
                      padding: "10px 12px",
                      background: `${gDef.color}07`,
                      border: `1px solid ${gDef.color}22`,
                      borderRadius: 6,
                    }}
                  >
                    <div
                      style={{
                        fontSize: 9,
                        color: gDef.color,
                        fontFamily: "'Space Mono',monospace",
                        fontWeight: 700,
                        marginBottom: 3,
                      }}
                    >
                      {gDef.icon} {gDef.label} · Millington-Quirk D_eff
                    </div>
                    <div
                      style={{ fontSize: 9, color: "#94a3b8", lineHeight: 1.7 }}
                    >
                      D_eff = φ/τ² = {geo.porosity}/
                      {(geo.tortuosity ** 2).toFixed(2)} = ×
                      {geo.D_eff_ratio.toFixed(3)} applied directly to k_KP rate
                      constant (not as a final multiplier — this is the P5 fix).
                      Pore radius {geo.poreRadiusUm}µm drives Washburn ISF
                      wicking. Manufacturing wicking RISK HIGH — target η {">"}{" "}
                      300 mPa·s or pre-coat shaft with hydrophobic layer
                      (PDMS/parylene).
                    </div>
                  </div>
                )}

                {/* Aspect ratio warning */}
                {form.H / form.R < 2 && (
                  <div
                    style={{
                      padding: "10px 12px",
                      background: "rgba(250,191,36,0.06)",
                      border: "1px solid rgba(250,191,36,0.22)",
                      borderRadius: 6,
                    }}
                  >
                    <div
                      style={{
                        fontSize: 9,
                        color: "#fbbf24",
                        fontFamily: "'Space Mono',monospace",
                        fontWeight: 700,
                        marginBottom: 3,
                      }}
                    >
                      ⚠ Low aspect ratio AR = {(form.H / form.R).toFixed(1)}
                    </div>
                    <div
                      style={{ fontSize: 9, color: "#94a3b8", lineHeight: 1.7 }}
                    >
                      Literature recommends AR ≥ 2 for reliable stratum corneum
                      penetration. At AR = {(form.H / form.R).toFixed(1)}, the
                      needle is likely to buckle before the tip breaches skin.
                      Increase H or reduce R. Conical MNs: optimal AR 2–4.
                      insertionScore = {geo.insertionScore.toFixed(2)} (target{" "}
                      {">"} 1.0).
                    </div>
                  </div>
                )}

                {/* Glycerol note (always shown if >0) */}
                {form.glycerol > 0 && (
                  <div
                    style={{
                      padding: "10px 12px",
                      background: "rgba(167,139,250,0.06)",
                      border: "1px solid rgba(167,139,250,0.18)",
                      borderRadius: 6,
                    }}
                  >
                    <div
                      style={{
                        fontSize: 9,
                        color: "#a78bfa",
                        fontFamily: "'Space Mono',monospace",
                        fontWeight: 700,
                        marginBottom: 3,
                      }}
                    >
                      Glycerol {form.glycerol}% w/w — plasticizer effect
                      {form.glycerol > 30 ? " ⚠ tacky" : ""}
                    </div>
                    <div
                      style={{ fontSize: 9, color: "#94a3b8", lineHeight: 1.7 }}
                    >
                      Depresses HPMC Tg → more flexible film (reduces cracking
                      during drying and skin insertion). Leaches into
                      dissolution medium on hydration → opens pore network →
                      plasticizerFactor = ×{mat.plasticizerFactor.toFixed(3)} on
                      k_KP.
                      {form.glycerol > 30
                        ? " Above 30%: film becomes tacky — handling and stacking problems during manufacturing."
                        : ""}
                      {form.glycerol > 20 && form.glycerol <= 30
                        ? " At 20–30%: good flexibility with marginal tackiness risk."
                        : ""}
                      {form.glycerol <= 20
                        ? " Below 20%: good mechanical properties, lower leaching pore-opening effect."
                        : ""}
                    </div>
                  </div>
                )}

                {/* Coat thickness effect */}
                <div
                  style={{
                    padding: "10px 12px",
                    background: "rgba(255,255,255,0.02)",
                    border: "1px solid rgba(255,255,255,0.07)",
                    borderRadius: 6,
                  }}
                >
                  <div
                    style={{
                      fontSize: 9,
                      color: "#e2e8f0",
                      fontFamily: "'Space Mono',monospace",
                      fontWeight: 700,
                      marginBottom: 3,
                    }}
                  >
                    Coating thickness L = {form.coatThickUm}µm · thicknessFactor
                    = ×{geo.thicknessFactor.toFixed(3)}
                  </div>
                  <div
                    style={{ fontSize: 9, color: "#94a3b8", lineHeight: 1.7 }}
                  >
                    k_KP ∝ D/L² — doubling coat thickness quarters the release
                    rate.
                    {form.coatThickUm <= 15 &&
                      " Very thin (≤15µm): fast release but dose per needle is low. Typically 1–2 dip coats."}
                    {form.coatThickUm > 15 &&
                      form.coatThickUm <= 35 &&
                      " Standard range (15–35µm): 2–4 dip coats. Good balance of dose and release rate."}
                    {form.coatThickUm > 35 &&
                      form.coatThickUm <= 60 &&
                      " Thick coat (35–60µm): 5–8 dip coats. Significantly slowed release — intentional sustained profile."}
                    {form.coatThickUm > 60 &&
                      " ⚠ Very thick (>60µm): release substantially retarded. Risk of coating delamination and poor insertion force."}{" "}
                    D_water through this coat = {mat.D_water.toExponential(1)}{" "}
                    m²/s.
                  </div>
                </div>

                {/* Drug MW effect */}
                <div
                  style={{
                    padding: "10px 12px",
                    background: "rgba(255,255,255,0.02)",
                    border: "1px solid rgba(255,255,255,0.07)",
                    borderRadius: 6,
                  }}
                >
                  <div
                    style={{
                      fontSize: 9,
                      color: "#e2e8f0",
                      fontFamily: "'Space Mono',monospace",
                      fontWeight: 700,
                      marginBottom: 3,
                    }}
                  >
                    Drug MW = {form.drugMW} Da · Peppas-Reinhart n-shift ={" "}
                    {(form.drugMW - 300) * 0.0002 >= 0 ? "+" : ""}
                    {((form.drugMW - 300) * 0.0002).toFixed(3)}
                  </div>
                  <div
                    style={{ fontSize: 9, color: "#94a3b8", lineHeight: 1.7 }}
                  >
                    {form.drugMW < 200 &&
                      "Small molecule (<200Da): nearly Fickian diffusion through swollen HPMC matrix. Free volume theory: molecular size well below mesh size."}
                    {form.drugMW >= 200 &&
                      form.drugMW < 350 &&
                      "Mid-range MW (200–350Da): slight anomalous shift. Drug size approaching mesh size of swollen HPMC network."}
                    {form.drugMW >= 350 &&
                      form.drugMW < 500 &&
                      "High MW (350–500Da): significant n-shift toward anomalous transport. Drug–polymer entanglement starts to contribute."}
                    {form.drugMW >= 500 &&
                      "Large molecule (≥500Da, peptide/protein range): strongly anomalous transport. Drug release increasingly coupled to matrix relaxation — consider PVPP for fastest burst."}
                  </div>
                </div>

                {/* SD-specific mechanism */}
                <div
                  style={{
                    padding: "10px 12px",
                    background: `${mat.sdColor}07`,
                    border: `1px solid ${mat.sdColor}22`,
                    borderRadius: 6,
                  }}
                >
                  <div
                    style={{
                      fontSize: 9,
                      color: mat.sdColor,
                      fontFamily: "'Space Mono',monospace",
                      fontWeight: 700,
                      marginBottom: 3,
                    }}
                  >
                    {form.sdType} · kBurst = {mat.kBurst} min⁻¹ · t½_burst ≈{" "}
                    {((Math.log(2) / mat.kBurst) * 60).toFixed(0)}s
                  </div>
                  <div
                    style={{ fontSize: 9, color: "#94a3b8", lineHeight: 1.7 }}
                  >
                    {form.sdType === "SSG" &&
                      "SSG (sodium starch glycolate): dual fast+slow water diffusion process (ATR-FTIR). Slowest burst of the three SDs (kBurst=0.9 min⁻¹, t½≈46s). Swelling-dominant — large volume expansion (up to 450%). Gel threshold 8%; above this, viscous gel paradoxically retards release."}
                    {form.sdType === "CCS" &&
                      "CCS (croscarmellose sodium): combined wicking + swelling mechanism. Moderate burst kinetics (kBurst=2.0 min⁻¹, t½≈21s). Gel threshold 5%. Large particles swell more; small particles form denser gel. Crosslinked network ensures insolubility while maximising water uptake."}
                    {form.sdType === "PVPP" &&
                      "PVPP (crospovidone): pure wicking — single fast water uptake process, no gel formation (threshold effectively infinite). Fastest burst (kBurst=3.5 min⁻¹, t½≈12s). Non-ionic → compatible with charged drugs. Does not swell significantly but generates strong capillary forces."}
                  </div>
                </div>

                {/* Manufacturing wicking insight — always shown for MN */}
                {geo.kind !== "film" && (
                  <div
                    style={{
                      padding: "10px 12px",
                      background:
                        (w5?.manuf ?? 0) > 100
                          ? "rgba(248,113,113,0.06)"
                          : "rgba(255,255,255,0.02)",
                      border: `1px solid ${
                        (w5?.manuf ?? 0) > 100
                          ? "rgba(248,113,113,0.25)"
                          : "rgba(255,255,255,0.07)"
                      }`,
                      borderRadius: 6,
                    }}
                  >
                    <div
                      style={{
                        fontSize: 9,
                        color: (w5?.manuf ?? 0) > 100 ? "#f87171" : "#e2e8f0",
                        fontFamily: "'Space Mono',monospace",
                        fontWeight: 700,
                        marginBottom: 3,
                      }}
                    >
                      {(w5?.manuf ?? 0) > 100 ? "⚠ " : "✓ "}Manufacturing
                      wicking · {Math.round(w5?.manuf ?? 0)}µm at 5s
                    </div>
                    <div
                      style={{ fontSize: 9, color: "#94a3b8", lineHeight: 1.7 }}
                    >
                      Washburn front travels {Math.round(w5?.manuf ?? 0)}µm up
                      the needle shaft in 5 seconds of drying.
                      {(w5?.manuf ?? 0) <= 50 &&
                        " Within safe limit (<50µm). Standard dip coating protocol adequate."}
                      {(w5?.manuf ?? 0) > 50 &&
                        (w5?.manuf ?? 0) <= 100 &&
                        " Marginal (50–100µm). Increase withdrawal speed or add a brief forced-air drying step between dips."}
                      {(w5?.manuf ?? 0) > 100 &&
                        " Exceeds 100µm shaft exposure. Options: (1) increase HPMC conc to raise η; (2) switch to E50/K4M grade; (3) add CMC thickener; (4) hydrophobic shaft pre-coating (PDMS/parylene C)."}{" "}
                      ISF in-skin at 5s: {Math.round(w5?.inskin ?? 0)}µm —{" "}
                      {(w5?.inskin ?? 0) > 200
                        ? "excellent hydration front"
                        : "moderate hydration, adequate for most SDs"}
                      .
                    </div>
                  </div>
                )}
              </div>
            </>
          )}

          {/* ── COMPARE TAB ── */}
          {tab === "compare" && (
            <>
              <div
                style={{
                  display: "flex",
                  gap: 6,
                  marginBottom: 10,
                  alignItems: "center",
                }}
              >
                <Tab active={!absMode} onClick={() => setAbsMode(false)}>
                  % Released
                </Tab>
                <Tab
                  active={absMode}
                  onClick={() => setAbsMode(true)}
                  color="#818cf8"
                >
                  µg Released
                </Tab>
                <div
                  style={{
                    fontSize: 8,
                    color: "#475569",
                    fontFamily: "'Space Mono',monospace",
                    marginLeft: 8,
                  }}
                >
                  Absolute mass normalises for geometry — same % can mean very
                  different delivered doses
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                {slots.map((s, i) => {
                  const sm = slotSims[i];
                  if (!sm) return null;
                  const t80s =
                    sm.release.find((d) => d.release >= 80)?.t ?? ">30";
                  const ni = clamp(
                    sm.material.nBase +
                      (sm.geometry.tpms ? 0.06 : 0) +
                      (sm.geometry.kind === "film" ? -0.05 : 0),
                    0.2,
                    0.95
                  );
                  const mi = nMech(ni);
                  return (
                    <div
                      key={i}
                      style={{
                        flex: 1,
                        padding: "10px 12px",
                        background: `${SLOT_COLORS[i]}0a`,
                        border: `1px solid ${SLOT_COLORS[i]}25`,
                        borderRadius: 6,
                      }}
                    >
                      <div
                        style={{
                          fontSize: 11,
                          color: SLOT_COLORS[i],
                          fontFamily: "'Space Mono',monospace",
                          fontWeight: 700,
                          marginBottom: 4,
                        }}
                      >
                        {s.label} · {s.sdType} {s.sdConc}% / {s.hpmcGrade}{" "}
                        {s.hpmcConc}%
                      </div>
                      <div
                        style={{
                          fontSize: 9,
                          color: "#94a3b8",
                          lineHeight: 1.7,
                        }}
                      >
                        T₈₀ {typeof t80s === "number" ? `${t80s}min` : t80s} ·
                        n={ni.toFixed(2)} ({mi.t}) · η=
                        {Math.round(sm.material.viscosity_mPas)}mPa·s
                      </div>
                    </div>
                  );
                })}
              </div>
              <div
                style={{
                  background: "rgba(255,255,255,0.02)",
                  border: "1px solid rgba(56,189,248,0.08)",
                  borderRadius: 7,
                  padding: "12px 10px",
                  marginBottom: 12,
                }}
              >
                <div
                  style={{
                    fontSize: 8,
                    color: "#475569",
                    fontFamily: "'Space Mono',monospace",
                    marginBottom: 8,
                    letterSpacing: "0.07em",
                  }}
                >
                  3-FORMULATION RELEASE COMPARISON · 0–30 min
                </div>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart
                    data={compareData}
                    margin={{ top: 4, right: 10, left: 0, bottom: 14 }}
                  >
                    <CartesianGrid
                      strokeDasharray="2 4"
                      stroke="rgba(255,255,255,0.04)"
                    />
                    <XAxis
                      dataKey="t"
                      stroke="#334155"
                      tick={{
                        fill: "#475569",
                        fontSize: 8,
                        fontFamily: "Space Mono",
                      }}
                      label={{
                        value: "Time (min)",
                        position: "insideBottom",
                        offset: -4,
                        fill: "#475569",
                        fontSize: 8,
                      }}
                    />
                    <YAxis
                      domain={
                        absMode
                          ? [0, (d) => Math.ceil(d * 1.15 * 10) / 10]
                          : [0, 100]
                      }
                      stroke="#334155"
                      tick={{
                        fill: "#475569",
                        fontSize: 8,
                        fontFamily: "Space Mono",
                      }}
                      label={{
                        value: absMode ? "µg released" : "% Released",
                        angle: -90,
                        position: "insideLeft",
                        fill: absMode ? "#818cf8" : "#475569",
                        fontSize: 8,
                      }}
                    />
                    <Tooltip
                      contentStyle={{
                        background: "#0f172a",
                        border: "1px solid #1e3a5f",
                        borderRadius: 5,
                        fontSize: 9,
                        fontFamily: "Space Mono",
                      }}
                      formatter={(v, n) => [absMode ? `${v} µg` : `${v}%`, n]}
                      labelFormatter={(l) => `t=${l}min`}
                    />
                    {!absMode && (
                      <ReferenceLine
                        y={80}
                        stroke="rgba(248,113,113,0.18)"
                        strokeDasharray="4 3"
                        label={{
                          value: "80%",
                          fill: "#ef4444",
                          fontSize: 7,
                          fontFamily: "Space Mono",
                        }}
                      />
                    )}
                    {["A", "B", "C"].map((lbl, i) => {
                      const key = absMode ? `${lbl}_ug` : lbl;
                      const Mmass =
                        slotSims[i].geometry.M_drug_ug?.toFixed(2) ?? "-";
                      return (
                        <Line
                          key={lbl}
                          type="monotone"
                          dataKey={key}
                          name={`${lbl} (${slots[i].sdType}/${
                            slots[i].hpmcGrade
                          }${absMode ? ` · ${Mmass}µg` : ""})`}
                          stroke={SLOT_COLORS[i]}
                          strokeWidth={2}
                          dot={false}
                          strokeDasharray={
                            i === 1 ? "5 3" : i === 2 ? "2 2" : "0"
                          }
                        />
                      );
                    })}
                  </LineChart>
                </ResponsiveContainer>
              </div>
              {/* Compare table */}
              <div
                style={{
                  background: "rgba(255,255,255,0.02)",
                  border: "1px solid rgba(56,189,248,0.08)",
                  borderRadius: 7,
                  padding: "12px",
                  overflowX: "auto",
                }}
              >
                <table
                  style={{
                    width: "100%",
                    borderCollapse: "collapse",
                    fontSize: 8,
                    fontFamily: "'Space Mono',monospace",
                    minWidth: 500,
                  }}
                >
                  <thead>
                    <tr
                      style={{
                        color: "#64748b",
                        borderBottom: "1px solid rgba(255,255,255,0.07)",
                      }}
                    >
                      {["Parameter", "A", "B", "C"].map((h) => (
                        <th
                          key={h}
                          style={{ textAlign: "left", padding: "3px 8px" }}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      [
                        "SD / conc",
                        ...slots.map((s) => `${s.sdType} ${s.sdConc}%`),
                      ],
                      [
                        "HPMC / conc",
                        ...slots.map((s) => `${s.hpmcGrade} ${s.hpmcConc}%`),
                      ],
                      [
                        "Glycerol / Tween",
                        ...slots.map((s) => `${s.glycerol}% / ${s.tween80}%`),
                      ],
                      ["Coat L (µm)", ...slots.map((s) => s.coatThickUm)],
                      [
                        "Geometry",
                        ...slots.map(
                          (s) =>
                            GEOMETRIES[s.geoKey]?.icon +
                            " " +
                            GEOMETRIES[s.geoKey]?.label
                        ),
                      ],
                      [
                        "Viscosity (mPa·s)",
                        ...slotSims.map((s) =>
                          Math.round(s.material.viscosity_mPas)
                        ),
                      ],
                      [
                        "D_water (m²/s)",
                        ...slotSims.map((s) =>
                          s.material.D_water.toExponential(1)
                        ),
                      ],
                      [
                        "Peppas n",
                        ...slotSims.map((s) =>
                          clamp(
                            s.material.nBase +
                              (s.geometry.tpms ? 0.06 : 0) +
                              (s.geometry.kind === "film" ? -0.05 : 0),
                            0.2,
                            0.95
                          ).toFixed(3)
                        ),
                      ],
                      [
                        "T₅₀ (min)",
                        ...slotSims.map(
                          (s) =>
                            s.release.find((d) => d.release >= 50)?.t ?? ">30"
                        ),
                      ],
                      [
                        "T₈₀ (min)",
                        ...slotSims.map(
                          (s) =>
                            s.release.find((d) => d.release >= 80)?.t ?? ">30"
                        ),
                      ],
                      [
                        "SA coat (×10⁶µm²)",
                        ...slotSims.map((s) =>
                          ((s.geometry.SA_base_um2 ?? 0) / 1e6).toFixed(1)
                        ),
                      ],
                      [
                        "M_coat (µg/needle)",
                        ...slotSims.map(
                          (s) => s.geometry.M_coat_ug?.toFixed(2) ?? "-"
                        ),
                      ],
                      [
                        "M_drug (µg/needle)",
                        ...slotSims.map(
                          (s) => s.geometry.M_drug_ug?.toFixed(2) ?? "-"
                        ),
                      ],
                      [
                        "Vol. factor",
                        ...slotSims.map(
                          (s) => s.geometry.volumeFactor?.toFixed(2) ?? "-"
                        ),
                      ],
                      [
                        "Dose @ 60% (µg)",
                        ...slotSims.map((s) =>
                          ((s.geometry.M_drug_ug ?? 0) * 0.6).toFixed(2)
                        ),
                      ],
                    ].map(([label, ...vals]) => (
                      <tr
                        key={label}
                        style={{
                          borderBottom: "1px solid rgba(255,255,255,0.03)",
                        }}
                      >
                        <td style={{ padding: "3px 8px", color: "#64748b" }}>
                          {label}
                        </td>
                        {vals.map((v, i) => (
                          <td
                            key={i}
                            style={{
                              padding: "3px 8px",
                              color: SLOT_COLORS[i],
                              fontWeight:
                                label.includes("T₈₀") || label.includes("T₅₀")
                                  ? "700"
                                  : "400",
                            }}
                          >
                            {String(v)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {/* ── TPMS VIZ TAB ── */}
          {tab === "tpms" && (
            <>
              <div style={{ marginBottom: 10 }}>
                <div
                  style={{
                    fontSize: 9,
                    color: "#64748b",
                    fontFamily: "'Space Mono',monospace",
                    marginBottom: 6,
                    lineHeight: 1.8,
                  }}
                >
                  Interactive 3D TPMS implicit surface · drag to rotate ·
                  cross-section slider · ISF flow animation
                </div>
              </div>
              <TPMSVisualizer geoKey={form.geoKey} />
              <div
                style={{
                  marginTop: 12,
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr 1fr",
                  gap: 8,
                }}
              >
                {["tpms_gyroid", "tpms_primitive", "tpms_diamond"].map((k) => {
                  const g = GEOMETRIES[k];
                  if (!g) return null;
                  return (
                    <div
                      key={k}
                      style={{
                        padding: "10px 12px",
                        background: `${g.color}08`,
                        border: `1px solid ${g.color}20`,
                        borderRadius: 6,
                      }}
                    >
                      <div
                        style={{
                          fontSize: 10,
                          color: g.color,
                          fontFamily: "'Space Mono',monospace",
                          fontWeight: 700,
                          marginBottom: 4,
                        }}
                      >
                        {g.icon} {g.label}
                      </div>
                      <div
                        style={{
                          fontSize: 9,
                          color: "#94a3b8",
                          lineHeight: 1.7,
                        }}
                      >
                        φ={(g.porosity * 100).toFixed(0)}% · τ={g.tortuosity} ·
                        r={g.poreRadiusUm}µm
                        <br />
                        D_eff = φ/τ² = ×
                        {(g.porosity / g.tortuosity ** 2).toFixed(3)}
                        <br />
                        SA× = {g.saFactor} · Release× = {g.releaseFactor}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {/* ── AI SUGGEST TAB ── */}
          {tab === "ai" && (
            <AIPanel
              params={{ ...form }}
              sim={sim}
              onApply={applyAISuggestion}
            />
          )}
        </div>
      </div>
    </div>
  );
}
