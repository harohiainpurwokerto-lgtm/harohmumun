import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  APIProvider,
  APILoadingStatus,
  AdvancedMarker,
  AdvancedMarkerAnchorPoint,
  InfoWindow,
  Map as GoogleMap,
  Polyline,
  useAdvancedMarkerRef,
  useApiLoadingStatus,
  useMap,
} from '@vis.gl/react-google-maps';
import type { MapMouseEvent } from '@vis.gl/react-google-maps';
import {
  AlertTriangle,
  Box,
  Crosshair,
  Eye,
  Layers,
  LocateFixed,
  MessageCircle,
  Router,
  Server,
  Ticket,
} from 'lucide-react';
import type {
  Customer,
  NetworkNode,
  NetworkOdp,
  TicketPrefillPayload,
} from '../types';
import {
  calculateHaversineMeters,
  computeGeoDeoverlappedOntLayout,
  getFiberLinkVisual,
  getOpticalStatusMeta,
  type LabelPlacement,
  type LatLngLiteral,
} from '../utils/networkMap';

export type MapSelectedEntity =
  | { kind: 'node'; id: number }
  | { kind: 'odp'; id: number }
  | { kind: 'ont'; id: number }
  | null;

interface HighlightedPath {
  nodeIds: Set<number>;
  odpIds: Set<number>;
  ontIds: Set<number>;
  active: boolean;
}

export interface PreviewOntTarget {
  ontId: number;
  deviceId: string;
  customerName: string;
  lat: number;
  lng: number;
  odpId: number | null;
  nodeId: number | null;
  odpCode?: string | null;
}

export interface PreviewInfraTarget {
  kind: 'odp' | 'node';
  id: number;
  code: string;
  name: string;
  lat: number;
  lng: number;
}

interface GoogleNetworkMapProps {
  nodes: NetworkNode[];
  odps: NetworkOdp[];
  onts: Customer[];
  selected: MapSelectedEntity;
  highlightedPath: HighlightedPath;
  showCableLines: boolean;
  showTelemetryLabels: boolean;
  pickMapTarget: { kind: 'ont' | 'odp' | 'node'; id: number } | null;
  previewOnt?: PreviewOntTarget | null;
  previewInfra?: PreviewInfraTarget | null;
  onSelect: (entity: MapSelectedEntity) => void;
  onInspectEntity?: (entity: MapSelectedEntity) => void;
  onPickCoordinates: (lat: number, lng: number) => void;
  onOpenChat?: (customerId: number) => void;
  onCreateTicket?: (prefill: TicketPrefillPayload) => void;
  onSwitchToSchematic?: () => void;
}

const DEFAULT_CENTER: LatLngLiteral = { lat: -7.4242, lng: 109.2392 };

function hasValidCoords(lat: number | null | undefined, lng: number | null | undefined): boolean {
  return (
    typeof lat === 'number' &&
    typeof lng === 'number' &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat !== 0 &&
    lng !== 0
  );
}

function getFallbackCoords(mapX: number | null | undefined, mapY: number | null | undefined): LatLngLiteral {
  const rx = typeof mapX === 'number' && Number.isFinite(mapX) ? mapX : 50;
  const ry = typeof mapY === 'number' && Number.isFinite(mapY) ? mapY : 50;
  return {
    lat: Number((-7.4195 - (ry / 100) * 0.009).toFixed(5)),
    lng: Number((109.232 + (rx / 100) * 0.016).toFixed(5)),
  };
}

function getEntityCoords(
  lat: number | null | undefined,
  lng: number | null | undefined,
  mapX: number | null | undefined,
  mapY: number | null | undefined
): LatLngLiteral {
  if (hasValidCoords(lat, lng)) {
    return { lat: lat as number, lng: lng as number };
  }
  return getFallbackCoords(mapX, mapY);
}

function buildTicketPrefillFromOnt(ont: Customer): TicketPrefillPayload {
  const isLos = ont.rx_power_dbm !== null && ont.rx_power_dbm <= -28;
  const isWeak = ont.rx_power_dbm !== null && ont.rx_power_dbm <= -25;
  return {
    customer_id: ont.id,
    source: ont.device_status === 'Offline' ? 'Alarm NOC / Webhook' : 'Cek Lapangan',
    category: isLos
      ? 'LOS / Optik Putus'
      : isWeak
        ? 'Redaman / Optik Lemah'
        : ont.device_status === 'Offline'
          ? 'Perangkat Mati / Adaptor'
          : 'Lainnya',
    priority:
      ont.device_status === 'Offline' && isLos
        ? 'Kritis'
        : ont.device_status !== 'Online' || isWeak
          ? 'Tinggi'
          : 'Normal',
    issue_summary: `Gangguan pada ${ont.device_id} (${ont.odp_code || 'Tanpa ODP'}${
      ont.pon_port ? ` · ${ont.pon_port}` : ''
    }, status: ${ont.device_status}${
      ont.rx_power_dbm !== null ? `, redaman ${ont.rx_power_dbm.toFixed(1)} dBm` : ''
    })`,
  };
}

function getDirectionalLabelClass(placement: LabelPlacement): string {
  switch (placement) {
    case 'top':
      return 'bottom-full mb-1.5 left-1/2 -translate-x-1/2';
    case 'right':
      return 'left-full ml-1.5 top-1/2 -translate-y-1/2';
    case 'left':
      return 'right-full mr-1.5 top-1/2 -translate-y-1/2';
    case 'bottom':
    default:
      return 'top-full mt-1.5 left-1/2 -translate-x-1/2';
  }
}

interface NodeMarkerItemProps {
  node: NetworkNode;
  position: LatLngLiteral;
  isSelected: boolean;
  dimmed: boolean;
  isInfoOpen: boolean;
  onSelect: () => void;
  onInspect?: () => void;
  onCloseInfo: () => void;
}

