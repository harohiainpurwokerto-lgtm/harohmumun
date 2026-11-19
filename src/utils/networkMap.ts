import type { Customer, DeviceStatus, NetworkNodeStatus } from '../types';

export interface LatLngLiteral {
  lat: number;
  lng: number;
}

export type LabelPlacement = 'top' | 'right' | 'bottom' | 'left';

export interface OpticalStatusMeta {
  severity: 'ok' | 'warning' | 'isolir' | 'critical';
  shortTag: string;
  statusLabel: string;
  opticalLabel: string;
  signalBadgeText: string;
  markerBgClass: string;
  markerBorderClass: string;
  markerTextClass: string;
  tagBgClass: string;
  tagTextClass: string;
  dotClass: string;
}

export interface FiberLinkVisual {
  stroke: string;
  dashed: boolean;
  dashArray?: string;
  repeatPx?: string;
  strokeWeight: number;
  category: 'normal' | 'attenuation' | 'isolir' | 'critical';
  label: string;
}

export function getOpticalStatusMeta(
  status: DeviceStatus,
  rxPowerDbm: number | null | undefined
): OpticalStatusMeta {
  const hasDbm = typeof rxPowerDbm === 'number' && Number.isFinite(rxPowerDbm);

  if (status === 'Isolir') {
    return {
      severity: 'isolir',
      shortTag: 'ISOLIR',
      statusLabel: 'Isolir (Billing)',
      opticalLabel: hasDbm ? `${rxPowerDbm.toFixed(1)} dBm` : 'Nonaktif Billing',
      signalBadgeText: hasDbm ? `${rxPowerDbm.toFixed(1)} dBm · Isolir` : 'Isolir Layanan',
      markerBgClass: 'bg-amber-50',
      markerBorderClass: 'border-amber-500',
      markerTextClass: 'text-amber-950',
      tagBgClass: 'bg-amber-500 text-white',
      tagTextClass: 'text-amber-800',
      dotClass: 'bg-amber-500',
    };
  }

  if (status === 'Offline') {
    const isLos = !hasDbm || (rxPowerDbm as number) <= -28;
    return {
      severity: 'critical',
      shortTag: isLos ? 'LOS' : 'OFFLINE',
      statusLabel: isLos ? 'Offline / LOS' : 'Offline',
      opticalLabel: hasDbm ? `${rxPowerDbm.toFixed(1)} dBm` : 'LOS / Putus',
      signalBadgeText: hasDbm
        ? `${rxPowerDbm.toFixed(1)} dBm · Kritis`
        : 'LOS · Tidak Terjangkau',
      markerBgClass: 'bg-rose-50',
      markerBorderClass: 'border-rose-600',
      markerTextClass: 'text-rose-950',
      tagBgClass: 'bg-rose-600 text-white',
      tagTextClass: 'text-rose-700',
      dotClass: 'bg-rose-600',
    };
  }

  if (hasDbm && (rxPowerDbm as number) <= -28) {
    return {
      severity: 'critical',
      shortTag: 'LOS!',
      statusLabel: 'Online (Redaman Kritis)',
      opticalLabel: `${rxPowerDbm.toFixed(1)} dBm`,
      signalBadgeText: `${rxPowerDbm.toFixed(1)} dBm · Kritis`,
      markerBgClass: 'bg-rose-50',
      markerBorderClass: 'border-rose-600',
      markerTextClass: 'text-rose-950',
      tagBgClass: 'bg-rose-600 text-white',
      tagTextClass: 'text-rose-700',
      dotClass: 'bg-rose-600',
    };
  }

  if (hasDbm && (rxPowerDbm as number) <= -25) {
    return {
      severity: 'warning',
      shortTag: 'ONLINE',
      statusLabel: 'Online (Redaman Tinggi)',
      opticalLabel: `${rxPowerDbm.toFixed(1)} dBm`,
      signalBadgeText: `${rxPowerDbm.toFixed(1)} dBm · Redaman Tinggi`,
      markerBgClass: 'bg-white',
      markerBorderClass: 'border-emerald-600',
      markerTextClass: 'text-slate-900',
      tagBgClass: 'bg-orange-600 text-white',
      tagTextClass: 'text-orange-700',
      dotClass: 'bg-emerald-500',
    };
  }

  return {
    severity: 'ok',
    shortTag: 'ONLINE',
    statusLabel: 'Online',
    opticalLabel: hasDbm ? `${rxPowerDbm.toFixed(1)} dBm` : 'Ethernet',
    signalBadgeText: hasDbm ? `${rxPowerDbm.toFixed(1)} dBm · Sinyal Baik` : 'Ethernet · Normal',
    markerBgClass: 'bg-white',
    markerBorderClass: 'border-emerald-600',
    markerTextClass: 'text-slate-900',
    tagBgClass: 'bg-emerald-600 text-white',
    tagTextClass: 'text-emerald-700',
    dotClass: 'bg-emerald-500',
  };
}

