import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  Layers,
  Grid,
  Calculator,
  Plus,
  Trash2,
  Square,
  Maximize2,
  Ruler,
  AlertTriangle,
  Eye,
  Sliders,
  FileSpreadsheet,
  RefreshCw,
  ArrowRight,
  ArrowDown,
  ArrowUp,
  ArrowLeft,
  ShieldCheck,
  Sparkles,
  Crosshair,
  ChevronRight
} from 'lucide-react';

const CONCRETE_CLASSES = {
  'C20/25': { name: 'C20/25', fck: 20, fcd: 14.29, fctm: 2.2, Ecm: 30000 },
  'C25/30': { name: 'C25/30', fck: 25, fcd: 17.86, fctm: 2.6, Ecm: 31000 },
  'C30/37': { name: 'C30/37', fck: 30, fcd: 21.43, fctm: 2.9, Ecm: 33000 },
  'C35/45': { name: 'C35/45', fck: 35, fcd: 25.00, fctm: 3.2, Ecm: 34000 },
};

const STEEL_CLASSES = {
  'B500SP': { name: 'B500SP (Epstalon / ciąliwość C)', fyk: 500, fyd: 434.78, xiLim: 0.493, muLim: 0.371 },
  'B500B': { name: 'B500B (ciągliwość B)', fyk: 500, fyd: 434.78, xiLim: 0.493, muLim: 0.371 },
};

const BAR_DIAMETERS = [8, 10, 12, 14, 16, 20];
const BAR_SPACINGS = [8, 10, 12, 13, 15, 20, 25];

const EXPOSURE_CLASSES = {
  'XC1': { name: 'XC1 – Wnętrza budynków (suche/wilgotne)', cMin: 15, cNomRec: 20 },
  'XC2': { name: 'XC2 – Mokre, rzadko suche (fundamenty)', cMin: 25, cNomRec: 30 },
  'XC3': { name: 'XC3 – Umiarkowana wilgotność (zewn. osłonięte)', cMin: 25, cNomRec: 30 },
};

const LAYER_PRESETS = [
  { name: 'Płyta żelbetowa (ciężar własny - auto)', type: 'G', mode: 'volume', thickness: 16, density: 25.0, surfaceLoad: 0, isSlabSelfWeight: true },
  { name: 'Jastrych cementowy (szlichta)', type: 'G', mode: 'volume', thickness: 5, density: 22.0, surfaceLoad: 0 },
  { name: 'Jastrych anhydrytowy', type: 'G', mode: 'volume', thickness: 4.5, density: 20.0, surfaceLoad: 0 },
  { name: 'Styropian podłogowy EPS 100 / izolacja', type: 'G', mode: 'volume', thickness: 5, density: 0.30, surfaceLoad: 0 },
  { name: 'Wełna mineralna akustyczna', type: 'G', mode: 'volume', thickness: 3, density: 1.20, surfaceLoad: 0 },
  { name: 'Płytki ceramiczne / gres na kleju', type: 'G', mode: 'surface', thickness: 1.5, density: 0, surfaceLoad: 0.35 },
  { name: 'Panele podłogowe / deska warstwowa', type: 'G', mode: 'surface', thickness: 1.2, density: 0, surfaceLoad: 0.15 },
  { name: 'Tynk gipsowy na suficie (1,5 cm)', type: 'G', mode: 'volume', thickness: 1.5, density: 13.5, surfaceLoad: 0 },
  { name: 'Tynk cementowo-wapienny na suficie (1,5 cm)', type: 'G', mode: 'volume', thickness: 1.5, density: 19.0, surfaceLoad: 0 },
  { name: 'Zastępcze obciążenie od lekkich ścianek działowych (kat. A)', type: 'G', mode: 'surface', thickness: 0, density: 0, surfaceLoad: 1.20 },
  { name: 'Obciążenie użytkowe – Budynki mieszkalne (Kat. A)', type: 'Q', mode: 'surface', thickness: 0, density: 0, surfaceLoad: 2.00 },
  { name: 'Obciążenie użytkowe – Powierzchnie biurowe (Kat. B)', type: 'Q', mode: 'surface', thickness: 0, density: 0, surfaceLoad: 3.00 },
  { name: 'Obciążenie użytkowe – Sale zebrań / korytarze (Kat. C1/C3)', type: 'Q', mode: 'surface', thickness: 0, density: 0, surfaceLoad: 4.00 },
  { name: 'Obciążenie użytkowe – Balkony i loggie (Kat. A)', type: 'Q', mode: 'surface', thickness: 0, density: 0, surfaceLoad: 3.00 },
];

function solveSlabFEM({ panels, openings, qd, thicknessCm, Ecm, nu = 0.2 }) {
  if (!panels || panels.length === 0) return null;

  const minX = Math.min(...panels.map(p => p.x));
  const maxX = Math.max(...panels.map(p => p.x + p.w));
  const minY = Math.min(...panels.map(p => p.y));
  const maxY = Math.max(...panels.map(p => p.y + p.h));

  const totalW = maxX - minX;
  const totalH = maxY - minY;
  if (totalW <= 0.1 || totalH <= 0.1) return null;

  const targetStep = Math.max(totalW, totalH) / 56;
  const nx = Math.max(24, Math.min(64, Math.round(totalW / targetStep)));
  const ny = Math.max(24, Math.min(76, Math.round(totalH / targetStep)));

  const dx = totalW / nx;
  const dy = totalH / ny;

  const h_m = thicknessCm / 100;
  const D = ((Ecm * 1000) * Math.pow(h_m, 3)) / (12 * (1 - nu * nu));

  const cols = nx + 1;
  const rows = ny + 1;
  const N = cols * rows;

  const nodeType = new Uint8Array(N);
  const w = new Float64Array(N);

  const epsX = dx * 0.48;
  const epsY = dy * 0.48;

  const isSharedInternalEdge = (px, py) => {
    if (!panels || panels.length < 2) return false;
    for (let a = 0; a < panels.length; a++) {
      for (let b = a + 1; b < panels.length; b++) {
        const p1 = panels[a];
        const p2 = panels[b];

        if (Math.abs((p1.y + p1.h) - p2.y) <= epsY && Math.abs(py - p2.y) <= epsY) {
          const minOvX = Math.max(p1.x, p2.x) - epsX;
          const maxOvX = Math.min(p1.x + p1.w, p2.x + p2.w) + epsX;
          if (maxOvX > minOvX && px >= minOvX && px <= maxOvX) return true;
        }
        if (Math.abs((p2.y + p2.h) - p1.y) <= epsY && Math.abs(py - p1.y) <= epsY) {
          const minOvX = Math.max(p1.x, p2.x) - epsX;
          const maxOvX = Math.min(p1.x + p1.w, p2.x + p2.w) + epsX;
          if (maxOvX > minOvX && px >= minOvX && px <= maxOvX) return true;
        }

        if (Math.abs((p1.x + p1.w) - p2.x) <= epsX && Math.abs(px - p2.x) <= epsX) {
          const minOvY = Math.max(p1.y, p2.y) - epsY;
          const maxOvY = Math.min(p1.y + p1.h, p2.y + p2.h) + epsY;
          if (maxOvY > minOvY && py >= minOvY && py <= maxOvY) return true;
        }
        if (Math.abs((p2.x + p2.w) - p1.x) <= epsX && Math.abs(px - p1.x) <= epsX) {
          const minOvY = Math.max(p1.y, p2.y) - epsY;
          const maxOvY = Math.min(p1.y + p1.h, p2.y + p2.h) + epsY;
          if (maxOvY > minOvY && py >= minOvY && py <= maxOvY) return true;
        }
      }
    }
    return false;
  };

  const isContinuousClampedEdge = (px, py) => {
    if (!panels || panels.length < 2) return false;
    for (let a = 0; a < panels.length; a++) {
      for (let b = a + 1; b < panels.length; b++) {
        const p1 = panels[a];
        const p2 = panels[b];

        if (Math.abs((p1.y + p1.h) - p2.y) <= epsY && Math.abs(py - p2.y) <= epsY) {
          const minOvX = Math.max(p1.x, p2.x) - epsX;
          const maxOvX = Math.min(p1.x + p1.w, p2.x + p2.w) + epsX;
          if (maxOvX > minOvX && px >= minOvX && px <= maxOvX) {
            if (p1.edges.top === 'clamped' && p2.edges.bottom === 'clamped') return true;
          }
        }
        if (Math.abs((p2.y + p2.h) - p1.y) <= epsY && Math.abs(py - p1.y) <= epsY) {
          const minOvX = Math.max(p1.x, p2.x) - epsX;
          const maxOvX = Math.min(p1.x + p1.w, p2.x + p2.w) + epsX;
          if (maxOvX > minOvX && px >= minOvX && px <= maxOvX) {
            if (p2.edges.top === 'clamped' && p1.edges.bottom === 'clamped') return true;
          }
        }

        if (Math.abs((p1.x + p1.w) - p2.x) <= epsX && Math.abs(px - p2.x) <= epsX) {
          const minOvY = Math.max(p1.y, p2.y) - epsY;
          const maxOvY = Math.min(p1.y + p1.h, p2.y + p2.h) + epsY;
          if (maxOvY > minOvY && py >= minOvY && py <= maxOvY) {
            if (p1.edges.right === 'clamped' && p2.edges.left === 'clamped') return true;
          }
        }
        if (Math.abs((p2.x + p2.w) - p1.x) <= epsX && Math.abs(px - p1.x) <= epsX) {
          const minOvY = Math.max(p1.y, p2.y) - epsY;
          const maxOvY = Math.min(p1.y + p1.h, p2.y + p2.h) + epsY;
          if (maxOvY > minOvY && py >= minOvY && py <= maxOvY) {
            if (p2.edges.right === 'clamped' && p1.edges.left === 'clamped') return true;
          }
        }
      }
    }
    return false;
  };

  const isSharedPinnedHingeEdge = (px, py) => {
    if (!panels || panels.length < 2) return false;
    for (let a = 0; a < panels.length; a++) {
      for (let b = a + 1; b < panels.length; b++) {
        const p1 = panels[a];
        const p2 = panels[b];

        if (Math.abs((p1.y + p1.h) - p2.y) <= epsY && Math.abs(py - p2.y) <= epsY) {
          const minOvX = Math.max(p1.x, p2.x) - epsX;
          const maxOvX = Math.min(p1.x + p1.w, p2.x + p2.w) + epsX;
          if (maxOvX > minOvX && px >= minOvX && px <= maxOvX) {
            if (p1.edges.top === 'pinned' && p2.edges.bottom === 'pinned') return true;
          }
        }
        if (Math.abs((p2.y + p2.h) - p1.y) <= epsY && Math.abs(py - p1.y) <= epsY) {
          const minOvX = Math.max(p1.x, p2.x) - epsX;
          const maxOvX = Math.min(p1.x + p1.w, p2.x + p2.w) + epsX;
          if (maxOvX > minOvX && px >= minOvX && px <= maxOvX) {
            if (p2.edges.top === 'pinned' && p1.edges.bottom === 'pinned') return true;
          }
        }

        if (Math.abs((p1.x + p1.w) - p2.x) <= epsX && Math.abs(px - p2.x) <= epsX) {
          const minOvY = Math.max(p1.y, p2.y) - epsY;
          const maxOvY = Math.min(p1.y + p1.h, p2.y + p2.h) + epsY;
          if (maxOvY > minOvY && py >= minOvY && py <= maxOvY) {
            if (p1.edges.right === 'pinned' && p2.edges.left === 'pinned') return true;
          }
        }
        if (Math.abs((p2.x + p2.w) - p1.x) <= epsX && Math.abs(px - p1.x) <= epsX) {
          const minOvY = Math.max(p1.y, p2.y) - epsY;
          const maxOvY = Math.min(p1.y + p1.h, p2.y + p2.h) + epsY;
          if (maxOvY > minOvY && py >= minOvY && py <= maxOvY) {
            if (p2.edges.right === 'pinned' && p1.edges.left === 'pinned') return true;
          }
        }
      }
    }
    return false;
  };

  const isNodeOnPinnedHinge = (i, j) => {
    const px = minX + i * dx;
    const py = minY + j * dy;
    return isSharedPinnedHingeEdge(px, py) && !isContinuousClampedEdge(px, py);
  };

  const getPointState = (px, py) => {
    let insideAnyPanel = false;
    let isSupported = false;
    let isClamped = false;

    const sharedEdge = isSharedInternalEdge(px, py);
    const continuousClamped = isContinuousClampedEdge(px, py);
    const sharedPinnedHinge = isSharedPinnedHingeEdge(px, py);

    for (const p of panels) {
      const inX = px >= p.x - epsX && px <= p.x + p.w + epsX;
      const inY = py >= p.y - epsY && py <= p.y + p.h + epsY;
      if (inX && inY) {
        insideAnyPanel = true;
        if (Math.abs(px - p.x) <= epsX) {
          if (p.edges.left === 'pinned') isSupported = true;
          if (p.edges.left === 'clamped') { isSupported = true; isClamped = true; }
        }
        if (Math.abs(px - (p.x + p.w)) <= epsX) {
          if (p.edges.right === 'pinned') isSupported = true;
          if (p.edges.right === 'clamped') { isSupported = true; isClamped = true; }
        }
        if (Math.abs(py - p.y) <= epsY) {
          if (p.edges.bottom === 'pinned') isSupported = true;
          if (p.edges.bottom === 'clamped') { isSupported = true; isClamped = true; }
        }
        if (Math.abs(py - (p.y + p.h)) <= epsY) {
          if (p.edges.top === 'pinned') isSupported = true;
          if (p.edges.top === 'clamped') { isSupported = true; isClamped = true; }
        }
      }
    }

    if (!insideAnyPanel) return 0;

    for (const op of openings) {
      const strictlyInsideX = px > op.x + epsX * 0.4 && px < op.x + op.w - epsX * 0.4;
      const strictlyInsideY = py > op.y + epsY * 0.4 && py < op.y + op.h - epsY * 0.4;

      const onOpeningEdgeX = (Math.abs(px - op.x) <= epsX || Math.abs(px - (op.x + op.w)) <= epsX) &&
                             (py > op.y + epsY * 0.5 && py < op.y + op.h - epsY * 0.5);
      const onOpeningEdgeY = (Math.abs(py - op.y) <= epsY || Math.abs(py - (op.y + op.h)) <= epsY) &&
                             (px > op.x + epsX * 0.5 && px < op.x + op.w - epsX * 0.5);

      if (strictlyInsideX && strictlyInsideY) {
        return 0;
      }
      if ((Math.abs(px - op.x) <= epsX && Math.abs(op.x - minX) <= epsX && py > op.y + epsY && py < op.y + op.h - epsY) ||
          (Math.abs(px - (op.x + op.w)) <= epsX && Math.abs(op.x + op.w - maxX) <= epsX && py > op.y + epsY && py < op.y + op.h - epsY) ||
          (Math.abs(py - op.y) <= epsY && Math.abs(op.y - minY) <= epsY && px > op.x + epsX && px < op.x + op.w - epsX) ||
          (Math.abs(py - (op.y + op.h)) <= epsY && Math.abs(op.y + op.h - maxY) <= epsY && px > op.x + epsX && px < op.x + op.w - epsX)) {
        return 0;
      }

      if (onOpeningEdgeX || onOpeningEdgeY) {
        isSupported = false;
        isClamped = false;
      }
    }

    if (sharedEdge && continuousClamped) return 5;
    if (sharedEdge && sharedPinnedHinge) return 2;
    if (isClamped) return 3;
    if (isSupported) return 2;
    return 1;
  };

  for (let j = 0; j < rows; j++) {
    const py = minY + j * dy;
    for (let i = 0; i < cols; i++) {
      const idx = j * cols + i;
      const px = minX + i * dx;
      nodeType[idx] = getPointState(px, py);
    }
  }

  const getW = (i, j, refI = null, refJ = null) => {
    if (i < 0 || i >= cols || j < 0 || j >= rows) return 0;
    const idx = j * cols + i;
    const t = nodeType[idx];
    if (t === 0) {
      if (refI !== null && refJ !== null) {
        return w[refJ * cols + refI];
      }
      return 0;
    }
    if (t === 2 || t === 3) return 0;
    return w[idx];
  };

  const dx2 = dx * dx;
  const dy2 = dy * dy;
  const dx4 = dx2 * dx2;
  const dy4 = dy2 * dy2;
  const dx2dy2 = dx2 * dy2;

  const diagCoeff = 6 / dx4 + 8 / dx2dy2 + 6 / dy4;
  const omega = 1.62;
  const maxIter = 750;
  const tol = 1e-11;

  for (let iter = 0; iter < maxIter; iter++) {
    let maxDelta = 0;

    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const idx = j * cols + i;
        const t = nodeType[idx];
        if (t === 0 || t === 2 || t === 3) {
          w[idx] = 0;
          continue;
        }

        const w_c = w[idx];
        const w_ip1 = getW(i + 1, j, i, j);
        const w_im1 = getW(i - 1, j, i, j);
        const w_jp1 = getW(i, j + 1, i, j);
        const w_jm1 = getW(i, j - 1, i, j);

        const w_ip2 = getW(i + 2, j, i + 1, j);
        const w_im2 = getW(i - 2, j, i - 1, j);
        const w_jp2 = getW(i, j + 2, i, j + 1);
        const w_jm2 = getW(i, j - 2, i, j - 1);

        const w_ipp_jpp = getW(i + 1, j + 1, i, j);
        const w_ip1_jm1 = getW(i + 1, j - 1, i, j);
        const w_im1_jp1 = getW(i - 1, j + 1, i, j);
        const w_im1_jm1 = getW(i - 1, j - 1, i, j);

        const rhs = qd / Math.max(1, D);
        const neighborSum =
          (w_ip2 + w_im2) / dx4 +
          (w_jp2 + w_jm2) / dy4 -
          (4 * (w_ip1 + w_im1)) / dx4 -
          (4 * (w_jp1 + w_jm1)) / dy4 -
          (2 * (w_ip1 + w_im1 + w_jp1 + w_jm1)) / dx2dy2 +
          (w_ipp_jpp + w_ip1_jm1 + w_im1_jp1 + w_im1_jm1) / dx2dy2;

        const wNewRaw = (rhs - neighborSum) / diagCoeff;
        const wNew = Math.max(0, w_c + omega * (wNewRaw - w_c));
        const delta = Math.abs(wNew - w_c);
        if (delta > maxDelta) maxDelta = delta;
        w[idx] = wNew;
      }
    }

    if (iter > 40 && maxDelta < tol) break;
  }

  const Mx = Array.from({ length: rows }, () => new Array(cols).fill(null));
  const My = Array.from({ length: rows }, () => new Array(cols).fill(null));
  const W_mm = Array.from({ length: rows }, () => new Array(cols).fill(null));

  let maxMx = -Infinity;
  let minMx = Infinity;
  let maxMy = -Infinity;
  let minMy = Infinity;
  let maxMxCoord = { x: minX + totalW / 2, y: minY + totalH / 2 };
  let minMxCoord = { x: minX + totalW / 2, y: minY + totalH / 2 };
  let maxMyCoord = { x: minX + totalW / 2, y: minY + totalH / 2 };
  let minMyCoord = { x: minX + totalW / 2, y: minY + totalH / 2 };
  let maxDeflectionMm = 0;

  const activeRibs = openings.filter(op => op.hasRib);

  for (let j = 0; j < rows; j++) {
    const py = minY + j * dy;
    for (let i = 0; i < cols; i++) {
      const idx = j * cols + i;
      const t = nodeType[idx];
      if (t === 0) continue;

      const px = minX + i * dx;
      const wc = w[idx];
      const w_im1 = isNodeOnPinnedHinge(i - 1, j) ? -getW(i + 1, j, i, j) : getW(i - 1, j, i, j);
      const w_ip1 = isNodeOnPinnedHinge(i + 1, j) ? -getW(i - 1, j, i, j) : getW(i + 1, j, i, j);
      const w_jm1 = isNodeOnPinnedHinge(i, j - 1) ? -getW(i, j + 1, i, j) : getW(i, j - 1, i, j);
      const w_jp1 = isNodeOnPinnedHinge(i, j + 1) ? -getW(i, j - 1, i, j) : getW(i, j + 1, i, j);

      let d2w_dx2 = (w_im1 - 2 * wc + w_ip1) / dx2;
      let d2w_dy2 = (w_jm1 - 2 * wc + w_jp1) / dy2;

      const isHingeNode =
        t === 2 &&
        isSharedInternalEdge(px, py) &&
        !isContinuousClampedEdge(px, py);

      if (isHingeNode) {
        const hasHorizontalShared = isSharedInternalEdge(px - dx, py) || isSharedInternalEdge(px + dx, py);
        const hasVerticalShared = isSharedInternalEdge(px, py - dy) || isSharedInternalEdge(px, py + dy);
        if (hasHorizontalShared) {
          d2w_dx2 = 0;
        }
        if (hasVerticalShared) {
          d2w_dy2 = 0;
        }
      }

      const nearLeftOpenEdge = (i > 0 && nodeType[idx - 1] === 0);
      const nearRightOpenEdge = (i < cols - 1 && nodeType[idx + 1] === 0);
      const nearBottomOpenEdge = (j > 0 && nodeType[idx - cols] === 0);
      const nearTopOpenEdge = (j < rows - 1 && nodeType[idx + cols] === 0);

      let mxVal = -D * (d2w_dx2 + nu * d2w_dy2);
      let myVal = -D * (d2w_dy2 + nu * d2w_dx2);

      if (nearLeftOpenEdge || nearRightOpenEdge) {
        mxVal = 0;
        myVal = -D * (1 - nu * nu) * d2w_dy2;
      }
      if (nearBottomOpenEdge || nearTopOpenEdge) {
        myVal = 0;
        mxVal = -D * (1 - nu * nu) * d2w_dx2;
      }

      for (const op of activeRibs) {
        const distToVertEdge = Math.min(Math.abs(px - op.x), Math.abs(px - (op.x + op.w)));
        if (distToVertEdge <= 0.35 && py >= op.y - 0.1 && py <= op.y + op.h + 0.1) {
          const ribH = (op.ribHeight || 30) / 100;
          const stiffFactor = Math.min(1.35, 1 + 0.35 * ((ribH - h_m) / 0.14));
          myVal *= stiffFactor;
        }
      }

      mxVal = Math.max(-180, Math.min(180, mxVal));
      myVal = Math.max(-180, Math.min(180, myVal));

      Mx[j][i] = Number(mxVal.toFixed(2));
      My[j][i] = Number(myVal.toFixed(2));
      const defl = Number((wc * 1000).toFixed(2));
      W_mm[j][i] = defl;

      if (defl > maxDeflectionMm) maxDeflectionMm = defl;
      if (mxVal > maxMx) { maxMx = mxVal; maxMxCoord = { x: px, y: py }; }
      if (mxVal < minMx) { minMx = mxVal; minMxCoord = { x: px, y: py }; }
      if (myVal > maxMy) { maxMy = myVal; maxMyCoord = { x: px, y: py }; }
      if (myVal < minMy) { minMy = myVal; minMyCoord = { x: px, y: py }; }
    }
  }

  return {
    minX, maxX, minY, maxY,
    totalW, totalH,
    nx, ny, dx, dy,
    cols, rows,
    Mx, My, W_mm,
    nodeType,
    extrema: {
      maxMx: maxMx === -Infinity ? 0 : maxMx,
      minMx: minMx === Infinity ? 0 : minMx,
      maxMy: maxMy === -Infinity ? 0 : maxMy,
      minMy: minMy === Infinity ? 0 : minMy,
      maxMxCoord, minMxCoord, maxMyCoord, minMyCoord,
      maxDeflectionMm
    }
  };
}