function NodeMarkerItem({
  node,
  position,
  isSelected,
  dimmed,
  isInfoOpen,
  onSelect,
  onInspect,
  onCloseInfo,
}: NodeMarkerItemProps) {
  const [markerRef, marker] = useAdvancedMarkerRef();
  const [hovered, setHovered] = useState(false);

  const statusDotClass =
    node.status === 'Online'
      ? 'bg-emerald-400'
      : node.status === 'Degraded'
        ? 'bg-amber-400'
        : 'bg-rose-500';

  return (
    <>
      <AdvancedMarker
        ref={markerRef}
        position={position}
        anchorPoint={AdvancedMarkerAnchorPoint.CENTER}
        zIndex={isSelected ? 1000 : hovered ? 900 : 450}
        onClick={onSelect}
        title={`${node.node_code} - ${node.name} (${node.status})`}
      >
        <div
          className="relative"
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
        >
          <div
            className={`px-2.5 py-1 rounded-md border bg-slate-900 text-white text-[11px] font-mono font-semibold flex items-center gap-1.5 shadow-md transition-transform cursor-pointer ${
              isSelected
                ? 'ring-2 ring-red-400 border-red-400 scale-105'
                : 'border-slate-700 hover:scale-105'
            } ${dimmed ? 'opacity-40' : 'opacity-100'}`}
          >
            <span className={`w-2 h-2 rounded-full shrink-0 ${statusDotClass}`} />
            {node.node_type === 'MikroTik' ? (
              <Router className="w-3.5 h-3.5 text-sky-400 shrink-0" />
            ) : (
              <Server className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            )}
            <span>{node.node_code}</span>
          </div>

          {hovered && !isInfoOpen && (
            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-52 p-2 rounded-md bg-slate-900 text-white text-[11px] shadow-xl border border-slate-700 pointer-events-none z-50">
              <div className="flex items-center justify-between gap-2 font-mono font-bold">
                <span>{node.node_code}</span>
                <span
                  className={
                    node.status === 'Online'
                      ? 'text-emerald-300'
                      : node.status === 'Degraded'
                        ? 'text-amber-300'
                        : 'text-rose-300'
                  }
                >
                  {node.status}
                </span>
              </div>
              <div className="text-slate-200 truncate mt-0.5">{node.name}</div>
              <div className="text-[10px] font-mono text-slate-400 mt-0.5 tabular-nums">
                {node.host_ip} · CPU {node.cpu_load_pct}% · {node.active_sessions} sesi
              </div>
            </div>
          )}
        </div>
      </AdvancedMarker>

      {isInfoOpen && marker && (
        <InfoWindow anchor={marker} onCloseClick={onCloseInfo}>
          <div className="min-w-[220px] p-1 text-slate-900 space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-xs font-bold">{node.node_code}</span>
              <span
                className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                  node.status === 'Online'
                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                    : node.status === 'Degraded'
                      ? 'bg-amber-50 text-amber-700 border border-amber-200'
                      : 'bg-rose-50 text-rose-700 border border-rose-200'
                }`}
              >
                {node.status}
              </span>
            </div>
            <div className="text-xs font-medium text-slate-800">{node.name}</div>
            <div className="text-[11px] font-mono text-slate-500">
              {node.node_type} · {node.host_ip}
            </div>
            <div className="text-[11px] font-mono text-slate-600 tabular-nums">
              CPU {node.cpu_load_pct}% · {node.active_sessions} sesi aktif
            </div>
            {onInspect && (
              <div className="pt-1">
                <button
                  type="button"
                  onClick={() => {
                    onInspect();
                    onCloseInfo();
                  }}
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-slate-800 bg-slate-100 hover:bg-slate-200 rounded transition-colors"
                >
                  <Eye className="w-3 h-3" />
                  Inspeksi Node
                </button>
              </div>
            )}
          </div>
        </InfoWindow>
      )}
    </>
  );
}

interface OdpMarkerItemProps {
  odp: NetworkOdp;
  position: LatLngLiteral;
  isSelected: boolean;
  dimmed: boolean;
  ontCounts: { online: number; isolir: number; offline: number };
  isInfoOpen: boolean;
  onSelect: () => void;
  onInspect?: () => void;
  onCloseInfo: () => void;
}

function OdpMarkerItem({
  odp,
  position,
  isSelected,
  dimmed,
  ontCounts,
  isInfoOpen,
  onSelect,
  onInspect,
  onCloseInfo,
}: OdpMarkerItemProps) {
  const [markerRef, marker] = useAdvancedMarkerRef();
  const [hovered, setHovered] = useState(false);

  const hasOfflineOnt = ontCounts.offline > 0;
  const hasIsolirOnt = ontCounts.isolir > 0;

  return (
    <>
      <AdvancedMarker
        ref={markerRef}
        position={position}
        anchorPoint={AdvancedMarkerAnchorPoint.CENTER}
        zIndex={isSelected ? 1000 : hovered ? 900 : hasOfflineOnt ? 420 : 380}
        onClick={onSelect}
        title={`${odp.odp_code} (${odp.area_zone})`}
      >
        <div
          className="relative"
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
        >
          <div
            className={`px-2 py-1 rounded border bg-white text-slate-900 text-[10px] font-mono font-bold flex items-center gap-1 shadow-md transition-transform cursor-pointer ${
              isSelected
                ? 'border-red-600 ring-2 ring-red-500/40 scale-105'
                : hasOfflineOnt
                  ? 'border-rose-500 ring-1 ring-rose-300'
                  : hasIsolirOnt
                    ? 'border-amber-500'
                    : 'border-sky-600'
            } ${dimmed ? 'opacity-40' : 'opacity-100'}`}
          >
            <Box className="w-3 h-3 text-sky-700 shrink-0" />
            <span>{odp.odp_code}</span>
            <span className="text-[9px] text-slate-500 font-normal tabular-nums">
              {odp.used_ports ?? 0}/{odp.capacity_ports}
            </span>
          </div>

          {hovered && !isInfoOpen && (
            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-56 p-2 rounded-md bg-white text-slate-900 text-[11px] shadow-xl border border-slate-200 pointer-events-none z-50">
              <div className="flex items-center justify-between gap-2 font-mono font-bold">
                <span>{odp.odp_code}</span>
                <span className="text-slate-500 tabular-nums">
                  {odp.used_ports ?? 0}/{odp.capacity_ports} port
                </span>
              </div>
              <div className="text-slate-700 font-medium truncate mt-0.5">{odp.area_zone}</div>
              <div className="mt-1 flex items-center gap-2 text-[10px] font-mono tabular-nums">
                <span className="text-emerald-700">{ontCounts.online} Online</span>
                <span className="text-amber-700">{ontCounts.isolir} Isolir</span>
                <span className="text-rose-700">{ontCounts.offline} LOS</span>
              </div>
            </div>
          )}
        </div>
      </AdvancedMarker>

      {isInfoOpen && marker && (
        <InfoWindow anchor={marker} onCloseClick={onCloseInfo}>
          <div className="min-w-[225px] p-1 text-slate-900 space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-xs font-bold">{odp.odp_code}</span>
              <span className="font-mono text-[11px] text-slate-600 tabular-nums">
                {odp.used_ports ?? 0}/{odp.capacity_ports} port
              </span>
            </div>
            <div className="text-xs font-medium text-slate-800">{odp.name}</div>
            <div className="text-[11px] text-slate-500">Area: {odp.area_zone}</div>
            <div className="text-[11px] font-mono text-slate-600">
              {odp.node_code || '—'} · {odp.pon_port} ({odp.splitter_ratio})
            </div>
            <div className="flex items-center gap-2 pt-0.5 text-[10px] font-mono tabular-nums">
              <span className="px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">
                {ontCounts.online} Online
              </span>
              <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200">
                {ontCounts.isolir} Isolir
              </span>
              <span className="px-1.5 py-0.5 rounded bg-rose-50 text-rose-700 border border-rose-200">
                {ontCounts.offline} Offline/LOS
              </span>
            </div>
            {onInspect && (
              <div className="pt-1">
                <button
                  type="button"
                  onClick={() => {
                    onInspect();
                    onCloseInfo();
                  }}
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-slate-800 bg-slate-100 hover:bg-slate-200 rounded transition-colors"
                >
                  <Eye className="w-3 h-3" />
                  Inspeksi ODP
                </button>
              </div>
            )}
          </div>
        </InfoWindow>
      )}
    </>
  );
}

interface OntMarkerItemProps {
  ont: Customer;
  position: LatLngLiteral;
  actualCoords: LatLngLiteral;
  labelPlacement: LabelPlacement;
  wasSpread: boolean;
  baseZIndex: number;
  isSelected: boolean;
  dimmed: boolean;
  showTelemetryLabels: boolean;
  isInfoOpen: boolean;
  onSelect: () => void;
  onInspect?: () => void;
  onCloseInfo: () => void;
  onOpenChat?: (customerId: number) => void;
  onCreateTicket?: (prefill: TicketPrefillPayload) => void;
}

function OntMarkerItem({
  ont,
  position,
  actualCoords,
  labelPlacement,
  wasSpread,
  baseZIndex,
  isSelected,
  dimmed,
  showTelemetryLabels,
  isInfoOpen,
  onSelect,
  onInspect,
  onCloseInfo,
  onOpenChat,
  onCreateTicket,
}: OntMarkerItemProps) {
  const [markerRef, marker] = useAdvancedMarkerRef();
  const [hovered, setHovered] = useState(false);

  const meta = getOpticalStatusMeta(ont.device_status, ont.rx_power_dbm);
  const shortCode = ont.device_id.replace('ONT-', '').replace('RTR-', '');
  const firstName = ont.name.split(' ').slice(0, 2).join(' ');

  const beaconRingClass =
    ont.device_status === 'Offline'
      ? 'bg-rose-600 ring-4 ring-rose-500/35 border-white'
      : ont.device_status === 'Isolir'
        ? 'bg-amber-500 ring-4 ring-amber-400/35 border-white'
        : meta.severity === 'warning'
          ? 'bg-emerald-600 ring-4 ring-orange-400/40 border-white'
          : 'bg-emerald-600 ring-2 ring-emerald-400/35 border-white';

  const zIndex = isSelected ? 1000 : hovered ? 900 : baseZIndex;

  return (
    <>
      <AdvancedMarker
        ref={markerRef}
        position={position}
        anchorPoint={AdvancedMarkerAnchorPoint.CENTER}
        zIndex={zIndex}
        onClick={onSelect}
        title={`${ont.device_id} (${ont.name}) - ${meta.statusLabel}`}
      >
        <div
          className={`relative flex items-center justify-center cursor-pointer ${
            dimmed ? 'opacity-40' : 'opacity-100'
          }`}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
        >
          {/* Central Coordinate Beacon Dot (anchors fiber polyline cleanly) */}
          <div
            className={`w-4 h-4 rounded-full border-2 shadow-md flex items-center justify-center transition-transform ${beaconRingClass} ${
              isSelected || hovered ? 'scale-125' : ''
            }`}
          >
            {ont.device_status === 'Offline' ? (
              <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
            ) : ont.device_status === 'Isolir' ? (
              <span className="w-1.5 h-1.5 rounded-sm bg-white" />
            ) : (
              <span className="w-1.5 h-1.5 rounded-full bg-white" />
            )}
          </div>

          {/* Non-overlapping Directional Label Callout */}
          <div
            className={`absolute ${getDirectionalLabelClass(
              labelPlacement
            )} px-1.5 py-0.5 rounded border shadow-sm transition-transform whitespace-nowrap ${
              meta.markerBgClass
            } ${meta.markerBorderClass} ${meta.markerTextClass} ${
              isSelected ? 'ring-2 ring-red-600 scale-105' : ''
            }`}
          >
            <div className="flex items-center gap-1 text-[10px] font-mono font-bold leading-tight">
              <span>{shortCode}</span>
              <span
                className={`px-1 py-[1px] rounded-[3px] text-[8px] font-bold tracking-wide leading-none ${meta.tagBgClass}`}
              >
                {meta.shortTag}
              </span>
            </div>
            {showTelemetryLabels && (
              <div className="text-[9px] leading-tight mt-0.5 flex items-center gap-1 font-mono tabular-nums text-slate-600">
                <span className="font-sans font-medium text-slate-700 truncate max-w-[78px]">
                  {firstName}
                </span>
                <span>·</span>
                <span className={meta.tagTextClass}>{meta.opticalLabel}</span>
              </div>
            )}
          </div>

          {/* Compact Hover Popup (only when InfoWindow is not already open) */}
          {hovered && !isInfoOpen && (
            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-5 w-60 p-2.5 rounded-md bg-slate-900 text-white text-[11px] shadow-xl border border-slate-700 pointer-events-none z-50">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono font-bold text-white">{ont.device_id}</span>
                <span
                  className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${meta.tagBgClass}`}
                >
                  {meta.shortTag}
                </span>
              </div>
              <div className="text-slate-100 font-medium mt-0.5 truncate">{ont.name}</div>
              <div className="mt-1 space-y-0.5 text-[10px] font-mono text-slate-300 tabular-nums">
                <div>Redaman: {meta.signalBadgeText}</div>
                <div>
                  ODP Induk:{' '}
                  {ont.odp_code ? `${ont.odp_code} (Port #${ont.odp_port ?? '?'})` : 'Direct OLT'}
                </div>
                {wasSpread && (
                  <div className="text-sky-300">
                    * Posisi marker digeser tipis agar tidak bertumpuk
                  </div>
                )}
              </div>
              <div className="mt-1.5 pt-1 border-t border-slate-700/80 text-[10px] text-slate-400">
                Klik marker untuk Inspeksi, Chat WA, atau Buat Tiket
              </div>
            </div>
          )}
        </div>
      </AdvancedMarker>

      {isInfoOpen && marker && (
        <InfoWindow anchor={marker} onCloseClick={onCloseInfo}>
          <div className="min-w-[248px] max-w-[285px] p-1 text-slate-900 space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="font-mono text-xs font-bold text-slate-900">{ont.device_id}</div>
                <div className="text-xs font-semibold text-slate-800">{ont.name}</div>
              </div>
              <span
                className={`px-2 py-0.5 rounded text-[10px] font-bold shrink-0 ${meta.tagBgClass}`}
              >
                {meta.statusLabel}
              </span>
            </div>

            <div className="text-[11px] text-slate-600 leading-snug">{ont.address}</div>

            <div className="bg-slate-50 border border-slate-200 rounded p-2 space-y-1 text-[11px] font-mono tabular-nums">
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-500">Redaman:</span>
                <span className={`font-semibold ${meta.tagTextClass}`}>{meta.signalBadgeText}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-500">ODP Induk:</span>
                <span className="text-slate-800 font-medium">
                  {ont.odp_code ? `${ont.odp_code} #${ont.odp_port ?? '?'}` : ont.node_code || 'Direct'}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-500">IP / Kabel:</span>
                <span className="text-slate-700">
                  {ont.device_ip}
                  {ont.cable_length_m ? ` · ${ont.cable_length_m}m` : ''}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2 text-[10px] text-slate-500">
                <span>GPS:</span>
                <span>
                  {actualCoords.lat.toFixed(5)}, {actualCoords.lng.toFixed(5)}
                </span>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
              <button
                type="button"
                onClick={() => {
                  if (onInspect) {
                    onInspect();
                  } else {
                    onSelect();
                  }
                  onCloseInfo();
                }}
                className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-slate-800 bg-slate-100 border border-slate-200 hover:bg-slate-200 rounded transition-colors"
              >
                <Eye className="w-3 h-3" />
                Inspeksi
              </button>
              {onOpenChat && (
                <button
                  type="button"
                  onClick={() => onOpenChat(ont.id)}
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-emerald-800 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 rounded transition-colors"
                >
                  <MessageCircle className="w-3 h-3" />
                  Chat WA
                </button>
              )}
              {onCreateTicket && (
                <button
                  type="button"
                  onClick={() => {
                    onCreateTicket(buildTicketPrefillFromOnt(ont));
                    onCloseInfo();
                  }}
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-red-700 bg-red-50 border border-red-200 hover:bg-red-100 rounded transition-colors"
                >
                  <Ticket className="w-3 h-3" />
                  Buat Tiket
                </button>
              )}
            </div>
          </div>
        </InfoWindow>
      )}
    </>
  );
}