export function getFiberLinkVisual(
  status: DeviceStatus | NetworkNodeStatus,
  rxPowerDbm?: number | null
): FiberLinkVisual {
  const hasDbm = typeof rxPowerDbm === 'number' && Number.isFinite(rxPowerDbm);

  if (status === 'Offline') {
    return {
      stroke: '#e11d48',
      dashed: true,
      dashArray: '4 4',
      repeatPx: '9px',
      strokeWeight: 2.8,
      category: 'critical',
      label: 'Offline / LOS',
    };
  }

  if (status === 'Isolir' || status === 'Degraded') {
    return {
      stroke: '#d97706',
      dashed: true,
      dashArray: '8 5',
      repeatPx: '15px',
      strokeWeight: 2.5,
      category: 'isolir',
      label: status === 'Isolir' ? 'Isolir Billing' : 'Degraded',
    };
  }

  if (hasDbm && (rxPowerDbm as number) <= -28) {
    return {
      stroke: '#e11d48',
      dashed: true,
      dashArray: '4 4',
      repeatPx: '9px',
      strokeWeight: 2.7,
      category: 'critical',
      label: 'Redaman Kritis (<= -28 dBm)',
    };
  }

  if (hasDbm && (rxPowerDbm as number) <= -25) {
    return {
      stroke: '#ea580c',
      dashed: true,
      dashArray: '7 4',
      repeatPx: '13px',
      strokeWeight: 2.5,
      category: 'attenuation',
      label: 'Redaman Tinggi (<= -25 dBm)',
    };
  }

  return {
    stroke: '#059669',
    dashed: false,
    strokeWeight: 2.8,
    category: 'normal',
    label: 'Online / Normal',
  };
}

export function calculateHaversineMeters(a: LatLngLiteral, b: LatLngLiteral): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h =
    sinLat * sinLat +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinLng * sinLng;
  return Math.round(2 * R * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h)));
}

export function latLngToSchematicPercent(lat: number, lng: number): { mapX: number; mapY: number } {
  const relX = Math.min(96, Math.max(4, Number((((lng - 109.232) / 0.016) * 100).toFixed(1))));
  const relY = Math.min(94, Math.max(6, Number((((-7.4195 - lat) / 0.009) * 100).toFixed(1))));
  return { mapX: relX, mapY: relY };
}

export function schematicPercentToLatLng(relX: number, relY: number): LatLngLiteral {
  return {
    lat: Number((-7.4195 - (relY / 100) * 0.009).toFixed(5)),
    lng: Number((109.232 + (relX / 100) * 0.016).toFixed(5)),
  };
}

/**
 * Computes anti-overlap visual coordinates and directional label placement
 * for geographic markers that sit very close to each other or near an ODP.
 */
