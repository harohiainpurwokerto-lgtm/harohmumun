import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import {
  Activity,
  AlertTriangle,
  Check,
  Copy,
  Cpu,
  Edit2,
  GitBranch,
  Plus,
  RefreshCw,
  Router,
  Send,
  Server,
  Terminal,
  Ticket,
  Trash2,
  Webhook,
  Wifi,
  WifiOff,
  ShieldAlert,
  X,
} from 'lucide-react';
import type {
  AuthUser,
  Customer,
  DeviceLog,
  DeviceStatus,
  NetworkNode,
  NetworkNodeStatus,
  NetworkNodeType,
  TicketCategory,
  TicketPrefillPayload,
  TicketPriority,
  WebhookEvent,
} from '../types';
import { formatDateTimeId } from '../utils/format';
import { apiFetch, canManageNetworkInfra } from '../utils/auth';
import { DeviceStatusLabel } from './StatusText';
import { ReadOnlyBadge, ReadOnlyBanner } from './ReadOnlyIndicator';

interface MonitoringWebhookViewProps {
  currentUser: AuthUser;
  networkNodes: NetworkNode[];
  devices: Customer[];
  deviceLogs: DeviceLog[];
  webhookEvents: WebhookEvent[];
  onRefresh: () => Promise<void>;
  onOpenMapping?: (customerId: number) => void;
  onCreateTicket?: (prefill: TicketPrefillPayload) => void;
  onNotify: (msg: string, type?: 'success' | 'error') => void;
}

function NodeStatusLabel({ status }: { status: NetworkNodeStatus }) {
  if (status === 'Online') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 whitespace-nowrap shrink-0">
        <Wifi className="w-3.5 h-3.5 text-emerald-600 shrink-0" aria-hidden="true" />
        <span>Online</span>
      </span>
    );
  }
  if (status === 'Degraded') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700 whitespace-nowrap shrink-0">
        <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" aria-hidden="true" />
        <span>Degraded</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-rose-700 whitespace-nowrap shrink-0">
      <WifiOff className="w-3.5 h-3.5 text-rose-600 shrink-0" aria-hidden="true" />
      <span>Offline</span>
    </span>
  );
}

