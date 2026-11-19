import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, MouseEvent } from 'react';
import {
  Activity,
  AlertTriangle,
  Box,
  CheckCircle2,
  Cpu,
  Crosshair,
  Edit2,
  ExternalLink,
  Eye,
  GitBranch,
  Map as MapIcon,
  MessageCircle,
  Plus,
  RefreshCw,
  Router,
  Save,
  Search,
  Server,
  Ticket,
  Trash2,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type {
  AuthUser,
  Customer,
  DeviceLog,
  DeviceStatus,
  NetworkNode,
  NetworkOdp,
  TicketPrefillPayload,
} from '../types';
import { formatDateTimeId, formatDateTimeWib } from '../utils/format';
import { apiFetch, canManageNetworkInfra } from '../utils/auth';
import {
  calculateHaversineMeters,
  computeSchematicDeoverlappedLayout,
  getFiberLinkVisual,
  getOpticalStatusMeta,
  latLngToSchematicPercent,
  schematicPercentToLatLng,
  type LabelPlacement,
} from '../utils/networkMap';
import {
  GoogleNetworkMap,
  type PreviewInfraTarget,
  type PreviewOntTarget,
} from './GoogleNetworkMap';
import { DeviceStatusLabel } from './StatusText';
import { ReadOnlyBadge, ReadOnlyBanner } from './ReadOnlyIndicator';

interface NetworkMappingViewProps {
  currentUser: AuthUser;
  initialOntId?: number | null;
  onClearInitialOnt?: () => void;
  onOpenChat?: (customerId: number) => void;
  onCreateTicket?: (prefill: TicketPrefillPayload) => void;
  onRefreshGlobal: () => Promise<void>;
  onNotify: (msg: string, type?: 'success' | 'error') => void;
}

type SelectedEntity =
  | { kind: 'node'; id: number }
  | { kind: 'odp'; id: number }
  | { kind: 'ont'; id: number }
  | null;

interface TopologyPayload {
  nodes: NetworkNode[];
  odps: NetworkOdp[];
  onts: Customer[];
  recent_logs: DeviceLog[];
}

function getOpticalQualityText(dbm: number | null): { label: string; colorClass: string } {
  if (dbm === null || Number.isNaN(dbm)) {
    return { label: 'Ethernet / Non-Optik', colorClass: 'text-slate-500' };
  }
  if (dbm <= -28) {
    return { label: 'Kritis / LOS', colorClass: 'text-rose-700 font-semibold' };
  }
  if (dbm <= -25) {
    return { label: 'Redaman Tinggi', colorClass: 'text-amber-700 font-semibold' };
  }
  return { label: 'Sinyal Baik', colorClass: 'text-emerald-700 font-medium' };
}

function getSchematicLabelOffsetClass(placement: LabelPlacement): string {
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

function buildTicketPrefill(ont: Customer): TicketPrefillPayload {
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

export function NetworkMappingView({
  currentUser,
  initialOntId,
  onClearInitialOnt,
  onOpenChat,
  onCreateTicket,
  onRefreshGlobal,
  onNotify,
}: NetworkMappingViewProps) {
  const isReadOnly = !canManageNetworkInfra(currentUser);
  const [subTab, setSubTab] = useState<'topologi' | 'peta' | 'tabel'>('peta');
  const [mapMode, setMapMode] = useState<'google' | 'schematic'>('google');
  const [loading, setLoading] = useState(true);
  const [topology, setTopology] = useState<TopologyPayload>({
    nodes: [],
    odps: [],
    onts: [],
    recent_logs: [],
  });

  const [selected, setSelected] = useState<SelectedEntity>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | DeviceStatus>('all');
  const [nodeFilter, setNodeFilter] = useState<string>('all');

  // Map & Topology canvas controls
  const [zoom, setZoom] = useState<number>(1);
  const [showCableLines, setShowCableLines] = useState(true);
  const [showTelemetryLabels, setShowTelemetryLabels] = useState(true);
  const [pickMapTarget, setPickMapTarget] = useState<{ kind: 'ont' | 'odp' | 'node'; id: number } | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Staged coordinate preview (before user confirms "Simpan Mapping ONT" / "Simpan Posisi")
  const [stagedOntPreview, setStagedOntPreview] = useState<{
    ontId: number;
    lat: number;
    lng: number;
    mapX: number;
    mapY: number;
  } | null>(null);
  const [stagedInfraPreview, setStagedInfraPreview] = useState<
    (PreviewInfraTarget & { mapX: number; mapY: number }) | null
  >(null);

  // Schematic map hover & click popups
  const [hoveredSchematicOntId, setHoveredSchematicOntId] = useState<number | null>(null);
  const [schematicPopupOntId, setSchematicPopupOntId] = useState<number | null>(null);
  const inspectorRef = useRef<HTMLDivElement | null>(null);

  // Edit ONT mapping form
  const [editingOntForm, setEditingOntForm] = useState<{
    node_id: string;
    odp_id: string;
    odp_port: string;
    pon_port: string;
    cable_length_m: string;
    rx_power_dbm: string;
    pppoe_username: string;
    latitude: string;
    longitude: string;
  } | null>(null);
  const [savingOnt, setSavingOnt] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [syncingNodeId, setSyncingNodeId] = useState<number | null>(null);

  // ODP Add/Edit Modal
  const [odpModalOpen, setOdpModalOpen] = useState(false);
  const [editingOdp, setEditingOdp] = useState<NetworkOdp | null>(null);
  const [savingOdp, setSavingOdp] = useState(false);
  const [odpForm, setOdpForm] = useState({
    odp_code: '',
    name: '',
    node_id: '',
    pon_port: 'GPON 0/1/1',
    splitter_ratio: '1:8',
    capacity_ports: '8',
    area_zone: '',
    latitude: '-7.42400',
    longitude: '109.23900',
    map_x: '50',
    map_y: '55',
    notes: '',
  });

  const loadTopology = useCallback(async () => {
    try {
      const res = await apiFetch('/api/topology');
      if (res.ok) {
        const json = (await res.json()) as TopologyPayload;
        setTopology(json);
        setLastUpdatedAt(new Date().toISOString());
        setSelected((prev) => {
          if (prev) return prev;
          if (initialOntId) return { kind: 'ont', id: initialOntId };
          if (json.onts.length > 0) {
            const firstProblem = json.onts.find((o) => o.device_status !== 'Online');
            return { kind: 'ont', id: (firstProblem ?? json.onts[0]).id };
          }
          if (json.nodes.length > 0) return { kind: 'node', id: json.nodes[0].id };
          return null;
        });
      }
    } catch {
      onNotify('Gagal memuat data topologi dan pemetaan jaringan.', 'error');
    } finally {
      setLoading(false);
    }
  }, [initialOntId, onNotify]);

  const handleRefreshStatus = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([loadTopology(), onRefreshGlobal()]);
      onNotify('Status perangkat & pemetaan topologi berhasil diperbarui.', 'success');
    } finally {
      setRefreshing(false);
    }
  }, [loadTopology, onRefreshGlobal, onNotify]);

  useEffect(() => {
    void loadTopology();
  }, [loadTopology]);

  useEffect(() => {
    if (initialOntId) {
      setSelected({ kind: 'ont', id: initialOntId });
      onClearInitialOnt?.();
    }
  }, [initialOntId, onClearInitialOnt]);

  // Keep edit form synced whenever a different ONT is selected
  const selectedOnt = useMemo(
    () => (selected?.kind === 'ont' ? topology.onts.find((o) => o.id === selected.id) ?? null : null),
    [selected, topology.onts]
  );
  const selectedOdp = useMemo(
    () => (selected?.kind === 'odp' ? topology.odps.find((d) => d.id === selected.id) ?? null : null),
    [selected, topology.odps]
  );
  const selectedNode = useMemo(
    () => (selected?.kind === 'node' ? topology.nodes.find((n) => n.id === selected.id) ?? null : null),
    [selected, topology.nodes]
  );

  useEffect(() => {
    if (!selectedOnt) {
      setEditingOntForm(null);
      setStagedOntPreview(null);
      return;
    }
    setEditingOntForm({
      node_id: selectedOnt.node_id ? String(selectedOnt.node_id) : '',
      odp_id: selectedOnt.odp_id ? String(selectedOnt.odp_id) : '',
      odp_port: selectedOnt.odp_port ? String(selectedOnt.odp_port) : '',
      pon_port: selectedOnt.pon_port ?? '',
      cable_length_m: selectedOnt.cable_length_m ? String(selectedOnt.cable_length_m) : '',
      rx_power_dbm: selectedOnt.rx_power_dbm !== null && selectedOnt.rx_power_dbm !== undefined ? String(selectedOnt.rx_power_dbm) : '',
      pppoe_username: selectedOnt.pppoe_username ?? '',
      latitude: selectedOnt.latitude !== null && selectedOnt.latitude !== undefined ? String(selectedOnt.latitude) : '',
      longitude: selectedOnt.longitude !== null && selectedOnt.longitude !== undefined ? String(selectedOnt.longitude) : '',
    });
    setStagedOntPreview((prev) => (prev?.ontId === selectedOnt.id ? prev : null));
  }, [selectedOnt]);

  const filteredOnts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return topology.onts.filter((ont) => {
      if (statusFilter !== 'all' && ont.device_status !== statusFilter) return false;
      if (nodeFilter !== 'all' && String(ont.node_id ?? '') !== nodeFilter) return false;
      if (!q) return true;
      return (
        ont.name.toLowerCase().includes(q) ||
        ont.device_id.toLowerCase().includes(q) ||
        ont.device_ip.toLowerCase().includes(q) ||
        ont.customer_code.toLowerCase().includes(q) ||
        (ont.odp_code ?? '').toLowerCase().includes(q) ||
        (ont.pon_port ?? '').toLowerCase().includes(q) ||
        ont.address.toLowerCase().includes(q)
      );
    });
  }, [topology.onts, search, statusFilter, nodeFilter]);

  const mapSummaryStats = useMemo(() => {
    const online = filteredOnts.filter((o) => o.device_status === 'Online').length;
    const isolir = filteredOnts.filter((o) => o.device_status === 'Isolir').length;
    const offline = filteredOnts.filter((o) => o.device_status === 'Offline').length;
    const highAttenuation = filteredOnts.filter(
      (o) => o.device_status === 'Online' && o.rx_power_dbm !== null && o.rx_power_dbm <= -25
    ).length;
    return {
      totalVisible: filteredOnts.length,
      online,
      isolir,
      offline,
      highAttenuation,
    };
  }, [filteredOnts]);

  const schematicDeoverlapped = useMemo(
    () => computeSchematicDeoverlappedLayout(filteredOnts, topology.odps),
    [filteredOnts, topology.odps]
  );

  // Active live preview for ONT coordinate (either via clicking map OR typing Lat/Lng in form)
  const activePreviewOnt = useMemo<{
    mapPayload: PreviewOntTarget;
    mapX: number;
    mapY: number;
    distanceMeters: number | null;
    odpCode: string;
    isDirty: boolean;
  } | null>(() => {
    if (!selectedOnt || !editingOntForm) return null;
    const parsedLat = Number(editingOntForm.latitude);
    const parsedLng = Number(editingOntForm.longitude);
    const hasParsed =
      editingOntForm.latitude.trim() !== '' &&
      editingOntForm.longitude.trim() !== '' &&
      Number.isFinite(parsedLat) &&
      Number.isFinite(parsedLng) &&
      parsedLat !== 0 &&
      parsedLng !== 0;

    if (!hasParsed) return null;

    const stagedMatch = stagedOntPreview?.ontId === selectedOnt.id ? stagedOntPreview : null;
    const coordChanged =
      stagedMatch !== null ||
      Math.abs(parsedLat - (selectedOnt.latitude ?? 0)) > 0.000005 ||
      Math.abs(parsedLng - (selectedOnt.longitude ?? 0)) > 0.000005;

    if (!coordChanged) return null;

    const odpId = editingOntForm.odp_id ? Number(editingOntForm.odp_id) : null;
    const nodeId = editingOntForm.node_id ? Number(editingOntForm.node_id) : null;
    const srcOdp = odpId ? topology.odps.find((d) => d.id === odpId) : undefined;
    const srcNode = !srcOdp && nodeId ? topology.nodes.find((n) => n.id === nodeId) : undefined;

    const srcLat = srcOdp?.latitude ?? srcNode?.latitude ?? null;
    const srcLng = srcOdp?.longitude ?? srcNode?.longitude ?? null;
    const distanceMeters =
      srcLat && srcLng
        ? calculateHaversineMeters({ lat: srcLat, lng: srcLng }, { lat: parsedLat, lng: parsedLng })
        : null;

    const pct = stagedMatch
      ? { mapX: stagedMatch.mapX, mapY: stagedMatch.mapY }
      : latLngToSchematicPercent(parsedLat, parsedLng);

    return {
      mapPayload: {
        ontId: selectedOnt.id,
        deviceId: selectedOnt.device_id,
        customerName: selectedOnt.name,
        lat: parsedLat,
        lng: parsedLng,
        odpId,
        nodeId,
        odpCode: srcOdp?.odp_code ?? srcNode?.node_code ?? null,
      },
      mapX: pct.mapX,
      mapY: pct.mapY,
      distanceMeters,
      odpCode: srcOdp?.odp_code ?? srcNode?.node_code ?? 'OLT Induk',
      isDirty: true,
    };
  }, [selectedOnt, editingOntForm, stagedOntPreview, topology.odps, topology.nodes]);

  const stats = useMemo(() => {
    const total = topology.onts.length;
    const mapped = topology.onts.filter((o) => o.odp_id || o.node_id).length;
    const online = topology.onts.filter((o) => o.device_status === 'Online').length;
    const offline = topology.onts.filter((o) => o.device_status === 'Offline').length;
    const isolir = topology.onts.filter((o) => o.device_status === 'Isolir').length;
    const opticalWarn = topology.onts.filter(
      (o) => (o.rx_power_dbm !== null && o.rx_power_dbm <= -27) || o.device_status === 'Offline'
    ).length;
    const totalOdpPorts = topology.odps.reduce((sum, d) => sum + d.capacity_ports, 0);
    const usedOdpPorts = topology.odps.reduce((sum, d) => sum + Number(d.used_ports ?? 0), 0);
    return {
      total,
      mapped,
      unmapped: total - mapped,
      online,
      offline,
      isolir,
      opticalWarn,
      totalOdpPorts,
      usedOdpPorts,
    };
  }, [topology.onts, topology.odps]);

  // Compute highlighted lineage IDs so clicking any entity traces its full path
  const highlightedPath = useMemo(() => {
    const nodeIds = new Set<number>();
    const odpIds = new Set<number>();
    const ontIds = new Set<number>();

    if (!selected) return { nodeIds, odpIds, ontIds, active: false };

    if (selected.kind === 'ont') {
      const ont = topology.onts.find((o) => o.id === selected.id);
      if (ont) {
        ontIds.add(ont.id);
        if (ont.odp_id) odpIds.add(ont.odp_id);
        const odp = ont.odp_id ? topology.odps.find((d) => d.id === ont.odp_id) : undefined;
        const nId = ont.node_id ?? odp?.node_id ?? null;
        if (nId) {
          nodeIds.add(nId);
          const nObj = topology.nodes.find((n) => n.id === nId);
          if (nObj?.parent_node_id) nodeIds.add(nObj.parent_node_id);
        }
      }
    } else if (selected.kind === 'odp') {
      const odp = topology.odps.find((d) => d.id === selected.id);
      if (odp) {
        odpIds.add(odp.id);
        if (odp.node_id) {
          nodeIds.add(odp.node_id);
          const nObj = topology.nodes.find((n) => n.id === odp.node_id);
          if (nObj?.parent_node_id) nodeIds.add(nObj.parent_node_id);
        }
        topology.onts.filter((o) => o.odp_id === odp.id).forEach((o) => ontIds.add(o.id));
      }
    } else if (selected.kind === 'node') {
      const node = topology.nodes.find((n) => n.id === selected.id);
      if (node) {
        nodeIds.add(node.id);
        if (node.parent_node_id) nodeIds.add(node.parent_node_id);
        const childNodes = topology.nodes.filter((n) => n.parent_node_id === node.id);
        childNodes.forEach((cn) => nodeIds.add(cn.id));
        topology.odps
          .filter((d) => d.node_id && nodeIds.has(d.node_id))
          .forEach((d) => odpIds.add(d.id));
        topology.onts
          .filter((o) => (o.node_id && nodeIds.has(o.node_id)) || (o.odp_id && odpIds.has(o.odp_id)))
          .forEach((o) => ontIds.add(o.id));
      }
    }

    return { nodeIds, odpIds, ontIds, active: true };
  }, [selected, topology]);

  // Compute deterministic layout for the Hierarchical FTTH Topology Graph (SVG + interactive cards)
  const topologyLayout = useMemo(() => {
    const coreNodes = topology.nodes.filter((n) => !n.parent_node_id);
    const childNodes = topology.nodes.filter((n) => Boolean(n.parent_node_id));
    const tier1 = coreNodes.length > 0 ? coreNodes : topology.nodes.slice(0, 1);
    const tier2 = childNodes;
    const odps = topology.odps;
    const visibleOntIds = new Set(filteredOnts.map((o) => o.id));
    const onts = topology.onts.filter((o) => visibleOntIds.has(o.id));

    // Order ONTs grouped by ODP so lines don't cross unnecessarily
    const orderedOnts: Customer[] = [];
    const groupedByOdp = new Map<number, Customer[]>();
    const noOdpOnts: Customer[] = [];

    for (const ont of onts) {
      if (ont.odp_id) {
        const list = groupedByOdp.get(ont.odp_id) ?? [];
        list.push(ont);
        groupedByOdp.set(ont.odp_id, list);
      } else {
        noOdpOnts.push(ont);
      }
    }

    for (const odp of odps) {
      const list = groupedByOdp.get(odp.id) ?? [];
      orderedOnts.push(...list);
    }
    orderedOnts.push(...noOdpOnts);

    const colWidth = 178;
    const maxCols = Math.max(orderedOnts.length, odps.length, tier2.length, tier1.length, 5);
    const canvasWidth = Math.max(1060, maxCols * colWidth + 80);
    const canvasHeight = 620;

    const distributeX = (count: number, idx: number): number => {
      if (count <= 1) return canvasWidth / 2;
      const usable = canvasWidth - 180;
      return 90 + (usable * idx) / (count - 1);
    };

    const nodePos = new Map<number, { x: number; y: number }>();
    tier1.forEach((n, idx) => nodePos.set(n.id, { x: distributeX(tier1.length, idx), y: 66 }));
    tier2.forEach((n, idx) => nodePos.set(n.id, { x: distributeX(tier2.length, idx), y: 204 }));

    const odpPos = new Map<number, { x: number; y: number }>();
    odps.forEach((d, idx) => odpPos.set(d.id, { x: distributeX(odps.length, idx), y: 356 }));

    const ontPos = new Map<number, { x: number; y: number }>();
    orderedOnts.forEach((o, idx) => ontPos.set(o.id, { x: distributeX(orderedOnts.length, idx), y: 518 }));

    return {
      canvasWidth,
      canvasHeight,
      tier1,
      tier2,
      odps,
      orderedOnts,
      nodePos,
      odpPos,
      ontPos,
    };
  }, [topology, filteredOnts]);

  async function handleSaveOntMapping(e: FormEvent) {
    e.preventDefault();
    if (!selectedOnt || !editingOntForm) return;
    setSavingOnt(true);
    try {
      const latNum = editingOntForm.latitude !== '' ? Number(editingOntForm.latitude) : null;
      const lngNum = editingOntForm.longitude !== '' ? Number(editingOntForm.longitude) : null;
      let nextMapX: number | undefined;
      let nextMapY: number | undefined;
      if (stagedOntPreview && stagedOntPreview.ontId === selectedOnt.id) {
        nextMapX = stagedOntPreview.mapX;
        nextMapY = stagedOntPreview.mapY;
      } else if (latNum !== null && lngNum !== null && Number.isFinite(latNum) && Number.isFinite(lngNum)) {
        const pct = latLngToSchematicPercent(latNum, lngNum);
        nextMapX = pct.mapX;
        nextMapY = pct.mapY;
      }

      const res = await apiFetch(`/api/topology/ont/${selectedOnt.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          node_id: editingOntForm.node_id ? Number(editingOntForm.node_id) : null,
          odp_id: editingOntForm.odp_id ? Number(editingOntForm.odp_id) : null,
          odp_port: editingOntForm.odp_port ? Number(editingOntForm.odp_port) : null,
          pon_port: editingOntForm.pon_port || null,
          cable_length_m: editingOntForm.cable_length_m ? Number(editingOntForm.cable_length_m) : null,
          rx_power_dbm: editingOntForm.rx_power_dbm !== '' ? Number(editingOntForm.rx_power_dbm) : null,
          pppoe_username: editingOntForm.pppoe_username || null,
          latitude: latNum,
          longitude: lngNum,
          ...(nextMapX !== undefined && nextMapY !== undefined
            ? { map_x: nextMapX, map_y: nextMapY }
            : {}),
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        onNotify(json.error || 'Gagal menyimpan mapping ONT.', 'error');
        return;
      }
      setStagedOntPreview(null);
      setPickMapTarget(null);
      await Promise.all([loadTopology(), onRefreshGlobal()]);
      onNotify(`Mapping ONT ${selectedOnt.device_id} berhasil diperbarui.`, 'success');
    } catch {
      onNotify('Terjadi kesalahan saat menyimpan mapping ONT.', 'error');
    } finally {
      setSavingOnt(false);
    }
  }

  async function handleQuickOntStatus(ont: Customer, nextStatus: DeviceStatus) {
    setUpdatingStatus(true);
    try {
      const res = await apiFetch(`/api/devices/${ont.id}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: nextStatus,
          reason: `Perubahan status dari Mapping & Topologi (${ont.odp_code || 'Direct'})`,
        }),
      });
      if (!res.ok) {
        onNotify('Gagal mengubah status perangkat ONT.', 'error');
        return;
      }
      await Promise.all([loadTopology(), onRefreshGlobal()]);
      onNotify(`Status ${ont.device_id} diubah ke ${nextStatus}.`, 'success');
    } catch {
      onNotify('Gagal terhubung ke server.', 'error');
    } finally {
      setUpdatingStatus(false);
    }
  }

  async function handleSyncNode(node: NetworkNode) {
    setSyncingNodeId(node.id);
    try {
      const res = await apiFetch(`/api/network-nodes/${node.id}/sync`, { method: 'POST' });
      const json = await res.json();
      await Promise.all([loadTopology(), onRefreshGlobal()]);
      onNotify(
        json.reachable
          ? `Sinkronisasi API ${node.node_code} berhasil.`
          : `Ringkasan lokal ${node.node_code} diperbarui.`,
        'success'
      );
    } catch {
      onNotify('Gagal menyinkronkan node.', 'error');
    } finally {
      setSyncingNodeId(null);
    }
  }

  function stageCoordinatesFromMap(relX: number, relY: number, lat: number, lng: number) {
    if (!pickMapTarget) return;
    if (pickMapTarget.kind === 'ont') {
      if (selected?.kind !== 'ont' || selected.id !== pickMapTarget.id) {
        setSelected({ kind: 'ont', id: pickMapTarget.id });
      }
      setEditingOntForm((prev) =>
        prev
          ? {
              ...prev,
              latitude: lat.toFixed(6),
              longitude: lng.toFixed(6),
            }
          : prev
      );
      setStagedOntPreview({
        ontId: pickMapTarget.id,
        lat,
        lng,
        mapX: relX,
        mapY: relY,
      });
      return;
    }

    if (pickMapTarget.kind === 'odp') {
      const odp = topology.odps.find((d) => d.id === pickMapTarget.id);
      setStagedInfraPreview({
        kind: 'odp',
        id: pickMapTarget.id,
        code: odp?.odp_code || `ODP-${pickMapTarget.id}`,
        name: odp?.name || 'ODP Splitter',
        lat,
        lng,
        mapX: relX,
        mapY: relY,
      });
      return;
    }

    const node = topology.nodes.find((n) => n.id === pickMapTarget.id);
    setStagedInfraPreview({
      kind: 'node',
      id: pickMapTarget.id,
      code: node?.node_code || `NODE-${pickMapTarget.id}`,
      name: node?.name || 'Network Node',
      lat,
      lng,
      mapX: relX,
      mapY: relY,
    });
  }

  async function commitStagedInfraCoordinates() {
    if (!stagedInfraPreview) return;
    try {
      const endpoint =
        stagedInfraPreview.kind === 'odp'
          ? `/api/odps/${stagedInfraPreview.id}`
          : `/api/topology/nodes/${stagedInfraPreview.id}`;
      const res = await apiFetch(endpoint, {
        method: stagedInfraPreview.kind === 'odp' ? 'PUT' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          map_x: stagedInfraPreview.mapX,
          map_y: stagedInfraPreview.mapY,
          latitude: stagedInfraPreview.lat,
          longitude: stagedInfraPreview.lng,
        }),
      });
      if (!res.ok) {
        onNotify('Gagal menyimpan titik koordinat perangkat.', 'error');
        return;
      }
      const savedCode = stagedInfraPreview.code;
      const savedLat = stagedInfraPreview.lat;
      const savedLng = stagedInfraPreview.lng;
      setStagedInfraPreview(null);
      setPickMapTarget(null);
      await loadTopology();
      onNotify(
        `Koordinat ${savedCode} (${savedLat.toFixed(5)}, ${savedLng.toFixed(5)}) berhasil disimpan.`,
        'success'
      );
    } catch {
      onNotify('Gagal menyimpan posisi peta.', 'error');
    }
  }

  function handleResetStagedOntCoordinates() {
    setStagedOntPreview(null);
    if (selectedOnt && editingOntForm) {
      setEditingOntForm({
        ...editingOntForm,
        latitude:
          selectedOnt.latitude !== null && selectedOnt.latitude !== undefined
            ? String(selectedOnt.latitude)
            : '',
        longitude:
          selectedOnt.longitude !== null && selectedOnt.longitude !== undefined
            ? String(selectedOnt.longitude)
            : '',
      });
    }
  }

  function handleSpatialCanvasClick(e: MouseEvent<HTMLDivElement>) {
    if (!pickMapTarget) {
      setSchematicPopupOntId(null);
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const relX = Math.min(96, Math.max(4, Number((((e.clientX - rect.left) / rect.width) * 100).toFixed(1))));
    const relY = Math.min(94, Math.max(6, Number((((e.clientY - rect.top) / rect.height) * 100).toFixed(1))));
    const approx = schematicPercentToLatLng(relX, relY);
    stageCoordinatesFromMap(relX, relY, approx.lat, approx.lng);
  }

  function handlePickGoogleMapCoordinates(lat: number, lng: number) {
    if (!pickMapTarget) return;
    const pct = latLngToSchematicPercent(lat, lng);
    stageCoordinatesFromMap(pct.mapX, pct.mapY, lat, lng);
  }

  function focusInspector(entity: SelectedEntity) {
    setSelected(entity);
    inspectorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function openAddOdpModal() {
    setEditingOdp(null);
    const defaultOlt = topology.nodes.find((n) => n.node_type === 'OLT') ?? topology.nodes[0];
    setOdpForm({
      odp_code: `ODP-AREA-${String(topology.odps.length + 1).padStart(2, '0')}`,
      name: '',
      node_id: defaultOlt ? String(defaultOlt.id) : '',
      pon_port: defaultOlt?.node_type === 'OLT' ? 'GPON 0/1/1' : 'ether1',
      splitter_ratio: '1:8',
      capacity_ports: '8',
      area_zone: '',
      latitude: '-7.42450',
      longitude: '109.23950',
      map_x: '50',
      map_y: '55',
      notes: '',
    });
    setOdpModalOpen(true);
  }

  function openEditOdpModal(odp: NetworkOdp) {
    setEditingOdp(odp);
    setOdpForm({
      odp_code: odp.odp_code,
      name: odp.name,
      node_id: odp.node_id ? String(odp.node_id) : '',
      pon_port: odp.pon_port,
      splitter_ratio: odp.splitter_ratio,
      capacity_ports: String(odp.capacity_ports),
      area_zone: odp.area_zone,
      latitude: odp.latitude !== null ? String(odp.latitude) : '',
      longitude: odp.longitude !== null ? String(odp.longitude) : '',
      map_x: String(odp.map_x),
      map_y: String(odp.map_y),
      notes: odp.notes ?? '',
    });
    setOdpModalOpen(true);
  }

  async function handleSaveOdp(e: FormEvent) {
    e.preventDefault();
    setSavingOdp(true);
    try {
      const payload = {
        ...odpForm,
        node_id: odpForm.node_id ? Number(odpForm.node_id) : null,
        capacity_ports: Number(odpForm.capacity_ports) || 8,
        latitude: odpForm.latitude !== '' ? Number(odpForm.latitude) : null,
        longitude: odpForm.longitude !== '' ? Number(odpForm.longitude) : null,
        map_x: Number(odpForm.map_x) || 50,
        map_y: Number(odpForm.map_y) || 55,
      };
      const url = editingOdp ? `/api/odps/${editingOdp.id}` : '/api/odps';
      const method = editingOdp ? 'PUT' : 'POST';
      const res = await apiFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) {
        onNotify(json.error || 'Gagal menyimpan data ODP.', 'error');
        return;
      }
      setOdpModalOpen(false);
      await loadTopology();
      onNotify(
        editingOdp ? `ODP ${odpForm.odp_code} diperbarui.` : `ODP baru ${odpForm.odp_code} ditambahkan.`,
        'success'
      );
    } catch {
      onNotify('Terjadi kesalahan saat menyimpan ODP.', 'error');
    } finally {
      setSavingOdp(false);
    }
  }

  async function handleDeleteOdp(odp: NetworkOdp) {
    try {
      const res = await apiFetch(`/api/odps/${odp.id}`, { method: 'DELETE' });
      if (!res.ok) {
        onNotify('Gagal menghapus ODP.', 'error');
        return;
      }
      if (selected?.kind === 'odp' && selected.id === odp.id) {
        setSelected(null);
      }
      await loadTopology();
      onNotify(`ODP ${odp.odp_code} dihapus dan ONT dilepas dari ODP.`, 'success');
    } catch {
      onNotify('Gagal menghapus ODP.', 'error');
    }
  }

  const selectedOntLogs = useMemo(() => {
    if (!selectedOnt) return [];
    return topology.recent_logs.filter((l) => l.customer_id === selectedOnt.id).slice(0, 4);
  }, [selectedOnt, topology.recent_logs]);

  const selectedOdpOnts = useMemo(() => {
    if (!selectedOdp) return [];
    return topology.onts.filter((o) => o.odp_id === selectedOdp.id);
  }, [selectedOdp, topology.onts]);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-24 bg-white border border-slate-200 rounded-lg animate-pulse" />
          ))}
        </div>
        <div className="h-[540px] bg-white border border-slate-200 rounded-lg animate-pulse" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {isReadOnly && (
        <ReadOnlyBanner
          description={`Peran ${currentUser.role} hanya dapat melihat peta Google Maps, topologi jaringan, dan detail ONT/ODP. Perubahan mapping ONT, ODP splitter, dan status perangkat hanya tersedia untuk Teknisi / Admin.`}
        />
      )}

      {/* Top 4 KPI Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="text-xs font-medium text-slate-500">ONT Termapping ke Topologi</div>
          <div className="mt-1.5 text-2xl font-bold font-mono text-slate-900 tabular-nums">
            {stats.mapped} / {stats.total}
          </div>
          <div className="mt-1 text-xs text-slate-500">
            {stats.unmapped === 0 ? 'Semua ONT terhubung ke OLT/ODP' : `${stats.unmapped} ONT belum dipetakan`}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="text-xs font-medium text-slate-500">Status Perangkat ONT</div>
          <div className="mt-1.5 text-2xl font-bold font-mono text-emerald-700 tabular-nums">
            {stats.online} Online
          </div>
          <div className="mt-1 text-xs text-slate-500 font-mono tabular-nums">
            <span className="text-rose-700">{stats.offline} Offline</span> ·{' '}
            <span className="text-amber-700">{stats.isolir} Isolir</span>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="text-xs font-medium text-slate-500">Kapasitas ODP Splitter</div>
          <div className="mt-1.5 text-2xl font-bold font-mono text-slate-900 tabular-nums">
            {topology.odps.length} ODP
          </div>
          <div className="mt-1 text-xs text-slate-500 font-mono tabular-nums">
            {stats.usedOdpPorts} / {stats.totalOdpPorts} port terisi
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="text-xs font-medium text-slate-500">Alert Redaman / LOS</div>
          <div className={`mt-1.5 text-2xl font-bold font-mono tabular-nums ${stats.opticalWarn > 0 ? 'text-rose-700' : 'text-emerald-700'}`}>
            {stats.opticalWarn} Perangkat
          </div>
          <div className="mt-1 text-xs text-slate-500">
            Redaman &le; -27 dBm atau status Offline
          </div>
        </div>
      </div>

      {/* Mode Switcher & Filter Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex items-center gap-1 p-1 bg-slate-200/70 rounded-lg">
          <button
            type="button"
            onClick={() => setSubTab('peta')}
            className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
              subTab === 'peta' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <MapIcon className="w-3.5 h-3.5" />
            Peta Google Maps
          </button>
          <button
            type="button"
            onClick={() => {
              setSubTab('topologi');
              setPickMapTarget(null);
            }}
            className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
              subTab === 'topologi' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <GitBranch className="w-3.5 h-3.5" />
            Topologi Jaringan
          </button>
          <button
            type="button"
            onClick={() => {
              setSubTab('tabel');
              setPickMapTarget(null);
            }}
            className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
              subTab === 'tabel' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Box className="w-3.5 h-3.5" />
            Tabel Mapping ONT &amp; ODP
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-52">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cari ONT, ODP, pelanggan..."
              className="w-full pl-8 pr-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-md focus:outline-none focus:border-red-600"
            />
          </div>

          <select
            value={nodeFilter}
            onChange={(e) => setNodeFilter(e.target.value)}
            aria-label="Filter OLT atau MikroTik"
            className="px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-md text-slate-700 focus:outline-none focus:border-red-600"
          >
            <option value="all">Semua MikroTik / OLT</option>
            {topology.nodes.map((n) => (
              <option key={n.id} value={String(n.id)}>
                {n.node_code} ({n.node_type})
              </option>
            ))}
          </select>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as 'all' | DeviceStatus)}
            aria-label="Filter status ONT"
            className="px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-md text-slate-700 focus:outline-none focus:border-red-600"
          >
            <option value="all">Semua Status</option>
            <option value="Online">Online</option>
            <option value="Offline">Offline</option>
            <option value="Isolir">Isolir</option>
          </select>

          {!isReadOnly && (
            <button
              type="button"
              onClick={openAddOdpModal}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-red-700 hover:bg-red-800 rounded-md transition-colors whitespace-nowrap shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              Tambah ODP
            </button>
          )}

          <button
            type="button"
            onClick={() => void loadTopology()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-md transition-colors whitespace-nowrap shrink-0"
          >
            <RefreshCw className="w-3.5 h-3.5 text-slate-500" />
            Refresh
          </button>
        </div>
      </div>

      {/* Main Content Split: Left Interactive Canvas / Table + Right Inspector */}
      {subTab === 'tabel' ? (
        <div className="space-y-6">
          {/* ONT Mapping Matrix Table */}
          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">
                  Pemetaan Setiap ONT / Router Pelanggan ({filteredOnts.length})
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Integrasi langsung antara perangkat pelanggan, port PON, splitter ODP, redaman optik, dan koordinat lokasi.
                </p>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                    <th className="py-2.5 px-4">ONT / IP</th>
                    <th className="py-2.5 px-4">Pelanggan</th>
                    <th className="py-2.5 px-4">OLT / MikroTik &amp; PON</th>
                    <th className="py-2.5 px-4">ODP &amp; Port Splitter</th>
                    <th className="py-2.5 px-4 text-right">Kabel / Redaman</th>
                    <th className="py-2.5 px-4">Koordinat GPS</th>
                    <th className="py-2.5 px-4">Status</th>
                    <th className="py-2.5 px-4 text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {filteredOnts.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-8 text-center text-slate-500">
                        Tidak ada ONT yang cocok dengan filter saat ini.
                      </td>
                    </tr>
                  ) : (
                    filteredOnts.map((ont) => {
                      const opt = getOpticalQualityText(ont.rx_power_dbm);
                      return (
                        <tr key={ont.id} className="hover:bg-slate-50 transition-colors">
                          <td className="py-2.5 px-4">
                            <div className="font-mono font-semibold text-slate-900">{ont.device_id}</div>
                            <div className="font-mono text-[11px] text-slate-500">{ont.device_ip} · {ont.device_model}</div>
                          </td>
                          <td className="py-2.5 px-4">
                            <div className="font-medium text-slate-900">{ont.name}</div>
                            <div className="text-[11px] text-slate-500 truncate max-w-[190px]" title={ont.address}>
                              {ont.customer_code} · {ont.address}
                            </div>
                          </td>
                          <td className="py-2.5 px-4">
                            <div className="font-mono font-medium text-slate-800">{ont.node_code || 'Belum dipilih'}</div>
                            <div className="font-mono text-[11px] text-slate-500">{ont.pon_port || '—'}</div>
                          </td>
                          <td className="py-2.5 px-4">
                            <div className="font-mono font-medium text-slate-800">
                              {ont.odp_code ? `${ont.odp_code} · Port #${ont.odp_port ?? '?'}` : 'Belum masuk ODP'}
                            </div>
                            <div className="text-[11px] text-slate-500 truncate max-w-[180px]">{ont.odp_name || '—'}</div>
                          </td>
                          <td className="py-2.5 px-4 text-right font-mono tabular-nums">
                            <div className="text-slate-800">{ont.cable_length_m ? `${ont.cable_length_m} m` : '—'}</div>
                            <div className={`text-[11px] ${opt.colorClass}`}>
                              {ont.rx_power_dbm !== null ? `${ont.rx_power_dbm} dBm` : 'Ethernet'}
                            </div>
                          </td>
                          <td className="py-2.5 px-4 font-mono text-[11px] text-slate-600 tabular-nums">
                            {ont.latitude && ont.longitude ? (
                              <a
                                href={`https://www.google.com/maps?q=${ont.latitude},${ont.longitude}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-red-700 hover:underline"
                              >
                                <span>{ont.latitude.toFixed(4)}, {ont.longitude.toFixed(4)}</span>
                                <ExternalLink className="w-3 h-3" />
                              </a>
                            ) : (
                              <span>Belum diset</span>
                            )}
                          </td>
                          <td className="py-2.5 px-4 whitespace-nowrap">
                            <DeviceStatusLabel status={ont.device_status} />
                          </td>
                          <td className="py-2.5 px-4 text-right whitespace-nowrap">
                            <div className="inline-flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => {
                                  setSelected({ kind: 'ont', id: ont.id });
                                  setSubTab('topologi');
                                }}
                                className="px-2.5 py-1 text-[11px] font-medium text-red-700 bg-red-50 hover:bg-red-100 rounded transition-colors"
                              >
                                Lacak Topologi
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setSelected({ kind: 'ont', id: ont.id });
                                  setSubTab('peta');
                                }}
                                className="px-2.5 py-1 text-[11px] font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded transition-colors"
                              >
                                Lihat Peta
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* ODP Inventory Table */}
          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">
                  Inventaris ODP / Splitter Distribusi Fiber ({topology.odps.length})
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Kelola kapasitas port splitter ODP, relasi ke port PON OLT, dan lokasi tiang distribusi.
                </p>
              </div>
              {!isReadOnly && (
                <button
                  type="button"
                  onClick={openAddOdpModal}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-red-700 hover:bg-red-800 rounded-md transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Tambah ODP Baru
                </button>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                    <th className="py-2.5 px-4">Kode &amp; Nama ODP</th>
                    <th className="py-2.5 px-4">Area / Cluster</th>
                    <th className="py-2.5 px-4">Upstream OLT &amp; PON</th>
                    <th className="py-2.5 px-4 text-center">Splitter &amp; Port Terpakai</th>
                    <th className="py-2.5 px-4">Koordinat</th>
                    {!isReadOnly && <th className="py-2.5 px-4 text-right">Aksi</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {topology.odps.map((odp) => (
                    <tr key={odp.id} className="hover:bg-slate-50 transition-colors">
                      <td className="py-2.5 px-4">
                        <div className="font-mono font-semibold text-slate-900">{odp.odp_code}</div>
                        <div className="text-slate-600">{odp.name}</div>
                      </td>
                      <td className="py-2.5 px-4 text-slate-700">{odp.area_zone}</td>
                      <td className="py-2.5 px-4 font-mono text-slate-700">
                        {odp.node_code || '—'} · {odp.pon_port}
                      </td>
                      <td className="py-2.5 px-4 text-center font-mono tabular-nums">
                        <span className="font-semibold text-slate-900">{odp.used_ports ?? 0}</span> / {odp.capacity_ports} port ({odp.splitter_ratio})
                      </td>
                      <td className="py-2.5 px-4 font-mono text-[11px] text-slate-600 tabular-nums">
                        {odp.latitude && odp.longitude ? `${odp.latitude.toFixed(4)}, ${odp.longitude.toFixed(4)}` : '—'}
                      </td>
                      {!isReadOnly && (
                        <td className="py-2.5 px-4 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => openEditOdpModal(odp)}
                              title="Edit ODP"
                              className="p-1.5 text-slate-500 hover:text-red-700 hover:bg-red-50 rounded transition-colors"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleDeleteOdp(odp)}
                              title="Hapus ODP"
                              className="p-1.5 text-slate-500 hover:text-rose-700 hover:bg-rose-50 rounded transition-colors"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
          {/* Left 8 Columns: Interactive Topology Graph OR Spatial Fiber Map */}
          <div className="xl:col-span-8 bg-white border border-slate-200 rounded-lg overflow-hidden flex flex-col">
            {/* Canvas Header Toolbar */}
            <div className="px-4 py-3 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 bg-slate-50">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">
                  {subTab === 'topologi'
                    ? 'Diagram Topologi Jaringan FTTH (Core → OLT → ODP → ONT)'
                    : mapMode === 'google'
                      ? 'Visualisasi Peta Jaringan Google Maps (MikroTik → OLT → ODP → ONT)'
                      : 'Denah Skematik Sebaran ODP & ONT Pelanggan'}
                </h2>
                <div className="flex flex-wrap items-center gap-3 mt-1 text-[11px] text-slate-600">
                  <span className="inline-flex items-center gap-1">
                    <span className="w-3 h-0.5 bg-emerald-600 inline-block" /> Online (Normal)
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <span className="w-3 h-0.5 border-t-2 border-dashed border-orange-600 inline-block" /> Redaman Tinggi
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <span className="w-3 h-0.5 border-t-2 border-dashed border-amber-500 inline-block" /> Isolir
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <span className="w-3 h-0.5 border-t-2 border-dotted border-rose-600 inline-block" /> Offline / LOS
                  </span>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {subTab === 'peta' && (
                  <>
                    <div className="inline-flex items-center border border-slate-200 rounded bg-white p-0.5">
                      <button
                        type="button"
                        onClick={() => setMapMode('google')}
                        className={`px-2 py-1 text-[11px] font-medium rounded transition-colors ${
                          mapMode === 'google'
                            ? 'bg-red-700 text-white'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        Google Maps
                      </button>
                      <button
                        type="button"
                        onClick={() => setMapMode('schematic')}
                        className={`px-2 py-1 text-[11px] font-medium rounded transition-colors ${
                          mapMode === 'schematic'
                            ? 'bg-slate-900 text-white'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        Denah Skematik
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowCableLines((v) => !v)}
                      className={`px-2.5 py-1 text-xs font-medium border rounded transition-colors ${
                        showCableLines
                          ? 'bg-red-50 text-red-700 border-red-200'
                          : 'bg-white text-slate-600 border-slate-200'
                      }`}
                    >
                      Jalur Fiber
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowTelemetryLabels((v) => !v)}
                      className={`px-2.5 py-1 text-xs font-medium border rounded transition-colors ${
                        showTelemetryLabels
                          ? 'bg-red-50 text-red-700 border-red-200'
                          : 'bg-white text-slate-600 border-slate-200'
                      }`}
                    >
                      Label dBm
                    </button>
                  </>
                )}

                {(subTab === 'topologi' || mapMode === 'schematic') && (
                  <div className="inline-flex items-center border border-slate-200 rounded bg-white">
                    <button
                      type="button"
                      onClick={() => setZoom((z) => Math.max(0.7, Number((z - 0.1).toFixed(2))))}
                      title="Perkecil"
                      className="p-1.5 text-slate-600 hover:bg-slate-50 border-r border-slate-200"
                    >
                      <ZoomOut className="w-3.5 h-3.5" />
                    </button>
                    <span className="px-2 text-[11px] font-mono text-slate-700 tabular-nums">
                      {Math.round(zoom * 100)}%
                    </span>
                    <button
                      type="button"
                      onClick={() => setZoom((z) => Math.min(1.4, Number((z + 0.1).toFixed(2))))}
                      title="Perbesar"
                      className="p-1.5 text-slate-600 hover:bg-slate-50 border-l border-slate-200"
                    >
                      <ZoomIn className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Live Status Summary Strip & Refresh Control */}
            <div className="px-4 py-2.5 border-b border-slate-200 bg-white flex flex-wrap items-center justify-between gap-2.5">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="text-[11px] font-medium text-slate-500 mr-0.5">
                  Ringkasan Peta ({mapSummaryStats.totalVisible} ONT):
                </span>
                <button
                  type="button"
                  onClick={() => setStatusFilter((prev) => (prev === 'Online' ? 'all' : 'Online'))}
                  className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded border text-[11px] font-mono font-semibold tabular-nums transition-colors ${
                    statusFilter === 'Online'
                      ? 'bg-emerald-600 text-white border-emerald-600'
                      : 'bg-emerald-50 text-emerald-800 border-emerald-200 hover:bg-emerald-100'
                  }`}
                >
                  <span
                    className={`w-2 h-2 rounded-full ${
                      statusFilter === 'Online' ? 'bg-white' : 'bg-emerald-600'
                    }`}
                  />
                  <span>{mapSummaryStats.online} Online</span>
                </button>
                <button
                  type="button"
                  onClick={() => setStatusFilter((prev) => (prev === 'Isolir' ? 'all' : 'Isolir'))}
                  className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded border text-[11px] font-mono font-semibold tabular-nums transition-colors ${
                    statusFilter === 'Isolir'
                      ? 'bg-amber-500 text-white border-amber-500'
                      : 'bg-amber-50 text-amber-800 border-amber-200 hover:bg-amber-100'
                  }`}
                >
                  <span
                    className={`w-2 h-2 rounded-full ${
                      statusFilter === 'Isolir' ? 'bg-white' : 'bg-amber-500'
                    }`}
                  />
                  <span>{mapSummaryStats.isolir} Isolir</span>
                </button>
                <button
                  type="button"
                  onClick={() => setStatusFilter((prev) => (prev === 'Offline' ? 'all' : 'Offline'))}
                  className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded border text-[11px] font-mono font-semibold tabular-nums transition-colors ${
                    statusFilter === 'Offline'
                      ? 'bg-rose-600 text-white border-rose-600'
                      : 'bg-rose-50 text-rose-800 border-rose-200 hover:bg-rose-100'
                  }`}
                >
                  <span
                    className={`w-2 h-2 rounded-full ${
                      statusFilter === 'Offline' ? 'bg-white' : 'bg-rose-600'
                    }`}
                  />
                  <span>{mapSummaryStats.offline} Offline / LOS</span>
                </button>
                {mapSummaryStats.highAttenuation > 0 && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded border bg-orange-50 text-orange-800 border-orange-200 text-[11px] font-mono font-semibold tabular-nums">
                    {mapSummaryStats.highAttenuation} Redaman Tinggi
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2.5 ml-auto">
                <span className="text-[11px] font-mono text-slate-500 tabular-nums">
                  Pembaruan: {lastUpdatedAt ? formatDateTimeWib(lastUpdatedAt) : '—'}
                </span>
                <button
                  type="button"
                  disabled={refreshing}
                  onClick={() => void handleRefreshStatus()}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 disabled:opacity-60 rounded-md transition-colors whitespace-nowrap shrink-0"
                >
                  <RefreshCw className={`w-3.5 h-3.5 text-red-700 ${refreshing ? 'animate-spin' : ''}`} />
                  {refreshing ? 'Menyegarkan...' : 'Refresh Status'}
                </button>
              </div>
            </div>

            {pickMapTarget && subTab === 'peta' && (
              <div className="px-4 py-2.5 bg-blue-50 border-b border-blue-200 flex flex-wrap items-center justify-between gap-2 text-xs text-blue-950">
                <span className="font-medium inline-flex items-center gap-1.5">
                  <Crosshair className="w-4 h-4 text-blue-700 shrink-0" />
                  {pickMapTarget.kind === 'ont'
                    ? activePreviewOnt
                      ? `Pratinjau GPS aktif (${activePreviewOnt.mapPayload.lat.toFixed(5)}, ${activePreviewOnt.mapPayload.lng.toFixed(5)})${
                          activePreviewOnt.distanceMeters !== null
                            ? ` · Estimasi dropcore dari ${activePreviewOnt.odpCode}: ~${activePreviewOnt.distanceMeters} m`
                            : ''
                        }. Tekan "Simpan Mapping ONT" di panel kanan untuk menyimpan.`
                      : 'Mode Set Posisi Aktif: Klik titik koordinat baru di peta untuk memperbarui Latitude/Longitude & melihat pratinjau jalur dropcore dari ODP.'
                    : 'Mode Set Posisi Infrastruktur: Klik titik koordinat baru di peta untuk pratinjau posisi ODP/Node.'}
                </span>
                <div className="flex items-center gap-1.5">
                  {pickMapTarget.kind === 'ont' && activePreviewOnt && (
                    <button
                      type="button"
                      onClick={() => {
                        handleResetStagedOntCoordinates();
                        setPickMapTarget(null);
                      }}
                      className="px-2.5 py-1 text-xs font-medium bg-white border border-blue-200 text-blue-900 rounded hover:bg-blue-100"
                    >
                      Batalkan Pratinjau
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setPickMapTarget(null);
                      setStagedInfraPreview(null);
                    }}
                    className="px-2.5 py-1 text-xs font-medium bg-white border border-slate-300 text-slate-700 rounded hover:bg-slate-50"
                  >
                    {activePreviewOnt ? 'Selesai Pilih Titik' : 'Batal'}
                  </button>
                </div>
              </div>
            )}

            {stagedInfraPreview && subTab === 'peta' && (
              <div className="px-4 py-2.5 bg-red-50 border-b border-red-200 flex flex-wrap items-center justify-between gap-2 text-xs text-red-950">
                <span className="font-medium">
                  Pratinjau Koordinat {stagedInfraPreview.code}:{' '}
                  <span className="font-mono tabular-nums">
                    {stagedInfraPreview.lat.toFixed(5)}, {stagedInfraPreview.lng.toFixed(5)}
                  </span>
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setStagedInfraPreview(null)}
                    className="px-2.5 py-1 text-xs font-medium bg-white border border-red-200 rounded hover:bg-red-100"
                  >
                    Reset
                  </button>
                  <button
                    type="button"
                    onClick={() => void commitStagedInfraCoordinates()}
                    className="inline-flex items-center gap-1 px-3 py-1 text-xs font-medium bg-red-700 text-white rounded hover:bg-red-800"
                  >
                    <Save className="w-3.5 h-3.5" />
                    Simpan Posisi {stagedInfraPreview.code}
                  </button>
                </div>
              </div>
            )}

            {/* Interactive Canvas Viewport */}
            {subTab === 'topologi' ? (
              <div className="overflow-auto bg-slate-50/70 p-4" style={{ maxHeight: '660px' }}>
                <div
                  className="relative mx-auto origin-top-left transition-transform duration-150"
                  style={{
                    width: `${topologyLayout.canvasWidth}px`,
                    height: `${topologyLayout.canvasHeight}px`,
                    transform: `scale(${zoom})`,
                  }}
                >
                  {/* Tier Labels on Left Margin */}
                  <div className="absolute left-2 top-8 text-[11px] font-medium text-slate-400">
                    Tier 1 · Core MikroTik
                  </div>
                  <div className="absolute left-2 top-[148px] text-[11px] font-medium text-slate-400">
                    Tier 2 · OLT Distribusi
                  </div>
                  <div className="absolute left-2 top-[300px] text-[11px] font-medium text-slate-400">
                    Tier 3 · ODP Splitter
                  </div>
                  <div className="absolute left-2 top-[462px] text-[11px] font-medium text-slate-400">
                    Tier 4 · ONT Pelanggan
                  </div>

                  {/* SVG Connection Curves */}
                  <svg
                    width={topologyLayout.canvasWidth}
                    height={topologyLayout.canvasHeight}
                    className="absolute inset-0 pointer-events-none"
                  >
                    {/* Tier 1 -> Tier 2 (Core MikroTik -> OLT) */}
                    {topologyLayout.tier2.map((node) => {
                      const p1 = node.parent_node_id ? topologyLayout.nodePos.get(node.parent_node_id) : undefined;
                      const p2 = topologyLayout.nodePos.get(node.id);
                      if (!p1 || !p2) return null;
                      const style = getFiberLinkVisual(node.status);
                      const isEmphasized =
                        !highlightedPath.active ||
                        (highlightedPath.nodeIds.has(node.id) &&
                          node.parent_node_id &&
                          highlightedPath.nodeIds.has(node.parent_node_id));
                      const midY = (p1.y + 34 + p2.y - 34) / 2;
                      return (
                        <path
                          key={`link-node-${node.id}`}
                          d={`M ${p1.x} ${p1.y + 34} C ${p1.x} ${midY}, ${p2.x} ${midY}, ${p2.x} ${p2.y - 34}`}
                          fill="none"
                          stroke={style.stroke}
                          strokeWidth={isEmphasized ? 2.5 : 1.5}
                          strokeDasharray={style.dashArray}
                          opacity={isEmphasized ? 0.9 : 0.22}
                        />
                      );
                    })}

                    {/* Node -> ODP */}
                    {topologyLayout.odps.map((odp) => {
                      const p1 = odp.node_id ? topologyLayout.nodePos.get(odp.node_id) : undefined;
                      const p2 = topologyLayout.odpPos.get(odp.id);
                      if (!p1 || !p2) return null;
                      const parentNode = topology.nodes.find((n) => n.id === odp.node_id);
                      const style = getFiberLinkVisual(parentNode?.status ?? 'Online');
                      const isEmphasized =
                        !highlightedPath.active ||
                        (highlightedPath.odpIds.has(odp.id) &&
                          odp.node_id !== null &&
                          highlightedPath.nodeIds.has(odp.node_id));
                      const midY = (p1.y + 34 + p2.y - 30) / 2;
                      return (
                        <path
                          key={`link-odp-${odp.id}`}
                          d={`M ${p1.x} ${p1.y + 34} C ${p1.x} ${midY}, ${p2.x} ${midY}, ${p2.x} ${p2.y - 30}`}
                          fill="none"
                          stroke={style.stroke}
                          strokeWidth={isEmphasized ? 2.2 : 1.4}
                          strokeDasharray={style.dashArray}
                          opacity={isEmphasized ? 0.85 : 0.2}
                        />
                      );
                    })}

                    {/* ODP (or Node direct) -> ONT */}
                    {topologyLayout.orderedOnts.map((ont) => {
                      const pOdp = ont.odp_id ? topologyLayout.odpPos.get(ont.odp_id) : undefined;
                      const pNode = !pOdp && ont.node_id ? topologyLayout.nodePos.get(ont.node_id) : undefined;
                      const p1 = pOdp ?? pNode;
                      const p2 = topologyLayout.ontPos.get(ont.id);
                      if (!p1 || !p2) return null;
                      const style = getFiberLinkVisual(ont.device_status, ont.rx_power_dbm);
                      const isEmphasized = !highlightedPath.active || highlightedPath.ontIds.has(ont.id);
                      const startY = p1.y + 30;
                      const endY = p2.y - 36;
                      const midY = (startY + endY) / 2;
                      return (
                        <path
                          key={`link-ont-${ont.id}`}
                          d={`M ${p1.x} ${startY} C ${p1.x} ${midY}, ${p2.x} ${midY}, ${p2.x} ${endY}`}
                          fill="none"
                          stroke={style.stroke}
                          strokeWidth={isEmphasized ? 2.2 : 1.2}
                          strokeDasharray={style.dashArray}
                          opacity={isEmphasized ? 0.92 : 0.18}
                        />
                      );
                    })}
                  </svg>

                  {/* Tier 1 + Tier 2 Cards (MikroTik & OLT) */}
                  {[...topologyLayout.tier1, ...topologyLayout.tier2].map((node) => {
                    const pos = topologyLayout.nodePos.get(node.id);
                    if (!pos) return null;
                    const isSelected = selected?.kind === 'node' && selected.id === node.id;
                    const dimmed = highlightedPath.active && !highlightedPath.nodeIds.has(node.id);
                    return (
                      <button
                        key={`node-card-${node.id}`}
                        type="button"
                        onClick={() => setSelected({ kind: 'node', id: node.id })}
                        style={{ left: `${pos.x - 108}px`, top: `${pos.y - 34}px`, width: '216px' }}
                        className={`absolute text-left bg-white rounded-lg border p-2.5 transition-all ${
                          isSelected
                            ? 'border-red-600 ring-2 ring-red-600/20 shadow-sm'
                            : 'border-slate-200 hover:border-slate-300'
                        } ${dimmed ? 'opacity-40' : 'opacity-100'}`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="inline-flex items-center gap-1.5 font-mono text-xs font-bold text-slate-900 truncate">
                            {node.node_type === 'MikroTik' ? (
                              <Router className="w-3.5 h-3.5 text-red-700 shrink-0" />
                            ) : (
                              <Server className="w-3.5 h-3.5 text-slate-700 shrink-0" />
                            )}
                            {node.node_code}
                          </span>
                          <span
                            className={`text-[11px] font-medium ${
                              node.status === 'Online'
                                ? 'text-emerald-700'
                                : node.status === 'Degraded'
                                  ? 'text-amber-700'
                                  : 'text-rose-700'
                            }`}
                          >
                            {node.status}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-700 font-medium truncate mt-0.5">{node.name}</div>
                        <div className="text-[10px] font-mono text-slate-500 mt-0.5 tabular-nums">
                          {node.host_ip} · CPU {node.cpu_load_pct}% · {node.active_sessions} sesi
                        </div>
                      </button>
                    );
                  })}

                  {/* Tier 3 Cards (ODP Splitters) */}
                  {topologyLayout.odps.map((odp) => {
                    const pos = topologyLayout.odpPos.get(odp.id);
                    if (!pos) return null;
                    const isSelected = selected?.kind === 'odp' && selected.id === odp.id;
                    const dimmed = highlightedPath.active && !highlightedPath.odpIds.has(odp.id);
                    const hasOfflineOnt = topology.onts.some(
                      (o) => o.odp_id === odp.id && o.device_status === 'Offline'
                    );
                    return (
                      <button
                        key={`odp-card-${odp.id}`}
                        type="button"
                        onClick={() => setSelected({ kind: 'odp', id: odp.id })}
                        style={{ left: `${pos.x - 86}px`, top: `${pos.y - 30}px`, width: '172px' }}
                        className={`absolute text-left bg-white rounded-lg border p-2.5 transition-all ${
                          isSelected
                            ? 'border-red-600 ring-2 ring-red-600/20 shadow-sm'
                            : hasOfflineOnt
                              ? 'border-rose-300 hover:border-rose-400'
                              : 'border-slate-200 hover:border-slate-300'
                        } ${dimmed ? 'opacity-40' : 'opacity-100'}`}
                      >
                        <div className="flex items-center justify-between gap-1.5">
                          <span className="inline-flex items-center gap-1 font-mono text-xs font-bold text-slate-900 truncate">
                            <Box className="w-3.5 h-3.5 text-slate-600 shrink-0" />
                            {odp.odp_code}
                          </span>
                          <span className="font-mono text-[10px] text-slate-600 tabular-nums">
                            {odp.used_ports ?? 0}/{odp.capacity_ports}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-700 truncate mt-0.5">{odp.area_zone}</div>
                        <div className="text-[10px] font-mono text-slate-500 mt-0.5 truncate">
                          {odp.pon_port} · {odp.splitter_ratio}
                        </div>
                      </button>
                    );
                  })}

                  {/* Tier 4 Cards (Customer ONT / Router) */}
                  {topologyLayout.orderedOnts.map((ont) => {
                    const pos = topologyLayout.ontPos.get(ont.id);
                    if (!pos) return null;
                    const isSelected = selected?.kind === 'ont' && selected.id === ont.id;
                    const dimmed = highlightedPath.active && !highlightedPath.ontIds.has(ont.id);
                    const opt = getOpticalQualityText(ont.rx_power_dbm);
                    const meta = getOpticalStatusMeta(ont.device_status, ont.rx_power_dbm);
                    return (
                      <button
                        key={`ont-card-${ont.id}`}
                        type="button"
                        onClick={() => setSelected({ kind: 'ont', id: ont.id })}
                        style={{ left: `${pos.x - 80}px`, top: `${pos.y - 36}px`, width: '160px' }}
                        className={`absolute text-left bg-white rounded-lg border p-2 transition-all ${
                          isSelected
                            ? 'border-red-600 ring-2 ring-red-600/20 shadow-sm'
                            : ont.device_status === 'Offline'
                              ? 'border-rose-300 bg-rose-50/40 hover:border-rose-400'
                              : ont.device_status === 'Isolir'
                                ? 'border-amber-300 bg-amber-50/40 hover:border-amber-400'
                                : 'border-slate-200 hover:border-slate-300'
                        } ${dimmed ? 'opacity-40' : 'opacity-100'}`}
                      >
                        <div className="flex items-center justify-between gap-1">
                          <span className="font-mono text-[11px] font-bold text-slate-900 truncate">
                            {ont.device_id}
                          </span>
                          <span className={`px-1 py-[1px] rounded text-[8px] font-bold shrink-0 ${meta.tagBgClass}`}>
                            {meta.shortTag}
                          </span>
                        </div>
                        <div className="text-[11px] font-medium text-slate-800 truncate mt-0.5">{ont.name}</div>
                        <div className="flex items-center justify-between text-[10px] font-mono mt-0.5 tabular-nums">
                          <span className="text-slate-500">
                            {ont.odp_port ? `Port #${ont.odp_port}` : ont.device_ip}
                          </span>
                          <span className={opt.colorClass}>
                            {ont.rx_power_dbm !== null ? `${ont.rx_power_dbm} dBm` : `${ont.latency_ms ?? '-'} ms`}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : mapMode === 'google' ? (
              /* Interactive Real-World Google Maps View */
              <GoogleNetworkMap
                nodes={topology.nodes}
                odps={topology.odps}
                onts={filteredOnts}
                selected={selected}
                highlightedPath={highlightedPath}
                showCableLines={showCableLines}
                showTelemetryLabels={showTelemetryLabels}
                pickMapTarget={pickMapTarget}
                previewOnt={activePreviewOnt?.mapPayload ?? null}
                previewInfra={stagedInfraPreview}
                onSelect={setSelected}
                onInspectEntity={focusInspector}
                onPickCoordinates={(lat, lng) => handlePickGoogleMapCoordinates(lat, lng)}
                onOpenChat={onOpenChat}
                onCreateTicket={isReadOnly ? undefined : onCreateTicket}
                onSwitchToSchematic={() => setMapMode('schematic')}
              />
            ) : (
              /* Peta Skematik & Jalur Kabel Fiber */
              <div className="overflow-auto bg-slate-100 p-4" style={{ maxHeight: '660px' }}>
                <div
                  onClick={handleSpatialCanvasClick}
                  className={`relative mx-auto bg-slate-50 border border-slate-200 rounded-lg overflow-hidden select-none ${
                    pickMapTarget ? 'cursor-crosshair ring-2 ring-blue-500/50' : ''
                  }`}
                  style={{
                    width: `${960 * zoom}px`,
                    height: `${560 * zoom}px`,
                  }}
                >
                  {/* Map Grid & Cluster Zones Background SVG */}
                  <svg
                    viewBox="0 0 1000 600"
                    className="absolute inset-0 w-full h-full pointer-events-none"
                    preserveAspectRatio="none"
                  >
                    {/* Coordinate Survey Grid */}
                    <defs>
                      <pattern id="noc-grid" width="50" height="50" patternUnits="userSpaceOnUse">
                        <path d="M 50 0 L 0 0 0 50" fill="none" stroke="#e2e8f0" strokeWidth="0.8" />
                      </pattern>
                    </defs>
                    <rect width="1000" height="600" fill="url(#noc-grid)" />

                    {/* Area Cluster Footprints */}
                    <rect x="35" y="340" width="210" height="205" rx="12" fill="#f1f5f9" stroke="#cbd5e1" strokeDasharray="4 4" />
                    <text x="48" y="362" fill="#64748b" fontSize="12" fontWeight="600">Perum Graha Asri</text>

                    <rect x="260" y="355" width="185" height="210" rx="12" fill="#f1f5f9" stroke="#cbd5e1" strokeDasharray="4 4" />
                    <text x="274" y="376" fill="#64748b" fontSize="12" fontWeight="600">Jl. Melati &amp; Cempaka</text>

                    <rect x="460" y="345" width="185" height="215" rx="12" fill="#f1f5f9" stroke="#cbd5e1" strokeDasharray="4 4" />
                    <text x="472" y="366" fill="#64748b" fontSize="12" fontWeight="600">Griya Indah &amp; Sudirman</text>

                    <rect x="660" y="350" width="305" height="210" rx="12" fill="#f1f5f9" stroke="#cbd5e1" strokeDasharray="4 4" />
                    <text x="674" y="372" fill="#64748b" fontSize="12" fontWeight="600">Cluster Kenanga &amp; Jl. Anggrek</text>

                    {/* Street / Backbone Corridors */}
                    <path d="M 30 275 L 970 275" stroke="#cbd5e1" strokeWidth="3" />
                    <path d="M 490 30 L 490 580" stroke="#cbd5e1" strokeWidth="2.5" />

                    {/* Fiber Cables: Core -> OLT -> ODP -> ONT */}
                    {showCableLines &&
                      topology.nodes
                        .filter((n) => n.parent_node_id)
                        .map((n) => {
                          const parent = topology.nodes.find((p) => p.id === n.parent_node_id);
                          if (!parent) return null;
                          const x1 = ((parent.map_x ?? 50) / 100) * 1000;
                          const y1 = ((parent.map_y ?? 14) / 100) * 600;
                          const x2 = ((n.map_x ?? 50) / 100) * 1000;
                          const y2 = ((n.map_y ?? 30) / 100) * 600;
                          return (
                            <line
                              key={`map-backbone-${n.id}`}
                              x1={x1}
                              y1={y1}
                              x2={x2}
                              y2={y2}
                              stroke={n.status === 'Offline' ? '#e11d48' : n.status === 'Degraded' ? '#d97706' : '#1d4ed8'}
                              strokeWidth="3"
                              strokeDasharray={n.status === 'Online' ? undefined : '6 4'}
                              opacity="0.78"
                            />
                          );
                        })}

                    {showCableLines &&
                      topology.odps.map((odp) => {
                        const parent = topology.nodes.find((n) => n.id === odp.node_id);
                        if (!parent) return null;
                        const x1 = ((parent.map_x ?? 50) / 100) * 1000;
                        const y1 = ((parent.map_y ?? 30) / 100) * 600;
                        const x2 = (odp.map_x / 100) * 1000;
                        const y2 = (odp.map_y / 100) * 600;
                        return (
                          <line
                            key={`map-dist-${odp.id}`}
                            x1={x1}
                            y1={y1}
                            x2={x2}
                            y2={y2}
                            stroke={parent.status === 'Offline' ? '#e11d48' : '#0284c7'}
                            strokeWidth="2.2"
                            strokeDasharray={parent.status === 'Online' ? undefined : '5 4'}
                            opacity="0.78"
                          />
                        );
                      })}

                    {showCableLines &&
                      filteredOnts.map((ont) => {
                        const odp = ont.odp_id ? topology.odps.find((d) => d.id === ont.odp_id) : undefined;
                        const node = !odp && ont.node_id ? topology.nodes.find((n) => n.id === ont.node_id) : undefined;
                        const srcX = odp ? odp.map_x : node?.map_x ?? null;
                        const srcY = odp ? odp.map_y : node?.map_y ?? null;
                        if (srcX === null || srcY === null) return null;
                        const pos = schematicDeoverlapped.positions[ont.id] ?? {
                          x: ont.map_x ?? 50,
                          y: ont.map_y ?? 75,
                        };
                        const x1 = (srcX / 100) * 1000;
                        const y1 = (srcY / 100) * 600;
                        const x2 = (pos.x / 100) * 1000;
                        const y2 = (pos.y / 100) * 600;
                        const visual = getFiberLinkVisual(ont.device_status, ont.rx_power_dbm);
                        const isEmphasized = !highlightedPath.active || highlightedPath.ontIds.has(ont.id);
                        const isDimmedByPreview = activePreviewOnt?.mapPayload.ontId === ont.id;
                        return (
                          <line
                            key={`map-drop-${ont.id}`}
                            x1={x1}
                            y1={y1}
                            x2={x2}
                            y2={y2}
                            stroke={visual.stroke}
                            strokeWidth={isEmphasized ? 2.4 : 1.3}
                            strokeDasharray={visual.dashArray}
                            opacity={isDimmedByPreview ? 0.25 : isEmphasized ? 0.9 : 0.22}
                          />
                        );
                      })}

                    {/* Preview Dropcore Cable Line in Schematic Mode */}
                    {activePreviewOnt && (() => {
                      const odp = activePreviewOnt.mapPayload.odpId
                        ? topology.odps.find((d) => d.id === activePreviewOnt.mapPayload.odpId)
                        : undefined;
                      const node =
                        !odp && activePreviewOnt.mapPayload.nodeId
                          ? topology.nodes.find((n) => n.id === activePreviewOnt.mapPayload.nodeId)
                          : undefined;
                      const srcX = odp ? odp.map_x : node?.map_x ?? null;
                      const srcY = odp ? odp.map_y : node?.map_y ?? null;
                      if (srcX === null || srcY === null) return null;
                      return (
                        <line
                          x1={(srcX / 100) * 1000}
                          y1={(srcY / 100) * 600}
                          x2={(activePreviewOnt.mapX / 100) * 1000}
                          y2={(activePreviewOnt.mapY / 100) * 600}
                          stroke="#2563eb"
                          strokeWidth="3"
                          strokeDasharray="8 5"
                          opacity="0.95"
                        />
                      );
                    })()}
                  </svg>

                  {/* Map Pins: MikroTik & OLT POP */}
                  {topology.nodes.map((node) => {
                    const isSelected = selected?.kind === 'node' && selected.id === node.id;
                    return (
                      <button
                        key={`map-node-${node.id}`}
                        type="button"
                        onClick={(e) => {
                          if (pickMapTarget) return;
                          e.stopPropagation();
                          setSchematicPopupOntId(null);
                          setSelected({ kind: 'node', id: node.id });
                        }}
                        style={{ left: `${node.map_x ?? 50}%`, top: `${node.map_y ?? 14}%` }}
                        className={`absolute -translate-x-1/2 -translate-y-1/2 px-2.5 py-1.5 rounded-md border bg-slate-900 text-white text-[11px] font-mono font-semibold flex items-center gap-1.5 shadow-sm transition-transform hover:scale-105 z-20 ${
                          isSelected ? 'ring-2 ring-red-500 border-red-400' : 'border-slate-700'
                        }`}
                      >
                        <span
                          className={`w-2 h-2 rounded-full ${
                            node.status === 'Online'
                              ? 'bg-emerald-400'
                              : node.status === 'Degraded'
                                ? 'bg-amber-400'
                                : 'bg-rose-500'
                          }`}
                        />
                        {node.node_type === 'MikroTik' ? (
                          <Router className="w-3.5 h-3.5 text-sky-400" />
                        ) : (
                          <Server className="w-3.5 h-3.5 text-emerald-400" />
                        )}
                        <span>{node.node_code}</span>
                      </button>
                    );
                  })}

                  {/* Map Pins: ODP Splitters */}
                  {topology.odps.map((odp) => {
                    const isSelected = selected?.kind === 'odp' && selected.id === odp.id;
                    const hasOffline = filteredOnts.some(
                      (o) => o.odp_id === odp.id && o.device_status === 'Offline'
                    );
                    return (
                      <button
                        key={`map-odp-${odp.id}`}
                        type="button"
                        onClick={(e) => {
                          if (pickMapTarget) return;
                          e.stopPropagation();
                          setSchematicPopupOntId(null);
                          setSelected({ kind: 'odp', id: odp.id });
                        }}
                        style={{ left: `${odp.map_x}%`, top: `${odp.map_y}%` }}
                        className={`absolute -translate-x-1/2 -translate-y-1/2 px-2 py-1 rounded border bg-white text-slate-900 text-[10px] font-mono font-bold flex items-center gap-1 shadow-xs transition-transform hover:scale-105 z-20 ${
                          isSelected
                            ? 'border-red-600 ring-2 ring-red-600/30'
                            : hasOffline
                              ? 'border-rose-500'
                              : 'border-sky-600'
                        }`}
                      >
                        <Box className="w-3 h-3 text-sky-700" />
                        <span>{odp.odp_code}</span>
                      </button>
                    );
                  })}

                  {/* Map Pins: Every Customer ONT (Anti-overlap beacons + directional labels + hover/click popup) */}
                  {filteredOnts.map((ont) => {
                    const pos = schematicDeoverlapped.positions[ont.id] ?? {
                      x: ont.map_x ?? 50,
                      y: ont.map_y ?? 75,
                    };
                    const placement = schematicDeoverlapped.labelPlacement[ont.id] ?? 'bottom';
                    const isSelected = selected?.kind === 'ont' && selected.id === ont.id;
                    const isHovered = hoveredSchematicOntId === ont.id;
                    const isPopupOpen = schematicPopupOntId === ont.id;
                    const dimmed = highlightedPath.active && !highlightedPath.ontIds.has(ont.id);
                    const meta = getOpticalStatusMeta(ont.device_status, ont.rx_power_dbm);
                    const shortCode = ont.device_id.replace('ONT-', '').replace('RTR-', '');
                    const firstName = ont.name.split(' ')[0];

                    const beaconRing =
                      ont.device_status === 'Offline'
                        ? 'bg-rose-600 ring-4 ring-rose-500/35 border-white'
                        : ont.device_status === 'Isolir'
                          ? 'bg-amber-500 ring-4 ring-amber-400/35 border-white'
                          : 'bg-emerald-600 ring-2 ring-emerald-400/35 border-white';

                    const zClass = isPopupOpen
                      ? 'z-40'
                      : isSelected || isHovered
                        ? 'z-30'
                        : ont.device_status === 'Offline'
                          ? 'z-20'
                          : 'z-10';

                    return (
                      <div
                        key={`map-ont-${ont.id}`}
                        style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
                        className={`absolute -translate-x-1/2 -translate-y-1/2 ${zClass} ${
                          dimmed ? 'opacity-40' : 'opacity-100'
                        }`}
                        onMouseEnter={() => setHoveredSchematicOntId(ont.id)}
                        onMouseLeave={() =>
                          setHoveredSchematicOntId((prev) => (prev === ont.id ? null : prev))
                        }
                      >
                        <button
                          type="button"
                          onClick={(e) => {
                            if (pickMapTarget) return;
                            e.stopPropagation();
                            setSelected({ kind: 'ont', id: ont.id });
                            setSchematicPopupOntId((prev) => (prev === ont.id ? null : ont.id));
                          }}
                          title={`${ont.device_id} (${ont.name}) - ${meta.statusLabel}`}
                          className="relative flex items-center justify-center focus:outline-none"
                        >
                          <span
                            className={`w-4 h-4 rounded-full border-2 shadow-sm flex items-center justify-center transition-transform ${beaconRing} ${
                              isSelected || isHovered ? 'scale-125' : ''
                            }`}
                          >
                            <span
                              className={`w-1.5 h-1.5 rounded-full bg-white ${
                                ont.device_status === 'Offline' ? 'animate-pulse' : ''
                              }`}
                            />
                          </span>

                          {/* Directional Label Callout */}
                          <div
                            className={`absolute ${getSchematicLabelOffsetClass(
                              placement
                            )} px-1.5 py-0.5 rounded border shadow-xs whitespace-nowrap text-left transition-transform ${
                              meta.markerBgClass
                            } ${meta.markerBorderClass} ${meta.markerTextClass} ${
                              isSelected ? 'ring-2 ring-red-600 scale-105' : ''
                            }`}
                          >
                            <div className="flex items-center gap-1 text-[10px] font-mono font-bold leading-tight">
                              <span>{shortCode}</span>
                              <span
                                className={`px-1 py-[1px] rounded-[3px] text-[8px] font-bold leading-none ${meta.tagBgClass}`}
                              >
                                {meta.shortTag}
                              </span>
                            </div>
                            {showTelemetryLabels && (
                              <div className="text-[9px] leading-tight mt-0.5 font-mono tabular-nums text-slate-600">
                                <span className="font-sans text-slate-700">{firstName}</span> ·{' '}
                                <span className={meta.tagTextClass}>{meta.opticalLabel}</span>
                              </div>
                            )}
                          </div>
                        </button>

                        {/* Hover Summary Popup */}
                        {isHovered && !isPopupOpen && !pickMapTarget && (
                          <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-5 w-56 p-2.5 rounded-md bg-slate-900 text-white text-[11px] shadow-xl border border-slate-700 pointer-events-none z-50">
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-mono font-bold">{ont.device_id}</span>
                              <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${meta.tagBgClass}`}>
                                {meta.shortTag}
                              </span>
                            </div>
                            <div className="font-medium text-slate-100 truncate mt-0.5">{ont.name}</div>
                            <div className="mt-1 space-y-0.5 text-[10px] font-mono text-slate-300 tabular-nums">
                              <div>Redaman: {meta.signalBadgeText}</div>
                              <div>
                                ODP: {ont.odp_code ? `${ont.odp_code} #${ont.odp_port ?? '?'}` : 'Direct'}
                              </div>
                            </div>
                          </div>
                        )}

                        {/* Click Quick-Action Popup */}
                        {isPopupOpen && !pickMapTarget && (
                          <div
                            onClick={(e) => e.stopPropagation()}
                            className={`absolute ${
                              pos.y < 36 ? 'top-full mt-4' : 'bottom-full mb-4'
                            } ${
                              pos.x > 74 ? 'right-0' : pos.x < 26 ? 'left-0' : 'left-1/2 -translate-x-1/2'
                            } w-64 p-3 rounded-lg bg-white text-slate-900 shadow-xl border border-slate-200 z-50 space-y-2`}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div>
                                <div className="font-mono text-xs font-bold text-slate-900">{ont.device_id}</div>
                                <div className="text-xs font-semibold text-slate-800">{ont.name}</div>
                              </div>
                              <div className="flex items-center gap-1">
                                <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${meta.tagBgClass}`}>
                                  {meta.shortTag}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => setSchematicPopupOntId(null)}
                                  className="p-0.5 text-slate-400 hover:text-slate-700 rounded"
                                >
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>

                            <div className="bg-slate-50 border border-slate-200 rounded p-2 space-y-1 text-[10px] font-mono tabular-nums">
                              <div className="flex justify-between gap-2">
                                <span className="text-slate-500">Status:</span>
                                <span className={`font-semibold ${meta.tagTextClass}`}>{meta.statusLabel}</span>
                              </div>
                              <div className="flex justify-between gap-2">
                                <span className="text-slate-500">Redaman:</span>
                                <span className={`font-semibold ${meta.tagTextClass}`}>{meta.signalBadgeText}</span>
                              </div>
                              <div className="flex justify-between gap-2">
                                <span className="text-slate-500">ODP Induk:</span>
                                <span className="text-slate-800">
                                  {ont.odp_code ? `${ont.odp_code} #${ont.odp_port ?? '?'}` : 'Direct'}
                                </span>
                              </div>
                            </div>

                            <div className="flex flex-wrap items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => {
                                  focusInspector({ kind: 'ont', id: ont.id });
                                  setSchematicPopupOntId(null);
                                }}
                                className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-slate-800 bg-slate-100 border border-slate-200 hover:bg-slate-200 rounded"
                              >
                                <Eye className="w-3 h-3" />
                                Inspeksi
                              </button>
                              {onOpenChat && (
                                <button
                                  type="button"
                                  onClick={() => onOpenChat(ont.id)}
                                  className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-emerald-800 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 rounded"
                                >
                                  <MessageCircle className="w-3 h-3" />
                                  Chat WA
                                </button>
                              )}
                              {onCreateTicket && !isReadOnly && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    onCreateTicket(buildTicketPrefill(ont));
                                    setSchematicPopupOntId(null);
                                  }}
                                  className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-red-700 bg-red-50 border border-red-200 hover:bg-red-100 rounded"
                                >
                                  <Ticket className="w-3 h-3" />
                                  Buat Tiket
                                </button>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {/* Live Preview Target Marker on Schematic Map */}
                  {activePreviewOnt && (
                    <div
                      style={{ left: `${activePreviewOnt.mapX}%`, top: `${activePreviewOnt.mapY}%` }}
                      className="absolute -translate-x-1/2 -translate-y-1/2 z-40 pointer-events-none"
                    >
                      <div className="w-6 h-6 rounded-full bg-blue-600/20 border-2 border-blue-600 flex items-center justify-center animate-pulse">
                        <Crosshair className="w-3.5 h-3.5 text-blue-700" />
                      </div>
                      <div className="absolute bottom-full mb-1.5 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded bg-blue-700 text-white text-[9px] font-mono whitespace-nowrap shadow">
                        Pratinjau {activePreviewOnt.mapPayload.deviceId.replace('ONT-', '')}
                        {activePreviewOnt.distanceMeters !== null
                          ? ` (~${activePreviewOnt.distanceMeters}m)`
                          : ''}
                      </div>
                    </div>
                  )}

                  {stagedInfraPreview && (
                    <div
                      style={{ left: `${stagedInfraPreview.mapX}%`, top: `${stagedInfraPreview.mapY}%` }}
                      className="absolute -translate-x-1/2 -translate-y-1/2 z-40 pointer-events-none"
                    >
                      <div className="w-6 h-6 rounded-full bg-red-600/20 border-2 border-red-600 flex items-center justify-center animate-pulse">
                        <Crosshair className="w-3.5 h-3.5 text-red-700" />
                      </div>
                      <div className="absolute bottom-full mb-1.5 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded bg-red-700 text-white text-[9px] font-mono whitespace-nowrap shadow">
                        Pratinjau {stagedInfraPreview.code}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Right 4 Columns: Integrated ONT / ODP / Node Inspector & Mapping Editor */}
          <div ref={inspectorRef} className="xl:col-span-4 bg-white border border-slate-200 rounded-lg overflow-hidden">
            {selectedOnt && editingOntForm ? (
              <div>
                <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 flex items-start justify-between gap-2">
                  <div>
                    <div className="font-mono text-sm font-bold text-slate-900">{selectedOnt.device_id}</div>
                    <div className="text-xs text-slate-600 mt-0.5">
                      {selectedOnt.name} ({selectedOnt.customer_code})
                    </div>
                  </div>
                  <DeviceStatusLabel status={selectedOnt.device_status} />
                </div>

                <div className="p-4 space-y-4">
                  {/* Live Telemetry Strip */}
                  <div className="grid grid-cols-2 gap-2.5 text-xs">
                    <div className="bg-slate-50 border border-slate-200 rounded p-2.5">
                      <div className="text-slate-500">IP &amp; Model</div>
                      <div className="font-mono font-semibold text-slate-900 mt-0.5">{selectedOnt.device_ip}</div>
                      <div className="text-[11px] text-slate-500 truncate">{selectedOnt.device_model}</div>
                    </div>
                    <div className="bg-slate-50 border border-slate-200 rounded p-2.5">
                      <div className="text-slate-500">Redaman Optik &amp; Ping</div>
                      <div className={`font-mono mt-0.5 ${getOpticalQualityText(selectedOnt.rx_power_dbm).colorClass}`}>
                        {selectedOnt.rx_power_dbm !== null ? `${selectedOnt.rx_power_dbm} dBm` : 'Ethernet'}
                      </div>
                      <div className="text-[11px] font-mono text-slate-500 tabular-nums">
                        {selectedOnt.latency_ms !== null ? `${selectedOnt.latency_ms} ms` : 'Timeout'} ·{' '}
                        {getOpticalQualityText(selectedOnt.rx_power_dbm).label}
                      </div>
                    </div>
                  </div>

                  {/* Quick Status Actions + Chat WA + Map Placement */}
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-[11px] font-medium text-slate-500">
                        {isReadOnly ? 'Aksi Inspeksi ONT' : 'Kontrol Status & Aksi Cepat ONT'}
                      </div>
                      {isReadOnly && <ReadOnlyBadge />}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {!isReadOnly && (
                        <>
                          {(['Online', 'Offline', 'Isolir'] as const).map((st) => (
                            <button
                              key={st}
                              type="button"
                              disabled={updatingStatus || selectedOnt.device_status === st}
                              onClick={() => void handleQuickOntStatus(selectedOnt, st)}
                              className={`px-2.5 py-1 text-xs font-medium rounded border transition-colors ${
                                selectedOnt.device_status === st
                                  ? 'bg-slate-900 text-white border-slate-900'
                                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                              }`}
                            >
                              {st}
                            </button>
                          ))}
                          <button
                            type="button"
                            onClick={() => {
                              setSubTab('peta');
                              setPickMapTarget({ kind: 'ont', id: selectedOnt.id });
                            }}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-red-700 bg-red-50 border border-red-200 hover:bg-red-100 rounded transition-colors"
                          >
                            <Crosshair className="w-3.5 h-3.5" />
                            Set Posisi di Peta
                          </button>
                        </>
                      )}
                      {onOpenChat && (
                        <button
                          type="button"
                          onClick={() => onOpenChat(selectedOnt.id)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-emerald-800 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 rounded transition-colors"
                        >
                          <MessageCircle className="w-3.5 h-3.5" />
                          Chat WA
                        </button>
                      )}
                      {onCreateTicket && !isReadOnly && (
                        <button
                          type="button"
                          onClick={() =>
                            onCreateTicket({
                              customer_id: selectedOnt.id,
                              source:
                                selectedOnt.device_status === 'Offline'
                                  ? 'Alarm NOC / Webhook'
                                  : 'Cek Lapangan',
                              category:
                                selectedOnt.rx_power_dbm !== null && selectedOnt.rx_power_dbm <= -29
                                  ? 'LOS / Optik Putus'
                                  : selectedOnt.rx_power_dbm !== null && selectedOnt.rx_power_dbm <= -25
                                    ? 'Redaman / Optik Lemah'
                                    : selectedOnt.device_status === 'Offline'
                                      ? 'Perangkat Mati / Adaptor'
                                      : 'Lainnya',
                              priority:
                                selectedOnt.device_status === 'Offline' &&
                                selectedOnt.rx_power_dbm !== null &&
                                selectedOnt.rx_power_dbm <= -29
                                  ? 'Kritis'
                                  : selectedOnt.device_status !== 'Online'
                                    ? 'Tinggi'
                                    : 'Normal',
                              issue_summary: `Gangguan pada ${selectedOnt.device_id} (${selectedOnt.odp_code || 'Tanpa ODP'}${selectedOnt.pon_port ? ` · ${selectedOnt.pon_port}` : ''}, status: ${selectedOnt.device_status}${selectedOnt.rx_power_dbm !== null ? `, redaman ${selectedOnt.rx_power_dbm.toFixed(1)} dBm` : ''})`,
                            })
                          }
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-red-700 bg-red-50 border border-red-200 hover:bg-red-100 rounded transition-colors"
                        >
                          <Ticket className="w-3.5 h-3.5" />
                          Buat Tiket
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Edit Mapping ONT Form */}
                  <form onSubmit={handleSaveOntMapping} className="pt-3 border-t border-slate-200 space-y-3">
                    <div className="text-xs font-semibold text-slate-900">
                      Integrasi Mapping Topologi ONT
                    </div>

                    <fieldset disabled={isReadOnly} className="space-y-3 disabled:opacity-75">
                      <div className="grid grid-cols-2 gap-2.5">
                        <div>
                          <label className="block text-[11px] font-medium text-slate-600 mb-1">
                            OLT / MikroTik Induk
                          </label>
                          <select
                            value={editingOntForm.node_id}
                            onChange={(e) => setEditingOntForm({ ...editingOntForm, node_id: e.target.value })}
                            className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded-md focus:outline-none focus:border-red-600"
                          >
                            <option value="">-- Belum Dipilih --</option>
                            {topology.nodes.map((n) => (
                              <option key={n.id} value={String(n.id)}>
                                {n.node_code} ({n.node_type})
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-[11px] font-medium text-slate-600 mb-1">
                            Port PON / Interface
                          </label>
                          <input
                            type="text"
                            value={editingOntForm.pon_port}
                            onChange={(e) => setEditingOntForm({ ...editingOntForm, pon_port: e.target.value })}
                            placeholder="GPON 0/1/1:1"
                            className="w-full px-2.5 py-1.5 text-xs font-mono border border-slate-200 rounded-md focus:outline-none focus:border-red-600"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-3 gap-2">
                        <div className="col-span-2">
                          <label className="block text-[11px] font-medium text-slate-600 mb-1">
                            Box ODP Splitter
                          </label>
                          <select
                            value={editingOntForm.odp_id}
                            onChange={(e) => {
                              const nextOdpId = e.target.value;
                              const chosenOdp = topology.odps.find((d) => String(d.id) === nextOdpId);
                              setEditingOntForm({
                                ...editingOntForm,
                                odp_id: nextOdpId,
                                node_id: chosenOdp?.node_id ? String(chosenOdp.node_id) : editingOntForm.node_id,
                              });
                            }}
                            className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded-md focus:outline-none focus:border-red-600"
                          >
                            <option value="">-- Direct / Tanpa ODP --</option>
                            {topology.odps.map((d) => (
                              <option key={d.id} value={String(d.id)}>
                                {d.odp_code} ({d.area_zone})
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-[11px] font-medium text-slate-600 mb-1">
                            Port ODP
                          </label>
                          <input
                            type="number"
                            min={1}
                            max={16}
                            value={editingOntForm.odp_port}
                            onChange={(e) => setEditingOntForm({ ...editingOntForm, odp_port: e.target.value })}
                            placeholder="1-8"
                            className="w-full px-2.5 py-1.5 text-xs font-mono border border-slate-200 rounded-md focus:outline-none focus:border-red-600"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-3 gap-2">
                        <div>
                          <label className="block text-[11px] font-medium text-slate-600 mb-1">
                            Kabel (m)
                          </label>
                          <input
                            type="number"
                            min={1}
                            value={editingOntForm.cable_length_m}
                            onChange={(e) => setEditingOntForm({ ...editingOntForm, cable_length_m: e.target.value })}
                            placeholder="85"
                            className="w-full px-2.5 py-1.5 text-xs font-mono border border-slate-200 rounded-md focus:outline-none focus:border-red-600"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] font-medium text-slate-600 mb-1">
                            RX (dBm)
                          </label>
                          <input
                            type="number"
                            step="0.1"
                            value={editingOntForm.rx_power_dbm}
                            onChange={(e) => setEditingOntForm({ ...editingOntForm, rx_power_dbm: e.target.value })}
                            placeholder="-19.5"
                            className="w-full px-2.5 py-1.5 text-xs font-mono border border-slate-200 rounded-md focus:outline-none focus:border-red-600"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] font-medium text-slate-600 mb-1">
                            PPPoE User
                          </label>
                          <input
                            type="text"
                            value={editingOntForm.pppoe_username}
                            onChange={(e) => setEditingOntForm({ ...editingOntForm, pppoe_username: e.target.value })}
                            className="w-full px-2.5 py-1.5 text-xs font-mono border border-slate-200 rounded-md focus:outline-none focus:border-red-600"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-[11px] font-medium text-slate-600 mb-1">
                            Latitude GPS
                          </label>
                          <input
                            type="text"
                            value={editingOntForm.latitude}
                            onChange={(e) => {
                              setStagedOntPreview(null);
                              setEditingOntForm({ ...editingOntForm, latitude: e.target.value });
                            }}
                            placeholder="-7.42412"
                            className="w-full px-2.5 py-1.5 text-xs font-mono border border-slate-200 rounded-md focus:outline-none focus:border-red-600"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] font-medium text-slate-600 mb-1">
                            Longitude GPS
                          </label>
                          <input
                            type="text"
                            value={editingOntForm.longitude}
                            onChange={(e) => {
                              setStagedOntPreview(null);
                              setEditingOntForm({ ...editingOntForm, longitude: e.target.value });
                            }}
                            placeholder="109.23920"
                            className="w-full px-2.5 py-1.5 text-xs font-mono border border-slate-200 rounded-md focus:outline-none focus:border-red-600"
                          />
                        </div>
                      </div>

                      {!isReadOnly && activePreviewOnt && (
                        <div className="p-2.5 rounded-md bg-blue-50 border border-blue-200 text-[11px] text-blue-950 space-y-1.5">
                          <div className="font-semibold flex items-center justify-between gap-2">
                            <span>Pratinjau Koordinat &amp; Jalur Dropcore</span>
                            <button
                              type="button"
                              onClick={handleResetStagedOntCoordinates}
                              className="text-[11px] font-medium text-blue-800 hover:underline"
                            >
                              Reset
                            </button>
                          </div>
                          <div className="text-blue-900">
                            {activePreviewOnt.distanceMeters !== null
                              ? `Estimasi jarak udara dari ${activePreviewOnt.odpCode}: ~${activePreviewOnt.distanceMeters} m.`
                              : `Jalur pratinjau dari ${activePreviewOnt.odpCode} ditampilkan di peta.`}{' '}
                            Klik <strong>Simpan Mapping ONT</strong> untuk menyimpan permanen.
                          </div>
                          {activePreviewOnt.distanceMeters !== null && activePreviewOnt.distanceMeters > 0 && (
                            <button
                              type="button"
                              onClick={() =>
                                setEditingOntForm({
                                  ...editingOntForm,
                                  cable_length_m: String(Math.max(10, Math.round(activePreviewOnt.distanceMeters! * 1.15))),
                                })
                              }
                              className="px-2 py-0.5 text-[10px] font-medium bg-white border border-blue-200 text-blue-800 rounded hover:bg-blue-100"
                            >
                              Pakai Estimasi Kabel (~{Math.max(10, Math.round(activePreviewOnt.distanceMeters * 1.15))} m)
                            </button>
                          )}
                        </div>
                      )}
                    </fieldset>

                    <div className="flex items-center justify-between gap-2 pt-1">
                      {editingOntForm.latitude && editingOntForm.longitude ? (
                        <a
                          href={`https://www.google.com/maps?q=${editingOntForm.latitude},${editingOntForm.longitude}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-red-700 hover:underline"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                          Buka Google Maps
                        </a>
                      ) : (
                        <span className="text-[11px] text-slate-400">Koordinat opsional</span>
                      )}

                      {!isReadOnly && (
                        <button
                          type="submit"
                          disabled={savingOnt}
                          className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium text-white bg-red-700 hover:bg-red-800 disabled:opacity-50 rounded-md transition-colors ${
                            activePreviewOnt ? 'ring-2 ring-blue-500 ring-offset-1' : ''
                          }`}
                        >
                          <Save className="w-3.5 h-3.5" />
                          {savingOnt ? 'Menyimpan...' : 'Simpan Mapping ONT'}
                        </button>
                      )}
                    </div>
                  </form>

                  {/* Recent Logs for Selected ONT */}
                  <div className="pt-3 border-t border-slate-200 space-y-2">
                    <div className="text-xs font-semibold text-slate-900">Riwayat Log ONT Ini</div>
                    {selectedOntLogs.length === 0 ? (
                      <div className="text-xs text-slate-500">Belum ada riwayat perubahan status terbaru.</div>
                    ) : (
                      <div className="space-y-2">
                        {selectedOntLogs.map((log) => (
                          <div key={log.id} className="text-[11px] border-b border-slate-100 pb-1.5 last:border-0">
                            <div className="flex items-center justify-between font-mono text-slate-600">
                              <span>
                                {log.previous_status} &rarr; <strong className="text-slate-900">{log.new_status}</strong>
                              </span>
                              <span>{formatDateTimeId(log.logged_at)}</span>
                            </div>
                            <div className="text-slate-600 mt-0.5">{log.reason || log.event_source}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ) : selectedOdp ? (
              <div>
                <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 flex items-start justify-between gap-2">
                  <div>
                    <div className="font-mono text-sm font-bold text-slate-900">{selectedOdp.odp_code}</div>
                    <div className="text-xs text-slate-600 mt-0.5">{selectedOdp.name}</div>
                  </div>
                  <span className="font-mono text-xs font-semibold text-slate-800 tabular-nums">
                    {selectedOdp.used_ports ?? 0}/{selectedOdp.capacity_ports} port
                  </span>
                </div>

                <div className="p-4 space-y-4">
                  <div className="grid grid-cols-2 gap-2.5 text-xs">
                    <div className="bg-slate-50 border border-slate-200 rounded p-2.5">
                      <div className="text-slate-500">Upstream OLT &amp; PON</div>
                      <div className="font-mono font-semibold text-slate-900 mt-0.5">
                        {selectedOdp.node_code || '—'}
                      </div>
                      <div className="font-mono text-[11px] text-slate-500">{selectedOdp.pon_port}</div>
                    </div>
                    <div className="bg-slate-50 border border-slate-200 rounded p-2.5">
                      <div className="text-slate-500">Cluster &amp; Splitter</div>
                      <div className="font-semibold text-slate-900 mt-0.5">{selectedOdp.area_zone}</div>
                      <div className="font-mono text-[11px] text-slate-500">Splitter {selectedOdp.splitter_ratio}</div>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {!isReadOnly && (
                      <>
                        <button
                          type="button"
                          onClick={() => openEditOdpModal(selectedOdp)}
                          className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-md"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                          Edit ODP
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setSubTab('peta');
                            setPickMapTarget({ kind: 'odp', id: selectedOdp.id });
                          }}
                          className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-red-700 bg-red-50 border border-red-200 hover:bg-red-100 rounded-md"
                        >
                          <Crosshair className="w-3.5 h-3.5" />
                          Set Posisi di Peta
                        </button>
                      </>
                    )}
                    {selectedOdp.latitude && selectedOdp.longitude && (
                      <a
                        href={`https://www.google.com/maps?q=${selectedOdp.latitude},${selectedOdp.longitude}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        Google Maps
                      </a>
                    )}
                  </div>

                  {selectedOdp.notes && (
                    <div className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded p-2.5">
                      {selectedOdp.notes}
                    </div>
                  )}

                  <div className="pt-3 border-t border-slate-200 space-y-2">
                    <div className="text-xs font-semibold text-slate-900">
                      Daftar ONT Terhubung ({selectedOdpOnts.length})
                    </div>
                    {selectedOdpOnts.length === 0 ? (
                      <div className="text-xs text-slate-500">Belum ada ONT yang terhubung ke ODP ini.</div>
                    ) : (
                      <div className="divide-y divide-slate-100 border border-slate-200 rounded-md">
                        {selectedOdpOnts.map((ont) => (
                          <button
                            key={ont.id}
                            type="button"
                            onClick={() => setSelected({ kind: 'ont', id: ont.id })}
                            className="w-full px-3 py-2 text-left hover:bg-slate-50 flex items-center justify-between gap-2 text-xs"
                          >
                            <div className="min-w-0">
                              <div className="font-mono font-semibold text-slate-900">
                                Port #{ont.odp_port ?? '?'} · {ont.device_id}
                              </div>
                              <div className="text-slate-600 truncate">{ont.name}</div>
                            </div>
                            <DeviceStatusLabel status={ont.device_status} />
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ) : selectedNode ? (
              <div>
                <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 flex items-start justify-between gap-2">
                  <div>
                    <div className="font-mono text-sm font-bold text-slate-900">{selectedNode.node_code}</div>
                    <div className="text-xs text-slate-600 mt-0.5">{selectedNode.name}</div>
                  </div>
                  <span
                    className={`text-xs font-medium ${
                      selectedNode.status === 'Online'
                        ? 'text-emerald-700'
                        : selectedNode.status === 'Degraded'
                          ? 'text-amber-700'
                          : 'text-rose-700'
                    }`}
                  >
                    {selectedNode.status}
                  </span>
                </div>

                <div className="p-4 space-y-4">
                  <div className="grid grid-cols-2 gap-2.5 text-xs">
                    <div className="bg-slate-50 border border-slate-200 rounded p-2.5">
                      <div className="text-slate-500">IP &amp; Protokol</div>
                      <div className="font-mono font-semibold text-slate-900 mt-0.5">{selectedNode.host_ip}</div>
                      <div className="text-[11px] text-slate-500">{selectedNode.api_protocol}</div>
                    </div>
                    <div className="bg-slate-50 border border-slate-200 rounded p-2.5">
                      <div className="text-slate-500">Resource &amp; Trafik</div>
                      <div className="font-mono font-semibold text-slate-900 mt-0.5 tabular-nums">
                        CPU {selectedNode.cpu_load_pct}% · RAM {selectedNode.memory_used_pct}%
                      </div>
                      <div className="font-mono text-[11px] text-slate-500 tabular-nums">
                        Rx {selectedNode.rx_throughput_mbps} Mbps · {selectedNode.active_sessions} sesi
                      </div>
                    </div>
                  </div>

                  {!isReadOnly ? (
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={syncingNodeId === selectedNode.id}
                        onClick={() => void handleSyncNode(selectedNode)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-red-700 hover:bg-red-800 disabled:opacity-50 rounded-md"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${syncingNodeId === selectedNode.id ? 'animate-spin' : ''}`} />
                        Sinkronkan API Node
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setSubTab('peta');
                          setPickMapTarget({ kind: 'node', id: selectedNode.id });
                        }}
                        className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-red-700 bg-red-50 border border-red-200 hover:bg-red-100 rounded-md"
                      >
                        <Crosshair className="w-3.5 h-3.5" />
                        Set Posisi di Peta
                      </button>
                    </div>
                  ) : (
                    <ReadOnlyBadge />
                  )}

                  <div className="pt-3 border-t border-slate-200 space-y-2 text-xs">
                    <div className="font-semibold text-slate-900 flex items-center gap-1.5">
                      <Cpu className="w-3.5 h-3.5 text-slate-500" />
                      ODP &amp; ONT di Bawah Node Ini
                    </div>
                    <div className="text-slate-600 font-mono tabular-nums">
                      {topology.odps.filter((d) => d.node_id === selectedNode.id).length} ODP ·{' '}
                      {topology.onts.filter((o) => o.node_id === selectedNode.id).length} ONT terhubung langsung
                    </div>
                    {selectedNode.last_sync_message && (
                      <div className="text-[11px] text-slate-500 bg-slate-50 border border-slate-200 rounded p-2.5">
                        {selectedNode.last_sync_message}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="p-8 text-center text-xs text-slate-500 space-y-2">
                <Activity className="w-6 h-6 text-slate-400 mx-auto" />
                <div className="font-medium text-slate-700">Pilih MikroTik, OLT, ODP, atau ONT</div>
                <p>Klik salah satu perangkat pada diagram topologi atau peta sebaran untuk melihat detail telemetry dan mengubah pemetaan.</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modal Tambah / Edit ODP Splitter */}
      {!isReadOnly && odpModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="bg-white border border-slate-200 rounded-lg w-full max-w-lg shadow-xl max-h-[92vh] overflow-y-auto">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-red-700" />
                <h3 className="text-base font-semibold text-slate-900">
                  {editingOdp ? `Edit ODP: ${editingOdp.odp_code}` : 'Tambah ODP / Splitter Baru'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setOdpModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-700 rounded"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveOdp} className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Kode ODP *</label>
                  <input
                    type="text"
                    required
                    value={odpForm.odp_code}
                    onChange={(e) => setOdpForm({ ...odpForm, odp_code: e.target.value })}
                    placeholder="ODP-GA-06"
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-md focus:outline-none focus:border-red-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Area / Cluster *</label>
                  <input
                    type="text"
                    required
                    value={odpForm.area_zone}
                    onChange={(e) => setOdpForm({ ...odpForm, area_zone: e.target.value })}
                    placeholder="Perum Graha Asri"
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-md focus:outline-none focus:border-red-600"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Nama / Lokasi Tiang ODP *</label>
                <input
                  type="text"
                  required
                  value={odpForm.name}
                  onChange={(e) => setOdpForm({ ...odpForm, name: e.target.value })}
                  placeholder="ODP Tiang Sudut Blok C"
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-md focus:outline-none focus:border-red-600"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Upstream OLT / MikroTik</label>
                  <select
                    value={odpForm.node_id}
                    onChange={(e) => setOdpForm({ ...odpForm, node_id: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-md focus:outline-none focus:border-red-600"
                  >
                    <option value="">-- Pilih Node Induk --</option>
                    {topology.nodes.map((n) => (
                      <option key={n.id} value={String(n.id)}>
                        {n.node_code} ({n.node_type})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Port PON OLT</label>
                  <input
                    type="text"
                    value={odpForm.pon_port}
                    onChange={(e) => setOdpForm({ ...odpForm, pon_port: e.target.value })}
                    placeholder="GPON 0/1/1"
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-md focus:outline-none focus:border-red-600"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Rasio Splitter</label>
                  <select
                    value={odpForm.splitter_ratio}
                    onChange={(e) => {
                      const ratio = e.target.value;
                      const cap = ratio === '1:16' ? '16' : ratio === '1:4' ? '4' : '8';
                      setOdpForm({ ...odpForm, splitter_ratio: ratio, capacity_ports: cap });
                    }}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-md focus:outline-none focus:border-red-600"
                  >
                    <option value="1:4">1:4 (4 Port)</option>
                    <option value="1:8">1:8 (8 Port)</option>
                    <option value="1:16">1:16 (16 Port)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Kapasitas Port</label>
                  <input
                    type="number"
                    min={1}
                    max={32}
                    value={odpForm.capacity_ports}
                    onChange={(e) => setOdpForm({ ...odpForm, capacity_ports: e.target.value })}
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-md focus:outline-none focus:border-red-600"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Latitude GPS</label>
                  <input
                    type="text"
                    value={odpForm.latitude}
                    onChange={(e) => setOdpForm({ ...odpForm, latitude: e.target.value })}
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-md focus:outline-none focus:border-red-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Longitude GPS</label>
                  <input
                    type="text"
                    value={odpForm.longitude}
                    onChange={(e) => setOdpForm({ ...odpForm, longitude: e.target.value })}
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-md focus:outline-none focus:border-red-600"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Catatan Teknis</label>
                <input
                  type="text"
                  value={odpForm.notes}
                  onChange={(e) => setOdpForm({ ...odpForm, notes: e.target.value })}
                  placeholder="Tiang PLN depan pos ronda..."
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-md focus:outline-none focus:border-red-600"
                />
              </div>

              <div className="pt-3 border-t border-slate-200 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setOdpModalOpen(false)}
                  className="px-4 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={savingOdp}
                  className="px-4 py-2 text-xs font-medium text-white bg-red-700 hover:bg-red-800 disabled:opacity-50 rounded-md"
                >
                  {savingOdp ? 'Menyimpan...' : 'Simpan ODP'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