export function computeGeoDeoverlappedOntLayout(
  onts: Customer[],
  actualOntCoords: Record<number, LatLngLiteral>,
  odpCoords: Record<number, LatLngLiteral>
): {
  displayCoords: Record<number, LatLngLiteral>;
  labelPlacement: Record<number, LabelPlacement>;
  wasSpread: Record<number, boolean>;
} {
  const displayCoords: Record<number, LatLngLiteral> = {};
  const labelPlacement: Record<number, LabelPlacement> = {};
  const wasSpread: Record<number, boolean> = {};

  // Step 1: Detect nearly identical points (< 20m apart) and spread them on a tiny ring
  const sortedOnts = [...onts].sort((a, b) => a.id - b.id);
  const clusters: number[][] = [];
  const visited = new Set<number>();

  for (let i = 0; i < sortedOnts.length; i++) {
    const a = sortedOnts[i];
    if (visited.has(a.id)) continue;
    const posA = actualOntCoords[a.id];
    if (!posA) continue;
    const group = [a.id];
    visited.add(a.id);

    for (let j = i + 1; j < sortedOnts.length; j++) {
      const b = sortedOnts[j];
      if (visited.has(b.id)) continue;
      const posB = actualOntCoords[b.id];
      if (!posB) continue;
      const distMeters = calculateHaversineMeters(posA, posB);
      if (distMeters < 22) {
        group.push(b.id);
        visited.add(b.id);
      }
    }
    clusters.push(group);
  }

  for (const group of clusters) {
    if (group.length === 1) {
      const id = group[0];
      displayCoords[id] = actualOntCoords[id];
      wasSpread[id] = false;
    } else {
      const centerLat =
        group.reduce((s, id) => s + actualOntCoords[id].lat, 0) / group.length;
      const centerLng =
        group.reduce((s, id) => s + actualOntCoords[id].lng, 0) / group.length;
      const radiusDeg = 0.00018; // ~20 meters visual separation
      group.forEach((id, idx) => {
        const angle = (2 * Math.PI * idx) / group.length - Math.PI / 2;
        displayCoords[id] = {
          lat: Number((centerLat + Math.sin(angle) * radiusDeg).toFixed(6)),
          lng: Number((centerLng + Math.cos(angle) * radiusDeg * 1.05).toFixed(6)),
        };
        wasSpread[id] = true;
      });
    }
  }

  // Step 2: Pick the least crowded label quadrant ('top' | 'right' | 'bottom' | 'left')
  const candidateDirs: Array<{ dir: LabelPlacement; dx: number; dy: number }> = [
    { dir: 'bottom', dx: 0, dy: -1 },
    { dir: 'right', dx: 1, dy: 0 },
    { dir: 'top', dx: 0, dy: 1 },
    { dir: 'left', dx: -1, dy: 0 },
  ];

  const allAnchors: Array<{ key: string; pos: LatLngLiteral }> = [
    ...Object.entries(odpCoords).map(([id, pos]) => ({ key: `odp-${id}`, pos })),
    ...Object.entries(displayCoords).map(([id, pos]) => ({ key: `ont-${id}`, pos })),
  ];

  const usedSiblingSlots = new Map<number, number>();

  for (const ont of sortedOnts) {
    const pos = displayCoords[ont.id];
    if (!pos) continue;

    let bestDir: LabelPlacement = 'bottom';
    let bestScore = -Infinity;

    // Slight rotation per ODP sibling so devices under the same ODP alternate naturally
    const odpKey = ont.odp_id ?? 0;
    const siblingIndex = usedSiblingSlots.get(odpKey) ?? 0;
    usedSiblingSlots.set(odpKey, siblingIndex + 1);

    for (let cIdx = 0; cIdx < candidateDirs.length; cIdx++) {
      const cand = candidateDirs[(cIdx + siblingIndex) % candidateDirs.length];
      let score = 0;

      // Prefer pointing away from parent ODP
      if (ont.odp_id && odpCoords[ont.odp_id]) {
        const odpPos = odpCoords[ont.odp_id];
        const vx = pos.lng - odpPos.lng;
        const vy = pos.lat - odpPos.lat;
        const len = Math.hypot(vx, vy) || 1;
        const dot = (vx / len) * cand.dx + (vy / len) * cand.dy;
        score += dot * 2.5;
      }

      // Penalize directions pointing toward nearby markers within ~110m
      for (const anchor of allAnchors) {
        if (anchor.key === `ont-${ont.id}`) continue;
        const dx = (anchor.pos.lng - pos.lng) * 110000;
        const dy = (anchor.pos.lat - pos.lat) * 111000;
        const dist = Math.hypot(dx, dy);
        if (dist > 0 && dist < 115) {
          const alignment = (dx / dist) * cand.dx + (dy / dist) * cand.dy;
          if (alignment > 0) {
            score -= alignment * ((115 - dist) / 25);
          }
        }
      }

      // Slight preference for bottom/right readability when scores tie
      if (cand.dir === 'bottom') score += 0.25;
      if (cand.dir === 'right') score += 0.15;

      if (score > bestScore) {
        bestScore = score;
        bestDir = cand.dir;
      }
    }

    labelPlacement[ont.id] = bestDir;
  }

  return { displayCoords, labelPlacement, wasSpread };
}