export function MonitoringWebhookView({
  currentUser,
  networkNodes,
  devices,
  deviceLogs,
  webhookEvents,
  onRefresh,
  onOpenMapping,
  onCreateTicket,
  onNotify,
}: MonitoringWebhookViewProps) {
  const isReadOnly = !canManageNetworkInfra(currentUser);

  function buildNocTicketPrefill(
    customerId: number,
    deviceId: string,
    deviceStatus: DeviceStatus,
    rxPowerDbm: number | null,
    reasonText?: string | null
  ): TicketPrefillPayload {
    const lower = (reasonText ?? '').toLowerCase();
    let category: TicketCategory = 'Lainnya';
    if (lower.includes('los') || lower.includes('optik putus') || lower.includes('dropcore') || (rxPowerDbm !== null && rxPowerDbm <= -30)) {
      category = 'LOS / Optik Putus';
    } else if (lower.includes('adaptor') || lower.includes('timeout') || lower.includes('power') || lower.includes('mati') || lower.includes('listrik')) {
      category = 'Perangkat Mati / Adaptor';
    } else if (lower.includes('redaman') || (rxPowerDbm !== null && rxPowerDbm <= -25)) {
      category = 'Redaman / Optik Lemah';
    } else if (lower.includes('latency') || lower.includes('lambat')) {
      category = 'Koneksi Lambat / Latency';
    } else if (deviceStatus === 'Offline') {
      category = 'LOS / Optik Putus';
    }

    const priority: TicketPriority =
      category === 'LOS / Optik Putus' && deviceStatus === 'Offline'
        ? 'Kritis'
        : deviceStatus !== 'Online'
          ? 'Tinggi'
          : 'Normal';

    const summaryParts = [`Alarm NOC pada perangkat ${deviceId} (status: ${deviceStatus})`];
    if (rxPowerDbm !== null) {
      summaryParts.push(`redaman ${rxPowerDbm.toFixed(1)} dBm`);
    }
    const base = summaryParts.join(', ');
    return {
      customer_id: customerId,
      source: 'Alarm NOC / Webhook',
      category,
      priority,
      issue_summary: reasonText ? `${base} — ${reasonText}` : base,
    };
  }
  const [subTab, setSubTab] = useState<'nodes' | 'devices' | 'webhook'>('nodes');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [statusFilter, setStatusFilter] = useState<'all' | DeviceStatus>('all');
  const [nodeFilter, setNodeFilter] = useState<string>('all');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [syncingNodeId, setSyncingNodeId] = useState<number | null>(null);

  // Node Add/Edit Modal State
  const [nodeModalOpen, setNodeModalOpen] = useState(false);
  const [editingNode, setEditingNode] = useState<NetworkNode | null>(null);
  const [savingNode, setSavingNode] = useState(false);
  const [nodeForm, setNodeForm] = useState({
    node_code: '',
    name: '',
    node_type: 'MikroTik' as NetworkNodeType,
    vendor_model: 'MikroTik CCR1036-8G-2S+',
    host_ip: '',
    api_protocol: 'RouterOS REST API',
    api_port: '443',
    api_base_url: '',
    api_username: 'api_noc',
    api_secret: '',
    poll_interval_sec: '30',
    status: 'Online' as NetworkNodeStatus,
  });

  // Push Telemetry Test (MikroTik / OLT)
  const [pushNodeCode, setPushNodeCode] = useState(networkNodes[0]?.node_code ?? 'MK-CORE-01');
  const [pushCpu, setPushCpu] = useState('28');
  const [pushMem, setPushMem] = useState('41');
  const [pushTemp, setPushTemp] = useState('45');
  const [pushRxMbps, setPushRxMbps] = useState('438.5');
  const [pushTxMbps, setPushTxMbps] = useState('142.2');
  const [pushSessions, setPushSessions] = useState('10');
  const [pushingTelemetry, setPushingTelemetry] = useState(false);

  // Device Webhook Tester State
  const [testDeviceId, setTestDeviceId] = useState(devices[0]?.device_id ?? 'ONT-ZTE-001');
  const [testStatus, setTestStatus] = useState<DeviceStatus>('Offline');
  const [testReason, setTestReason] = useState('LOS (Loss of Signal) terdeteksi oleh OLT');
  const [testSource, setTestSource] = useState('MikroTik-Netwatch');
  const [testLatency, setTestLatency] = useState('');
  const [sendingWebhook, setSendingWebhook] = useState(false);
  const [lastWebhookResponse, setLastWebhookResponse] = useState<string | null>(null);

  useEffect(() => {
    if (!autoRefresh) return;
    const timer = setInterval(() => {
      void onRefresh();
    }, 6000);
    return () => clearInterval(timer);
  }, [autoRefresh, onRefresh]);

  useEffect(() => {
    if (networkNodes.length > 0 && !networkNodes.some((n) => n.node_code === pushNodeCode)) {
      setPushNodeCode(networkNodes[0].node_code);
    }
  }, [networkNodes, pushNodeCode]);

  const originUrl =
    typeof window !== 'undefined' ? window.location.origin : '';
  const deviceWebhookUrl = `${originUrl}/api/webhook/device-status`;
  const nodePushUrl = `${originUrl}/api/webhook/mikrotik-olt`;

  const onlineCount = devices.filter((d) => d.device_status === 'Online').length;
  const offlineCount = devices.filter((d) => d.device_status === 'Offline').length;
  const isolirCount = devices.filter((d) => d.device_status === 'Isolir').length;

  const mikrotikCount = networkNodes.filter((n) => n.node_type === 'MikroTik').length;
  const oltCount = networkNodes.filter((n) => n.node_type === 'OLT').length;
  const totalSessions = networkNodes.reduce((acc, n) => acc + n.active_sessions, 0);
  const totalRxMbps = networkNodes.reduce((acc, n) => acc + Number(n.rx_throughput_mbps || 0), 0);
  const lowOpticalAlerts = devices.filter(
    (d) => d.rx_power_dbm !== null && d.rx_power_dbm <= -27
  ).length;

  const filteredDevices = devices.filter((d) => {
    if (statusFilter !== 'all' && d.device_status !== statusFilter) return false;
    if (nodeFilter !== 'all' && String(d.node_id ?? '') !== nodeFilter) return false;
    return true;
  });

  function openAddNodeModal(defaultType: NetworkNodeType) {
    setEditingNode(null);
    setNodeForm({
      node_code: '',
      name: '',
      node_type: defaultType,
      vendor_model: defaultType === 'MikroTik' ? 'MikroTik RB4011iGS+' : 'ZTE ZXA10 C320 GPON',
      host_ip: defaultType === 'MikroTik' ? '103.145.22.5' : '10.10.0.4',
      api_protocol: defaultType === 'MikroTik' ? 'RouterOS REST API' : 'OLT HTTP / SNMP API',
      api_port: defaultType === 'MikroTik' ? '443' : '8080',
      api_base_url: defaultType === 'MikroTik' ? 'https://103.145.22.5/rest' : 'http://10.10.0.4:8080/api/v1',
      api_username: 'api_noc',
      api_secret: '',
      poll_interval_sec: '30',
      status: 'Online',
    });
    setNodeModalOpen(true);
  }

  function openEditNodeModal(node: NetworkNode) {
    setEditingNode(node);
    setNodeForm({
      node_code: node.node_code,
      name: node.name,
      node_type: node.node_type,
      vendor_model: node.vendor_model,
      host_ip: node.host_ip,
      api_protocol: node.api_protocol,
      api_port: String(node.api_port),
      api_base_url: node.api_base_url,
      api_username: node.api_username,
      api_secret: '',
      poll_interval_sec: String(node.poll_interval_sec),
      status: node.status,
    });
    setNodeModalOpen(true);
  }

  async function handleSaveNode(e: FormEvent) {
    e.preventDefault();
    setSavingNode(true);
    try {
      const payload = {
        ...nodeForm,
        api_port: Number(nodeForm.api_port),
        poll_interval_sec: Number(nodeForm.poll_interval_sec),
      };
      const url = editingNode ? `/api/network-nodes/${editingNode.id}` : '/api/network-nodes';
      const method = editingNode ? 'PUT' : 'POST';
      const res = await apiFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) {
        onNotify(json.error || 'Gagal menyimpan konfigurasi node.', 'error');
        return;
      }
      await onRefresh();
      setNodeModalOpen(false);
      onNotify(
        editingNode ? `Node ${editingNode.node_code} berhasil diperbarui.` : 'Node MikroTik/OLT baru berhasil ditambahkan.',
        'success'
      );
    } catch {
      onNotify('Gagal menghubungi server.', 'error');
    } finally {
      setSavingNode(false);
    }
  }

  async function handleDeleteNode(node: NetworkNode) {
    try {
      const res = await apiFetch(`/api/network-nodes/${node.id}`, { method: 'DELETE' });
      if (!res.ok) {
        onNotify('Gagal menghapus node.', 'error');
        return;
      }
      await onRefresh();
      onNotify(`Node ${node.node_code} dihapus.`, 'success');
    } catch {
      onNotify('Gagal menghapus node.', 'error');
    }
  }

  async function handleSyncNode(node: NetworkNode) {
    setSyncingNodeId(node.id);
    try {
      const res = await apiFetch(`/api/network-nodes/${node.id}/sync`, { method: 'POST' });
      const json = await res.json();
      await onRefresh();
      if (json.reachable) {
        onNotify(`Sinkronisasi API langsung dari ${node.node_code} berhasil.`, 'success');
      } else {
        onNotify(json.message || `Sinkronisasi status lokal ${node.node_code} selesai.`, 'success');
      }
    } catch {
      onNotify(`Gagal menyinkronkan API ${node.node_code}.`, 'error');
    } finally {
      setSyncingNodeId(null);
    }
  }

  async function handlePushNodeTelemetry(e: FormEvent) {
    e.preventDefault();
    setPushingTelemetry(true);
    try {
      const payload = {
        node_code: pushNodeCode,
        status: 'Online',
        cpu_load_pct: Number(pushCpu),
        memory_used_pct: Number(pushMem),
        temperature_c: Number(pushTemp),
        rx_throughput_mbps: Number(pushRxMbps),
        tx_throughput_mbps: Number(pushTxMbps),
        active_sessions: Number(pushSessions),
      };
      const res = await apiFetch('/api/webhook/mikrotik-olt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      await onRefresh();
      if (!res.ok) {
        onNotify(json.error || 'Gagal memproses push telemetry.', 'error');
        return;
      }
      onNotify(`Telemetry API untuk node ${pushNodeCode} berhasil diperbarui.`, 'success');
    } catch {
      onNotify('Gagal mengirim telemetry API.', 'error');
    } finally {
      setPushingTelemetry(false);
    }
  }

  async function handleManualStatusChange(device: Customer, newStatus: DeviceStatus) {
    if (device.device_status === newStatus) return;
    try {
      const reasonMap: Record<DeviceStatus, string> = {
        Online: 'Dipulihkan manual oleh operator NOC',
        Offline: 'Ditandai Offline oleh operator NOC',
        Isolir: 'Diisolir manual oleh operator NOC',
      };
      const res = await apiFetch(`/api/devices/${device.id}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus, reason: reasonMap[newStatus] }),
      });
      const json = await res.json();
      if (!res.ok) {
        onNotify(json.error || 'Gagal memperbarui status perangkat', 'error');
        return;
      }
      await onRefresh();
      onNotify(`Perangkat ${device.device_id} diubah menjadi ${newStatus}.`, 'success');
    } catch {
      onNotify('Terjadi kesalahan saat mengubah status perangkat.', 'error');
    }
  }

  async function handleSendTestWebhook(e: FormEvent) {
    e.preventDefault();
    setSendingWebhook(true);
    try {
      const payload = {
        device_id: testDeviceId.trim(),
        status: testStatus,
        reason: testReason.trim(),
        source: testSource.trim() || 'Webhook Simulator',
        latency_ms: testStatus === 'Online' && testLatency ? Number(testLatency) : null,
      };

      const res = await apiFetch('/api/webhook/device-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      setLastWebhookResponse(JSON.stringify(json, null, 2));
      await onRefresh();
      if (res.ok && json.processed_count > 0) {
        onNotify(`Webhook berhasil diproses untuk ${testDeviceId} (${testStatus}).`, 'success');
      } else {
        onNotify(json.results?.[0]?.message || json.error || 'Webhook gagal diproses.', 'error');
      }
    } catch {
      onNotify('Gagal mengirim permintaan webhook ke server.', 'error');
    } finally {
      setSendingWebhook(false);
    }
  }

  function handleCopy(key: string, text: string) {
    void navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1800);
  }

  const samplePayloadJson = JSON.stringify(
    {
      device_id: testDeviceId,
      status: testStatus,
      reason: testReason,
      source: testSource || 'MikroTik-Netwatch',
      latency_ms: testStatus === 'Online' && testLatency ? Number(testLatency) : null,
    },
    null,
    2
  );

  const curlSnippet = `curl -X POST "${deviceWebhookUrl}" \\
  -H "Content-Type: application/json" \\
  -d '{"device_id":"${testDeviceId}","status":"Offline","reason":"Ping timeout 5x","source":"MikroTik-Netwatch"}'`;

  const mikrotikNodeScript = `# MikroTik RouterOS Scheduler (Push CPU, RAM & PPPoE Active ke API setiap 1 menit)
:local cpu [/system resource get cpu-load]
:local totMem [/system resource get total-memory]
:local freeMem [/system resource get free-memory]
:local memPct ((($totMem - $freeMem) * 100) / $totMem)
:local pppCount [/ppp active print count-only]
:local upTime [/system resource get uptime]
/tool fetch url="${nodePushUrl}" http-method=post \\
  http-header-field="Content-Type:application/json" \\
  http-data="{\\"node_code\\":\\"${pushNodeCode}\\",\\"status\\":\\"Online\\",\\"cpu_load_pct\\":$cpu,\\"memory_used_pct\\":$memPct,\\"active_sessions\\":$pppCount,\\"uptime_text\\":\\"$upTime\\"}" \\
  keep-result=no`;

  const oltPushCurlSnippet = `curl -X POST "${nodePushUrl}" \\
  -H "Content-Type: application/json" \\
  -d '{"node_code":"OLT-ZTE-01","status":"Online","cpu_load_pct":18,"temperature_c":42,"rx_throughput_mbps":310.4,"active_sessions":8,"devices":[{"device_id":"ONT-ZTE-001","status":"Online","rx_power_dbm":-18.3,"pon_port":"GPON 0/1/1:1"}]}'`;

  return (
    <div className="space-y-5">
      {isReadOnly && (
        <ReadOnlyBanner
          description={`Peran ${currentUser.role} bersifat Lihat Saja pada modul Monitoring & Webhook. Pengelolaan node MikroTik/OLT serta aksi Isolir / Buka Isolir manual hanya dilakukan oleh Teknisi / Admin (isolir terbuka otomatis saat pelunasan tagihan).`}
        />
      )}

      {/* Sub-navigation & Live Refresh Controls */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="inline-flex flex-wrap items-center gap-1 p-1 bg-slate-200/70 rounded-lg">
          <button
            type="button"
            onClick={() => setSubTab('nodes')}
            className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
              subTab === 'nodes'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            MikroTik &amp; OLT (API) ({networkNodes.length})
          </button>
          <button
            type="button"
            onClick={() => setSubTab('devices')}
            className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
              subTab === 'devices'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Perangkat Pelanggan &amp; Log ({devices.length})
          </button>
          <button
            type="button"
            onClick={() => setSubTab('webhook')}
            className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
              subTab === 'webhook'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Penerima Webhook / API ({webhookEvents.length})
          </button>
        </div>

        <div className="flex items-center gap-3">
          <label className="inline-flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="rounded border-slate-300 text-red-700 focus:ring-red-600"
            />
            Auto-refresh 6 detik
          </label>
          <button
            type="button"
            onClick={() => void onRefresh()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-md transition-colors whitespace-nowrap shrink-0"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Segarkan
          </button>
        </div>
      </div>

      {/* KPI Summary Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-lg p-4 flex items-center justify-between">
          <div>
            <div className="text-xs text-slate-500">Node MikroTik &amp; OLT</div>
            <div className="mt-1 text-xl font-bold font-mono text-slate-900 tabular-nums">
              {mikrotikCount} MikroTik · {oltCount} OLT
            </div>
            <div className="mt-0.5 text-xs text-slate-500 tabular-nums">
              Total {totalSessions} sesi PPPoE / ONT aktif
            </div>
          </div>
          <Server className="w-5 h-5 text-red-700 shrink-0" aria-hidden="true" />
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-4 flex items-center justify-between">
          <div>
            <div className="text-xs text-slate-500">Total Trafik Download (Rx)</div>
            <div className="mt-1 text-xl font-bold font-mono text-slate-900 tabular-nums">
              {totalRxMbps.toFixed(1)} Mbps
            </div>
            <div className="mt-0.5 text-xs text-slate-500">Agregat dari seluruh gateway</div>
          </div>
          <Activity className="w-5 h-5 text-emerald-600 shrink-0" aria-hidden="true" />
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-4 flex items-center justify-between">
          <div>
            <div className="text-xs text-slate-500">Status Perangkat Pelanggan</div>
            <div className="mt-1 text-xl font-bold font-mono tabular-nums">
              <span className="text-emerald-700">{onlineCount}</span>
              <span className="text-slate-300 mx-1">/</span>
              <span className="text-rose-700">{offlineCount}</span>
              <span className="text-slate-300 mx-1">/</span>
              <span className="text-amber-700">{isolirCount}</span>
            </div>
            <div className="mt-0.5 text-xs text-slate-500">Online · Offline · Isolir</div>
          </div>
          <Router className="w-5 h-5 text-slate-400 shrink-0" aria-hidden="true" />
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-4 flex items-center justify-between">
          <div>
            <div className="text-xs text-slate-500">Peringatan Redaman Optik</div>
            <div className="mt-1 text-xl font-bold font-mono text-rose-700 tabular-nums">
              {lowOpticalAlerts} ONT
            </div>
            <div className="mt-0.5 text-xs text-slate-500">Sinyal lemah (&le; -27 dBm / LOS)</div>
          </div>
          <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" aria-hidden="true" />
        </div>
      </div>

      {subTab === 'nodes' && (
        <div className="space-y-6">
          {/* Network Nodes Table */}
          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-slate-900">
                  Integrasi API MikroTik RouterOS &amp; OLT (GPON / EPON)
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Pantau CPU, memori, suhu perangkat, trafik, jumlah sesi PPPoE/ONT, serta lakukan sinkronisasi API langsung atau via Push Agent.
                </p>
              </div>
              {!isReadOnly && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => openAddNodeModal('MikroTik')}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-red-700 hover:bg-red-800 rounded-md transition-colors whitespace-nowrap shrink-0"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Tambah MikroTik / OLT
                  </button>
                </div>
              )}
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                    <th className="py-2.5 px-4">Node &amp; Model</th>
                    <th className="py-2.5 px-4">Endpoint API &amp; Protokol</th>
                    <th className="py-2.5 px-4">Status</th>
                    <th className="py-2.5 px-4">Resource (CPU / RAM / Suhu)</th>
                    <th className="py-2.5 px-4">Trafik &amp; Sesi Aktif</th>
                    <th className="py-2.5 px-4">Sinkronisasi Terakhir</th>
                    {!isReadOnly && <th className="py-2.5 px-4 text-right">Aksi</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-sm">
                  {networkNodes.length === 0 ? (
                    <tr>
                      <td colSpan={isReadOnly ? 6 : 7} className="py-10 text-center text-slate-500 text-sm">
                        Belum ada node MikroTik atau OLT yang terhubung.
                      </td>
                    </tr>
                  ) : (
                    networkNodes.map((node) => (
                      <tr key={node.id} className="hover:bg-slate-50 transition-colors">
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-xs font-semibold text-red-700">
                              {node.node_code}
                            </span>
                            <span className="text-xs text-slate-400">·</span>
                            <span className="text-xs font-medium text-slate-600">{node.node_type}</span>
                          </div>
                          <div className="font-medium text-slate-900 mt-0.5">{node.name}</div>
                          <div className="text-xs text-slate-500">{node.vendor_model}</div>
                        </td>
                        <td className="py-3 px-4">
                          <div className="font-mono text-xs text-slate-800">
                            {node.host_ip}:{node.api_port}
                          </div>
                          <div className="text-xs text-slate-500">{node.api_protocol}</div>
                          <div className="font-mono text-[11px] text-slate-400 max-w-[220px] truncate" title={node.api_base_url}>
                            {node.api_base_url}
                          </div>
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap">
                          <NodeStatusLabel status={node.status} />
                          <div className="text-[11px] font-mono text-slate-400 mt-1">
                            Up: {node.uptime_text}
                          </div>
                        </td>
                        <td className="py-3 px-4 font-mono text-xs tabular-nums whitespace-nowrap">
                          <div className="text-slate-800">
                            CPU: <strong className={node.cpu_load_pct > 75 ? 'text-rose-700' : 'text-slate-900'}>{node.cpu_load_pct}%</strong>
                            {' · '}
                            RAM: <strong>{node.memory_used_pct}%</strong>
                          </div>
                          <div className="text-slate-500 mt-0.5">
                            Suhu: {node.temperature_c}°C
                          </div>
                        </td>
                        <td className="py-3 px-4 font-mono text-xs tabular-nums whitespace-nowrap">
                          <div className="text-slate-900">
                            Rx {Number(node.rx_throughput_mbps).toFixed(1)} · Tx {Number(node.tx_throughput_mbps).toFixed(1)} Mbps
                          </div>
                          <div className="text-slate-500 mt-0.5">
                            {node.active_sessions} {node.node_type === 'MikroTik' ? 'PPPoE aktif' : 'ONT terdaftar'}
                          </div>
                        </td>
                        <td className="py-3 px-4 max-w-xs">
                          <div className="font-mono text-[11px] text-slate-500 tabular-nums">
                            {formatDateTimeId(node.last_sync_at)}
                          </div>
                          <div className="text-[11px] text-slate-500 line-clamp-2 mt-0.5">
                            {node.last_sync_message || '—'}
                          </div>
                        </td>
                        {!isReadOnly && (
                          <td className="py-3 px-4 text-right whitespace-nowrap">
                            <div className="inline-flex items-center gap-1.5">
                              <button
                                type="button"
                                disabled={syncingNodeId === node.id}
                                onClick={() => void handleSyncNode(node)}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-red-700 border border-red-200 bg-red-50/70 hover:bg-red-100 disabled:opacity-50 rounded-md transition-colors"
                              >
                                <RefreshCw className={`w-3.5 h-3.5 ${syncingNodeId === node.id ? 'animate-spin' : ''}`} />
                                Sinkronkan
                              </button>
                              <button
                                type="button"
                                onClick={() => openEditNodeModal(node)}
                                title="Edit Konfigurasi API Node"
                                className="p-1.5 text-slate-500 hover:text-red-700 hover:bg-red-50 rounded transition-colors"
                              >
                                <Edit2 className="w-4 h-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() => void handleDeleteNode(node)}
                                title="Hapus Node"
                                className="p-1.5 text-slate-500 hover:text-rose-700 hover:bg-rose-50 rounded transition-colors"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </td>
                        )}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* MikroTik & OLT API Push Integration + Simulator */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            <div className="lg:col-span-6 bg-white border border-slate-200 rounded-lg p-5 space-y-4">
              <div className="flex items-center gap-2">
                <Terminal className="w-4 h-4 text-red-700" />
                <h3 className="text-sm font-semibold text-slate-900">
                  Skrip Integrasi Push API (MikroTik RouterOS &amp; OLT Agent)
                </h3>
              </div>
              <p className="text-xs text-slate-600">
                Jika MikroTik atau OLT berada di belakang NAT / IP lokal (tanpa IP publik), jalankan skrip penjadwalan berikut agar router mengirim metrik CPU, trafik, PPPoE, dan status ONT ke endpoint{' '}
                <span className="font-mono font-medium text-slate-800">POST /api/webhook/mikrotik-olt</span>.
              </p>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-slate-700">Skrip MikroTik RouterOS Scheduler</span>
                  <button
                    type="button"
                    onClick={() => handleCopy('mk-script', mikrotikNodeScript)}
                    className="inline-flex items-center gap-1 text-xs text-red-700 hover:underline"
                  >
                    {copiedKey === 'mk-script' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    {copiedKey === 'mk-script' ? 'Tersalin' : 'Salin Skrip'}
                  </button>
                </div>
                <pre className="p-3 bg-slate-900 text-slate-100 rounded-md text-[11px] font-mono overflow-x-auto leading-relaxed">
                  {mikrotikNodeScript}
                </pre>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-slate-700">Contoh Push Telemetry OLT &amp; Redaman Optik ONT</span>
                  <button
                    type="button"
                    onClick={() => handleCopy('olt-curl', oltPushCurlSnippet)}
                    className="inline-flex items-center gap-1 text-xs text-red-700 hover:underline"
                  >
                    {copiedKey === 'olt-curl' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    {copiedKey === 'olt-curl' ? 'Tersalin' : 'Salin cURL'}
                  </button>
                </div>
                <pre className="p-3 bg-slate-900 text-slate-100 rounded-md text-[11px] font-mono overflow-x-auto leading-relaxed">
                  {oltPushCurlSnippet}
                </pre>
              </div>
            </div>

            <div className="lg:col-span-6 bg-white border border-slate-200 rounded-lg p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Cpu className="w-4 h-4 text-red-700" />
                  <h3 className="text-sm font-semibold text-slate-900">
                    Uji Push Telemetry Node MikroTik / OLT
                  </h3>
                </div>
                {isReadOnly && <ReadOnlyBadge />}
              </div>
              <p className="text-xs text-slate-500">
                Simulasikan laporan metrik perangkat dari agen MikroTik atau OLT langsung ke API{' '}
                <span className="font-mono">/api/webhook/mikrotik-olt</span>.
              </p>

              <form onSubmit={handlePushNodeTelemetry} className="space-y-3">
                <fieldset disabled={isReadOnly} className="space-y-3 disabled:opacity-65">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Target Node</label>
                    <select
                      value={pushNodeCode}
                      onChange={(e) => setPushNodeCode(e.target.value)}
                      className="w-full px-3 py-2 text-xs font-mono border border-slate-200 rounded-md focus:outline-none focus:border-red-600"
                    >
                      {networkNodes.map((n) => (
                        <option key={n.id} value={n.node_code}>
                          {n.node_code} — {n.name} ({n.node_type})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">CPU Load (%)</label>
                      <input
                        type="number"
                        min={0}
                        max={100}
                        value={pushCpu}
                        onChange={(e) => setPushCpu(e.target.value)}
                        className="w-full px-3 py-1.5 text-xs font-mono border border-slate-200 rounded-md"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">RAM Used (%)</label>
                      <input
                        type="number"
                        min={0}
                        max={100}
                        value={pushMem}
                        onChange={(e) => setPushMem(e.target.value)}
                        className="w-full px-3 py-1.5 text-xs font-mono border border-slate-200 rounded-md"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">Suhu (°C)</label>
                      <input
                        type="number"
                        value={pushTemp}
                        onChange={(e) => setPushTemp(e.target.value)}
                        className="w-full px-3 py-1.5 text-xs font-mono border border-slate-200 rounded-md"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">Rx (Mbps)</label>
                      <input
                        type="number"
                        step="0.1"
                        value={pushRxMbps}
                        onChange={(e) => setPushRxMbps(e.target.value)}
                        className="w-full px-3 py-1.5 text-xs font-mono border border-slate-200 rounded-md"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">Tx (Mbps)</label>
                      <input
                        type="number"
                        step="0.1"
                        value={pushTxMbps}
                        onChange={(e) => setPushTxMbps(e.target.value)}
                        className="w-full px-3 py-1.5 text-xs font-mono border border-slate-200 rounded-md"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">Sesi / ONT Aktif</label>
                      <input
                        type="number"
                        min={0}
                        value={pushSessions}
                        onChange={(e) => setPushSessions(e.target.value)}
                        className="w-full px-3 py-1.5 text-xs font-mono border border-slate-200 rounded-md"
                      />
                    </div>
                  </div>
                </fieldset>

                {!isReadOnly && (
                  <div className="pt-2 flex justify-end">
                    <button
                      type="submit"
                      disabled={pushingTelemetry || networkNodes.length === 0}
                      className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-red-700 hover:bg-red-800 disabled:opacity-50 rounded-md transition-colors"
                    >
                      <Send className="w-3.5 h-3.5" />
                      {pushingTelemetry ? 'Mengirim...' : 'Kirim Telemetry API'}
                    </button>
                  </div>
                )}
              </form>
            </div>
          </div>
        </div>
      )}

      {subTab === 'devices' && (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
          {/* Device Status Table with OLT Optical & MikroTik PPPoE telemetry */}
          <div className="xl:col-span-8 bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="px-4 py-3.5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-slate-900">
                Perangkat Pelanggan (ONT Optik &amp; PPPoE Session)
              </h2>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={nodeFilter}
                  onChange={(e) => setNodeFilter(e.target.value)}
                  aria-label="Filter Node MikroTik atau OLT"
                  className="px-2.5 py-1 text-xs border border-slate-200 rounded-md bg-white"
                >
                  <option value="all">Semua Node</option>
                  {networkNodes.map((n) => (
                    <option key={n.id} value={String(n.id)}>
                      {n.node_code} ({n.node_type})
                    </option>
                  ))}
                </select>

                <div className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-md">
                  {(['all', 'Online', 'Offline', 'Isolir'] as const).map((st) => (
                    <button
                      key={st}
                      type="button"
                      onClick={() => setStatusFilter(st)}
                      className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                        statusFilter === st
                          ? 'bg-white text-slate-900 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {st === 'all' ? 'Semua' : st}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                    <th className="py-2.5 px-4">ID &amp; IP Perangkat</th>
                    <th className="py-2.5 px-4">Pelanggan &amp; PPPoE</th>
                    <th className="py-2.5 px-4">Node / Port PON</th>
                    <th className="py-2.5 px-4 text-right">Redaman / Latency</th>
                    <th className="py-2.5 px-4">Status</th>
                    <th className="py-2.5 px-4 text-right">Ubah Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-sm">
                  {filteredDevices.map((dev) => {
                    const lowRx = dev.rx_power_dbm !== null && dev.rx_power_dbm <= -27;
                    return (
                      <tr key={dev.id} className="hover:bg-slate-50 transition-colors">
                        <td className="py-2.5 px-4">
                          <div className="font-mono text-xs font-semibold text-slate-900">
                            {dev.device_id}
                          </div>
                          <div className="font-mono text-[11px] text-slate-500">
                            {dev.device_ip} · {dev.device_model}
                          </div>
                        </td>
                        <td className="py-2.5 px-4">
                          <div className="font-medium text-slate-800 text-xs">{dev.name}</div>
                          <div className="font-mono text-[11px] text-slate-500">
                            {dev.pppoe_username || dev.customer_code}
                          </div>
                        </td>
                        <td className="py-2.5 px-4">
                          <div className="font-mono text-xs text-slate-800">
                            {dev.node_code || '—'}
                            {dev.odp_code ? ` · ${dev.odp_code}` : ''}
                          </div>
                          <div className="font-mono text-[11px] text-slate-500">
                            {dev.pon_port || '—'}
                          </div>
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono text-xs tabular-nums whitespace-nowrap">
                          {dev.rx_power_dbm !== null ? (
                            <div className={lowRx ? 'text-rose-700 font-semibold' : 'text-slate-800'}>
                              {dev.rx_power_dbm.toFixed(1)} dBm
                            </div>
                          ) : (
                            <div className="text-slate-400">Ethernet</div>
                          )}
                          <div className="text-[11px] text-slate-500">
                            {dev.latency_ms !== null ? `${dev.latency_ms} ms` : 'Timeout'}
                            {dev.uptime_session ? ` · ${dev.uptime_session}` : ''}
                          </div>
                        </td>
                        <td className="py-2.5 px-4 whitespace-nowrap">
                          <DeviceStatusLabel status={dev.device_status} />
                        </td>
                        <td className="py-2.5 px-4 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-1">
                            {onCreateTicket && !isReadOnly && (
                              <button
                                type="button"
                                onClick={() =>
                                  onCreateTicket(
                                    buildNocTicketPrefill(
                                      dev.id,
                                      dev.device_id,
                                      dev.device_status,
                                      dev.rx_power_dbm,
                                      dev.uptime_session ? `Sesi terakhir: ${dev.uptime_session}` : null
                                    )
                                  )
                                }
                                title="Buat Tiket Gangguan dari Perangkat Ini"
                                className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-red-700 bg-red-50/70 border border-red-200 hover:bg-red-100 rounded transition-colors mr-1"
                              >
                                <Ticket className="w-3 h-3" />
                                Tiket
                              </button>
                            )}
                            {onOpenMapping && (
                              <button
                                type="button"
                                onClick={() => onOpenMapping(dev.id)}
                                title="Lihat Topologi & Mapping ONT"
                                className="p-1.5 text-slate-500 hover:text-red-700 hover:bg-red-50 rounded transition-colors mr-1"
                              >
                                <GitBranch className="w-3.5 h-3.5" />
                              </button>
                            )}
                            {!isReadOnly ? (
                              (['Online', 'Offline', 'Isolir'] as const).map((target) => (
                                <button
                                  key={target}
                                  type="button"
                                  disabled={dev.device_status === target}
                                  onClick={() => void handleManualStatusChange(dev, target)}
                                  className={`px-2 py-1 text-[11px] font-medium rounded border transition-colors ${
                                    dev.device_status === target
                                      ? 'border-slate-200 bg-slate-100 text-slate-400 cursor-default'
                                      : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
                                  }`}
                                >
                                  {target}
                                </button>
                              ))
                            ) : (
                              <span className="text-[11px] text-slate-400">Lihat Saja</span>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Disconnect History Log */}
          <div className="xl:col-span-4 bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="px-4 py-3.5 border-b border-slate-200">
              <h2 className="text-sm font-semibold text-slate-900">
                Log Riwayat Disconnect &amp; Status
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Rekaman kronologis dari OLT, MikroTik &amp; operator
              </p>
            </div>

            <div className="divide-y divide-slate-100 max-h-[540px] overflow-y-auto">
              {deviceLogs.length === 0 ? (
                <div className="py-10 text-center text-sm text-slate-500">
                  Belum ada log perubahan status perangkat.
                </div>
              ) : (
                deviceLogs.map((log) => (
                  <div key={log.id} className="p-4 hover:bg-slate-50/70 transition-colors">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 text-xs">
                        <span className="font-mono font-semibold text-slate-900">{log.device_id}</span>
                        <span aria-hidden="true" className="text-slate-300">·</span>
                        <span className="text-slate-700 font-medium">{log.customer_name}</span>
                      </div>
                      <DeviceStatusLabel status={log.new_status} />
                    </div>
                    <p className="text-xs text-slate-600 mt-1.5">
                      {log.reason || 'Perubahan status koneksi perangkat'}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono text-slate-400 tabular-nums">
                        <span>{formatDateTimeId(log.logged_at)}</span>
                        <span aria-hidden="true">·</span>
                        <span>
                          {log.previous_status} -&gt; {log.new_status}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>{log.event_source}</span>
                        {log.latency_ms !== null && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>{log.latency_ms} ms</span>
                          </>
                        )}
                      </div>
                      {onCreateTicket && !isReadOnly && (
                        <button
                          type="button"
                          onClick={() => {
                            const matchedDevice = devices.find((d) => d.id === log.customer_id);
                            onCreateTicket(
                              buildNocTicketPrefill(
                                log.customer_id,
                                log.device_id,
                                log.new_status,
                                matchedDevice?.rx_power_dbm ?? null,
                                log.reason
                              )
                            );
                          }}
                          className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium text-red-700 bg-red-50/70 border border-red-200 hover:bg-red-100 rounded transition-colors whitespace-nowrap shrink-0"
                        >
                          <Ticket className="w-3 h-3" />
                          Buat Tiket
                        </button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {subTab === 'webhook' && (
        /* Halaman Khusus Penerima Webhook / API */
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            <div className="lg:col-span-6 bg-white border border-slate-200 rounded-lg p-5 space-y-4">
              <div className="flex items-center gap-2.5">
                <Webhook className="w-5 h-5 text-red-700 shrink-0" />
                <div>
                  <h2 className="text-base font-semibold text-slate-900">
                    Endpoint Penerima Webhook Status Perangkat
                  </h2>
                  <p className="text-xs text-slate-500">
                    Menerima laporan otomatis status ONT/Router dari MikroTik Netwatch, OLT, atau skrip pemantau.
                  </p>
                </div>
              </div>

              <div className="bg-slate-50 border border-slate-200 rounded-md p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-semibold text-slate-600">POST Endpoint Perangkat</span>
                  <button
                    type="button"
                    onClick={() => handleCopy('url', deviceWebhookUrl)}
                    className="inline-flex items-center gap-1 text-xs text-red-700 hover:underline"
                  >
                    {copiedKey === 'url' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    {copiedKey === 'url' ? 'Tersalin' : 'Salin URL'}
                  </button>
                </div>
                <div className="font-mono text-xs text-slate-900 break-all bg-white border border-slate-200 rounded px-2.5 py-2">
                  POST {deviceWebhookUrl}
                </div>
              </div>

              <div className="bg-slate-50 border border-slate-200 rounded-md p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-semibold text-slate-600">POST Endpoint Node MikroTik &amp; OLT</span>
                  <button
                    type="button"
                    onClick={() => handleCopy('node-url', nodePushUrl)}
                    className="inline-flex items-center gap-1 text-xs text-red-700 hover:underline"
                  >
                    {copiedKey === 'node-url' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    {copiedKey === 'node-url' ? 'Tersalin' : 'Salin URL'}
                  </button>
                </div>
                <div className="font-mono text-xs text-slate-900 break-all bg-white border border-slate-200 rounded px-2.5 py-2">
                  POST {nodePushUrl}
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                    <Terminal className="w-3.5 h-3.5 text-slate-500" />
                    Contoh Permintaan cURL Status Perangkat
                  </span>
                  <button
                    type="button"
                    onClick={() => handleCopy('curl', curlSnippet)}
                    className="inline-flex items-center gap-1 text-xs text-red-700 hover:underline"
                  >
                    {copiedKey === 'curl' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    {copiedKey === 'curl' ? 'Tersalin' : 'Salin cURL'}
                  </button>
                </div>
                <pre className="p-3 bg-slate-900 text-slate-100 rounded-md text-[11px] font-mono overflow-x-auto leading-relaxed">
                  {curlSnippet}
                </pre>
              </div>
            </div>

            <div className="lg:col-span-6 bg-white border border-slate-200 rounded-lg p-5 space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h2 className="text-base font-semibold text-slate-900">
                    Uji Kirim Laporan Webhook Langsung
                  </h2>
                  <p className="text-xs text-slate-500">
                    Kirim payload JSON nyata ke <span className="font-mono">/api/webhook/device-status</span> dan lihat pembaruan otomatis di database.
                  </p>
                </div>
                {isReadOnly && <ReadOnlyBadge />}
              </div>

              <form onSubmit={handleSendTestWebhook} className="space-y-3.5">
                <fieldset disabled={isReadOnly} className="space-y-3.5 disabled:opacity-65">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        Target Perangkat (device_id)
                      </label>
                      <select
                        value={testDeviceId}
                        onChange={(e) => setTestDeviceId(e.target.value)}
                        className="w-full px-3 py-2 text-xs font-mono border border-slate-200 rounded-md focus:outline-none focus:border-red-600"
                      >
                        {devices.map((d) => (
                          <option key={d.id} value={d.device_id}>
                            {d.device_id} ({d.name})
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        Status Dilaporkan
                      </label>
                      <select
                        value={testStatus}
                        onChange={(e) => setTestStatus(e.target.value as DeviceStatus)}
                        className="w-full px-3 py-2 text-xs border border-slate-200 rounded-md focus:outline-none focus:border-red-600"
                      >
                        <option value="Offline">Offline (Disconnect)</option>
                        <option value="Online">Online (Terhubung)</option>
                        <option value="Isolir">Isolir (Suspend)</option>
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        Sumber Agen / Router
                      </label>
                      <input
                        type="text"
                        value={testSource}
                        onChange={(e) => setTestSource(e.target.value)}
                        placeholder="MikroTik-Netwatch / OLT-ZTE"
                        className="w-full px-3 py-2 text-xs border border-slate-200 rounded-md focus:outline-none focus:border-red-600"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        Latency ms (jika Online)
                      </label>
                      <input
                        type="number"
                        value={testLatency}
                        onChange={(e) => setTestLatency(e.target.value)}
                        placeholder="Opsional, misal 6"
                        className="w-full px-3 py-2 text-xs font-mono border border-slate-200 rounded-md focus:outline-none focus:border-red-600"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Alasan / Pesan Diagnostik
                    </label>
                    <input
                      type="text"
                      value={testReason}
                      onChange={(e) => setTestReason(e.target.value)}
                      placeholder="Contoh: Redaman optik putus / Ping timeout"
                      className="w-full px-3 py-2 text-xs border border-slate-200 rounded-md focus:outline-none focus:border-red-600"
                    />
                  </div>
                </fieldset>

                <div>
                  <div className="text-[11px] font-medium text-slate-500 mb-1">Preview JSON Payload:</div>
                  <pre className="p-2.5 bg-slate-50 border border-slate-200 rounded-md text-[11px] font-mono text-slate-700 overflow-x-auto">
                    {samplePayloadJson}
                  </pre>
                </div>

                {!isReadOnly && (
                  <div className="flex items-center justify-end">
                    <button
                      type="submit"
                      disabled={sendingWebhook}
                      className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-red-700 hover:bg-red-800 disabled:opacity-50 rounded-md transition-colors"
                    >
                      <Send className="w-3.5 h-3.5" />
                      {sendingWebhook ? 'Mengirim...' : 'Kirim Webhook ke Server'}
                    </button>
                  </div>
                )}
              </form>

              {lastWebhookResponse && (
                <div className="pt-3 border-t border-slate-100">
                  <div className="text-[11px] font-semibold text-slate-600 mb-1">Respons Server Terakhir:</div>
                  <pre className="p-2.5 bg-slate-900 text-emerald-300 rounded-md text-[11px] font-mono overflow-x-auto">
                    {lastWebhookResponse}
                  </pre>
                </div>
              )}
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200">
              <h2 className="text-sm font-semibold text-slate-900">
                Log Permintaan Webhook Masuk (Realtime Receiver Log)
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Mencatat seluruh permintaan masuk ke <span className="font-mono">/api/webhook/device-status</span> dan <span className="font-mono">/api/webhook/mikrotik-olt</span>
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                    <th className="py-2.5 px-4">Waktu Diterima</th>
                    <th className="py-2.5 px-4">Endpoint &amp; HTTP</th>
                    <th className="py-2.5 px-4">Perangkat / Node</th>
                    <th className="py-2.5 px-4">Status</th>
                    <th className="py-2.5 px-4">Hasil Pemrosesan</th>
                    <th className="py-2.5 px-4">Payload JSON</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {webhookEvents.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-10 text-center text-slate-500">
                        Belum ada event webhook diterima.
                      </td>
                    </tr>
                  ) : (
                    webhookEvents.map((ev) => (
                      <tr key={ev.id} className="hover:bg-slate-50">
                        <td className="py-2.5 px-4 font-mono text-slate-600 tabular-nums whitespace-nowrap">
                          {formatDateTimeId(ev.received_at)}
                        </td>
                        <td className="py-2.5 px-4 font-mono whitespace-nowrap">
                          <span className={ev.http_status === 200 ? 'text-emerald-700 font-semibold' : 'text-rose-700 font-semibold'}>
                            {ev.http_status}
                          </span>
                          <span className="text-slate-400 ml-1.5">{ev.endpoint}</span>
                        </td>
                        <td className="py-2.5 px-4 font-mono text-slate-800 whitespace-nowrap">
                          {ev.device_id || ev.device_ip || '—'}
                        </td>
                        <td className="py-2.5 px-4 whitespace-nowrap">
                          {ev.reported_status === 'Online' ||
                          ev.reported_status === 'Offline' ||
                          ev.reported_status === 'Isolir' ? (
                            <DeviceStatusLabel status={ev.reported_status} />
                          ) : (
                            <span className="text-slate-500">{ev.reported_status || '—'}</span>
                          )}
                        </td>
                        <td className="py-2.5 px-4 text-slate-700 max-w-sm">
                          {ev.message}
                        </td>
                        <td className="py-2.5 px-4 font-mono text-[11px] text-slate-500 max-w-xs truncate" title={ev.payload_json}>
                          {ev.payload_json}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Modal Tambah / Edit Node MikroTik & OLT */}
      {!isReadOnly && nodeModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="bg-white border border-slate-200 rounded-lg w-full max-w-2xl max-h-[92vh] overflow-y-auto shadow-xl">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-900">
                {editingNode ? `Edit Konfigurasi API: ${editingNode.node_code}` : 'Tambah Node MikroTik / OLT (API)'}
              </h3>
              <button
                type="button"
                onClick={() => setNodeModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-700 rounded"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveNode} className="p-5 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Tipe Perangkat *</label>
                  <select
                    value={nodeForm.node_type}
                    onChange={(e) => {
                      const nextType = e.target.value as NetworkNodeType;
                      setNodeForm({
                        ...nodeForm,
                        node_type: nextType,
                        api_protocol: nextType === 'MikroTik' ? 'RouterOS REST API' : 'OLT HTTP / SNMP API',
                        api_port: nextType === 'MikroTik' ? '443' : '8080',
                      });
                    }}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-md"
                  >
                    <option value="MikroTik">MikroTik RouterOS</option>
                    <option value="OLT">OLT (GPON / EPON)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Kode Node</label>
                  <input
                    type="text"
                    value={nodeForm.node_code}
                    disabled={Boolean(editingNode)}
                    onChange={(e) => setNodeForm({ ...nodeForm, node_code: e.target.value })}
                    placeholder="Otomatis jika kosong"
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-md disabled:bg-slate-50"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Status Awal</label>
                  <select
                    value={nodeForm.status}
                    onChange={(e) => setNodeForm({ ...nodeForm, status: e.target.value as NetworkNodeStatus })}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-md"
                  >
                    <option value="Online">Online</option>
                    <option value="Degraded">Degraded</option>
                    <option value="Offline">Offline</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Nama Node *</label>
                  <input
                    type="text"
                    required
                    value={nodeForm.name}
                    onChange={(e) => setNodeForm({ ...nodeForm, name: e.target.value })}
                    placeholder="Contoh: MikroTik Distribusi Timur"
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-md"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Vendor / Model Perangkat</label>
                  <input
                    type="text"
                    value={nodeForm.vendor_model}
                    onChange={(e) => setNodeForm({ ...nodeForm, vendor_model: e.target.value })}
                    placeholder="MikroTik RB4011 / ZTE C320"
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-md"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">IP Host / Management *</label>
                  <input
                    type="text"
                    required
                    value={nodeForm.host_ip}
                    onChange={(e) => setNodeForm({ ...nodeForm, host_ip: e.target.value })}
                    placeholder="103.145.22.5"
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-md"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Protokol API</label>
                  <select
                    value={nodeForm.api_protocol}
                    onChange={(e) => setNodeForm({ ...nodeForm, api_protocol: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-md"
                  >
                    <option value="RouterOS REST API">RouterOS REST API (HTTPS)</option>
                    <option value="RouterOS API (8728)">RouterOS API (8728)</option>
                    <option value="OLT HTTP / SNMP API">OLT HTTP / SNMP API</option>
                    <option value="GenieACS / TR-069">GenieACS / TR-069</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Port API</label>
                  <input
                    type="number"
                    value={nodeForm.api_port}
                    onChange={(e) => setNodeForm({ ...nodeForm, api_port: e.target.value })}
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-md"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Base URL Endpoint API *</label>
                <input
                  type="text"
                  required
                  value={nodeForm.api_base_url}
                  onChange={(e) => setNodeForm({ ...nodeForm, api_base_url: e.target.value })}
                  placeholder="https://103.145.22.5/rest"
                  className="w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-md"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Username API</label>
                  <input
                    type="text"
                    value={nodeForm.api_username}
                    onChange={(e) => setNodeForm({ ...nodeForm, api_username: e.target.value })}
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-md"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    {editingNode ? 'Token / Password Baru (opsional)' : 'Password / API Key'}
                  </label>
                  <input
                    type="password"
                    value={nodeForm.api_secret}
                    onChange={(e) => setNodeForm({ ...nodeForm, api_secret: e.target.value })}
                    placeholder={editingNode ? 'Biarkan kosong jika tetap' : 'Token API'}
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-md"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Interval Polling (detik)</label>
                  <input
                    type="number"
                    min={10}
                    value={nodeForm.poll_interval_sec}
                    onChange={(e) => setNodeForm({ ...nodeForm, poll_interval_sec: e.target.value })}
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-md"
                  />
                </div>
              </div>

              <div className="pt-4 border-t border-slate-200 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setNodeModalOpen(false)}
                  className="px-4 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={savingNode}
                  className="px-4 py-2 text-xs font-medium text-white bg-red-700 hover:bg-red-800 disabled:opacity-50 rounded-md"
                >
                  {savingNode ? 'Menyimpan...' : 'Simpan Konfigurasi'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