function designFlexuralRebar({ M_kNm, b_m, h_m, cNom_mm, phi_mm, phiStirrup_mm = 0, concrete, steel }) {
  const M_abs = Math.abs(M_kNm);
  const d_m = Math.max(0.05, h_m - cNom_mm / 1000 - phiStirrup_mm / 1000 - (phi_mm / 2) / 1000);

  const AsMin = Math.max(
    0.26 * (concrete.fctm / steel.fyk) * b_m * d_m,
    0.0013 * b_m * d_m
  ) * 10000;

  if (M_abs < 0.1) {
    return {
      AsReq: AsMin,
      d_m,
      d_cm: d_m * 100,
      mu: 0,
      zeta: 0.95,
      overReinforced: false
    };
  }

  const M_MNm = M_abs / 1000;
  const mu = M_MNm / (b_m * d_m * d_m * concrete.fcd);
  const overReinforced = mu > steel.muLim;
  const muEff = Math.min(mu, steel.muLim);
  const xi = 1 - Math.sqrt(Math.max(0.01, 1 - 2 * muEff));
  const zeta = Math.max(0.75, 1 - 0.5 * xi);

  const AsCalc = (M_MNm / (zeta * d_m * steel.fyd)) * 10000;
  const AsReq = Math.max(AsCalc, AsMin);

  return {
    AsReq,
    d_m,
    d_cm: d_m * 100,
    mu,
    zeta,
    overReinforced
  };
}

function calcMomentResistance({ AsProv_cm2, d_m, b_m, concrete, steel }) {
  const As_m2 = Math.max(0, AsProv_cm2) / 10000;
  const maxAs_m2 = steel.xiLim * b_m * d_m * (concrete.fcd / steel.fyd);
  const AsEff_m2 = Math.min(As_m2, maxAs_m2);
  const a_m = (AsEff_m2 * steel.fyd) / (b_m * concrete.fcd);
  const z_m = Math.max(0.5 * d_m, d_m - 0.5 * a_m);
  const MRd_MNm = AsEff_m2 * steel.fyd * z_m;
  return Number((MRd_MNm * 1000).toFixed(2));
}

function selectBarSpacing(AsReq_cm2_m, preferredDiameters = [10, 12, 16]) {
  const maxSpacing = 20;
  const minSpacing = 8;

  for (const dia of preferredDiameters) {
    const areaOne = (Math.PI * Math.pow(dia / 10, 2)) / 4;
    const rawSpacing = (areaOne / Math.max(0.1, AsReq_cm2_m)) * 100;
    if (rawSpacing >= minSpacing) {
      const spacing = Math.min(maxSpacing, Math.floor(rawSpacing));
      const AsProv = (areaOne * 100) / spacing;
      return {
        dia,
        spacing,
        AsProv,
        label: `Ø${dia} co ${spacing} cm`
      };
    }
  }
  const dia = 20;
  const areaOne = (Math.PI * 4) / 4;
  const spacing = Math.max(7, Math.min(20, Math.floor((areaOne / AsReq_cm2_m) * 100)));
  return {
    dia,
    spacing,
    AsProv: (areaOne * 100) / spacing,
    label: `Ø${dia} co ${spacing} cm`
  };
}

function selectBeamBars(AsReq_cm2, preferredDiameters = [14, 16, 20]) {
  for (const dia of preferredDiameters) {
    const areaOne = (Math.PI * Math.pow(dia / 10, 2)) / 4;
    const count = Math.max(2, Math.ceil(AsReq_cm2 / areaOne));
    if (count <= 5) {
      return {
        count,
        dia,
        AsProv: count * areaOne,
        label: `${count}Ø${dia}`
      };
    }
  }
  const dia = 20;
  const areaOne = Math.PI;
  const count = Math.max(3, Math.ceil(AsReq_cm2 / areaOne));
  return { count, dia, AsProv: count * areaOne, label: `${count}Ø${dia}` };
}

const INITIAL_SINGLE_SLAB = [
  {
    id: 'panel-1',
    name: 'Pole P1 (Główne)',
    x: 0,
    y: 0,
    w: 7.50,
    h: 9.70,
    edges: {
      top: 'pinned',
      bottom: 'pinned',
      left: 'pinned',
      right: 'pinned'
    }
  }
];

const CONVERSATION_EXAMPLE_PANELS = [
  {
    id: 'panel-2',
    name: 'Pole P2 (Dolne)',
    x: 0,
    y: 0,
    w: 7.50,
    h: 2.75,
    edges: {
      top: 'pinned',
      bottom: 'pinned',
      left: 'pinned',
      right: 'pinned'
    }
  },
  {
    id: 'panel-1',
    name: 'Pole P1 (Górne)',
    x: 0,
    y: 2.75,
    w: 7.50,
    h: 9.70,
    edges: {
      top: 'pinned',
      bottom: 'pinned',
      left: 'pinned',
      right: 'pinned'
    }
  }
];

const CONVERSATION_EXAMPLE_OPENINGS = [
  {
    id: 'open-1',
    panelId: 'panel-1',
    name: 'Otwór przy prawej krawędzi',
    x: 6.50,
    y: 4.32,
    w: 1.00,
    h: 4.40,
    hasRib: true,
    ribWidth: 25,
    ribHeight: 30
  }
];

const INITIAL_LAYERS = [
  { id: 'l-1', name: 'Płyta żelbetowa (ciężar własny)', type: 'G', mode: 'volume', thickness: 16, density: 25.0, surfaceLoad: 0, isSlabSelfWeight: true },
  { id: 'l-2', name: 'Warstwy posadzkowe (jastrych + izolacja + wykończenie)', type: 'G', mode: 'surface', thickness: 6, density: 0, surfaceLoad: 1.50 },
  { id: 'l-3', name: 'Tynk gipsowy na suficie gr. 1,5 cm', type: 'G', mode: 'surface', thickness: 1.5, density: 0, surfaceLoad: 0.20 },
  { id: 'l-4', name: 'Zastępcze obciążenie od lekkich ścianek działowych (kat. A)', type: 'G', mode: 'surface', thickness: 0, density: 0, surfaceLoad: 1.20 },
  { id: 'l-5', name: 'Obciążenie użytkowe – Budynki mieszkalne (Kat. A)', type: 'Q', mode: 'surface', thickness: 0, density: 0, surfaceLoad: 2.00 },
];