/**
 * Anti-overlap layout solver for Schematic percentage canvas (0..100).
 */
export function computeSchematicDeoverlappedLayout(
  onts: Customer[],
  odps: Array<{ id: number; map_x: number; map_y: number }>
): {
  positions: Record<number, { x: number; y: number }>;
  labelPlacement: Record<number, LabelPlacement>;
} {
  const positions: Record<number, { x: number; y: number }> = {};
  const labelPlacement: Record<number, LabelPlacement> = {};

  // Initialize raw positions
  for (const ont of onts) {
    positions[ont.id] = {
      x: typeof ont.map_x === 'number' && Number.isFinite(ont.map_x) ? ont.map_x : 50,
      y: typeof ont.map_y === 'number' && Number.isFinite(ont.map_y) ? ont.map_y : 75,
    };
  }

  // Iterative gentle repulsion between nearby ONTs (< 7.5% distance)
  const ordered = [...onts].sort((a, b) => a.id - b.id);
  for (let iter = 0; iter < 5; iter++) {
    for (let i = 0; i < ordered.length; i++) {
      for (let j = i + 1; j < ordered.length; j++) {
        const a = positions[ordered[i].id];
        const b = positions[ordered[j].id];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.hypot(dx, dy);
        const minGap = 7.2;
        if (dist < minGap) {
          const angle = dist > 0.05 ? Math.atan2(dy, dx) : ((i + j) * Math.PI) / 3;
          const push = (minGap - dist) * 0.45;
          const px = Math.cos(angle) * push;
          const py = Math.sin(angle) * push;
          a.x = Math.min(95, Math.max(5, Number((a.x - px).toFixed(2))));
          a.y = Math.min(92, Math.max(8, Number((a.y - py).toFixed(2))));
          b.x = Math.min(95, Math.max(5, Number((b.x + px).toFixed(2))));
          b.y = Math.min(92, Math.max(8, Number((b.y + py).toFixed(2))));
        }
      }
    }
  }

  const odpById: Record<number, { x: number; y: number }> = {};
  for (const d of odps) {
    odpById[d.id] = { x: d.map_x, y: d.map_y };
  }

  // Note: in screen coordinates, top is -y, bottom is +y
  const dirs: Array<{ dir: LabelPlacement; dx: number; dy: number }> = [
    { dir: 'bottom', dx: 0, dy: 1 },
    { dir: 'right', dx: 1, dy: 0 },
    { dir: 'top', dx: 0, dy: -1 },
    { dir: 'left', dx: -1, dy: 0 },
  ];

  for (let idx = 0; idx < ordered.length; idx++) {
    const ont = ordered[idx];
    const p = positions[ont.id];
    let bestDir: LabelPlacement = 'bottom';
    let bestScore = -Infinity;

    for (const cand of dirs) {
      let score = 0;
      // Avoid clipping near canvas edges
      if (cand.dir === 'left' && p.x < 14) score -= 4;
      if (cand.dir === 'right' && p.x > 86) score -= 4;
      if (cand.dir === 'top' && p.y < 15) score -= 4;
      if (cand.dir === 'bottom' && p.y > 85) score -= 4;

      // Point away from parent ODP
      if (ont.odp_id && odpById[ont.odp_id]) {
        const odpP = odpById[ont.odp_id];
        const vx = p.x - odpP.x;
        const vy = p.y - odpP.y;
        const len = Math.hypot(vx, vy) || 1;
        score += ((vx / len) * cand.dx + (vy / len) * cand.dy) * 2.2;
      }

      // Avoid neighbors
      for (const other of ordered) {
        if (other.id === ont.id) continue;
        const op = positions[other.id];
        const dx = op.x - p.x;
        const dy = op.y - p.y;
        const dist = Math.hypot(dx, dy);
        if (dist > 0 && dist < 16) {
          const align = (dx / dist) * cand.dx + (dy / dist) * cand.dy;
          if (align > 0) score -= align * ((16 - dist) / 4);
        }
      }

      if (cand.dir === 'bottom') score += 0.2;
      if (score > bestScore) {
        bestScore = score;
        bestDir = cand.dir;
      }
    }
    labelPlacement[ont.id] = bestDir;
  }

  return { positions, labelPlacement };
}