interface InnerMapSceneProps extends GoogleNetworkMapProps {
  mapTypeId: 'roadmap' | 'hybrid';
  onToggleMapType: () => void;
}

function InnerMapScene({
  nodes,
  odps,
  onts,
  selected,
  highlightedPath,
  showCableLines,
  showTelemetryLabels,
  pickMapTarget,
  previewOnt,
  previewInfra,
  onSelect,
  onInspectEntity,
  onPickCoordinates,
  onOpenChat,
  onCreateTicket,
  onSwitchToSchematic,
  mapTypeId,
  onToggleMapType,
}: InnerMapSceneProps) {
  const map = useMap();
  const loadingStatus = useApiLoadingStatus();
  const [infoEntity, setInfoEntity] = useState<MapSelectedEntity>(null);

  const nodePositions = useMemo(() => {
    const coordsById: Record<number, LatLngLiteral> = {};
    for (const node of nodes) {
      coordsById[node.id] = getEntityCoords(node.latitude, node.longitude, node.map_x, node.map_y);
    }
    return coordsById;
  }, [nodes]);

  const odpPositions = useMemo(() => {
    const coordsById: Record<number, LatLngLiteral> = {};
    for (const odp of odps) {
      coordsById[odp.id] = getEntityCoords(odp.latitude, odp.longitude, odp.map_x, odp.map_y);
    }
    return coordsById;
  }, [odps]);

  const actualOntPositions = useMemo(() => {
    const coordsById: Record<number, LatLngLiteral> = {};
    for (const ont of onts) {
      coordsById[ont.id] = getEntityCoords(ont.latitude, ont.longitude, ont.map_x, ont.map_y);
    }
    return coordsById;
  }, [onts]);

  const geoDeoverlapped = useMemo(
    () => computeGeoDeoverlappedOntLayout(onts, actualOntPositions, odpPositions),
    [onts, actualOntPositions, odpPositions]
  );

  const nodeLookup = useMemo(() => {
    const byId: Record<number, NetworkNode> = {};
    for (const n of nodes) byId[n.id] = n;
    return byId;
  }, [nodes]);

  const odpLookup = useMemo(() => {
    const byId: Record<number, NetworkOdp> = {};
    for (const d of odps) byId[d.id] = d;
    return byId;
  }, [odps]);

  const odpOntStatusCounts = useMemo(() => {
    const counts: Record<number, { online: number; isolir: number; offline: number }> = {};
    for (const odp of odps) {
      counts[odp.id] = { online: 0, isolir: 0, offline: 0 };
    }
    for (const ont of onts) {
      if (!ont.odp_id || !counts[ont.odp_id]) continue;
      if (ont.device_status === 'Online') counts[ont.odp_id].online += 1;
      else if (ont.device_status === 'Isolir') counts[ont.odp_id].isolir += 1;
      else counts[ont.odp_id].offline += 1;
    }
    return counts;
  }, [odps, onts]);

  // Sort ONTs by descending latitude (southernmost drawn higher) + priority
  const sortedOntsForRender = useMemo(() => {
    return [...onts]
      .sort((a, b) => {
        const posA = geoDeoverlapped.displayCoords[a.id];
        const posB = geoDeoverlapped.displayCoords[b.id];
        return (posB?.lat ?? 0) - (posA?.lat ?? 0);
      })
      .map((ont, index) => {
        const priorityBoost =
          ont.device_status === 'Offline' ? 300 : ont.device_status === 'Isolir' ? 200 : 100;
        return { ont, baseZIndex: priorityBoost + index };
      });
  }, [onts, geoDeoverlapped.displayCoords]);

  const previewSourceInfo = useMemo(() => {
    if (!previewOnt) return null;
    const srcOdp = previewOnt.odpId ? odpLookup[previewOnt.odpId] : undefined;
    const srcPos =
      previewOnt.odpId && odpPositions[previewOnt.odpId]
        ? odpPositions[previewOnt.odpId]
        : previewOnt.nodeId && nodePositions[previewOnt.nodeId]
          ? nodePositions[previewOnt.nodeId]
          : null;
    const distanceMeters = srcPos
      ? calculateHaversineMeters(srcPos, { lat: previewOnt.lat, lng: previewOnt.lng })
      : null;
    return {
      srcPos,
      srcCode: srcOdp?.odp_code || previewOnt.odpCode || 'OLT / MikroTik',
      distanceMeters,
    };
  }, [previewOnt, odpLookup, odpPositions, nodePositions]);

  const handleFitAll = useCallback(() => {
    if (!map) return;
    const points: LatLngLiteral[] = [
      ...Object.values(nodePositions),
      ...Object.values(odpPositions),
      ...Object.values(geoDeoverlapped.displayCoords),
    ];
    if (previewOnt) {
      points.push({ lat: previewOnt.lat, lng: previewOnt.lng });
    }
    if (points.length === 0) {
      map.setCenter(DEFAULT_CENTER);
      map.setZoom(16);
      return;
    }
    let north = -90;
    let south = 90;
    let east = -180;
    let west = 180;
    for (const pt of points) {
      if (pt.lat > north) north = pt.lat;
      if (pt.lat < south) south = pt.lat;
      if (pt.lng > east) east = pt.lng;
      if (pt.lng < west) west = pt.lng;
    }
    map.fitBounds({ north, south, east, west }, { top: 56, right: 56, bottom: 56, left: 56 });
  }, [map, nodePositions, odpPositions, geoDeoverlapped.displayCoords, previewOnt]);

  useEffect(() => {
    if (!map || !selected || pickMapTarget) return;
    let target: LatLngLiteral | undefined;
    if (selected.kind === 'node') target = nodePositions[selected.id];
    if (selected.kind === 'odp') target = odpPositions[selected.id];
    if (selected.kind === 'ont') target = geoDeoverlapped.displayCoords[selected.id];
    if (target) {
      map.panTo(target);
    }
  }, [map, selected, pickMapTarget, nodePositions, odpPositions, geoDeoverlapped.displayCoords]);

  const handleMapClick = useCallback(
    (e: MapMouseEvent) => {
      if (pickMapTarget && e.detail.latLng) {
        onPickCoordinates(
          Number(e.detail.latLng.lat.toFixed(6)),
          Number(e.detail.latLng.lng.toFixed(6))
        );
        return;
      }
      setInfoEntity(null);
    },
    [pickMapTarget, onPickCoordinates]
  );

  if (loadingStatus === APILoadingStatus.FAILED || loadingStatus === APILoadingStatus.AUTH_FAILURE) {
    return (
      <div className="h-[580px] w-full flex flex-col items-center justify-center bg-slate-50 p-6 text-center space-y-3">
        <AlertTriangle className="w-7 h-7 text-amber-600" />
        <div className="text-sm font-semibold text-slate-900">
          Google Maps gagal dimuat atau kuota API sementara tercapai
        </div>
        <p className="text-xs text-slate-600 max-w-md">
          Anda tetap dapat memantau posisi ONT, ODP, dan jalur kabel fiber menggunakan Denah Skematik lokal.
        </p>
        {onSwitchToSchematic && (
          <button
            type="button"
            onClick={onSwitchToSchematic}
            className="px-3.5 py-1.5 text-xs font-medium text-white bg-red-700 hover:bg-red-800 rounded-md"
          >
            Buka Denah Skematik
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="relative h-[590px] w-full bg-slate-100">
      {/* Floating Map Controls Overlay */}
      <div className="absolute top-3 left-3 z-20 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onToggleMapType}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium bg-white/95 text-slate-800 border border-slate-300 rounded-md shadow-sm hover:bg-slate-50"
        >
          <Layers className="w-3.5 h-3.5 text-red-700" />
          {mapTypeId === 'roadmap' ? 'Tampilan Jalan' : 'Tampilan Satelit'}
        </button>
        <button
          type="button"
          onClick={handleFitAll}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium bg-white/95 text-slate-800 border border-slate-300 rounded-md shadow-sm hover:bg-slate-50"
        >
          <LocateFixed className="w-3.5 h-3.5 text-slate-700" />
          Pusatkan Semua
        </button>
      </div>

      {/* Bottom Legend Overlay for Quick Visual Clarity */}
      <div className="absolute bottom-3 left-3 z-20 hidden sm:flex flex-wrap items-center gap-3 px-3 py-1.5 bg-white/95 border border-slate-200 rounded-md shadow-sm text-[11px] text-slate-700">
        <span className="inline-flex items-center gap-1.5 font-medium">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-600 inline-block" /> Online
        </span>
        <span className="inline-flex items-center gap-1.5 font-medium">
          <span className="w-2.5 h-2.5 rounded-full bg-amber-500 inline-block" /> Isolir
        </span>
        <span className="inline-flex items-center gap-1.5 font-medium">
          <span className="w-2.5 h-2.5 rounded-full bg-rose-600 inline-block" /> Offline / LOS
        </span>
        <span className="inline-flex items-center gap-1.5 font-medium">
          <span className="w-3 h-0.5 border-t-2 border-dashed border-orange-600 inline-block" /> Redaman Tinggi
        </span>
      </div>

      {pickMapTarget && (
        <div className="absolute bottom-12 left-1/2 -translate-x-1/2 z-20 px-3.5 py-2 bg-slate-900/95 text-white text-xs font-medium rounded-md shadow-lg inline-flex items-center gap-2 pointer-events-none border border-slate-700">
          <Crosshair className="w-3.5 h-3.5 text-sky-400 animate-pulse" />
          {pickMapTarget.kind === 'ont'
            ? 'Klik titik baru di peta untuk pratinjau GPS & jalur dropcore dari ODP'
            : 'Klik titik lokasi baru di peta untuk menempatkan perangkat'}
        </div>
      )}

      <GoogleMap
        mapId="DEMO_MAP_ID"
        internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}
        defaultCenter={DEFAULT_CENTER}
        defaultZoom={16}
        mapTypeId={mapTypeId}
        gestureHandling="greedy"
        streetViewControl={false}
        mapTypeControl={false}
        fullscreenControl={true}
        zoomControl={true}
        onClick={handleMapClick}
        className={`w-full h-full ${pickMapTarget ? 'cursor-crosshair' : ''}`}
      >
        {/* Fiber Optic Links: Core -> OLT */}
        {showCableLines &&
          nodes
            .filter((n) => n.parent_node_id && nodePositions[n.parent_node_id])
            .map((n) => {
              const p1 = nodePositions[n.parent_node_id as number];
              const p2 = nodePositions[n.id];
              if (!p1 || !p2) return null;
              const emphasized =
                !highlightedPath.active ||
                (highlightedPath.nodeIds.has(n.id) &&
                  highlightedPath.nodeIds.has(n.parent_node_id as number));
              const isNodeHealthy = n.status === 'Online';
              const linkColor =
                n.status === 'Offline' ? '#e11d48' : n.status === 'Degraded' ? '#d97706' : '#1d4ed8';
              return (
                <Polyline
                  key={`gmap-backbone-${n.id}`}
                  path={[p1, p2]}
                  strokeColor={linkColor}
                  strokeWeight={emphasized ? 4 : 2}
                  strokeOpacity={isNodeHealthy ? (emphasized ? 0.88 : 0.25) : 0}
                  icons={
                    isNodeHealthy
                      ? undefined
                      : [
                          {
                            icon: {
                              path: 'M 0,-1 0,1',
                              strokeOpacity: emphasized ? 0.92 : 0.3,
                              strokeColor: linkColor,
                              scale: emphasized ? 3 : 2,
                            },
                            offset: '0',
                            repeat: '12px',
                          },
                        ]
                  }
                  geodesic={true}
                />
              );
            })}

        {/* Fiber Optic Links: OLT -> ODP */}
        {showCableLines &&
          odps.map((odp) => {
            if (!odp.node_id) return null;
            const p1 = nodePositions[odp.node_id];
            const p2 = odpPositions[odp.id];
            if (!p1 || !p2) return null;
            const parentNode = nodeLookup[odp.node_id];
            const counts = odpOntStatusCounts[odp.id];
            const emphasized =
              !highlightedPath.active ||
              (highlightedPath.odpIds.has(odp.id) && highlightedPath.nodeIds.has(odp.node_id));
            const linkColor =
              parentNode?.status === 'Offline'
                ? '#e11d48'
                : parentNode?.status === 'Degraded'
                  ? '#d97706'
                  : counts && counts.offline > 0
                    ? '#0284c7'
                    : '#0284c7';
            const isHealthy = !parentNode || parentNode.status === 'Online';
            return (
              <Polyline
                key={`gmap-dist-${odp.id}`}
                path={[p1, p2]}
                strokeColor={linkColor}
                strokeWeight={emphasized ? 3 : 1.5}
                strokeOpacity={isHealthy ? (emphasized ? 0.84 : 0.22) : 0}
                icons={
                  isHealthy
                    ? undefined
                    : [
                        {
                          icon: {
                            path: 'M 0,-1 0,1',
                            strokeOpacity: emphasized ? 0.9 : 0.3,
                            strokeColor: linkColor,
                            scale: emphasized ? 2.5 : 1.6,
                          },
                          offset: '0',
                          repeat: '12px',
                        },
                      ]
                }
                geodesic={true}
              />
            );
          })}

        {/* Drop Fiber Links: ODP (or Node) -> ONT */}
        {showCableLines &&
          onts.map((ont) => {
            const p1 =
              ont.odp_id && odpPositions[ont.odp_id]
                ? odpPositions[ont.odp_id]
                : ont.node_id && nodePositions[ont.node_id]
                  ? nodePositions[ont.node_id]
                  : undefined;
            const p2 = geoDeoverlapped.displayCoords[ont.id];
            if (!p1 || !p2) return null;
            const hasActivePreviewForThis = previewOnt?.ontId === ont.id;
            const emphasized = !highlightedPath.active || highlightedPath.ontIds.has(ont.id);
            const visual = getFiberLinkVisual(ont.device_status, ont.rx_power_dbm);
            const baseOpacity = hasActivePreviewForThis
              ? 0.26
              : emphasized
                ? 0.9
                : 0.2;

            return (
              <Polyline
                key={`gmap-drop-${ont.id}`}
                path={[p1, p2]}
                strokeColor={visual.stroke}
                strokeWeight={emphasized ? visual.strokeWeight : 1.4}
                strokeOpacity={visual.dashed ? 0 : baseOpacity}
                icons={
                  visual.dashed
                    ? [
                        {
                          icon: {
                            path: 'M 0,-1 0,1',
                            strokeOpacity: hasActivePreviewForThis
                              ? 0.35
                              : emphasized
                                ? 0.94
                                : 0.28,
                            strokeColor: visual.stroke,
                            scale: emphasized ? visual.strokeWeight : 1.6,
                          },
                          offset: '0',
                          repeat: visual.repeatPx || '12px',
                        },
                      ]
                    : undefined
                }
                geodesic={true}
              />
            );
          })}

        {/* Live Preview Dropcore Path & Marker for Staged ONT Coordinate */}
        {previewOnt && previewSourceInfo?.srcPos && (
          <Polyline
            key={`gmap-preview-drop-${previewOnt.ontId}`}
            path={[previewSourceInfo.srcPos, { lat: previewOnt.lat, lng: previewOnt.lng }]}
            strokeColor="#2563eb"
            strokeWeight={3}
            strokeOpacity={0}
            zIndex={80}
            icons={[
              {
                icon: {
                  path: 'M 0,-1.2 0,1.2',
                  strokeOpacity: 0.95,
                  strokeColor: '#2563eb',
                  scale: 3,
                },
                offset: '0',
                repeat: '11px',
              },
            ]}
            geodesic={true}
          />
        )}

        {previewOnt && (
          <AdvancedMarker
            position={{ lat: previewOnt.lat, lng: previewOnt.lng }}
            anchorPoint={AdvancedMarkerAnchorPoint.CENTER}
            zIndex={1100}
            title={`Pratinjau Posisi ${previewOnt.deviceId}`}
          >
            <div className="relative flex items-center justify-center">
              <div className="w-6 h-6 rounded-full bg-blue-600/20 border-2 border-blue-600 flex items-center justify-center animate-pulse">
                <Crosshair className="w-3.5 h-3.5 text-blue-700" />
              </div>
              <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 px-2.5 py-1 rounded-md bg-blue-700 text-white text-[10px] font-mono shadow-lg whitespace-nowrap border border-blue-400">
                <div className="font-bold">
                  Pratinjau {previewOnt.deviceId.replace('ONT-', '')} (Belum Disimpan)
                </div>
                <div className="text-blue-100 tabular-nums">
                  {previewOnt.lat.toFixed(5)}, {previewOnt.lng.toFixed(5)}
                  {previewSourceInfo?.distanceMeters !== null && previewSourceInfo?.distanceMeters !== undefined
                    ? ` · ~${previewSourceInfo.distanceMeters} m dari ${previewSourceInfo.srcCode}`
                    : ''}
                </div>
              </div>
            </div>
          </AdvancedMarker>
        )}

        {previewInfra && (
          <AdvancedMarker
            position={{ lat: previewInfra.lat, lng: previewInfra.lng }}
            anchorPoint={AdvancedMarkerAnchorPoint.CENTER}
            zIndex={1100}
            title={`Pratinjau Posisi ${previewInfra.code}`}
          >
            <div className="relative flex items-center justify-center">
              <div className="w-6 h-6 rounded-full bg-red-600/20 border-2 border-red-600 flex items-center justify-center animate-pulse">
                <Crosshair className="w-3.5 h-3.5 text-red-700" />
              </div>
              <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 px-2.5 py-1 rounded-md bg-red-700 text-white text-[10px] font-mono shadow-lg whitespace-nowrap">
                <div className="font-bold">Pratinjau {previewInfra.code}</div>
                <div className="text-red-100 tabular-nums">
                  {previewInfra.lat.toFixed(5)}, {previewInfra.lng.toFixed(5)}
                </div>
              </div>
            </div>
          </AdvancedMarker>
        )}

        {/* Markers: MikroTik Core & OLT */}
        {nodes.map((node) => {
          const pos = nodePositions[node.id];
          if (!pos) return null;
          const isSelected = selected?.kind === 'node' && selected.id === node.id;
          const dimmed = highlightedPath.active && !highlightedPath.nodeIds.has(node.id);
          const isInfoOpen = infoEntity?.kind === 'node' && infoEntity.id === node.id;
          return (
            <NodeMarkerItem
              key={`gmap-node-${node.id}`}
              node={node}
              position={pos}
              isSelected={isSelected}
              dimmed={dimmed}
              isInfoOpen={isInfoOpen}
              onSelect={() => {
                onSelect({ kind: 'node', id: node.id });
                setInfoEntity({ kind: 'node', id: node.id });
              }}
              onInspect={() => onInspectEntity?.({ kind: 'node', id: node.id })}
              onCloseInfo={() => setInfoEntity(null)}
            />
          );
        })}

        {/* Markers: ODP Splitters */}
        {odps.map((odp) => {
          const pos = odpPositions[odp.id];
          if (!pos) return null;
          const isSelected = selected?.kind === 'odp' && selected.id === odp.id;
          const dimmed = highlightedPath.active && !highlightedPath.odpIds.has(odp.id);
          const counts = odpOntStatusCounts[odp.id] ?? { online: 0, isolir: 0, offline: 0 };
          const isInfoOpen = infoEntity?.kind === 'odp' && infoEntity.id === odp.id;
          const parentNode = odp.node_id ? nodeLookup[odp.node_id] : undefined;
          const enrichedOdp = parentNode ? { ...odp, node_code: parentNode.node_code } : odp;
          return (
            <OdpMarkerItem
              key={`gmap-odp-${odp.id}`}
              odp={enrichedOdp}
              position={pos}
              isSelected={isSelected}
              dimmed={dimmed}
              ontCounts={counts}
              isInfoOpen={isInfoOpen}
              onSelect={() => {
                onSelect({ kind: 'odp', id: odp.id });
                setInfoEntity({ kind: 'odp', id: odp.id });
              }}
              onInspect={() => onInspectEntity?.({ kind: 'odp', id: odp.id })}
              onCloseInfo={() => setInfoEntity(null)}
            />
          );
        })}

        {/* Markers: Customer ONTs */}
        {sortedOntsForRender.map(({ ont, baseZIndex }) => {
          const pos = geoDeoverlapped.displayCoords[ont.id];
          const actualCoords = actualOntPositions[ont.id];
          if (!pos || !actualCoords) return null;
          const isSelected = selected?.kind === 'ont' && selected.id === ont.id;
          const dimmed = highlightedPath.active && !highlightedPath.ontIds.has(ont.id);
          const isInfoOpen = infoEntity?.kind === 'ont' && infoEntity.id === ont.id;
          const odp = ont.odp_id ? odpLookup[ont.odp_id] : undefined;
          const enrichedOnt = odp ? { ...ont, odp_code: odp.odp_code } : ont;
          return (
            <OntMarkerItem
              key={`gmap-ont-${ont.id}`}
              ont={enrichedOnt}
              position={pos}
              actualCoords={actualCoords}
              labelPlacement={geoDeoverlapped.labelPlacement[ont.id] ?? 'bottom'}
              wasSpread={Boolean(geoDeoverlapped.wasSpread[ont.id])}
              baseZIndex={baseZIndex}
              isSelected={isSelected}
              dimmed={dimmed}
              showTelemetryLabels={showTelemetryLabels}
              isInfoOpen={isInfoOpen}
              onSelect={() => {
                onSelect({ kind: 'ont', id: ont.id });
                setInfoEntity({ kind: 'ont', id: ont.id });
              }}
              onInspect={() => onInspectEntity?.({ kind: 'ont', id: ont.id })}
              onCloseInfo={() => setInfoEntity(null)}
              onOpenChat={onOpenChat}
              onCreateTicket={onCreateTicket}
            />
          );
        })}
      </GoogleMap>
    </div>
  );
}

export function GoogleNetworkMap(props: GoogleNetworkMapProps) {
  const initialEnvKey =
    import.meta.env.VITE_GOOGLE_MAPS_API_KEY ||
    (globalThis as { GOOGLE_MAPS_API_KEY?: string }).GOOGLE_MAPS_API_KEY ||
    '';

  const [apiKey, setApiKey] = useState<string>(initialEnvKey);
  const [resolvingKey, setResolvingKey] = useState<boolean>(!initialEnvKey);
  const [mapTypeId, setMapTypeId] = useState<'roadmap' | 'hybrid'>('roadmap');

  useEffect(() => {
    if (apiKey) {
      setResolvingKey(false);
      return;
    }
    let cancelled = false;
    fetch('/api/maps-config')
      .then((res) => (res.ok ? res.json() : { apiKey: '' }))
      .then((data: { apiKey?: string }) => {
        if (!cancelled && data.apiKey) {
          setApiKey(data.apiKey);
        }
      })
      .catch(() => {
        // handled cleanly by empty-key fallback UI below
      })
      .finally(() => {
        if (!cancelled) setResolvingKey(false);
      });
    return () => {
      cancelled = true;
    };
  }, [apiKey]);

  if (resolvingKey) {
    return (
      <div className="h-[590px] w-full flex items-center justify-center bg-slate-50 text-xs text-slate-500">
        Memuat konfigurasi Google Maps...
      </div>
    );
  }

  if (!apiKey) {
    return (
      <div className="h-[590px] w-full flex flex-col items-center justify-center bg-slate-50 p-6 text-center space-y-3">
        <AlertTriangle className="w-7 h-7 text-amber-600" />
        <div className="text-sm font-semibold text-slate-900">
          Kunci API Google Maps belum aktif di environment server
        </div>
        <p className="text-xs text-slate-600 max-w-md">
          Pastikan pengaturan Google Maps sudah selesai atau gunakan Denah Skematik lokal untuk tetap mengelola titik ONT &amp; ODP.
        </p>
        {props.onSwitchToSchematic && (
          <button
            type="button"
            onClick={props.onSwitchToSchematic}
            className="px-3.5 py-1.5 text-xs font-medium text-white bg-red-700 hover:bg-red-800 rounded-md"
          >
            Buka Denah Skematik
          </button>
        )}
      </div>
    );
  }

  return (
    <APIProvider apiKey={apiKey} libraries={['marker']} language="id" region="ID">
      <InnerMapScene
        {...props}
        mapTypeId={mapTypeId}
        onToggleMapType={() => setMapTypeId((prev) => (prev === 'roadmap' ? 'hybrid' : 'roadmap'))}
      />
    </APIProvider>
  );
}