export default function App() {
  const [activeTab, setActiveTab] = useState('geometry');

  const [panels, setPanels] = useState(INITIAL_SINGLE_SLAB);
  const [selectedPanelId, setSelectedPanelId] = useState('panel-1');
  const [openings, setOpenings] = useState([]);
  const [selectedOpeningId, setSelectedOpeningId] = useState(null);

  const [concreteKey, setConcreteKey] = useState('C25/30');
  const [steelKey, setSteelKey] = useState('B500SP');
  const [exposureKey, setExposureKey] = useState('XC1');
  const [slabThickness, setSlabThickness] = useState(16);
  const [cNom, setCNom] = useState(20);
  const [layers, setLayers] = useState(INITIAL_LAYERS);
  const [selectedPresetIdx, setSelectedPresetIdx] = useState(1);

  const [momentDir, setMomentDir] = useState('My');
  const [sectionAxis, setSectionAxis] = useState('Y');
  const [sectionPosRatio, setSectionPosRatio] = useState(0.86);
  const [hoveredCell, setHoveredCell] = useState(null);

  const [rebarLayerFilter, setRebarLayerFilter] = useState('all');
  const [selectedRebarPos, setSelectedRebarPos] = useState(null);

  const [manualOverrides, setManualOverrides] = useState({});

  const concrete = CONCRETE_CLASSES[concreteKey];
  const steel = STEEL_CLASSES[steelKey];

  const loadSummary = useMemo(() => {
    let gk = 0;
    let qk = 0;
    let gd = 0;
    let qdPart = 0;

    const rows = layers.map((layer) => {
      const charVal = layer.isSlabSelfWeight
        ? (slabThickness / 100) * layer.density
        : layer.mode === 'volume'
        ? (layer.thickness / 100) * layer.density
        : layer.surfaceLoad;

      const gamma = layer.type === 'G' ? 1.35 : 1.50;
      const designVal = charVal * gamma;

      if (layer.type === 'G') {
        gk += charVal;
        gd += designVal;
      } else {
        qk += charVal;
        qdPart += designVal;
      }

      return {
        ...layer,
        charVal: Number(charVal.toFixed(2)),
        gamma,
        designVal: Number(designVal.toFixed(2))
      };
    });

    const gkRounded = Number(gk.toFixed(2));
    const qkRounded = Number(qk.toFixed(2));
    const gdRounded = Number(gd.toFixed(2));
    const qdPartRounded = Number(qdPart.toFixed(2));

    return {
      rows,
      gk: gkRounded,
      qk: qkRounded,
      gd: gdRounded,
      qdPart: qdPartRounded,
      qdTotal: Number((gdRounded + qdPartRounded).toFixed(2))
    };
  }, [layers, slabThickness]);

  const femResult = useMemo(() => {
    return solveSlabFEM({
      panels,
      openings,
      qd: loadSummary.qdTotal,
      thicknessCm: slabThickness,
      Ecm: concrete.Ecm
    });
  }, [panels, openings, loadSummary.qdTotal, slabThickness, concrete.Ecm]);

  const reinforcementDesign = useMemo(() => {
    if (!femResult) return null;

    const { extrema } = femResult;
    const h_m = slabThickness / 100;

    const autoBottomX = designFlexuralRebar({
      M_kNm: Math.max(12, extrema.maxMx),
      b_m: 1.0,
      h_m,
      cNom_mm: cNom,
      phi_mm: 12,
      concrete,
      steel
    });
    const autoSpX = selectBarSpacing(autoBottomX.AsReq, [10, 12, 16]);
    const ovX = manualOverrides.bottomX;
    const diaX = ovX?.dia ?? autoSpX.dia;
    const spacingX = ovX?.spacing ?? autoSpX.spacing;
    const flexX = designFlexuralRebar({
      M_kNm: Math.max(0.5, extrema.maxMx),
      b_m: 1.0,
      h_m,
      cNom_mm: cNom,
      phi_mm: diaX,
      concrete,
      steel
    });
    const asProvX = ((Math.PI * Math.pow(diaX / 10, 2)) / 4) * (100 / spacingX);
    const mRdX = calcMomentResistance({
      AsProv_cm2: asProvX,
      d_m: flexX.d_m,
      b_m: 1.0,
      concrete,
      steel
    });
    const utilX = Number(((Math.max(0.5, extrema.maxMx) / Math.max(0.1, mRdX)) * 100).toFixed(1));

    const rebarBottomX = {
      dia: diaX,
      spacing: spacingX,
      AsProv: asProvX,
      AsReq: flexX.AsReq,
      MEd: Number(Math.max(0.5, extrema.maxMx).toFixed(2)),
      MRd: mRdX,
      utilization: utilX,
      label: `Ø${diaX} co ${spacingX} cm`,
      isManual: Boolean(ovX)
    };

    const effectivePlateMy = openings.some(o => o.hasRib)
      ? extrema.maxMy * 0.62
      : extrema.maxMy;
    const autoBottomY = designFlexuralRebar({
      M_kNm: Math.max(10, effectivePlateMy),
      b_m: 1.0,
      h_m,
      cNom_mm: cNom,
      phi_mm: 12,
      phiStirrup_mm: 12,
      concrete,
      steel
    });
    const autoSpY = selectBarSpacing(autoBottomY.AsReq, [10, 12, 16]);
    const ovY = manualOverrides.bottomY;
    const diaY = ovY?.dia ?? autoSpY.dia;
    const spacingY = ovY?.spacing ?? autoSpY.spacing;
    const flexY = designFlexuralRebar({
      M_kNm: Math.max(0.5, effectivePlateMy),
      b_m: 1.0,
      h_m,
      cNom_mm: cNom,
      phi_mm: diaY,
      phiStirrup_mm: diaY,
      concrete,
      steel
    });
    const asProvY = ((Math.PI * Math.pow(diaY / 10, 2)) / 4) * (100 / spacingY);
    const mRdY = calcMomentResistance({
      AsProv_cm2: asProvY,
      d_m: flexY.d_m,
      b_m: 1.0,
      concrete,
      steel
    });
    const utilY = Number(((Math.max(0.5, effectivePlateMy) / Math.max(0.1, mRdY)) * 100).toFixed(1));

    const rebarBottomY = {
      dia: diaY,
      spacing: spacingY,
      AsProv: asProvY,
      AsReq: flexY.AsReq,
      MEd: Number(Math.max(0.5, effectivePlateMy).toFixed(2)),
      MRd: mRdY,
      utilization: utilY,
      label: `Ø${diaY} co ${spacingY} cm`,
      isManual: Boolean(ovY)
    };

    const hasContinuousSupport = femResult.extrema.minMy < -3 || femResult.extrema.minMx < -3;
    const hasInternalSupport = panels.length > 1 || hasContinuousSupport;
    const maxNegMoment = hasContinuousSupport
      ? Math.max(Math.abs(extrema.minMy), Math.abs(extrema.minMx))
      : 0;
    const autoTopSup = designFlexuralRebar({
      M_kNm: Math.max(14, maxNegMoment),
      b_m: 1.0,
      h_m,
      cNom_mm: cNom,
      phi_mm: 16,
      concrete,
      steel
    });
    const autoSpSup = selectBarSpacing(autoTopSup.AsReq, [12, 16, 20]);
    const ovSup = manualOverrides.topSupport;
    const diaSup = ovSup?.dia ?? autoSpSup.dia;
    const spacingSup = ovSup?.spacing ?? autoSpSup.spacing;
    const flexSup = designFlexuralRebar({
      M_kNm: Math.max(0.5, maxNegMoment),
      b_m: 1.0,
      h_m,
      cNom_mm: cNom,
      phi_mm: diaSup,
      concrete,
      steel
    });
    const asProvSup = ((Math.PI * Math.pow(diaSup / 10, 2)) / 4) * (100 / spacingSup);
    const mRdSup = calcMomentResistance({
      AsProv_cm2: asProvSup,
      d_m: flexSup.d_m,
      b_m: 1.0,
      concrete,
      steel
    });
    const utilSup = Number(((Math.max(0.5, maxNegMoment) / Math.max(0.1, mRdSup)) * 100).toFixed(1));

    const rebarTopSupport = {
      dia: diaSup,
      spacing: spacingSup,
      AsProv: asProvSup,
      AsReq: flexSup.AsReq,
      MEd: Number(Math.max(0.5, maxNegMoment).toFixed(2)),
      MRd: mRdSup,
      utilization: utilSup,
      label: `Ø${diaSup} co ${spacingSup} cm`,
      isManual: Boolean(ovSup)
    };

    const ribsDesign = openings
      .filter(op => op.hasRib)
      .map(op => {
        const ribSpan = Math.max(op.w, op.h);
        const ribW_m = (op.ribWidth || 25) / 100;
        const ribH_m = (op.ribHeight || 30) / 100;
        const extraSelfWeight = 1.35 * ribW_m * Math.max(0, ribH_m - h_m) * 25;
        const qLine = 1.75 * loadSummary.qdTotal + extraSelfWeight;
        const mRib = (qLine * ribSpan * ribSpan) / 10;
        const vRib = (qLine * ribSpan) / 2;

        const botDesign = designFlexuralRebar({
          M_kNm: mRib,
          b_m: ribW_m,
          h_m: ribH_m,
          cNom_mm: Math.max(25, cNom),
          phi_mm: 16,
          phiStirrup_mm: 8,
          concrete,
          steel
        });
        const topDesign = designFlexuralRebar({
          M_kNm: mRib * 0.83,
          b_m: ribW_m,
          h_m: ribH_m,
          cNom_mm: Math.max(25, cNom),
          phi_mm: 14,
          phiStirrup_mm: 8,
          concrete,
          steel
        });

        const autoBotBars = selectBeamBars(botDesign.AsReq, [14, 16, 20]);
        const autoTopBars = selectBeamBars(topDesign.AsReq, [12, 14, 16]);

        const ovRib = manualOverrides[`rib-${op.id}`];
        const botDia = ovRib?.botDia ?? autoBotBars.dia;
        const botCount = ovRib?.botCount ?? autoBotBars.count;
        const topDia = ovRib?.topDia ?? autoTopBars.dia;
        const topCount = ovRib?.topCount ?? autoTopBars.count;

        const botAsProv = botCount * ((Math.PI * Math.pow(botDia / 10, 2)) / 4);
        const topAsProv = topCount * ((Math.PI * Math.pow(topDia / 10, 2)) / 4);

        const botFlexActual = designFlexuralRebar({
          M_kNm: mRib,
          b_m: ribW_m,
          h_m: ribH_m,
          cNom_mm: Math.max(25, cNom),
          phi_mm: botDia,
          phiStirrup_mm: 8,
          concrete,
          steel
        });
        const ribMRd = calcMomentResistance({
          AsProv_cm2: botAsProv,
          d_m: botFlexActual.d_m,
          b_m: ribW_m,
          concrete,
          steel
        });
        const ribUtilM = Number(((mRib / Math.max(0.1, ribMRd)) * 100).toFixed(1));

        const kShear = Math.min(2.0, 1 + Math.sqrt(200 / Math.max(50, botFlexActual.d_cm)));
        const rhoL = Math.min(0.02, botAsProv / (ribW_m * 100 * botFlexActual.d_cm));
        const vMin = 0.035 * Math.pow(kShear, 1.5) * Math.sqrt(concrete.fck);
        const vRdC = Number(
          (Math.max(0.12 * kShear * Math.pow(100 * rhoL * concrete.fck, 1 / 3), vMin) * ribW_m * botFlexActual.d_m * 1000).toFixed(1)
        );
        const ribUtilV = Number(((vRib / Math.max(1, vRdC)) * 100).toFixed(1));

        const stirrupSpacing = vRib > 40 ? 'Ø8 co 10 / 15 cm' : 'Ø8 co 15 cm';

        return {
          openingId: op.id,
          openingName: op.name,
          ribSpan,
          ribW: op.ribWidth || 25,
          ribH: op.ribHeight || 30,
          mRib: Number(mRib.toFixed(1)),
          vRib: Number(vRib.toFixed(1)),
          ribMRd,
          vRdC,
          ribUtilM,
          ribUtilV,
          botBars: { count: botCount, dia: botDia, AsProv: botAsProv, label: `${botCount}Ø${botDia}` },
          topBars: { count: topCount, dia: topDia, AsProv: topAsProv, label: `${topCount}Ø${topDia}` },
          stirrupSpacing,
          totalLength: Number((ribSpan + 1.70).toFixed(2)),
          overReinforced: botFlexActual.overReinforced,
          isManual: Boolean(ovRib)
        };
      });

    const positions = [
      {
        pos: 'Poz. 1',
        zone: 'Płyta – zbrojenie dolne (kierunek X)',
        rebar: rebarBottomX.label,
        asReq: `${rebarBottomX.AsReq.toFixed(2)} cm²/m`,
        asProv: `${rebarBottomX.AsProv.toFixed(2)} cm²/m`,
        utilization: rebarBottomX.utilization,
        mRd: rebarBottomX.MRd,
        notes: 'Warstwa zewnętrzna dolna (otulina c_nom). Rozłożyć na całej powierzchni pól.'
      },
      {
        pos: 'Poz. 2',
        zone: 'Płyta – zbrojenie dolne (kierunek Y)',
        rebar: rebarBottomY.label,
        asReq: `${rebarBottomY.AsReq.toFixed(2)} cm²/m`,
        asProv: `${rebarBottomY.AsProv.toFixed(2)} cm²/m`,
        utilization: rebarBottomY.utilization,
        mRd: rebarBottomY.MRd,
        notes: 'Druga warstwa dolna. Zakotwić na podporach.'
      },
      ...(hasInternalSupport
        ? [
            {
              pos: 'Poz. 3',
              zone: 'Płyta – zbrojenie górne nad podporami / utwierdzeniem',
              rebar: rebarTopSupport.label,
              asReq: `${rebarTopSupport.AsReq.toFixed(2)} cm²/m`,
              asProv: `${rebarTopSupport.AsProv.toFixed(2)} cm²/m`,
              utilization: rebarTopSupport.utilization,
              mRd: rebarTopSupport.MRd,
              notes: 'Zbrojenie górne nad ścianą pośrednią (wysięg min. 0,25·L w przęsła sąsiednie).'
            }
          ]
        : []),
      {
        pos: hasInternalSupport ? 'Poz. 4' : 'Poz. 3',
        zone: 'Krawędzie zewnętrzne płyty (U-pręty)',
        rebar: 'U-Ø10 co 15 cm',
        asReq: 'Konstrukcyjne',
        asProv: '5,24 cm²/m',
        utilization: 42.0,
        mRd: null,
        notes: 'Wysięg ramion 1,00 m w głąb płyty na całym obwodzie zewnętrznym.'
      }
    ];

    ribsDesign.forEach((rd) => {
      positions.push({
        pos: `Poz. ${positions.length + 1}`,
        zone: `Żebro ${rd.ribW}×${rd.ribH} cm przy otworze (${rd.openingName})`,
        rebar: `Dół: ${rd.botBars.label}, Góra: ${rd.topBars.label}, Strz.: ${rd.stirrupSpacing}`,
        asReq: `M = ${rd.mRib} kNm`,
        asProv: `As1 = ${rd.botBars.AsProv.toFixed(2)} cm²`,
        utilization: rd.ribUtilM,
        mRd: rd.ribMRd,
        notes: `Długość prętów L = ${rd.totalLength} m (zakotwienie po 85 cm poza otwór).`
      });
    });

    if (openings.length > 0) {
      positions.push({
        pos: `Poz. ${positions.length + 1}`,
        zone: 'Wzmocnienie naroży otworów (pręty ukośne 45°)',
        rebar: '2Ø12 góra + 2Ø12 dół (L = 1,60 m)',
        asReq: '4,52 cm² / naroże',
        asProv: '4,52 cm² / naroże',
        utilization: 55.0,
        mRd: null,
        notes: 'Układać pod kątem 45° w każdym narożu wewnętrznym otworu.'
      });
    }

    return {
      rebarBottomX,
      rebarBottomY,
      rebarTopSupport,
      hasInternalSupport,
      ribsDesign,
      positions
    };
  }, [femResult, slabThickness, cNom, concrete, steel, openings, panels.length, loadSummary.qdTotal, manualOverrides]);

  const handleAddAdjacentPanel = (basePanel, direction) => {
    const newId = `panel-${Date.now()}`;
    const defaultSpan = direction === 'top' || direction === 'bottom' ? 3.50 : 4.00;
    let newPanel;

    if (direction === 'bottom') {
      newPanel = {
        id: newId,
        name: `Pole P${panels.length + 1} (Dolne)`,
        x: basePanel.x,
        y: Number((basePanel.y - defaultSpan).toFixed(2)),
        w: basePanel.w,
        h: defaultSpan,
        edges: { top: 'pinned', bottom: 'pinned', left: 'pinned', right: 'pinned' }
      };
    } else if (direction === 'top') {
      newPanel = {
        id: newId,
        name: `Pole P${panels.length + 1} (Górne)`,
        x: basePanel.x,
        y: Number((basePanel.y + basePanel.h).toFixed(2)),
        w: basePanel.w,
        h: defaultSpan,
        edges: { top: 'pinned', bottom: 'pinned', left: 'pinned', right: 'pinned' }
      };
    } else if (direction === 'left') {
      newPanel = {
        id: newId,
        name: `Pole P${panels.length + 1} (Lewe)`,
        x: Number((basePanel.x - defaultSpan).toFixed(2)),
        y: basePanel.y,
        w: defaultSpan,
        h: basePanel.h,
        edges: { top: 'pinned', bottom: 'pinned', left: 'pinned', right: 'pinned' }
      };
    } else {
      newPanel = {
        id: newId,
        name: `Pole P${panels.length + 1} (Prawe)`,
        x: Number((basePanel.x + basePanel.w).toFixed(2)),
        y: basePanel.y,
        w: defaultSpan,
        h: basePanel.h,
        edges: { top: 'pinned', bottom: 'pinned', left: 'pinned', right: 'pinned' }
      };
    }

    setPanels(prev => [...prev, newPanel]);
    setSelectedPanelId(newId);
  };

  const handleUpdatePanelDimension = (panelId, field, value) => {
    const numVal = Math.max(1.0, Math.min(20.0, Number(value) || 1.0));
    setPanels(prev => {
      const target = prev.find(p => p.id === panelId);
      if (!target) return prev;
      const oldW = target.w;
      const oldH = target.h;
      const deltaW = Number((numVal - oldW).toFixed(2));
      const deltaH = Number((numVal - oldH).toFixed(2));

      return prev.map(p => {
        if (p.id === panelId) {
          return { ...p, [field]: numVal };
        }
        if (field === 'h' && p.y >= target.y + oldH - 0.05) {
          return { ...p, y: Number((p.y + deltaH).toFixed(2)) };
        }
        if (field === 'w' && p.x >= target.x + oldW - 0.05) {
          return { ...p, x: Number((p.x + deltaW).toFixed(2)) };
        }
        if (field === 'w' && Math.abs(p.x - target.x) < 0.05 && Math.abs(p.w - oldW) < 0.05) {
          return { ...p, w: numVal };
        }
        return p;
      });
    });
  };

  const handleDeletePanel = (panelId) => {
    if (panels.length <= 1) return;
    setPanels(prev => {
      const remaining = prev.filter(p => p.id !== panelId);
      setSelectedPanelId(remaining[0].id);
      return remaining;
    });
    setOpenings(prev => prev.filter(op => op.panelId !== panelId));
  };

  const handleAddOpening = () => {
    const targetPanel = panels.find(p => p.id === selectedPanelId) || panels[0];
    const ow = Math.min(1.20, Number((targetPanel.w * 0.25).toFixed(2)));
    const oh = Math.min(2.00, Number((targetPanel.h * 0.25).toFixed(2)));
    const newOp = {
      id: `open-${Date.now()}`,
      panelId: targetPanel.id,
      name: `Otwór O${openings.length + 1}`,
      x: Number((targetPanel.x + (targetPanel.w - ow) / 2).toFixed(2)),
      y: Number((targetPanel.y + (targetPanel.h - oh) / 2).toFixed(2)),
      w: ow,
      h: oh,
      hasRib: true,
      ribWidth: 25,
      ribHeight: 30
    };
    setOpenings(prev => [...prev, newOp]);
    setSelectedOpeningId(newOp.id);
  };

  const handleLoadConversationPreset = () => {
    setPanels(CONVERSATION_EXAMPLE_PANELS);
    setOpenings(CONVERSATION_EXAMPLE_OPENINGS);
    setSelectedPanelId('panel-1');
    setSelectedOpeningId('open-1');
    setSlabThickness(16);
    setConcreteKey('C25/30');
    setSteelKey('B500SP');
    setLayers(INITIAL_LAYERS);
    setMomentDir('My');
  };

  const handleResetSingleSlab = () => {
    setPanels(INITIAL_SINGLE_SLAB);
    setOpenings([]);
    setSelectedPanelId('panel-1');
    setSelectedOpeningId(null);
    setSlabThickness(16);
    setManualOverrides({});
  };

  const handleResizePanelEdge = React.useCallback((panelId, edge, newCoordRaw) => {
    const snap = 0.05;
    const snapped = Number((Math.round(newCoordRaw / snap) * snap).toFixed(2));
    const minSpan = 1.0;

    setPanels(prev => {
      const target = prev.find(p => p.id === panelId);
      if (!target) return prev;

      let nextX = target.x;
      let nextY = target.y;
      let nextW = target.w;
      let nextH = target.h;

      if (edge === 'right') {
        const clampedRight = Math.max(Number((target.x + minSpan).toFixed(2)), snapped);
        nextW = Number((clampedRight - target.x).toFixed(2));
      } else if (edge === 'left') {
        const fixedRight = Number((target.x + target.w).toFixed(2));
        const clampedLeft = Math.min(Number((fixedRight - minSpan).toFixed(2)), snapped);
        nextX = clampedLeft;
        nextW = Number((fixedRight - clampedLeft).toFixed(2));
      } else if (edge === 'top') {
        const clampedTop = Math.max(Number((target.y + minSpan).toFixed(2)), snapped);
        nextH = Number((clampedTop - target.y).toFixed(2));
      } else if (edge === 'bottom') {
        const fixedTop = Number((target.y + target.h).toFixed(2));
        const clampedBottom = Math.min(Number((fixedTop - minSpan).toFixed(2)), snapped);
        nextY = clampedBottom;
        nextH = Number((fixedTop - clampedBottom).toFixed(2));
      }

      const oldRight = Number((target.x + target.w).toFixed(2));
      const newRight = Number((nextX + nextW).toFixed(2));
      const deltaRight = Number((newRight - oldRight).toFixed(2));

      const oldTop = Number((target.y + target.h).toFixed(2));
      const newTop = Number((nextY + nextH).toFixed(2));
      const deltaTop = Number((newTop - oldTop).toFixed(2));

      const deltaLeft = Number((nextX - target.x).toFixed(2));
      const deltaBottom = Number((nextY - target.y).toFixed(2));

      setOpenings(prevOps =>
        prevOps.map(op => {
          if (op.panelId !== panelId) return op;
          let ox = Number((op.x + (edge === 'left' ? deltaLeft : 0)).toFixed(2));
          let oy = Number((op.y + (edge === 'bottom' ? deltaBottom : 0)).toFixed(2));
          const maxXAllowed = Number((nextX + nextW).toFixed(2));
          const maxYAllowed = Number((nextY + nextH).toFixed(2));
          if (ox + op.w > maxXAllowed) {
            ox = Math.max(nextX, Number((maxXAllowed - op.w).toFixed(2)));
          }
          if (oy + op.h > maxYAllowed) {
            oy = Math.max(nextY, Number((maxYAllowed - op.h).toFixed(2)));
          }
          return { ...op, x: ox, y: oy };
        })
      );

      return prev.map(p => {
        if (p.id === panelId) {
          return { ...p, x: nextX, y: nextY, w: nextW, h: nextH };
        }
        if (edge === 'top' && p.y >= oldTop - 0.06) {
          return { ...p, y: Number((p.y + deltaTop).toFixed(2)) };
        }
        if (edge === 'bottom' && (p.y + p.h) <= target.y + 0.06) {
          return { ...p, h: Math.max(minSpan, Number((p.h + deltaBottom).toFixed(2))) };
        }
        if (edge === 'right' && p.x >= oldRight - 0.06) {
          return { ...p, x: Number((p.x + deltaRight).toFixed(2)) };
        }
        if (edge === 'left' && (p.x + p.w) <= target.x + 0.06) {
          return { ...p, w: Math.max(minSpan, Number((p.w - deltaLeft).toFixed(2))) };
        }
        return p;
      });
    });
  }, []);

  const isEdgeFree = (panel, dir) => {
    const tol = 0.08;
    return !panels.some(other => {
      if (other.id === panel.id) return false;
      const overlapX = Math.min(panel.x + panel.w, other.x + other.w) - Math.max(panel.x, other.x) > tol;
      const overlapY = Math.min(panel.y + panel.h, other.y + other.h) - Math.max(panel.y, other.y) > tol;
      if (dir === 'top') return overlapX && Math.abs((panel.y + panel.h) - other.y) < tol;
      if (dir === 'bottom') return overlapX && Math.abs(panel.y - (other.y + other.h)) < tol;
      if (dir === 'left') return overlapY && Math.abs(panel.x - (other.x + other.w)) < tol;
      if (dir === 'right') return overlapY && Math.abs((panel.x + panel.w) - other.x) < tol;
      return false;
    });
  };

  const selectedPanel = panels.find(p => p.id === selectedPanelId) || panels[0];
  const selectedOpening = openings.find(o => o.id === selectedOpeningId) || null;

  const getEdgeNeighborInfo = (panel, dir) => {
    const tol = 0.08;
    const neighbor = panels.find(other => {
      if (other.id === panel.id) return false;
      const overlapX = Math.min(panel.x + panel.w, other.x + other.w) - Math.max(panel.x, other.x) > tol;
      const overlapY = Math.min(panel.y + panel.h, other.y + other.h) - Math.max(panel.y, other.y) > tol;
      if (dir === 'top') return overlapX && Math.abs((panel.y + panel.h) - other.y) < tol;
      if (dir === 'bottom') return overlapX && Math.abs(panel.y - (other.y + other.h)) < tol;
      if (dir === 'left') return overlapY && Math.abs(panel.x - (other.x + other.w)) < tol;
      if (dir === 'right') return overlapY && Math.abs((panel.x + panel.w) - other.x) < tol;
      return false;
    });

    if (!neighbor) return null;
    const oppositeMap = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };
    const oppDir = oppositeMap[dir];
    const bothClamped = panel.edges[dir] === 'clamped' && neighbor.edges[oppDir] === 'clamped';
    return { neighbor, oppDir, bothClamped };
  };

  if (!concrete || !steel) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-6 text-sm">
        Błąd inicjalizacji danych materiałowych. Odśwież widok lub zresetuj konfigurację.
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-sky-500/30">
      <header className="bg-slate-900 border-b border-slate-800 px-4 py-3 sticky top-0 z-30 shadow-lg">
        <div className="max-w-7xl mx-auto flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-sky-500 to-indigo-600 flex items-center justify-center shadow-md shadow-sky-500/20">
              <Grid className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base sm:text-lg font-bold tracking-tight text-white">
                  SlabCAD <span className="text-sky-400">EC1/EC2</span>
                </h1>
                <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-sky-500/15 text-sky-300 border border-sky-500/30">
                  PN-EN 1991 &amp; 1992
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Analiza MES/MRS płyt wielopolowych z otworami, mapy momentów i generowanie zbrojenia
              </p>
            </div>
          </div>

          <nav className="flex items-center bg-slate-950/90 p-1 rounded-xl border border-slate-800 overflow-x-auto">
            <button
              onClick={() => setActiveTab('geometry')}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs sm:text-sm font-medium transition-all whitespace-nowrap ${
                activeTab === 'geometry'
                  ? 'bg-sky-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
              }`}
            >
              <Square className="w-4 h-4" />
              <span>1. Geometria i Otwory</span>
              <span className="ml-1 px-1.5 py-0.2 text-[10px] rounded bg-black/25">
                {panels.length} {panels.length === 1 ? 'pole' : 'pola'}
              </span>
            </button>

            <button
              onClick={() => setActiveTab('loads')}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs sm:text-sm font-medium transition-all whitespace-nowrap ${
                activeTab === 'loads'
                  ? 'bg-sky-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
              }`}
            >
              <Layers className="w-4 h-4" />
              <span>2. Materiały i Warstwy</span>
              <span className="ml-1 px-1.5 py-0.2 text-[10px] rounded bg-black/25">
                {loadSummary.qdTotal} kN/m²
              </span>
            </button>

            <button
              onClick={() => setActiveTab('results')}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs sm:text-sm font-medium transition-all whitespace-nowrap ${
                activeTab === 'results'
                  ? 'bg-sky-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
              }`}
            >
              <Calculator className="w-4 h-4" />
              <span>3. Mapy Momentów i Zbrojenie</span>
            </button>
          </nav>

          <div className="hidden xl:flex items-center gap-4 text-xs bg-slate-950/70 px-3.5 py-2 rounded-xl border border-slate-800/80">
            <div>
              <span className="text-slate-500 block">Obciążenie q_d</span>
              <span className="font-mono font-semibold text-amber-400">{loadSummary.qdTotal.toFixed(2)} kN/m²</span>
            </div>
            <div className="h-6 w-px bg-slate-800" />
            <div>
              <span className="text-slate-500 block">Mx,max</span>
              <span className="font-mono font-semibold text-rose-400">
                +{femResult?.extrema.maxMx.toFixed(1) || '0.0'} kNm/m
              </span>
            </div>
            <div className="h-6 w-px bg-slate-800" />
            <div>
              <span className="text-slate-500 block">My,max</span>
              <span className="font-mono font-semibold text-sky-400">
                +{femResult?.extrema.maxMy.toFixed(1) || '0.0'} kNm/m
              </span>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6">
        {activeTab === 'geometry' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-7 bg-slate-900 rounded-2xl border border-slate-800 p-4 flex flex-col">
              <div className="flex flex-wrap items-center justify-between gap-2 pb-3 mb-3 border-b border-slate-800">
                <div>
                  <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                    <Crosshair className="w-4 h-4 text-sky-400" />
                    Rzut konstrukcyjny stropu (przeciągnij krawędź myszką lub kliknij „+”)
                  </h2>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Grubość płyty: <strong className="text-slate-200">{slabThickness} cm</strong> | Wymiary całkowite:{' '}
                    <strong className="text-slate-200">
                      {femResult?.totalW.toFixed(2)} m × {femResult?.totalH.toFixed(2)} m
                    </strong>{' '}
                    <span className="text-sky-400/90">• skok przesuwu krawędzi: 0,05 m</span>
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={handleLoadConversationPreset}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-indigo-600/20 text-indigo-300 border border-indigo-500/40 hover:bg-indigo-600/30 transition"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>Wczytaj przykład z rozmowy</span>
                  </button>
                  <button
                    onClick={handleResetSingleSlab}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-slate-800 text-slate-300 hover:bg-slate-700 transition"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>Reset</span>
                  </button>
                </div>
              </div>

              <div className="flex-1 min-h-[460px] bg-slate-950 rounded-xl border border-slate-800/90 relative overflow-hidden flex items-center justify-center p-4">
                <GeometryCADCanvas
                  panels={panels}
                  openings={openings}
                  selectedPanelId={selectedPanelId}
                  selectedOpeningId={selectedOpeningId}
                  onSelectPanel={(id) => {
                    setSelectedPanelId(id);
                    setSelectedOpeningId(null);
                  }}
                  onSelectOpening={(id) => setSelectedOpeningId(id)}
                  onAddAdjacentPanel={handleAddAdjacentPanel}
                  onResizePanelEdge={handleResizePanelEdge}
                  isEdgeFree={isEdgeFree}
                />
              </div>

              <div className="mt-3 pt-3 border-t border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-400">
                <div className="flex flex-wrap items-center gap-4">
                  <span className="flex items-center gap-1.5">
                    <span className="w-4 h-1 bg-emerald-400 inline-block rounded" /> Swobodnie podparty
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-4 h-1.5 bg-amber-400 inline-block rounded" /> Zamocowany
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-4 h-1.5 bg-cyan-400 inline-block rounded" /> Ciągły (2× zamocowany)
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-4 h-0.5 border-b border-dashed border-slate-500 inline-block" /> Wolny koniec
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-3 h-3 bg-purple-500/40 border border-purple-400 inline-block rounded-sm" /> Żebro wzmacniające
                  </span>
                </div>
                <button
                  onClick={() => setActiveTab('loads')}
                  className="text-sky-400 hover:text-sky-300 font-medium flex items-center gap-1"
                >
                  Dalej: Materiały i obciążenia <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="lg:col-span-5 flex flex-col gap-5">
              <div className="bg-slate-900 rounded-2xl border border-slate-800 p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                    <Ruler className="w-4 h-4 text-sky-400" />
                    Właściwości pola: <span className="text-sky-400">{selectedPanel?.name}</span>
                  </h3>
                  {panels.length > 1 && (
                    <button
                      onClick={() => handleDeletePanel(selectedPanel.id)}
                      className="text-xs text-rose-400 hover:text-rose-300 flex items-center gap-1 px-2 py-1 rounded bg-rose-500/10 border border-rose-500/20"
                    >
                      <Trash2 className="w-3.5 h-3.5" /> Usuń pole
                    </button>
                  )}
                </div>

                {selectedPanel && (
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs text-slate-400 mb-1">Szerokość Lx [m]</label>
                        <input
                          type="number"
                          step="0.05"
                          min="1.0"
                          max="20.0"
                          value={selectedPanel.w}
                          onChange={(e) => handleUpdatePanelDimension(selectedPanel.id, 'w', e.target.value)}
                          className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm font-mono text-white focus:outline-none focus:border-sky-500"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-slate-400 mb-1">Długość Ly [m]</label>
                        <input
                          type="number"
                          step="0.05"
                          min="1.0"
                          max="20.0"
                          value={selectedPanel.h}
                          onChange={(e) => handleUpdatePanelDimension(selectedPanel.id, 'h', e.target.value)}
                          className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm font-mono text-white focus:outline-none focus:border-sky-500"
                        />
                      </div>
                    </div>

                    <div>
                      <span className="block text-xs text-slate-400 mb-2">
                        Sposób podparcia krawędzi pola (dwie wspólne zamocowane = ciągła):
                      </span>
                      <div className="grid grid-cols-2 gap-2.5 text-xs">
                        {[
                          { key: 'top', label: 'Krawędź górna' },
                          { key: 'bottom', label: 'Krawędź dolna' },
                          { key: 'left', label: 'Krawędź lewa' },
                          { key: 'right', label: 'Krawędź prawa' }
                        ].map(edge => {
                          const sharedInfo = getEdgeNeighborInfo(selectedPanel, edge.key);
                          return (
                            <div key={edge.key} className="bg-slate-950 p-2 rounded-lg border border-slate-800">
                              <div className="flex items-center justify-between gap-1 mb-1">
                                <span className="text-slate-400">{edge.label}</span>
                                {sharedInfo?.bothClamped && (
                                  <span className="text-[10px] px-1.5 py-0.2 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 font-medium">
                                    ciągła
                                  </span>
                                )}
                              </div>
                              <select
                                value={selectedPanel.edges[edge.key]}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setPanels(prev =>
                                    prev.map(p =>
                                      p.id === selectedPanel.id
                                        ? { ...p, edges: { ...p.edges, [edge.key]: val } }
                                        : p
                                    )
                                  );
                                }}
                                className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-slate-200 focus:outline-none focus:border-sky-500"
                              >
                                <option value="pinned">Swobodnie podparty</option>
                                <option value="clamped">Zamocowany</option>
                                <option value="free">Wolny koniec</option>
                              </select>
                              {sharedInfo && (
                                <span className="block text-[10px] text-slate-500 mt-1">
                                  Wspólna z {sharedInfo.neighbor.name} ({sharedInfo.neighbor.edges[sharedInfo.oppDir]})
                                </span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    <div className="pt-2 border-t border-slate-800">
                      <span className="block text-xs text-slate-400 mb-2">Dodaj przylegające pole płyty:</span>
                      <div className="grid grid-cols-4 gap-2">
                        {[
                          { dir: 'top', label: 'U góry', icon: ArrowUp },
                          { dir: 'bottom', label: 'U dołu', icon: ArrowDown },
                          { dir: 'left', label: 'Z lewej', icon: ArrowLeft },
                          { dir: 'right', label: 'Z prawej', icon: ArrowRight }
                        ].map(btn => {
                          const Icon = btn.icon;
                          const free = isEdgeFree(selectedPanel, btn.dir);
                          return (
                            <button
                              key={btn.dir}
                              disabled={!free}
                              onClick={() => handleAddAdjacentPanel(selectedPanel, btn.dir)}
                              className={`flex flex-col items-center justify-center py-2 px-1 rounded-lg border text-xs transition ${
                                free
                                  ? 'bg-slate-950 border-slate-700 text-slate-200 hover:border-sky-500 hover:text-sky-400'
                                  : 'bg-slate-950/40 border-slate-800/50 text-slate-600 cursor-not-allowed'
                              }`}
                            >
                              <Icon className="w-3.5 h-3.5 mb-0.5" />
                              <span>{btn.label}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="bg-slate-900 rounded-2xl border border-slate-800 p-4 flex-1">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                    <Maximize2 className="w-4 h-4 text-purple-400" />
                    Otwory w stropie i żebra krawędziowe ({openings.length})
                  </h3>
                  <button
                    onClick={handleAddOpening}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-sky-600 text-white hover:bg-sky-500 transition shadow-sm"
                  >
                    <Plus className="w-3.5 h-3.5" /> Dodaj otwór
                  </button>
                </div>

                {openings.length === 0 ? (
                  <div className="text-center py-8 px-4 bg-slate-950/60 rounded-xl border border-dashed border-slate-800">
                    <p className="text-xs text-slate-400">
                      Brak zdefiniowanych otworów. Kliknij <strong className="text-slate-200">„Dodaj otwór”</strong>, aby wyciąć otwór technologiczny lub klatkę schodową w wybranym polu.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="flex flex-wrap gap-1.5">
                      {openings.map((op, i) => (
                        <button
                          key={op.id}
                          onClick={() => setSelectedOpeningId(op.id)}
                          className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition ${
                            selectedOpening?.id === op.id
                              ? 'bg-purple-500/20 border-purple-400 text-purple-200'
                              : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                          }`}
                        >
                          {op.name || `Otwór #${i + 1}`} ({op.w.toFixed(2)}×{op.h.toFixed(2)}m)
                        </button>
                      ))}
                    </div>

                    {selectedOpening && (() => {
                      const hostPanel = panels.find(p => p.id === selectedOpening.panelId) || panels[0];
                      const distFromLeft = Number((selectedOpening.x - hostPanel.x).toFixed(2));
                      const distFromTop = Number(((hostPanel.y + hostPanel.h) - (selectedOpening.y + selectedOpening.h)).toFixed(2));
                      const touchesRightEdge = Math.abs((selectedOpening.x + selectedOpening.w) - (hostPanel.x + hostPanel.w)) < 0.03;
                      const touchesLeftEdge = Math.abs(selectedOpening.x - hostPanel.x) < 0.03;

                      return (
                        <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800 space-y-3">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold text-purple-300">
                              Edycja: {selectedOpening.name} (w {hostPanel.name})
                            </span>
                            <button
                              onClick={() => {
                                setOpenings(prev => prev.filter(o => o.id !== selectedOpening.id));
                                setSelectedOpeningId(null);
                              }}
                              className="text-xs text-rose-400 hover:text-rose-300 flex items-center gap-1"
                            >
                              <Trash2 className="w-3.5 h-3.5" /> Usuń
                            </button>
                          </div>

                          <div className="grid grid-cols-2 gap-2.5 text-xs">
                            <div>
                              <label className="text-slate-400 block mb-1">Szerokość pozioma bx [m]</label>
                              <input
                                type="number"
                                step="0.05"
                                min="0.2"
                                max={hostPanel.w - 0.2}
                                value={selectedOpening.w}
                                onChange={(e) => {
                                  const val = Math.max(0.2, Math.min(hostPanel.w, Number(e.target.value) || 0.5));
                                  setOpenings(prev => prev.map(o => (o.id === selectedOpening.id ? { ...o, w: val } : o)));
                                }}
                                className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 font-mono text-white"
                              />
                            </div>
                            <div>
                              <label className="text-slate-400 block mb-1">Wysokość pionowa by [m]</label>
                              <input
                                type="number"
                                step="0.05"
                                min="0.2"
                                max={hostPanel.h - 0.2}
                                value={selectedOpening.h}
                                onChange={(e) => {
                                  const val = Math.max(0.2, Math.min(hostPanel.h, Number(e.target.value) || 0.5));
                                  setOpenings(prev => prev.map(o => (o.id === selectedOpening.id ? { ...o, h: val } : o)));
                                }}
                                className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 font-mono text-white"
                              />
                            </div>
                            <div>
                              <label className="text-slate-400 block mb-1">Odległość od lewej krawędzi [m]</label>
                              <input
                                type="number"
                                step="0.05"
                                min="0"
                                max={Number((hostPanel.w - selectedOpening.w).toFixed(2))}
                                value={distFromLeft}
                                onChange={(e) => {
                                  const dLeft = Math.max(0, Math.min(hostPanel.w - selectedOpening.w, Number(e.target.value) || 0));
                                  setOpenings(prev =>
                                    prev.map(o => (o.id === selectedOpening.id ? { ...o, x: Number((hostPanel.x + dLeft).toFixed(2)) } : o))
                                  );
                                }}
                                className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 font-mono text-white"
                              />
                            </div>
                            <div>
                              <label className="text-slate-400 block mb-1">Odległość od górnej krawędzi [m]</label>
                              <input
                                type="number"
                                step="0.05"
                                min="0"
                                max={Number((hostPanel.h - selectedOpening.h).toFixed(2))}
                                value={distFromTop}
                                onChange={(e) => {
                                  const dTop = Math.max(0, Math.min(hostPanel.h - selectedOpening.h, Number(e.target.value) || 0));
                                  const newY = (hostPanel.y + hostPanel.h) - dTop - selectedOpening.h;
                                  setOpenings(prev =>
                                    prev.map(o => (o.id === selectedOpening.id ? { ...o, y: Number(newY.toFixed(2)) } : o))
                                  );
                                }}
                                className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 font-mono text-white"
                              />
                            </div>
                          </div>

                          {(touchesRightEdge || touchesLeftEdge) && (
                            <div className="text-[11px] bg-amber-500/10 border border-amber-500/30 text-amber-300 px-2.5 py-1.5 rounded-lg flex items-center gap-2">
                              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                              <span>
                                Otwór przylega do krawędzi bocznej płyty — lokalnie usuwa podparcie na odcinku {selectedOpening.h.toFixed(2)} m.
                              </span>
                            </div>
                          )}

                          <div className="pt-2 border-t border-slate-800/80">
                            <label className="flex items-center gap-2 text-xs text-slate-200 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={selectedOpening.hasRib}
                                onChange={(e) =>
                                  setOpenings(prev =>
                                    prev.map(o => (o.id === selectedOpening.id ? { ...o, hasRib: e.target.checked } : o))
                                  )
                                }
                                className="rounded border-slate-700 bg-slate-900 text-sky-500 focus:ring-0"
                              />
                              <span>Zaprojektuj żebro wzmacniające wzdłuż krawędzi otworu</span>
                            </label>

                            {selectedOpening.hasRib && (
                              <div className="grid grid-cols-2 gap-2.5 mt-2.5 text-xs">
                                <div>
                                  <label className="text-slate-400 block mb-1">Szerokość żebra b [cm]</label>
                                  <input
                                    type="number"
                                    step="5"
                                    min="15"
                                    max="80"
                                    value={selectedOpening.ribWidth}
                                    onChange={(e) =>
                                      setOpenings(prev =>
                                        prev.map(o =>
                                          o.id === selectedOpening.id ? { ...o, ribWidth: Number(e.target.value) || 25 } : o
                                        )
                                      )
                                    }
                                    className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 font-mono text-white"
                                  />
                                </div>
                                <div>
                                  <label className="text-slate-400 block mb-1">Wysokość całk. żebra h [cm]</label>
                                  <input
                                    type="number"
                                    step="2"
                                    min={slabThickness}
                                    max="60"
                                    value={selectedOpening.ribHeight}
                                    onChange={(e) =>
                                      setOpenings(prev =>
                                        prev.map(o =>
                                          o.id === selectedOpening.id ? { ...o, ribHeight: Number(e.target.value) || 30 } : o
                                        )
                                      )
                                    }
                                    className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 font-mono text-white"
                                  />
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'loads' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-4 space-y-5">
              <div className="bg-slate-900 rounded-2xl border border-slate-800 p-5 space-y-4">
                <h2 className="text-sm font-semibold text-white flex items-center gap-2 border-b border-slate-800 pb-3">
                  <ShieldCheck className="w-4 h-4 text-emerald-400" />
                  Parametry materiałowe i geometryczne (EC2)
                </h2>

                <div>
                  <label className="block text-xs text-slate-400 mb-1">Grubość płyty stropowej h [cm]</label>
                  <div className="flex items-center gap-3">
                    <input
                      type="range"
                      min="12"
                      max="30"
                      step="1"
                      value={slabThickness}
                      onChange={(e) => setSlabThickness(Number(e.target.value))}
                      className="flex-1 accent-sky-500"
                    />
                    <input
                      type="number"
                      min="10"
                      max="40"
                      value={slabThickness}
                      onChange={(e) => setSlabThickness(Math.max(10, Number(e.target.value) || 16))}
                      className="w-20 bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-sm font-mono text-white text-center"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs text-slate-400 mb-1">Klasa betonu (PN-EN 1992-1-1)</label>
                  <select
                    value={concreteKey}
                    onChange={(e) => setConcreteKey(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
                  >
                    {Object.values(CONCRETE_CLASSES).map(c => (
                      <option key={c.name} value={c.name}>
                        {c.name} (f_ck = {c.fck} MPa, f_cd = {c.fcd} MPa)
                      </option>
                    ))}
                  </select>
                  <div className="grid grid-cols-3 gap-2 mt-2 text-[11px] font-mono bg-slate-950 p-2 rounded-lg border border-slate-800 text-slate-300">
                    <div>f_ck: <span className="text-sky-400">{concrete.fck} MPa</span></div>
                    <div>f_cd: <span className="text-sky-400">{concrete.fcd} MPa</span></div>
                    <div>f_ctm: <span className="text-sky-400">{concrete.fctm} MPa</span></div>
                  </div>
                </div>

                <div>
                  <label className="block text-xs text-slate-400 mb-1">Klasa stali zbrojeniowej</label>
                  <select
                    value={steelKey}
                    onChange={(e) => setSteelKey(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
                  >
                    {Object.values(STEEL_CLASSES).map(s => (
                      <option key={s.name} value={s.name}>
                        {s.name} (f_yk = {s.fyk} MPa, f_yd = {s.fyd} MPa)
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Klasa ekspozycji</label>
                    <select
                      value={exposureKey}
                      onChange={(e) => {
                        const k = e.target.value;
                        setExposureKey(k);
                        setCNom(EXPOSURE_CLASSES[k].cNomRec);
                      }}
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-2 text-xs text-white"
                    >
                      {Object.entries(EXPOSURE_CLASSES).map(([k, v]) => (
                        <option key={k} value={k}>
                          {k} (min. {v.cNomRec} mm)
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Otulina c_nom [mm]</label>
                    <input
                      type="number"
                      min="15"
                      max="50"
                      step="5"
                      value={cNom}
                      onChange={(e) => setCNom(Math.max(15, Number(e.target.value) || 20))}
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-sm font-mono text-white"
                    />
                  </div>
                </div>
              </div>

              <div className="bg-gradient-to-br from-slate-900 to-slate-900/70 rounded-2xl border border-slate-800 p-5 space-y-3">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Zestawienie zbiorcze obciążeń
                </h3>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Stałe charakterystyczne (g_k):</span>
                    <span className="font-mono font-medium text-slate-200">{loadSummary.gk.toFixed(2)} kN/m²</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Zmienne charakterystyczne (q_k):</span>
                    <span className="font-mono font-medium text-slate-200">{loadSummary.qk.toFixed(2)} kN/m²</span>
                  </div>
                  <div className="h-px bg-slate-800 my-1" />
                  <div className="flex justify-between">
                    <span className="text-slate-400">Stałe obliczeniowe (1,35 · g_k):</span>
                    <span className="font-mono text-sky-300">{loadSummary.gd.toFixed(2)} kN/m²</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Zmienne obliczeniowe (1,50 · q_k):</span>
                    <span className="font-mono text-amber-300">{loadSummary.qdPart.toFixed(2)} kN/m²</span>
                  </div>
                  <div className="pt-2 border-t border-slate-800 flex justify-between items-baseline">
                    <span className="font-semibold text-white">Całkowite obliczeniowe q_d:</span>
                    <span className="font-mono text-xl font-bold text-amber-400">
                      {loadSummary.qdTotal.toFixed(2)} kN/m²
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <div className="lg:col-span-8 bg-slate-900 rounded-2xl border border-slate-800 p-5 flex flex-col">
              <div className="flex flex-wrap items-center justify-between gap-3 pb-4 mb-4 border-b border-slate-800">
                <div>
                  <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                    <Layers className="w-4 h-4 text-amber-400" />
                    Warstwy stropu i obciążenia powierzchniowe (PN-EN 1991-1-1)
                  </h2>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Dodaj warstwy wykończeniowe z bazy normowej lub zdefiniuj własny ciężar objętościowy / powierzchniowy.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={selectedPresetIdx}
                    onChange={(e) => setSelectedPresetIdx(Number(e.target.value))}
                    className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 max-w-[260px]"
                  >
                    {LAYER_PRESETS.map((p, idx) => (
                      <option key={idx} value={idx}>
                        {p.name} ({p.mode === 'volume' ? `${p.density} kN/m³` : `${p.surfaceLoad} kN/m²`})
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={() => {
                      const preset = LAYER_PRESETS[selectedPresetIdx];
                      setLayers(prev => [
                        ...prev,
                        {
                          ...preset,
                          id: `layer-${Date.now()}`,
                          isSlabSelfWeight: false
                        }
                      ]);
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-sky-600 text-white hover:bg-sky-500 transition"
                  >
                    <Plus className="w-3.5 h-3.5" /> Dodaj warstwę
                  </button>
                </div>
              </div>

              <div className="overflow-x-auto flex-1">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-400">
                      <th className="py-2.5 px-2 font-medium">Nazwa warstwy / obciążenia</th>
                      <th className="py-2.5 px-2 font-medium">Rodzaj</th>
                      <th className="py-2.5 px-2 font-medium">Grubość [cm]</th>
                      <th className="py-2.5 px-2 font-medium">Gęstość / Ciężar</th>
                      <th className="py-2.5 px-2 font-medium text-right">q_k [kN/m²]</th>
                      <th className="py-2.5 px-2 font-medium text-center">γ_F</th>
                      <th className="py-2.5 px-2 font-medium text-right">q_d [kN/m²]</th>
                      <th className="py-2.5 px-2 text-center">Usuń</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/70">
                    {loadSummary.rows.map((row) => (
                      <tr key={row.id} className="hover:bg-slate-800/30 transition">
                        <td className="py-2.5 px-2">
                          <input
                            type="text"
                            value={row.name}
                            onChange={(e) =>
                              setLayers(prev =>
                                prev.map(l => (l.id === row.id ? { ...l, name: e.target.value } : l))
                              )
                            }
                            className="w-full bg-transparent border-b border-transparent focus:border-sky-500 text-slate-200 focus:outline-none py-0.5"
                          />
                        </td>
                        <td className="py-2.5 px-2">
                          <select
                            value={row.type}
                            disabled={row.isSlabSelfWeight}
                            onChange={(e) =>
                              setLayers(prev =>
                                prev.map(l => (l.id === row.id ? { ...l, type: e.target.value } : l))
                              )
                            }
                            className={`rounded px-2 py-1 font-medium ${
                              row.type === 'G'
                                ? 'bg-sky-500/15 text-sky-300 border border-sky-500/30'
                                : 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                            }`}
                          >
                            <option value="G">Stałe (G)</option>
                            <option value="Q">Zmienne (Q)</option>
                          </select>
                        </td>
                        <td className="py-2.5 px-2">
                          {row.mode === 'volume' ? (
                            <input
                              type="number"
                              step="0.5"
                              min="0"
                              max="100"
                              value={row.thickness}
                              onChange={(e) => {
                                const val = Math.max(0, Number(e.target.value) || 0);
                                if (row.isSlabSelfWeight) {
                                  setSlabThickness(val);
                                } else {
                                  setLayers(prev =>
                                    prev.map(l => (l.id === row.id ? { ...l, thickness: val } : l))
                                  );
                                }
                              }}
                              className="w-16 bg-slate-950 border border-slate-700 rounded px-2 py-1 font-mono text-white text-right"
                            />
                          ) : (
                            <span className="text-slate-600 font-mono">—</span>
                          )}
                        </td>
                        <td className="py-2.5 px-2">
                          {row.mode === 'volume' ? (
                            <div className="flex items-center gap-1">
                              <input
                                type="number"
                                step="0.1"
                                min="0"
                                max="40"
                                value={row.density}
                                onChange={(e) => {
                                  const val = Math.max(0, Number(e.target.value) || 0);
                                  setLayers(prev =>
                                    prev.map(l => (l.id === row.id ? { ...l, density: val } : l))
                                  );
                                }}
                                className="w-16 bg-slate-950 border border-slate-700 rounded px-2 py-1 font-mono text-white text-right"
                              />
                              <span className="text-slate-500">kN/m³</span>
                            </div>
                          ) : (
                            <div className="flex items-center gap-1">
                              <input
                                type="number"
                                step="0.05"
                                min="0"
                                max="30"
                                value={row.surfaceLoad}
                                onChange={(e) => {
                                  const val = Math.max(0, Number(e.target.value) || 0);
                                  setLayers(prev =>
                                    prev.map(l => (l.id === row.id ? { ...l, surfaceLoad: val } : l))
                                  );
                                }}
                                className="w-16 bg-slate-950 border border-slate-700 rounded px-2 py-1 font-mono text-white text-right"
                              />
                              <span className="text-slate-500">kN/m²</span>
                            </div>
                          )}
                        </td>
                        <td className="py-2.5 px-2 text-right font-mono text-slate-200">
                          {row.charVal.toFixed(2)}
                        </td>
                        <td className="py-2.5 px-2 text-center font-mono text-slate-400">
                          {row.gamma.toFixed(2)}
                        </td>
                        <td className="py-2.5 px-2 text-right font-mono font-semibold text-white">
                          {row.designVal.toFixed(2)}
                        </td>
                        <td className="py-2.5 px-2 text-center">
                          {!row.isSlabSelfWeight ? (
                            <button
                              onClick={() => setLayers(prev => prev.filter(l => l.id !== row.id))}
                              className="p-1 text-slate-500 hover:text-rose-400 transition"
                              title="Usuń warstwę"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          ) : (
                            <span className="text-[10px] text-slate-600">baza</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="mt-4 pt-3 border-t border-slate-800 flex items-center justify-between">
                <button
                  onClick={() => {
                    setLayers(prev => [
                      ...prev,
                      {
                        id: `custom-${Date.now()}`,
                        name: 'Nowa warstwa własna',
                        type: 'G',
                        mode: 'surface',
                        thickness: 0,
                        density: 0,
                        surfaceLoad: 0.50
                      }
                    ]);
                  }}
                  className="text-xs text-slate-300 hover:text-white flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800/80"
                >
                  <Plus className="w-3.5 h-3.5" /> Dodaj pusty wiersz własny
                </button>

                <button
                  onClick={() => setActiveTab('results')}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white transition shadow-md shadow-emerald-600/20"
                >
                  Oblicz momenty i generuj zbrojenie <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'results' && femResult && reinforcementDesign && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
              <div className="bg-slate-900 rounded-xl border border-slate-800 p-3.5">
                <span className="text-[11px] text-slate-400 block">Maks. moment przęsłowy Mx</span>
                <span className="text-lg font-mono font-bold text-rose-400">
                  +{Number(femResult?.extrema?.maxMx ?? 0).toFixed(2)}{' '}
                  <span className="text-xs font-normal">kNm/m</span>
                </span>
                <span className="text-[10px] text-slate-500 block mt-0.5">
                  w pkt ({Number(femResult?.extrema?.maxMxCoord?.x ?? 0).toFixed(2)}m;{' '}
                  {Number(femResult?.extrema?.maxMxCoord?.y ?? 0).toFixed(2)}m)
                </span>
              </div>

              <div className="bg-slate-900 rounded-xl border border-slate-800 p-3.5">
                <span className="text-[11px] text-slate-400 block">Maks. moment przęsłowy My</span>
                <span className="text-lg font-mono font-bold text-amber-400">
                  +{Number(femResult?.extrema?.maxMy ?? 0).toFixed(2)}{' '}
                  <span className="text-xs font-normal">kNm/m</span>
                </span>
                <span className="text-[10px] text-slate-500 block mt-0.5">
                  w pkt ({Number(femResult?.extrema?.maxMyCoord?.x ?? 0).toFixed(2)}m;{' '}
                  {Number(femResult?.extrema?.maxMyCoord?.y ?? 0).toFixed(2)}m)
                </span>
              </div>

              <div className="bg-slate-900 rounded-xl border border-slate-800 p-3.5">
                <span className="text-[11px] text-slate-400 block">Maks. moment podporowy (góra)</span>
                <span className="text-lg font-mono font-bold text-sky-400">
                  {Number(Math.min(femResult?.extrema?.minMx ?? 0, femResult?.extrema?.minMy ?? 0)).toFixed(2)}{' '}
                  <span className="text-xs font-normal">kNm/m</span>
                </span>
                <span className="text-[10px] text-slate-500 block mt-0.5">
                  Rozciąganie górnych włókien
                </span>
              </div>

              <div className="bg-slate-900 rounded-xl border border-slate-800 p-3.5">
                <span className="text-[11px] text-slate-400 block">Ugięcie sprężyste w_el</span>
                <span className="text-lg font-mono font-bold text-emerald-400">
                  {Number(femResult?.extrema?.maxDeflectionMm ?? 0).toFixed(1)}{' '}
                  <span className="text-xs font-normal">mm</span>
                </span>
                <span className="text-[10px] text-slate-500 block mt-0.5">
                  Sztywność niezarysowana D
                </span>
              </div>

              <div className="bg-slate-900 rounded-xl border border-slate-800 p-3.5 col-span-2 lg:col-span-1">
                <span className="text-[11px] text-slate-400 block">Obciążenie obliczeniowe q_d</span>
                <span className="text-lg font-mono font-bold text-white">
                  {Number(loadSummary?.qdTotal ?? 0).toFixed(2)}{' '}
                  <span className="text-xs font-normal">kN/m²</span>
                </span>
                <span className="text-[10px] text-slate-500 block mt-0.5">
                  Beton {String(concreteKey)}, Stal {String(steelKey)}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              <div className="lg:col-span-7 bg-slate-900 rounded-2xl border border-slate-800 p-4 flex flex-col">
                <div className="flex flex-wrap items-center justify-between gap-2 pb-3 mb-3 border-b border-slate-800">
                  <div>
                    <h2 className="text-sm font-semibold text-white">
                      Mapa rozkładu momentów zginających {momentDir} [kNm/m]
                    </h2>
                    <p className="text-xs text-slate-400">
                      Najedź kursorem na płytę, aby odczytać lokalne wartości Mx, My oraz ugięcie.
                    </p>
                  </div>

                  <div className="flex items-center bg-slate-950 p-1 rounded-lg border border-slate-800 text-xs">
                    <button
                      onClick={() => setMomentDir('Mx')}
                      className={`px-3 py-1 rounded-md font-medium transition ${
                        momentDir === 'Mx' ? 'bg-rose-600 text-white' : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      Moment Mx (poziomy)
                    </button>
                    <button
                      onClick={() => setMomentDir('My')}
                      className={`px-3 py-1 rounded-md font-medium transition ${
                        momentDir === 'My' ? 'bg-amber-600 text-white' : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      Moment My (pionowy)
                    </button>
                  </div>
                </div>

                <div className="flex-1 min-h-[420px] bg-slate-950 rounded-xl border border-slate-800 p-3 flex flex-col items-center justify-center">
                  <MomentHeatmapCanvas
                    femResult={femResult}
                    panels={panels}
                    openings={openings}
                    momentDir={momentDir}
                    sectionAxis={sectionAxis}
                    sectionPosRatio={sectionPosRatio}
                    onHoverCell={setHoveredCell}
                  />
                </div>

                <div className="mt-3 bg-slate-950 px-3.5 py-2 rounded-xl border border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs font-mono">
                  {hoveredCell ? (
                    <>
                      <span className="text-slate-400">
                        Współrzędne: <strong className="text-white">x = {hoveredCell.x.toFixed(2)} m, y = {hoveredCell.y.toFixed(2)} m</strong>
                      </span>
                      <span className="text-rose-400">Mx = {hoveredCell.mx.toFixed(2)} kNm/m</span>
                      <span className="text-amber-400">My = {hoveredCell.my.toFixed(2)} kNm/m</span>
                      <span className="text-emerald-400">w = {hoveredCell.w.toFixed(2)} mm</span>
                    </>
                  ) : (
                    <span className="text-slate-500 font-sans">
                      Wskaż dowolny punkt na mapie momentów powyżej, aby odczytać lokalne siły wewnętrzne...
                    </span>
                  )}
                </div>
              </div>

              <div className="lg:col-span-5 bg-slate-900 rounded-2xl border border-slate-800 p-4 flex flex-col">
                <div className="flex items-center justify-between pb-3 mb-3 border-b border-slate-800">
                  <div>
                    <h3 className="text-sm font-semibold text-white">
                      Przekrój wykresu momentu {momentDir}
                    </h3>
                    <p className="text-xs text-slate-400">
                      Linia cięcia widoczna jako przerywana na mapie obok
                    </p>
                  </div>
                  <div className="flex bg-slate-950 p-1 rounded-lg border border-slate-800 text-xs">
                    <button
                      onClick={() => setSectionAxis('Y')}
                      className={`px-2.5 py-1 rounded ${
                        sectionAxis === 'Y' ? 'bg-sky-600 text-white' : 'text-slate-400'
                      }`}
                    >
                      Pionowy (wzdłuż Y)
                    </button>
                    <button
                      onClick={() => setSectionAxis('X')}
                      className={`px-2.5 py-1 rounded ${
                        sectionAxis === 'X' ? 'bg-sky-600 text-white' : 'text-slate-400'
                      }`}
                    >
                      Poziomy (wzdłuż X)
                    </button>
                  </div>
                </div>

                <div className="mb-4 bg-slate-950 p-3 rounded-xl border border-slate-800">
                  <div className="flex justify-between text-xs mb-1.5">
                    <span className="text-slate-400">
                      Położenie cięcia ({sectionAxis === 'Y' ? 'współrzędna X' : 'współrzędna Y'}):
                    </span>
                    <span className="font-mono font-semibold text-sky-400">
                      {sectionAxis === 'Y'
                        ? `x = ${(femResult.minX + sectionPosRatio * femResult.totalW).toFixed(2)} m`
                        : `y = ${(femResult.minY + sectionPosRatio * femResult.totalH).toFixed(2)} m`}
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0.02"
                    max="0.98"
                    step="0.01"
                    value={sectionPosRatio}
                    onChange={(e) => setSectionPosRatio(Number(e.target.value))}
                    className="w-full accent-sky-500"
                  />
                </div>

                <div className="flex-1 min-h-[300px] bg-slate-950 rounded-xl border border-slate-800 p-3 flex items-center justify-center">
                  <MomentSectionChart
                    femResult={femResult}
                    momentDir={momentDir}
                    sectionAxis={sectionAxis}
                    sectionPosRatio={sectionPosRatio}
                  />
                </div>
              </div>
            </div>

            <div className="bg-slate-900 rounded-2xl border border-slate-800 p-5">
              <div className="flex flex-wrap items-center justify-between gap-3 pb-4 mb-4 border-b border-slate-800">
                <div>
                  <h2 className="text-base font-semibold text-white flex items-center gap-2">
                    <Eye className="w-4 h-4 text-emerald-400" />
                    Schematyczny rysunek rozmieszczenia zbrojenia (Eurokod 2)
                  </h2>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Rzut zbrojenia dolnego, górnego nad podporami, żebra krawędziowego oraz wzmocnień naroży otworów
                  </p>
                </div>

                <div className="flex flex-wrap items-center bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs gap-1">
                  {[
                    { id: 'all', label: 'Wszystkie warstwy' },
                    { id: 'bottom', label: 'Zbrojenie dolne' },
                    { id: 'top', label: 'Zbrojenie górne (podpory)' },
                    { id: 'rib', label: 'Żebro i otwory' }
                  ].map(tab => (
                    <button
                      key={tab.id}
                      onClick={() => setRebarLayerFilter(tab.id)}
                      className={`px-3 py-1.5 rounded-lg font-medium transition ${
                        rebarLayerFilter === tab.id
                          ? 'bg-emerald-600 text-white'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                <div className="lg:col-span-7 bg-slate-950 rounded-xl border border-slate-800 p-4 flex flex-col items-center justify-center min-h-[460px]">
                  <RebarPlanDrawing
                    panels={panels}
                    openings={openings}
                    femResult={femResult}
                    design={reinforcementDesign}
                    filter={rebarLayerFilter}
                    selectedPos={selectedRebarPos}
                    onSelectPos={setSelectedRebarPos}
                  />
                </div>

                <div className="lg:col-span-5 flex flex-col gap-4">
                  <div className="bg-slate-950 rounded-xl border border-slate-800 p-3.5">
                    <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
                      Przekrój poprzeczny A–A (krawędź otworu / żebro)
                    </h3>
                    <RebarCrossSectionSVG
                      slabThickness={slabThickness}
                      cNom={cNom}
                      design={reinforcementDesign}
                      openings={openings}
                    />
                  </div>

                  <div className="bg-slate-950 rounded-xl border border-slate-800 p-3.5 flex-1 overflow-x-auto">
                    <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                      <FileSpreadsheet className="w-3.5 h-3.5 text-sky-400" />
                      Zestawienie zbrojenia (Stal {steelKey})
                    </h3>
                    <table className="w-full text-left text-[11px] border-collapse">
                      <thead>
                        <tr className="border-b border-slate-800 text-slate-400">
                          <th className="py-1.5 px-1.5">Poz.</th>
                          <th className="py-1.5 px-1.5">Strefa</th>
                          <th className="py-1.5 px-1.5">Zbrojenie</th>
                          <th className="py-1.5 px-1.5 text-right">As,prov</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/70">
                        {reinforcementDesign.positions.map(p => (
                          <tr
                            key={String(p.pos)}
                            onClick={() => setSelectedRebarPos(p.pos)}
                            className={`cursor-pointer transition ${
                              selectedRebarPos === p.pos ? 'bg-sky-500/20' : 'hover:bg-slate-900'
                            }`}
                          >
                            <td className="py-2 px-1.5 font-mono font-bold text-sky-400 whitespace-nowrap">
                              {String(p.pos)}
                            </td>
                            <td className="py-2 px-1.5 text-slate-300">
                              <div className="font-medium">{String(p.zone)}</div>
                              <div className="text-[10px] text-slate-500">{String(p.notes)}</div>
                            </td>
                            <td className="py-2 px-1.5 font-mono font-semibold text-emerald-300 whitespace-nowrap">
                              {String(p.rebar)}
                            </td>
                            <td className="py-2 px-1.5 font-mono text-right text-slate-300 whitespace-nowrap">
                              {String(p.asProv)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              <div className="mt-6 pt-5 border-t border-slate-800">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
                  <div>
                    <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                      <Sliders className="w-4 h-4 text-amber-400" />
                      Wykorzystanie nośności przekroju (M_Ed / M_Rd, V_Ed / V_Rd) oraz dobór średnic i rozstawów
                    </h3>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Zmieniaj ręcznie średnice i rozstawy prętów — wskaźnik wytężenia, nośność M_Rd oraz rysunek zbrojenia aktualizują się na bieżąco.
                    </p>
                  </div>
                  {Object.keys(manualOverrides).length > 0 && (
                    <button
                      onClick={() => setManualOverrides({})}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 text-sky-300 hover:bg-slate-700 border border-slate-700 transition"
                    >
                      <RefreshCw className="w-3.5 h-3.5" /> Przywróć dobór automatyczny
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  <RebarUtilizationCard
                    title="Zbrojenie dolne główne (kierunek X)"
                    subtitle={`M_Ed = ${reinforcementDesign.rebarBottomX.MEd} kNm/m | M_Rd = ${reinforcementDesign.rebarBottomX.MRd} kNm/m`}
                    asReqLabel={`As,req = ${reinforcementDesign.rebarBottomX.AsReq.toFixed(2)} cm²/m`}
                    asProvLabel={`As,prov = ${reinforcementDesign.rebarBottomX.AsProv.toFixed(2)} cm²/m`}
                    utilization={reinforcementDesign.rebarBottomX.utilization}
                    dia={reinforcementDesign.rebarBottomX.dia}
                    spacing={reinforcementDesign.rebarBottomX.spacing}
                    isManual={reinforcementDesign.rebarBottomX.isManual}
                    onChangeDia={(dia) =>
                      setManualOverrides(prev => ({
                        ...prev,
                        bottomX: {
                          dia,
                          spacing: prev.bottomX?.spacing ?? reinforcementDesign.rebarBottomX.spacing
                        }
                      }))
                    }
                    onChangeSpacing={(spacing) =>
                      setManualOverrides(prev => ({
                        ...prev,
                        bottomX: {
                          dia: prev.bottomX?.dia ?? reinforcementDesign.rebarBottomX.dia,
                          spacing
                        }
                      }))
                    }
                  />

                  <RebarUtilizationCard
                    title="Zbrojenie dolne poprzeczne (kierunek Y)"
                    subtitle={`M_Ed = ${reinforcementDesign.rebarBottomY.MEd} kNm/m | M_Rd = ${reinforcementDesign.rebarBottomY.MRd} kNm/m`}
                    asReqLabel={`As,req = ${reinforcementDesign.rebarBottomY.AsReq.toFixed(2)} cm²/m`}
                    asProvLabel={`As,prov = ${reinforcementDesign.rebarBottomY.AsProv.toFixed(2)} cm²/m`}
                    utilization={reinforcementDesign.rebarBottomY.utilization}
                    dia={reinforcementDesign.rebarBottomY.dia}
                    spacing={reinforcementDesign.rebarBottomY.spacing}
                    isManual={reinforcementDesign.rebarBottomY.isManual}
                    onChangeDia={(dia) =>
                      setManualOverrides(prev => ({
                        ...prev,
                        bottomY: {
                          dia,
                          spacing: prev.bottomY?.spacing ?? reinforcementDesign.rebarBottomY.spacing
                        }
                      }))
                    }
                    onChangeSpacing={(spacing) =>
                      setManualOverrides(prev => ({
                        ...prev,
                        bottomY: {
                          dia: prev.bottomY?.dia ?? reinforcementDesign.rebarBottomY.dia,
                          spacing
                        }
                      }))
                    }
                  />

                  {reinforcementDesign.hasInternalSupport && (
                    <RebarUtilizationCard
                      title="Zbrojenie górne nad podporami"
                      subtitle={`M_Ed = ${reinforcementDesign.rebarTopSupport.MEd} kNm/m | M_Rd = ${reinforcementDesign.rebarTopSupport.MRd} kNm/m`}
                      asReqLabel={`As,req = ${reinforcementDesign.rebarTopSupport.AsReq.toFixed(2)} cm²/m`}
                      asProvLabel={`As,prov = ${reinforcementDesign.rebarTopSupport.AsProv.toFixed(2)} cm²/m`}
                      utilization={reinforcementDesign.rebarTopSupport.utilization}
                      dia={reinforcementDesign.rebarTopSupport.dia}
                      spacing={reinforcementDesign.rebarTopSupport.spacing}
                      isManual={reinforcementDesign.rebarTopSupport.isManual}
                      onChangeDia={(dia) =>
                        setManualOverrides(prev => ({
                          ...prev,
                          topSupport: {
                            dia,
                            spacing: prev.topSupport?.spacing ?? reinforcementDesign.rebarTopSupport.spacing
                          }
                        }))
                      }
                      onChangeSpacing={(spacing) =>
                        setManualOverrides(prev => ({
                          ...prev,
                          topSupport: {
                            dia: prev.topSupport?.dia ?? reinforcementDesign.rebarTopSupport.dia,
                            spacing
                          }
                        }))
                      }
                    />
                  )}

                  {reinforcementDesign.ribsDesign.map((rd) => {
                    const maxRibUtil = Math.max(rd.ribUtilM, rd.ribUtilV);
                    return (
                      <div
                        key={rd.openingId}
                        className="bg-slate-950 rounded-xl border border-slate-800 p-4 flex flex-col justify-between gap-3"
                      >
                        <div>
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <h4 className="text-xs font-semibold text-purple-300">
                                Żebro {rd.ribW}×{rd.ribH} cm ({rd.openingName})
                              </h4>
                              <p className="text-[11px] text-slate-400 font-mono mt-0.5">
                                M_Ed={rd.mRib} / M_Rd={rd.ribMRd} kNm • V_Ed={rd.vRib} / V_Rd,c={rd.vRdC} kN
                              </p>
                            </div>
                            <UtilizationBadge pct={maxRibUtil} />
                          </div>

                          <div className="mt-2.5 space-y-1.5">
                            <UtilizationBar label="Zginanie M_Ed/M_Rd" pct={rd.ribUtilM} />
                            <UtilizationBar label="Ścinanie V_Ed/V_Rd,c" pct={rd.ribUtilV} />
                          </div>
                        </div>

                        <div className="pt-2.5 border-t border-slate-800/80 grid grid-cols-2 gap-2 text-xs">
                          <div>
                            <label className="text-[10px] text-slate-400 block mb-1">Dół (liczba / Ø)</label>
                            <div className="flex gap-1">
                              <select
                                value={rd.botBars.count}
                                onChange={(e) =>
                                  setManualOverrides(prev => ({
                                    ...prev,
                                    [`rib-${rd.openingId}`]: {
                                      botCount: Number(e.target.value),
                                      botDia: rd.botBars.dia,
                                      topCount: rd.topBars.count,
                                      topDia: rd.topBars.dia
                                    }
                                  }))
                                }
                                className="w-12 bg-slate-900 border border-slate-700 rounded px-1.5 py-1 font-mono text-white"
                              >
                                {[2, 3, 4, 5, 6].map(n => (
                                  <option key={n} value={n}>{n}×</option>
                                ))}
                              </select>
                              <select
                                value={rd.botBars.dia}
                                onChange={(e) =>
                                  setManualOverrides(prev => ({
                                    ...prev,
                                    [`rib-${rd.openingId}`]: {
                                      botCount: rd.botBars.count,
                                      botDia: Number(e.target.value),
                                      topCount: rd.topBars.count,
                                      topDia: rd.topBars.dia
                                    }
                                  }))
                                }
                                className="flex-1 bg-slate-900 border border-slate-700 rounded px-1.5 py-1 font-mono text-white"
                              >
                                {BAR_DIAMETERS.map(d => (
                                  <option key={d} value={d}>Ø{d}</option>
                                ))}
                              </select>
                            </div>
                          </div>

                          <div>
                            <label className="text-[10px] text-slate-400 block mb-1">Góra (liczba / Ø)</label>
                            <div className="flex gap-1">
                              <select
                                value={rd.topBars.count}
                                onChange={(e) =>
                                  setManualOverrides(prev => ({
                                    ...prev,
                                    [`rib-${rd.openingId}`]: {
                                      botCount: rd.botBars.count,
                                      botDia: rd.botBars.dia,
                                      topCount: Number(e.target.value),
                                      topDia: rd.topBars.dia
                                    }
                                  }))
                                }
                                className="w-12 bg-slate-900 border border-slate-700 rounded px-1.5 py-1 font-mono text-white"
                              >
                                {[2, 3, 4, 5].map(n => (
                                  <option key={n} value={n}>{n}×</option>
                                ))}
                              </select>
                              <select
                                value={rd.topBars.dia}
                                onChange={(e) =>
                                  setManualOverrides(prev => ({
                                    ...prev,
                                    [`rib-${rd.openingId}`]: {
                                      botCount: rd.botBars.count,
                                      botDia: rd.botBars.dia,
                                      topCount: rd.topBars.count,
                                      topDia: Number(e.target.value)
                                    }
                                  }))
                                }
                                className="flex-1 bg-slate-900 border border-slate-700 rounded px-1.5 py-1 font-mono text-white"
                              >
                                {BAR_DIAMETERS.map(d => (
                                  <option key={d} value={d}>Ø{d}</option>
                                ))}
                              </select>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function getUtilizationStyle(pct) {
  if (pct > 100) {
    return {
      barClass: 'bg-rose-500',
      badgeClass: 'bg-rose-500/15 text-rose-300 border-rose-500/40',
      statusText: 'Przeciążenie (>100%)'
    };
  }
  if (pct >= 75) {
    return {
      barClass: 'bg-amber-400',
      badgeClass: 'bg-amber-500/15 text-amber-300 border-amber-500/40',
      statusText: 'Wysokie wytężenie'
    };
  }
  return {
    barClass: 'bg-emerald-500',
    badgeClass: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40',
    statusText: 'Nośność wystarczająca'
  };
}

function UtilizationBadge({ pct }) {
  const st = getUtilizationStyle(pct);
  return (
    <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold border whitespace-nowrap ${st.badgeClass}`}>
      {pct.toFixed(1)}% • {st.statusText}
    </span>
  );
}

function UtilizationBar({ label, pct }) {
  const st = getUtilizationStyle(pct);
  const cappedWidth = Math.min(100, Math.max(2, pct));
  return (
    <div>
      <div className="flex justify-between text-[10px] text-slate-400 mb-1 font-mono">
        <span>{label}</span>
        <span className={pct > 100 ? 'text-rose-400 font-bold' : 'text-slate-200'}>{pct.toFixed(1)}%</span>
      </div>
      <div className="w-full h-2.5 bg-slate-900 rounded-full overflow-hidden border border-slate-800">
        <div
          className={`h-full transition-all duration-200 ${st.barClass}`}
          style={{ width: `${cappedWidth}%` }}
        />
      </div>
    </div>
  );
}

function RebarUtilizationCard({
  title,
  subtitle,
  asReqLabel,
  asProvLabel,
  utilization,
  dia,
  spacing,
  isManual,
  onChangeDia,
  onChangeSpacing
}) {
  return (
    <div className="bg-slate-950 rounded-xl border border-slate-800 p-4 flex flex-col justify-between gap-3">
      <div>
        <div className="flex items-start justify-between gap-2">
          <div>
            <h4 className="text-xs font-semibold text-white flex items-center gap-1.5">
              <span>{title}</span>
              {isManual && (
                <span className="text-[9px] px-1.5 py-0.2 rounded bg-sky-500/20 text-sky-300 border border-sky-500/30">
                  ręcznie
                </span>
              )}
            </h4>
            <p className="text-[11px] text-slate-400 font-mono mt-0.5">{subtitle}</p>
          </div>
          <UtilizationBadge pct={utilization} />
        </div>

        <div className="mt-2.5">
          <UtilizationBar label="Wykorzystanie nośności M_Ed / M_Rd" pct={utilization} />
        </div>

        <div className="flex justify-between text-[10px] font-mono text-slate-400 mt-1.5">
          <span>{asReqLabel}</span>
          <span className={utilization > 100 ? 'text-rose-400' : 'text-emerald-400'}>{asProvLabel}</span>
        </div>
      </div>

      <div className="pt-2.5 border-t border-slate-800/80 grid grid-cols-2 gap-2.5 text-xs">
        <div>
          <label className="text-[10px] text-slate-400 block mb-1">Średnica pręta Ø</label>
          <select
            value={dia}
            onChange={(e) => onChangeDia(Number(e.target.value))}
            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 font-mono text-white focus:outline-none focus:border-sky-500"
          >
            {BAR_DIAMETERS.map(d => (
              <option key={d} value={d}>Ø{d} mm</option>
            ))}
          </select>
        </div>

        <div>
          <label className="text-[10px] text-slate-400 block mb-1">Rozstaw co [cm]</label>
          <select
            value={spacing}
            onChange={(e) => onChangeSpacing(Number(e.target.value))}
            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 font-mono text-white focus:outline-none focus:border-sky-500"
          >
            {BAR_SPACINGS.map(s => (
              <option key={s} value={s}>co {s} cm</option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}

function GeometryCADCanvas({
  panels,
  openings,
  selectedPanelId,
  selectedOpeningId,
  onSelectPanel,
  onSelectOpening,
  onAddAdjacentPanel,
  onResizePanelEdge,
  isEdgeFree
}) {
  const svgRef = useRef(null);
  const [dragState, setDragState] = useState(null);
  const [hoveredEdge, setHoveredEdge] = useState(null);

  const boundsRef = useRef({ minX: 0, maxX: 7.5, minY: 0, maxY: 9.7, scale: 40, pad: 75 });
  const dragStateRef = useRef(null);
  dragStateRef.current = dragState;

  if (!dragState) {
    const rawMinX = Math.min(...panels.map(p => p.x));
    const rawMaxX = Math.max(...panels.map(p => p.x + p.w));
    const rawMinY = Math.min(...panels.map(p => p.y));
    const rawMaxY = Math.max(...panels.map(p => p.y + p.h));
    const wSpan = Math.max(1, rawMaxX - rawMinX);
    const hSpan = Math.max(1, rawMaxY - rawMinY);
    const padVal = 75;
    const scaleVal = Math.min(460 / wSpan, 400 / hSpan);
    boundsRef.current = {
      minX: rawMinX,
      maxX: rawMaxX,
      minY: rawMinY,
      maxY: rawMaxY,
      scale: scaleVal,
      pad: padVal
    };
  }

  const { minX, maxX, minY, maxY, scale, pad } = boundsRef.current;
  const totalW = Math.max(1, maxX - minX);
  const totalH = Math.max(1, maxY - minY);

  const svgW = totalW * scale + pad * 2;
  const svgH = totalH * scale + pad * 2;

  const toSvgX = (x) => pad + (x - minX) * scale;
  const toSvgY = (y) => pad + (maxY - y) * scale;

  const clientToWorld = (clientX, clientY) => {
    const svg = svgRef.current;
    if (!svg) return { x: minX, y: minY };
    const rect = svg.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return { x: minX, y: minY };
    const b = boundsRef.current;
    const bTotalW = Math.max(1, b.maxX - b.minX);
    const bTotalH = Math.max(1, b.maxY - b.minY);
    const vSvgW = bTotalW * b.scale + b.pad * 2;
    const vSvgH = bTotalH * b.scale + b.pad * 2;
    const vx = ((clientX - rect.left) / rect.width) * vSvgW;
    const vy = ((clientY - rect.top) / rect.height) * vSvgH;
    const wx = b.minX + (vx - b.pad) / b.scale;
    const wy = b.maxY - (vy - b.pad) / b.scale;
    return { x: wx, y: wy };
  };

  useEffect(() => {
    if (!dragState) return;

    const handleMouseMove = (e) => {
      const active = dragStateRef.current;
      if (!active) return;
      const pt = clientToWorld(e.clientX, e.clientY);
      const targetCoord = active.edge === 'left' || active.edge === 'right' ? pt.x : pt.y;
      onResizePanelEdge(active.panelId, active.edge, targetCoord);
    };

    const handleMouseUp = () => {
      setDragState(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [dragState, onResizePanelEdge]);

  const startDraggingEdge = (e, panel, edge) => {
    e.stopPropagation();
    e.preventDefault();
    onSelectPanel(panel.id);
    const pt = clientToWorld(e.clientX, e.clientY);
    const initialCoord = edge === 'left' || edge === 'right' ? pt.x : pt.y;
    setDragState({ panelId: panel.id, edge, currentVal: initialCoord });
  };

  const renderEdgeLine = (x1, y1, x2, y2, type, isActive, isContinuous = false) => {
    const strokeColor = isActive
      ? '#38bdf8'
      : isContinuous
      ? '#22d3ee'
      : type === 'pinned'
      ? '#34d399'
      : type === 'clamped'
      ? '#fbbf24'
      : '#64748b';
    const strokeWidth = isActive ? '6' : isContinuous ? '5' : type === 'clamped' ? '4.5' : type === 'pinned' ? '3.5' : '1.5';
    const dashArray = !isActive && type === 'free' ? '5 4' : undefined;

    return (
      <line
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        stroke={strokeColor}
        strokeWidth={strokeWidth}
        strokeDasharray={dashArray}
      />
    );
  };

  const isSharedClampedWithNeighbor = (panel, edgeName) => {
    if (panel.edges[edgeName] !== 'clamped') return false;
    const tol = 0.08;
    return panels.some(other => {
      if (other.id === panel.id) return false;
      const overlapX = Math.min(panel.x + panel.w, other.x + other.w) - Math.max(panel.x, other.x) > tol;
      const overlapY = Math.min(panel.y + panel.h, other.y + other.h) - Math.max(panel.y, other.y) > tol;
      if (edgeName === 'top') return overlapX && Math.abs((panel.y + panel.h) - other.y) < tol && other.edges.bottom === 'clamped';
      if (edgeName === 'bottom') return overlapX && Math.abs(panel.y - (other.y + other.h)) < tol && other.edges.top === 'clamped';
      if (edgeName === 'left') return overlapY && Math.abs(panel.x - (other.x + other.w)) < tol && other.edges.right === 'clamped';
      if (edgeName === 'right') return overlapY && Math.abs((panel.x + panel.w) - other.x) < tol && other.edges.left === 'clamped';
      return false;
    });
  };

  const activeCursor = dragState
    ? dragState.edge === 'left' || dragState.edge === 'right'
      ? 'cursor-ew-resize'
      : 'cursor-ns-resize'
    : 'cursor-default';

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${svgW} ${svgH}`}
      className={`w-full h-full max-h-[480px] select-none ${activeCursor}`}
    >
      <defs>
        <pattern id="cadGrid" width="20" height="20" patternUnits="userSpaceOnUse">
          <path d="M 20 0 L 0 0 0 20" fill="none" stroke="#1e293b" strokeWidth="0.7" />
        </pattern>
        <pattern id="openingHatch" width="8" height="8" patternTransform="rotate(45 0 0)" patternUnits="userSpaceOnUse">
          <line x1="0" y1="0" x2="0" y2="8" stroke="#f43f5e" strokeWidth="1.2" opacity="0.55" />
        </pattern>
      </defs>

      <rect x="0" y="0" width={svgW} height={svgH} fill="url(#cadGrid)" />

      {panels.map(panel => {
        const sx = toSvgX(panel.x);
        const sy = toSvgY(panel.y + panel.h);
        const sw = panel.w * scale;
        const sh = panel.h * scale;
        const isSelected = panel.id === selectedPanelId;

        const isEdgeActive = (edgeName) =>
          (dragState?.panelId === panel.id && dragState?.edge === edgeName) ||
          (hoveredEdge?.panelId === panel.id && hoveredEdge?.edge === edgeName);

        return (
          <g key={panel.id} onClick={() => onSelectPanel(panel.id)} className="cursor-pointer">
            <rect
              x={sx}
              y={sy}
              width={sw}
              height={sh}
              fill={isSelected ? 'rgba(14, 165, 233, 0.14)' : 'rgba(30, 41, 59, 0.55)'}
              stroke={isSelected ? '#38bdf8' : '#334155'}
              strokeWidth={isSelected ? '2' : '1'}
            />

            {renderEdgeLine(sx, sy, sx + sw, sy, panel.edges.top, isEdgeActive('top'), isSharedClampedWithNeighbor(panel, 'top'))}
            {renderEdgeLine(sx, sy + sh, sx + sw, sy + sh, panel.edges.bottom, isEdgeActive('bottom'), isSharedClampedWithNeighbor(panel, 'bottom'))}
            {renderEdgeLine(sx, sy, sx, sy + sh, panel.edges.left, isEdgeActive('left'), isSharedClampedWithNeighbor(panel, 'left'))}
            {renderEdgeLine(sx + sw, sy, sx + sw, sy + sh, panel.edges.right, isEdgeActive('right'), isSharedClampedWithNeighbor(panel, 'right'))}

            <line
              x1={sx}
              y1={sy}
              x2={sx + sw}
              y2={sy}
              stroke="transparent"
              strokeWidth="12"
              className="cursor-ns-resize"
              onMouseEnter={() => setHoveredEdge({ panelId: panel.id, edge: 'top' })}
              onMouseLeave={() => setHoveredEdge(null)}
              onMouseDown={(e) => startDraggingEdge(e, panel, 'top')}
            />
            <line
              x1={sx}
              y1={sy + sh}
              x2={sx + sw}
              y2={sy + sh}
              stroke="transparent"
              strokeWidth="12"
              className="cursor-ns-resize"
              onMouseEnter={() => setHoveredEdge({ panelId: panel.id, edge: 'bottom' })}
              onMouseLeave={() => setHoveredEdge(null)}
              onMouseDown={(e) => startDraggingEdge(e, panel, 'bottom')}
            />
            <line
              x1={sx}
              y1={sy}
              x2={sx}
              y2={sy + sh}
              stroke="transparent"
              strokeWidth="12"
              className="cursor-ew-resize"
              onMouseEnter={() => setHoveredEdge({ panelId: panel.id, edge: 'left' })}
              onMouseLeave={() => setHoveredEdge(null)}
              onMouseDown={(e) => startDraggingEdge(e, panel, 'left')}
            />
            <line
              x1={sx + sw}
              y1={sy}
              x2={sx + sw}
              y2={sy + sh}
              stroke="transparent"
              strokeWidth="12"
              className="cursor-ew-resize"
              onMouseEnter={() => setHoveredEdge({ panelId: panel.id, edge: 'right' })}
              onMouseLeave={() => setHoveredEdge(null)}
              onMouseDown={(e) => startDraggingEdge(e, panel, 'right')}
            />

            <text
              x={sx + sw / 2}
              y={sy + sh / 2 - 6}
              textAnchor="middle"
              fill={isSelected ? '#7dd3fc' : '#cbd5e1'}
              fontSize="12"
              fontWeight="600"
              pointerEvents="none"
            >
              {panel.name}
            </text>
            <text
              x={sx + sw / 2}
              y={sy + sh / 2 + 10}
              textAnchor="middle"
              fill="#94a3b8"
              fontSize="11"
              fontFamily="monospace"
              pointerEvents="none"
            >
              {panel.w.toFixed(2)} m × {panel.h.toFixed(2)} m
            </text>

            {dragState?.panelId === panel.id && (
              <g pointerEvents="none">
                <rect
                  x={sx + sw / 2 - 48}
                  y={sy + sh / 2 - 34}
                  width="96"
                  height="20"
                  rx="4"
                  fill="#0284c7"
                />
                <text
                  x={sx + sw / 2}
                  y={sy + sh / 2 - 20}
                  textAnchor="middle"
                  fill="#ffffff"
                  fontSize="10.5"
                  fontWeight="bold"
                  fontFamily="monospace"
                >
                  {dragState.edge === 'left' || dragState.edge === 'right'
                    ? `Lx = ${panel.w.toFixed(2)} m`
                    : `Ly = ${panel.h.toFixed(2)} m`}
                </text>
              </g>
            )}

            {isEdgeFree(panel, 'top') && (
              <AddEdgeButton
                cx={sx + sw / 2}
                cy={sy - 18}
                title="Dodaj pole powyżej"
                onClick={(e) => {
                  e.stopPropagation();
                  onAddAdjacentPanel(panel, 'top');
                }}
              />
            )}
            {isEdgeFree(panel, 'bottom') && (
              <AddEdgeButton
                cx={sx + sw / 2}
                cy={sy + sh + 18}
                title="Dodaj pole poniżej"
                onClick={(e) => {
                  e.stopPropagation();
                  onAddAdjacentPanel(panel, 'bottom');
                }}
              />
            )}
            {isEdgeFree(panel, 'left') && (
              <AddEdgeButton
                cx={sx - 18}
                cy={sy + sh / 2}
                title="Dodaj pole z lewej"
                onClick={(e) => {
                  e.stopPropagation();
                  onAddAdjacentPanel(panel, 'left');
                }}
              />
            )}
            {isEdgeFree(panel, 'right') && (
              <AddEdgeButton
                cx={sx + sw + 18}
                cy={sy + sh / 2}
                title="Dodaj pole z prawej"
                onClick={(e) => {
                  e.stopPropagation();
                  onAddAdjacentPanel(panel, 'right');
                }}
              />
            )}
          </g>
        );
      })}

      {openings.map(op => {
        const ox = toSvgX(op.x);
        const oy = toSvgY(op.y + op.h);
        const ow = op.w * scale;
        const oh = op.h * scale;
        const isSelected = op.id === selectedOpeningId;

        const touchesRight = Math.abs((op.x + op.w) - maxX) < 0.05;
        const ribWpx = Math.max(5, ((op.ribWidth || 25) / 100) * scale);
        const ribExtPx = 0.85 * scale;

        return (
          <g
            key={op.id}
            onClick={(e) => {
              e.stopPropagation();
              onSelectOpening(op.id);
            }}
            className="cursor-pointer"
          >
            {op.hasRib && (
              <rect
                x={touchesRight ? ox - ribWpx : ox + ow}
                y={oy - ribExtPx}
                width={ribWpx}
                height={oh + ribExtPx * 2}
                fill="rgba(168, 85, 247, 0.35)"
                stroke="#c084fc"
                strokeWidth="1.2"
                strokeDasharray="3 2"
              />
            )}

            <rect
              x={ox}
              y={oy}
              width={ow}
              height={oh}
              fill="url(#openingHatch)"
              stroke={isSelected ? '#fb7185' : '#f43f5e'}
              strokeWidth={isSelected ? '2.5' : '1.5'}
            />
            <text
              x={ox + ow / 2}
              y={oy + oh / 2 + 4}
              textAnchor="middle"
              fill="#fda4af"
              fontSize="10"
              fontWeight="bold"
              fontFamily="monospace"
            >
              {op.w.toFixed(1)}×{op.h.toFixed(1)}
            </text>
          </g>
        );
      })}

      <g stroke="#475569" strokeWidth="1" fill="#94a3b8" fontSize="11" fontFamily="monospace">
        <line x1={toSvgX(minX)} y1={24} x2={toSvgX(maxX)} y2={24} />
        <line x1={toSvgX(minX)} y1={19} x2={toSvgX(minX)} y2={29} />
        <line x1={toSvgX(maxX)} y1={19} x2={toSvgX(maxX)} y2={29} />
        <text x={(toSvgX(minX) + toSvgX(maxX)) / 2} y={18} textAnchor="middle" stroke="none">
          Lx = {totalW.toFixed(2)} m
        </text>

        <line x1={24} y1={toSvgY(maxY)} x2={24} y2={toSvgY(minY)} />
        <line x1={19} y1={toSvgY(maxY)} x2={29} y2={toSvgY(maxY)} />
        <line x1={19} y1={toSvgY(minY)} x2={29} y2={toSvgY(minY)} />
        <text
          x={18}
          y={(toSvgY(minY) + toSvgY(maxY)) / 2}
          textAnchor="middle"
          stroke="none"
          transform={`rotate(-90 18 ${(toSvgY(minY) + toSvgY(maxY)) / 2})`}
        >
          Ly = {totalH.toFixed(2)} m
        </text>
      </g>
    </svg>
  );
}

function AddEdgeButton({ cx, cy, title, onClick }) {
  const safeTitle = typeof title === 'string' ? title : 'Dodaj przylegające pole';
  return (
    <g onClick={onClick} className="cursor-pointer group">
      <circle
        cx={cx}
        cy={cy}
        r="11"
        fill="#0284c7"
        stroke="#e0f2fe"
        strokeWidth="1.5"
        className="group-hover:fill-sky-400 transition"
      />
      <line x1={cx - 4.5} y1={cy} x2={cx + 4.5} y2={cy} stroke="#ffffff" strokeWidth="2" />
      <line x1={cx} y1={cy - 4.5} x2={cx} y2={cy + 4.5} stroke="#ffffff" strokeWidth="2" />
      <text x={cx} y={cy - 15} textAnchor="middle" fill="#bae6fd" fontSize="9" fontFamily="sans-serif">
        {safeTitle}
      </text>
    </g>
  );
}

function MomentHeatmapCanvas({
  femResult,
  panels,
  openings,
  momentDir,
  sectionAxis,
  sectionPosRatio,
  onHoverCell
}) {
  const { minX, maxX, minY, maxY, totalW, totalH, cols, rows, dx, dy, Mx, My, W_mm, extrema } = femResult;

  const matrix = momentDir === 'Mx' ? Mx : My;
  const maxPos = Math.max(10, momentDir === 'Mx' ? extrema.maxMx : extrema.maxMy);
  const maxNeg = Math.max(10, Math.abs(momentDir === 'Mx' ? extrema.minMx : extrema.minMy));

  const getColorForMoment = (val) => {
    if (val === null || val === undefined) return 'transparent';
    if (val >= 0) {
      const t = Math.min(1, val / maxPos);
      if (t < 0.35) {
        const k = t / 0.35;
        return `rgb(${Math.round(30 + k * 20)}, ${Math.round(58 + k * 110)}, ${Math.round(95 - k * 30)})`;
      } else if (t < 0.7) {
        const k = (t - 0.35) / 0.35;
        return `rgb(${Math.round(50 + k * 195)}, ${Math.round(168 + k * 30)}, ${Math.round(65 - k * 45)})`;
      } else {
        const k = (t - 0.7) / 0.3;
        return `rgb(${Math.round(245 - k * 10)}, ${Math.round(198 - k * 145)}, ${Math.round(20 + k * 25)})`;
      }
    } else {
      const t = Math.min(1, Math.abs(val) / maxNeg);
      return `rgb(${Math.round(30 - t * 15)}, ${Math.round(60 + t * 120)}, ${Math.round(110 + t * 140)})`;
    }
  };

  const pad = 42;
  const maxDrawW = 360;
  const maxDrawH = 340;
  const scale = Math.min(maxDrawW / totalW, maxDrawH / totalH);

  const svgW = totalW * scale + pad * 2 + 55;
  const svgH = totalH * scale + pad * 2;

  const toSvgX = (x) => pad + (x - minX) * scale;
  const toSvgY = (y) => pad + (maxY - y) * scale;

  const cellW = dx * scale;
  const cellH = dy * scale;

  return (
    <svg
      viewBox={`0 0 ${svgW} ${svgH}`}
      className="w-full h-full max-h-[430px] select-none"
      onMouseLeave={() => onHoverCell(null)}
    >
      {Array.from({ length: rows }).map((_, j) => {
        const py = minY + j * dy;
        const sy = toSvgY(py) - cellH / 2;
        return Array.from({ length: cols }).map((__, i) => {
          const val = matrix[j][i];
          if (val === null) return null;
          const px = minX + i * dx;
          const sx = toSvgX(px) - cellW / 2;

          return (
            <rect
              key={`${j}-${i}`}
              x={sx}
              y={sy}
              width={cellW + 0.6}
              height={cellH + 0.6}
              fill={getColorForMoment(val)}
              onMouseEnter={() =>
                onHoverCell({
                  x: px,
                  y: py,
                  mx: Mx[j][i],
                  my: My[j][i],
                  w: W_mm[j][i]
                })
              }
            />
          );
        });
      })}

      {panels.map(p => (
        <rect
          key={p.id}
          x={toSvgX(p.x)}
          y={toSvgY(p.y + p.h)}
          width={p.w * scale}
          height={p.h * scale}
          fill="none"
          stroke="#e2e8f0"
          strokeWidth="1.4"
          strokeOpacity="0.7"
          pointerEvents="none"
        />
      ))}

      {openings.map(op => (
        <g key={op.id} pointerEvents="none">
          <rect
            x={toSvgX(op.x)}
            y={toSvgY(op.y + op.h)}
            width={op.w * scale}
            height={op.h * scale}
            fill="#020617"
            stroke="#f43f5e"
            strokeWidth="1.5"
          />
          <text
            x={toSvgX(op.x + op.w / 2)}
            y={toSvgY(op.y + op.h / 2) + 3}
            textAnchor="middle"
            fill="#fda4af"
            fontSize="9"
            fontFamily="monospace"
          >
            OTWÓR
          </text>
        </g>
      ))}

      {sectionAxis === 'Y' ? (
        <line
          x1={toSvgX(minX + sectionPosRatio * totalW)}
          y1={toSvgY(maxY)}
          x2={toSvgX(minX + sectionPosRatio * totalW)}
          y2={toSvgY(minY)}
          stroke="#ffffff"
          strokeWidth="1.8"
          strokeDasharray="5 3"
          pointerEvents="none"
        />
      ) : (
        <line
          x1={toSvgX(minX)}
          y1={toSvgY(minY + sectionPosRatio * totalH)}
          x2={toSvgX(maxX)}
          y2={toSvgY(minY + sectionPosRatio * totalH)}
          stroke="#ffffff"
          strokeWidth="1.8"
          strokeDasharray="5 3"
          pointerEvents="none"
        />
      )}

      <defs>
        <linearGradient id="momentScaleGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ef4444" />
          <stop offset="35%" stopColor="#f59e0b" />
          <stop offset="65%" stopColor="#10b981" />
          <stop offset="82%" stopColor="#1e3a8a" />
          <stop offset="100%" stopColor="#06b6d4" />
        </linearGradient>
      </defs>
      <g transform={`translate(${toSvgX(maxX) + 18}, ${toSvgY(maxY)})`}>
        <rect x="0" y="0" width="12" height={totalH * scale} fill="url(#momentScaleGrad)" rx="3" />
        <text x="16" y="9" fill="#fca5a5" fontSize="9.5" fontFamily="monospace">
          +{maxPos.toFixed(1)}
        </text>
        <text x="16" y={(totalH * scale) * 0.68} fill="#94a3b8" fontSize="9.5" fontFamily="monospace">
          0.0
        </text>
        <text x="16" y={totalH * scale} fill="#67e8f9" fontSize="9.5" fontFamily="monospace">
          -{maxNeg.toFixed(1)}
        </text>
      </g>
    </svg>
  );
}

function MomentSectionChart({ femResult, momentDir, sectionAxis, sectionPosRatio }) {
  const { minX, minY, totalW, totalH, cols, rows, dx, dy, Mx, My } = femResult;
  const matrix = momentDir === 'Mx' ? Mx : My;
  const [hoverIdx, setHoverIdx] = useState(null);

  const points = [];
  if (sectionAxis === 'Y') {
    const colIdx = Math.min(cols - 1, Math.max(0, Math.round(sectionPosRatio * (cols - 1))));
    for (let j = 0; j < rows; j++) {
      points.push({
        coord: minY + j * dy,
        val: matrix[j][colIdx]
      });
    }
  } else {
    const rowIdx = Math.min(rows - 1, Math.max(0, Math.round(sectionPosRatio * (rows - 1))));
    for (let i = 0; i < cols; i++) {
      points.push({
        coord: minX + i * dx,
        val: matrix[rowIdx][i]
      });
    }
  }

  const validVals = points.map(p => p.val).filter(v => v !== null);
  const maxVal = Math.max(15, ...validVals, 0);
  const minVal = Math.min(-15, ...validVals, 0);
  const spanVal = maxVal - minVal || 1;

  const w = 360;
  const h = 250;
  const padL = 44;
  const padR = 16;
  const padT = 22;
  const padB = 34;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;

  const minCoord = sectionAxis === 'Y' ? minY : minX;
  const spanCoord = (sectionAxis === 'Y' ? totalH : totalW) || 1;

  const mapX = (c) => padL + ((c - minCoord) / spanCoord) * plotW;
  const mapY = (v) => padT + ((v - minVal) / spanVal) * plotH;
  const zeroY = mapY(0);

  let pathD = '';
  let penDown = false;
  points.forEach(pt => {
    if (pt.val === null) {
      penDown = false;
    } else {
      const sx = mapX(pt.coord);
      const sy = mapY(pt.val);
      pathD += penDown ? ` L ${sx.toFixed(1)} ${sy.toFixed(1)}` : ` M ${sx.toFixed(1)} ${sy.toFixed(1)}`;
      penDown = true;
    }
  });

  const handlePointerMove = (e) => {
    const svg = e.currentTarget;
    const rect = svg.getBoundingClientRect();
    if (rect.width === 0) return;
    const vx = ((e.clientX - rect.left) / rect.width) * w;
    const rel = Math.max(0, Math.min(1, (vx - padL) / plotW));
    const idx = Math.round(rel * (points.length - 1));
    setHoverIdx(idx);
  };

  const activePt =
    hoverIdx !== null && points[hoverIdx] && points[hoverIdx].val !== null
      ? points[hoverIdx]
      : points.reduce((best, p) => {
          if (p.val === null) return best;
          if (!best || Math.abs(p.val) > Math.abs(best.val)) return p;
          return best;
        }, null);

  const activeX = activePt ? mapX(activePt.coord) : null;
  const activeY = activePt ? mapY(activePt.val) : null;

  return (
    <div className="w-full h-full flex flex-col justify-between gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2 px-2 py-1.5 rounded-lg bg-slate-900/90 border border-slate-800 text-xs font-mono">
        {activePt ? (
          <>
            <span className="text-slate-300">
              {hoverIdx !== null ? 'Punkt wzdłuż przekroju' : 'Ekstremum na przekroju'}:{' '}
              <strong className="text-sky-400">
                {sectionAxis === 'Y' ? `y = ${activePt.coord.toFixed(2)} m` : `x = ${activePt.coord.toFixed(2)} m`}
              </strong>
            </span>
            <span className="text-amber-300 font-semibold">
              {momentDir} = {activePt.val >= 0 ? `+${activePt.val.toFixed(2)}` : activePt.val.toFixed(2)} kNm/m
            </span>
          </>
        ) : (
          <span className="text-slate-500 font-sans">Brak danych na linii cięcia</span>
        )}
      </div>

      <svg
        viewBox={`0 0 ${w} ${h}`}
        className="w-full flex-1 cursor-crosshair select-none"
        onMouseMove={handlePointerMove}
        onMouseLeave={() => setHoverIdx(null)}
      >
        <line x1={padL} y1={zeroY} x2={w - padR} y2={zeroY} stroke="#64748b" strokeWidth="1.2" />
        <text x={padL - 6} y={zeroY + 3} textAnchor="end" fill="#94a3b8" fontSize="9" fontFamily="monospace">
          0
        </text>

        <line x1={padL} y1={padT} x2={w - padR} y2={padT} stroke="#1e293b" strokeDasharray="3 3" />
        <text x={padL - 6} y={padT + 4} textAnchor="end" fill="#38bdf8" fontSize="9" fontFamily="monospace">
          {minVal.toFixed(0)}
        </text>

        <line x1={padL} y1={h - padB} x2={w - padR} y2={h - padB} stroke="#1e293b" strokeDasharray="3 3" />
        <text x={padL - 6} y={h - padB + 3} textAnchor="end" fill="#fbbf24" fontSize="9" fontFamily="monospace">
          +{maxVal.toFixed(0)}
        </text>

        <path d={pathD} fill="none" stroke="#38bdf8" strokeWidth="2.5" strokeLinecap="round" />

        {activePt && activeX !== null && activeY !== null && (
          <g pointerEvents="none">
            <line
              x1={activeX}
              y1={padT}
              x2={activeX}
              y2={h - padB}
              stroke="#94a3b8"
              strokeWidth="1"
              strokeDasharray="2 2"
            />
            <circle
              cx={activeX}
              cy={activeY}
              r="5"
              fill="#fbbf24"
              stroke="#0f172a"
              strokeWidth="2"
            />
          </g>
        )}

        <text x={w / 2} y={h - 6} textAnchor="middle" fill="#64748b" fontSize="10">
          Współrzędna {sectionAxis} [m] (najedź na wykres, aby odczytać wartość i odległość)
        </text>
      </svg>
    </div>
  );
}

function RebarPlanDrawing({
  panels,
  openings,
  femResult,
  design,
  filter,
  selectedPos,
  onSelectPos
}) {
  const { minX, maxX, minY, maxY, totalW, totalH } = femResult;

  const pad = 65;
  const maxDrawW = 430;
  const maxDrawH = 410;
  const scale = Math.min(maxDrawW / totalW, maxDrawH / totalH);

  const svgW = totalW * scale + pad * 2;
  const svgH = totalH * scale + pad * 2;

  const toSvgX = (x) => pad + (x - minX) * scale;
  const toSvgY = (y) => pad + (maxY - y) * scale;

  const showBottom = filter === 'all' || filter === 'bottom';
  const showTop = filter === 'all' || filter === 'top';
  const showRib = filter === 'all' || filter === 'rib';

  return (
    <svg viewBox={`0 0 ${svgW} ${svgH}`} className="w-full h-full max-h-[480px] select-none">
      {panels.map(p => (
        <rect
          key={p.id}
          x={toSvgX(p.x)}
          y={toSvgY(p.y + p.h)}
          width={p.w * scale}
          height={p.h * scale}
          fill="#0f172a"
          stroke="#475569"
          strokeWidth="1.8"
        />
      ))}

      {openings.map(op => (
        <rect
          key={op.id}
          x={toSvgX(op.x)}
          y={toSvgY(op.y + op.h)}
          width={op.w * scale}
          height={op.h * scale}
          fill="#020617"
          stroke="#f43f5e"
          strokeWidth="1.5"
        />
      ))}

      {showBottom &&
        panels.map(p => {
          const cx = toSvgX(p.x + p.w / 2);
          const cy = toSvgY(p.y + p.h / 2);
          const x1 = toSvgX(p.x + 0.15);
          const x2 = toSvgX(p.x + p.w - 0.15);
          const y1 = toSvgY(p.y + p.h - 0.15);
          const y2 = toSvgY(p.y + 0.15);

          return (
            <g
              key={`bot-${p.id}`}
              onClick={() => onSelectPos('Poz. 1')}
              className="cursor-pointer"
              opacity={selectedPos && selectedPos !== 'Poz. 1' && selectedPos !== 'Poz. 2' ? 0.35 : 1}
            >
              <line x1={x1} y1={cy - 12} x2={x2} y2={cy - 12} stroke="#10b981" strokeWidth="2.5" />
              <polyline points={`${x1},${cy - 18} ${x1},${cy - 12}`} stroke="#10b981" strokeWidth="2.5" fill="none" />
              <polyline points={`${x2},${cy - 18} ${x2},${cy - 12}`} stroke="#10b981" strokeWidth="2.5" fill="none" />
              <text x={cx} y={cy - 17} textAnchor="middle" fill="#6ee7b7" fontSize="9.5" fontFamily="monospace">
                Poz.1: {design.rebarBottomX.label} (dół X)
              </text>

              <line x1={cx - 18} y1={y1} x2={cx - 18} y2={y2} stroke="#34d399" strokeWidth="2" strokeDasharray="6 3" />
              <text
                x={cx - 24}
                y={cy + 25}
                textAnchor="middle"
                fill="#a7f3d0"
                fontSize="9"
                fontFamily="monospace"
                transform={`rotate(-90 ${cx - 24} ${cy + 25})`}
              >
                Poz.2: {design.rebarBottomY.label} (dół Y)
              </text>
            </g>
          );
        })}

      {showTop &&
        panels.length > 1 &&
        panels.slice(1).map((p, idx) => {
          const supY = toSvgY(p.y);
          const spanPx = Math.min(1.8 * scale, (p.h * scale) * 0.35);
          const midX = toSvgX(p.x + p.w * 0.38);

          return (
            <g
              key={`sup-${idx}`}
              onClick={() => onSelectPos('Poz. 3')}
              className="cursor-pointer"
              opacity={selectedPos && selectedPos !== 'Poz. 3' ? 0.35 : 1}
            >
              <rect
                x={toSvgX(p.x + 0.1)}
                y={supY - spanPx}
                width={(p.w - 0.2) * scale}
                height={spanPx * 1.8}
                fill="rgba(56, 189, 248, 0.12)"
                stroke="#38bdf8"
                strokeWidth="1"
                strokeDasharray="4 3"
              />
              <line x1={midX} y1={supY - spanPx} x2={midX} y2={supY + spanPx * 0.8} stroke="#38bdf8" strokeWidth="3" />
              <circle cx={midX} cy={supY} r="3.5" fill="#38bdf8" />
              <text x={midX + 8} y={supY - 6} fill="#7dd3fc" fontSize="9.5" fontFamily="monospace" fontWeight="bold">
                Poz.3: {design.rebarTopSupport.label} (góra)
              </text>
            </g>
          );
        })}

      {showRib &&
        openings.map(op => {
          const ox = toSvgX(op.x);
          const oy = toSvgY(op.y + op.h);
          const ow = op.w * scale;
          const oh = op.h * scale;
          const touchesRight = Math.abs((op.x + op.w) - maxX) < 0.05;
          const ribX = touchesRight ? ox - 8 : ox + ow + 8;
          const extPx = 0.85 * scale;

          return (
            <g key={`rib-rebar-${op.id}`}>
              {op.hasRib && (
                <>
                  <line
                    x1={ribX}
                    y1={oy - extPx}
                    x2={ribX}
                    y2={oy + oh + extPx}
                    stroke="#c084fc"
                    strokeWidth="4"
                  />
                  <text
                    x={ribX - 8}
                    y={oy + oh / 2}
                    textAnchor="middle"
                    fill="#e9d5ff"
                    fontSize="9.5"
                    fontWeight="bold"
                    fontFamily="monospace"
                    transform={`rotate(-90 ${ribX - 8} ${oy + oh / 2})`}
                  >
                    Żebro {op.ribWidth}×{op.ribHeight} cm
                  </text>
                </>
              )}

              <line x1={ox - 16} y1={oy + 12} x2={ox + 12} y2={oy - 16} stroke="#fbbf24" strokeWidth="2.5" />
              <line x1={ox - 16} y1={oy + oh - 12} x2={ox + 12} y2={oy + oh + 16} stroke="#fbbf24" strokeWidth="2.5" />
              <text x={ox - 20} y={oy - 18} textAnchor="end" fill="#fde047" fontSize="8.5" fontFamily="monospace">
                2Ø12 (45°)
              </text>
            </g>
          );
        })}

      <g transform={`translate(${pad}, ${svgH - 22})`} fontSize="9.5" fill="#94a3b8">
        <line x1="0" y1="0" x2="18" y2="0" stroke="#10b981" strokeWidth="2.5" />
        <text x="23" y="3">Dół X/Y</text>

        <line x1="85" y1="0" x2="103" y2="0" stroke="#38bdf8" strokeWidth="3" />
        <text x="108" y="3">Góra (podpora)</text>

        <line x1="195" y1="0" x2="213" y2="0" stroke="#c084fc" strokeWidth="3.5" />
        <text x="218" y="3">Żebro</text>

        <line x1="265" y1="0" x2="283" y2="0" stroke="#fbbf24" strokeWidth="2.5" />
        <text x="288" y="3">Ukośne 45°</text>
      </g>
    </svg>
  );
}

function RebarCrossSectionSVG({ slabThickness, cNom, design, openings }) {
  const activeRib = design.ribsDesign[0];
  const ribW = activeRib ? activeRib.ribW : 25;
  const ribH = activeRib ? activeRib.ribH : slabThickness;
  const hasOpening = openings.length > 0;

  return (
    <svg viewBox="0 0 360 155" className="w-full h-auto">
      {activeRib && ribH > slabThickness ? (
        <path
          d="M 20 25 L 250 25 L 250 125 L 185 125 L 185 75 L 20 75 Z"
          fill="#1e293b"
          stroke="#64748b"
          strokeWidth="1.5"
        />
      ) : (
        <rect x="20" y="25" width="230" height="50" fill="#1e293b" stroke="#64748b" strokeWidth="1.5" />
      )}

      {hasOpening && (
        <g>
          <line x1="250" y1="15" x2="250" y2="135" stroke="#f43f5e" strokeWidth="1.2" strokeDasharray="4 3" />
          <text x="262" y="55" fill="#fda4af" fontSize="10" fontWeight="bold">
            OTWÓR
          </text>
          <text x="262" y="68" fill="#94a3b8" fontSize="9">
            (krawędź swobodna)
          </text>
        </g>
      )}

      <line x1="25" y1="65" x2="240" y2="65" stroke="#10b981" strokeWidth="2" />
      <path d="M 150 34 L 242 34 L 242 66 L 150 66" fill="none" stroke="#38bdf8" strokeWidth="1.8" />

      {activeRib ? (
        <g>
          <rect
            x="192"
            y="32"
            width="50"
            height={ribH > slabThickness ? 85 : 36}
            fill="none"
            stroke="#c084fc"
            strokeWidth="1.8"
            rx="3"
          />
          <circle cx="198" cy={ribH > slabThickness ? 111 : 62} r="3.5" fill="#fbbf24" />
          <circle cx="217" cy={ribH > slabThickness ? 111 : 62} r="3.5" fill="#fbbf24" />
          <circle cx="236" cy={ribH > slabThickness ? 111 : 62} r="3.5" fill="#fbbf24" />

          <circle cx="198" cy="38" r="3" fill="#38bdf8" />
          <circle cx="217" cy="38" r="3" fill="#38bdf8" />
          <circle cx="236" cy="38" r="3" fill="#38bdf8" />

          <text x="217" y="142" textAnchor="middle" fill="#e9d5ff" fontSize="9.5" fontFamily="monospace">
            Żebro {ribW}×{ribH} cm ({activeRib.botBars.label})
          </text>
        </g>
      ) : (
        <text x="135" y="102" textAnchor="middle" fill="#94a3b8" fontSize="10" fontFamily="monospace">
          Płyta h = {slabThickness} cm, c_nom = {cNom} mm
        </text>
      )}

      <text x="30" y="18" fill="#94a3b8" fontSize="9.5" fontFamily="monospace">
        h_płyty = {slabThickness} cm | {design.rebarBottomX.label}
      </text>
    </svg>
  );
}
