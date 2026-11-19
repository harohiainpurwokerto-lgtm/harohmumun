import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Edit2,
  Filter,
  GitBranch,
  History,
  MessageCircle,
  Plus,
  RefreshCw,
  Search,
  Ticket,
  Trash2,
  UserCheck,
  Wrench,
  X,
} from 'lucide-react';
import type {
  AuthUser,
  TicketAssigneeOption,
  TicketCategory,
  TicketCustomerOption,
  TicketCustomerRecurrence,
  TicketOdpRecurrence,
  TicketPrefillPayload,
  TicketPriority,
  TicketSource,
  TicketStatus,
  TicketsListResponse,
  TroubleTicket,
} from '../types';
import {
  apiFetch,
  canDeleteTroubleTicket,
  canManageTroubleTickets,
} from '../utils/auth';
import { formatDateTimeWib } from '../utils/format';
import { DeviceStatusLabel } from './StatusText';
import { ReadOnlyBadge, ReadOnlyBanner } from './ReadOnlyIndicator';

interface TicketsViewProps {
  currentUser: AuthUser;
  prefillRequest?: TicketPrefillPayload | null;
  onClearPrefill?: () => void;
  onOpenChat?: (customerId: number) => void;
  onOpenMapping?: (customerId: number) => void;
  onNotify: (msg: string, type?: 'success' | 'error') => void;
}

const TICKET_SOURCES: TicketSource[] = [
  'WA Pelanggan',
  'Alarm NOC / Webhook',
  'Cek Lapangan',
  'Manual Admin',
];

const TICKET_CATEGORIES: TicketCategory[] = [
  'LOS / Optik Putus',
  'Redaman / Optik Lemah',
  'Perangkat Mati / Adaptor',
  'Koneksi Lambat / Latency',
  'Lainnya',
];

const TICKET_PRIORITIES: Array<{ value: TicketPriority; label: string; hint: string }> = [
  { value: 'Kritis', label: 'Kritis', hint: 'LOS / Cluster Down' },
  { value: 'Tinggi', label: 'Tinggi', hint: 'Isolir / Gangguan Aktif' },
  { value: 'Normal', label: 'Normal', hint: 'Reguler / Non-Darurat' },
];

const TICKET_STATUSES: Array<{ value: TicketStatus; label: string }> = [
  { value: 'Open', label: 'Terbuka (Open)' },
  { value: 'In Progress', label: 'Dalam Penanganan (In Progress)' },
  { value: 'Menunggu Konfirmasi', label: 'Menunggu Konfirmasi' },
  { value: 'Resolved', label: 'Selesai (Resolved)' },
];

const FIELD_NOTE_SNIPPETS = [
  'Ganti patchcord SC-APC di ODP / modem',
  'Sambung ulang kabel dropcore & cek redaman',
  'Cek / ganti adaptor DC 12V ONT pelanggan',
  'Restart port OLT & verifikasi PPPoE normal',
];

function TicketPriorityBadge({ priority }: { priority: TicketPriority }) {
  const styles =
    priority === 'Kritis'
      ? 'bg-rose-50 text-rose-800 border-rose-200'
      : priority === 'Tinggi'
        ? 'bg-amber-50 text-amber-800 border-amber-200'
        : 'bg-slate-50 text-slate-700 border-slate-200';
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 text-[11px] font-semibold rounded border whitespace-nowrap shrink-0 ${styles}`}
    >
      {priority}
    </span>
  );
}

function TicketStatusBadge({ status }: { status: TicketStatus }) {
  if (status === 'Resolved') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium rounded border bg-emerald-50 text-emerald-800 border-emerald-200 whitespace-nowrap shrink-0">
        <CheckCircle2 className="w-3 h-3 shrink-0" aria-hidden="true" />
        Selesai (Resolved)
      </span>
    );
  }
  if (status === 'In Progress') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium rounded border bg-amber-50 text-amber-800 border-amber-200 whitespace-nowrap shrink-0">
        <Wrench className="w-3 h-3 shrink-0" aria-hidden="true" />
        Dalam Penanganan
      </span>
    );
  }
  if (status === 'Menunggu Konfirmasi') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium rounded border bg-sky-50 text-sky-800 border-sky-200 whitespace-nowrap shrink-0">
        <Clock className="w-3 h-3 shrink-0" aria-hidden="true" />
        Menunggu Konfirmasi
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium rounded border bg-rose-50 text-rose-800 border-rose-200 whitespace-nowrap shrink-0">
      <AlertTriangle className="w-3 h-3 shrink-0" aria-hidden="true" />
      Terbuka (Open)
    </span>
  );
}

export function TicketsView({
  currentUser,
  prefillRequest,
  onClearPrefill,
  onOpenChat,
  onOpenMapping,
  onNotify,
}: TicketsViewProps) {
  const canManage = canManageTroubleTickets(currentUser);
  const canDelete = canDeleteTroubleTicket(currentUser);

  const [subTab, setSubTab] = useState<'list' | 'recurrence'>('list');
  const [loading, setLoading] = useState(true);
  const [tickets, setTickets] = useState<TroubleTicket[]>([]);
  const [assignees, setAssignees] = useState<TicketAssigneeOption[]>([]);
  const [customerOptions, setCustomerOptions] = useState<TicketCustomerOption[]>([]);
  const [customerRecurrence, setCustomerRecurrence] = useState<TicketCustomerRecurrence[]>([]);
  const [odpRecurrence, setOdpRecurrence] = useState<TicketOdpRecurrence[]>([]);
  const [summary, setSummary] = useState<TicketsListResponse['summary']>({
    total_count: 0,
    open_count: 0,
    in_progress_count: 0,
    waiting_count: 0,
    resolved_count: 0,
    critical_open_count: 0,
    recurring_customers_count: 0,
    recurring_odps_count: 0,
  });

  // Filters
  const [statusFilter, setStatusFilter] = useState<'all' | TicketStatus>('all');
  const [priorityFilter, setPriorityFilter] = useState<'all' | TicketPriority>('all');
  const [categoryFilter, setCategoryFilter] = useState<'all' | TicketCategory>('all');
  const [customerFilterId, setCustomerFilterId] = useState<number | null>(null);
  const [odpFilterId, setOdpFilterId] = useState<number | null>(null);
  const [contextFilterLabel, setContextFilterLabel] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  // Create Modal
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createForm, setCreateForm] = useState<{
    customer_id: string;
    source: TicketSource;
    category: TicketCategory;
    priority: TicketPriority;
    status: TicketStatus;
    assigned_to_user_id: string;
    issue_summary: string;
    resolution_notes: string;
  }>({
    customer_id: '',
    source: 'Manual Admin',
    category: 'LOS / Optik Putus',
    priority: 'Tinggi',
    status: 'Open',
    assigned_to_user_id: '',
    issue_summary: '',
    resolution_notes: '',
  });

  // Edit / Follow-up Modal
  const [editingTicket, setEditingTicket] = useState<TroubleTicket | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editForm, setEditForm] = useState<{
    source: TicketSource;
    category: TicketCategory;
    priority: TicketPriority;
    status: TicketStatus;
    assigned_to_user_id: string;
    issue_summary: string;
    resolution_notes: string;
  }>({
    source: 'Manual Admin',
    category: 'LOS / Optik Putus',
    priority: 'Normal',
    status: 'Open',
    assigned_to_user_id: '',
    issue_summary: '',
    resolution_notes: '',
  });

  const loadTickets = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== 'all') params.set('status', statusFilter);
      if (priorityFilter !== 'all') params.set('priority', priorityFilter);
      if (categoryFilter !== 'all') params.set('category', categoryFilter);
      if (customerFilterId) params.set('customer_id', String(customerFilterId));
      if (odpFilterId) params.set('odp_id', String(odpFilterId));
      if (search.trim()) params.set('search', search.trim());

      const res = await apiFetch(`/api/tickets?${params.toString()}`);
      const json = (await res.json()) as TicketsListResponse & { error?: string };
      if (!res.ok) {
        onNotify(json.error || 'Gagal memuat data tiket gangguan.', 'error');
        return;
      }
      setTickets(json.tickets);
      setAssignees(json.assignees);
      setCustomerOptions(json.customer_options);
      setSummary(json.summary);
      setCustomerRecurrence(json.customer_recurrence);
      setOdpRecurrence(json.odp_recurrence);
    } catch {
      onNotify('Gagal terhubung ke server saat memuat tiket gangguan.', 'error');
    } finally {
      setLoading(false);
    }
  }, [
    statusFilter,
    priorityFilter,
    categoryFilter,
    customerFilterId,
    odpFilterId,
    search,
    onNotify,
  ]);

  useEffect(() => {
    void loadTickets();
  }, [loadTickets]);

  // Auto-open pre-filled creation modal when launched from Monitoring NOC, Mapping, or Chat WA
  useEffect(() => {
    if (!prefillRequest) return;
    if (!canManage) {
      onNotify('Peran Anda hanya memiliki akses Lihat Saja (Read-Only) pada Tiket Gangguan.', 'error');
      onClearPrefill?.();
      return;
    }

    const defaultTech = assignees.find((a) => a.role === 'Teknisi') ?? assignees[0];
    setSubTab('list');
    setCreateForm({
      customer_id: String(prefillRequest.customer_id),
      source: prefillRequest.source,
      category: prefillRequest.category ?? 'LOS / Optik Putus',
      priority: prefillRequest.priority ?? 'Tinggi',
      status: 'Open',
      assigned_to_user_id: defaultTech ? String(defaultTech.id) : '',
      issue_summary: prefillRequest.issue_summary ?? '',
      resolution_notes: '',
    });
    setCreateOpen(true);
    onClearPrefill?.();
  }, [prefillRequest, canManage, assignees, onClearPrefill, onNotify]);

  const selectedCreateCustomer = useMemo(
    () => customerOptions.find((c) => String(c.id) === createForm.customer_id) ?? null,
    [customerOptions, createForm.customer_id]
  );

  function openNewTicketModal() {
    if (!canManage) return;
    const defaultCustomer =
      customerOptions.find((c) => c.device_status !== 'Online') ?? customerOptions[0];
    const defaultTech = assignees.find((a) => a.role === 'Teknisi') ?? assignees[0];
    setCreateForm({
      customer_id: defaultCustomer ? String(defaultCustomer.id) : '',
      source: currentUser.role === 'Teknisi' ? 'Cek Lapangan' : 'Manual Admin',
      category:
        defaultCustomer?.device_status === 'Offline'
          ? 'LOS / Optik Putus'
          : 'Koneksi Lambat / Latency',
      priority: defaultCustomer?.device_status === 'Offline' ? 'Kritis' : 'Normal',
      status: 'Open',
      assigned_to_user_id: defaultTech ? String(defaultTech.id) : '',
      issue_summary: '',
      resolution_notes: '',
    });
    setCreateOpen(true);
  }

  function openEditModal(ticket: TroubleTicket) {
    setEditingTicket(ticket);
    setEditForm({
      source: ticket.source,
      category: ticket.category,
      priority: ticket.priority,
      status: ticket.status,
      assigned_to_user_id: ticket.assigned_to_user_id ? String(ticket.assigned_to_user_id) : '',
      issue_summary: ticket.issue_summary,
      resolution_notes: ticket.resolution_notes,
    });
  }

  async function handleCreateSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canManage) return;
    setCreating(true);
    try {
      const res = await apiFetch('/api/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer_id: Number(createForm.customer_id),
          source: createForm.source,
          category: createForm.category,
          priority: createForm.priority,
          status: createForm.status,
          assigned_to_user_id: createForm.assigned_to_user_id
            ? Number(createForm.assigned_to_user_id)
            : null,
          issue_summary: createForm.issue_summary,
          resolution_notes: createForm.resolution_notes,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        onNotify(json.error || 'Gagal membuat tiket gangguan.', 'error');
        return;
      }
      setCreateOpen(false);
      await loadTickets();
      onNotify(`Tiket ${json.ticket_code} berhasil dibuat & dicatat ke Log Aktivitas.`, 'success');
    } catch {
      onNotify('Terjadi kesalahan saat menyimpan tiket.', 'error');
    } finally {
      setCreating(false);
    }
  }

  async function handleEditSubmit(e: FormEvent) {
    e.preventDefault();
    if (!editingTicket || !canManage) return;
    setSavingEdit(true);
    try {
      const res = await apiFetch(`/api/tickets/${editingTicket.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: editForm.source,
          category: editForm.category,
          priority: editForm.priority,
          status: editForm.status,
          assigned_to_user_id: editForm.assigned_to_user_id
            ? Number(editForm.assigned_to_user_id)
            : null,
          issue_summary: editForm.issue_summary,
          resolution_notes: editForm.resolution_notes,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        onNotify(json.error || 'Gagal memperbarui tiket gangguan.', 'error');
        return;
      }
      setEditingTicket(null);
      await loadTickets();
      onNotify(
        `Tiket ${json.ticket_code} diperbarui (${json.status}) dan dicatat ke Log Aktivitas.`,
        'success'
      );
    } catch {
      onNotify('Gagal menghubungi server saat memperbarui tiket.', 'error');
    } finally {
      setSavingEdit(false);
    }
  }

  async function handleDeleteTicket(ticket: TroubleTicket) {
    if (!canDelete) return;
    try {
      const res = await apiFetch(`/api/tickets/${ticket.id}`, { method: 'DELETE' });
      const json = await res.json();
      if (!res.ok) {
        onNotify(json.error || 'Gagal menghapus tiket.', 'error');
        return;
      }
      await loadTickets();
      onNotify(`Tiket ${ticket.ticket_code} dihapus dari sistem.`, 'success');
    } catch {
      onNotify('Gagal menghubungi server saat menghapus tiket.', 'error');
    }
  }

  function applyCustomerContextFilter(rec: TicketCustomerRecurrence) {
    setCustomerFilterId(rec.customer_id);
    setOdpFilterId(null);
    setStatusFilter('all');
    setContextFilterLabel(`Pelanggan: ${rec.customer_name} (${rec.device_id})`);
    setSubTab('list');
  }

  function applyOdpContextFilter(rec: TicketOdpRecurrence) {
    setOdpFilterId(rec.odp_id);
    setCustomerFilterId(null);
    setStatusFilter('all');
    setContextFilterLabel(`ODP: ${rec.odp_code} · ${rec.odp_name}`);
    setSubTab('list');
  }

  function clearContextFilters() {
    setCustomerFilterId(null);
    setOdpFilterId(null);
    setContextFilterLabel(null);
  }

  const activeTicketsCount =
    summary.open_count + summary.in_progress_count + summary.waiting_count;

  return (
    <div className="space-y-6">
      {!canManage && (
        <ReadOnlyBanner
          title={`Mode Akses Lihat Saja (${currentUser.role})`}
          description="Anda dapat memantau tiket gangguan pelanggan dan riwayat ODP, namun pembuatan tiket, penugasan teknisi, serta perubahan status hanya dapat dilakukan oleh Teknisi atau Administrator."
        />
      )}

      {/* 4-Column KPI Strip */}
      <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-slate-500">Tiket Gangguan Aktif</span>
            <Ticket className="w-4 h-4 text-red-700 shrink-0" aria-hidden="true" />
          </div>
          <div className="mt-2 text-2xl font-bold font-mono text-slate-900 tabular-nums">
            {activeTicketsCount}
          </div>
          <div className="mt-1 text-xs text-slate-500 font-mono tabular-nums">
            {summary.open_count} Open · {summary.in_progress_count} Proses · {summary.waiting_count} Konfirmasi
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-slate-500">Prioritas Kritis Aktif</span>
            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" aria-hidden="true" />
          </div>
          <div className="mt-2 text-2xl font-bold font-mono text-rose-700 tabular-nums">
            {summary.critical_open_count}
          </div>
          <div className="mt-1 text-xs text-slate-500">
            LOS optik / cluster down butuh penanganan cepat
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-slate-500">Tiket Selesai (Resolved)</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" aria-hidden="true" />
          </div>
          <div className="mt-2 text-2xl font-bold font-mono text-emerald-700 tabular-nums">
            {summary.resolved_count}
          </div>
          <div className="mt-1 text-xs text-slate-500 font-mono tabular-nums">
            Dari total {summary.total_count} tiket tercatat
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-slate-500">Gangguan Berulang (≥2x)</span>
            <History className="w-4 h-4 text-amber-600 shrink-0" aria-hidden="true" />
          </div>
          <div className="mt-2 text-2xl font-bold font-mono text-slate-900 tabular-nums">
            {summary.recurring_customers_count} PLG · {summary.recurring_odps_count} ODP
          </div>
          <div className="mt-1 text-xs text-slate-500">
            Pantau titik rawan pelanggan &amp; splitter ODP
          </div>
        </div>
      </section>

      {/* Sub-Tab & Primary Actions */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex items-center gap-1 p-1 bg-slate-200/70 rounded-md">
          <button
            type="button"
            onClick={() => setSubTab('list')}
            className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
              subTab === 'list'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Ticket className="w-3.5 h-3.5" />
            Daftar Tiket Gangguan ({tickets.length})
          </button>
          <button
            type="button"
            onClick={() => setSubTab('recurrence')}
            className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
              subTab === 'recurrence'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <History className="w-3.5 h-3.5" />
            Riwayat Berulang (Pelanggan &amp; ODP)
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {!canManage && <ReadOnlyBadge />}
          <button
            type="button"
            onClick={() => void loadTickets()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-md transition-colors whitespace-nowrap shrink-0"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Muat Ulang
          </button>
          {canManage && (
            <button
              type="button"
              onClick={openNewTicketModal}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-red-600 hover:bg-red-700 rounded-md transition-colors whitespace-nowrap shrink-0"
            >
              <Plus className="w-4 h-4" />
              Buat Tiket Baru
            </button>
          )}
        </div>
      </div>

      {subTab === 'list' && (
        <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          {/* Filter Bar */}
          <div className="p-4 border-b border-slate-200 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="inline-flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-md">
                {(
                  [
                    { id: 'all', label: 'Semua' },
                    { id: 'Open', label: 'Terbuka (Open)' },
                    { id: 'In Progress', label: 'Dalam Penanganan' },
                    { id: 'Menunggu Konfirmasi', label: 'Menunggu Konfirmasi' },
                    { id: 'Resolved', label: 'Selesai (Resolved)' },
                  ] as const
                ).map((st) => (
                  <button
                    key={st.id}
                    type="button"
                    onClick={() => setStatusFilter(st.id)}
                    className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                      statusFilter === st.id
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {st.label}
                  </button>
                ))}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={priorityFilter}
                  onChange={(e) => setPriorityFilter(e.target.value as 'all' | TicketPriority)}
                  aria-label="Filter prioritas"
                  className="px-2.5 py-1.5 text-xs border border-slate-200 rounded-md bg-white focus:outline-none focus:border-red-600"
                >
                  <option value="all">Semua Prioritas</option>
                  {TICKET_PRIORITIES.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label} ({p.hint})
                    </option>
                  ))}
                </select>

                <select
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value as 'all' | TicketCategory)}
                  aria-label="Filter kategori gangguan"
                  className="px-2.5 py-1.5 text-xs border border-slate-200 rounded-md bg-white focus:outline-none focus:border-red-600"
                >
                  <option value="all">Semua Kategori</option>
                  {TICKET_CATEGORIES.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>

                <div className="relative min-w-[230px]">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Cari TKT, ONT, pelanggan, ODP..."
                    className="w-full pl-8 pr-3 py-1.5 text-xs border border-slate-200 rounded-md focus:outline-none focus:border-red-600"
                  />
                </div>
              </div>
            </div>

            {contextFilterLabel && (
              <div className="flex items-center justify-between gap-2 px-3 py-2 bg-red-50/70 border border-red-200 rounded-md text-xs">
                <div className="flex items-center gap-2 text-red-800">
                  <Filter className="w-3.5 h-3.5 shrink-0" />
                  <span>
                    Menampilkan riwayat tiket khusus: <strong>{contextFilterLabel}</strong>
                  </span>
                </div>
                <button
                  type="button"
                  onClick={clearContextFilters}
                  className="text-xs font-medium text-red-700 hover:underline whitespace-nowrap shrink-0"
                >
                  Tampilkan Semua
                </button>
              </div>
            )}
          </div>

          {/* Tickets Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                  <th className="py-2.5 px-4">Tiket &amp; Waktu (WIB)</th>
                  <th className="py-2.5 px-4">Pelanggan &amp; Perangkat</th>
                  <th className="py-2.5 px-4">ODP / Node Induk</th>
                  <th className="py-2.5 px-4">Kategori &amp; Ringkasan Keluhan</th>
                  <th className="py-2.5 px-4">Prioritas &amp; Status</th>
                  <th className="py-2.5 px-4">Teknisi &amp; Penanganan</th>
                  <th className="py-2.5 px-4 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {loading && tickets.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-12 text-center text-sm text-slate-500">
                      Memuat daftar tiket gangguan...
                    </td>
                  </tr>
                ) : tickets.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-12 text-center text-sm text-slate-500">
                      Tidak ada tiket gangguan yang sesuai filter saat ini.
                    </td>
                  </tr>
                ) : (
                  tickets.map((t) => (
                    <tr key={t.id} className="hover:bg-slate-50/70 transition-colors align-top">
                      <td className="py-3 px-4 whitespace-nowrap">
                        <div className="font-mono text-xs font-bold text-red-700">
                          {t.ticket_code}
                        </div>
                        <div className="text-[11px] font-mono text-slate-500 tabular-nums mt-0.5">
                          {formatDateTimeWib(t.created_at)}
                        </div>
                        <div className="mt-1 text-[11px] text-slate-500">
                          Sumber: <span className="font-medium text-slate-700">{t.source}</span>
                        </div>
                      </td>

                      <td className="py-3 px-4 min-w-[200px]">
                        <div className="font-medium text-slate-900 text-xs">{t.customer_name}</div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px]">
                          <span className="font-mono text-slate-600">{t.customer_code}</span>
                          <span className="text-slate-300" aria-hidden="true">·</span>
                          <span className="font-mono font-semibold text-slate-800">{t.device_id}</span>
                          <DeviceStatusLabel status={t.device_status} />
                        </div>
                        <div className="text-[11px] text-slate-500 mt-0.5">{t.package_name}</div>
                      </td>

                      <td className="py-3 px-4 whitespace-nowrap">
                        <div className="font-mono text-xs font-medium text-slate-800">
                          {t.odp_code || 'Belum dipetakan'}
                        </div>
                        <div className="font-mono text-[11px] text-slate-500 mt-0.5">
                          {t.node_code || '—'}
                          {t.pon_port ? ` · ${t.pon_port}` : ''}
                        </div>
                        {t.rx_power_dbm !== null && (
                          <div
                            className={`font-mono text-[11px] tabular-nums mt-0.5 ${
                              t.rx_power_dbm <= -27 ? 'text-rose-700 font-semibold' : 'text-slate-500'
                            }`}
                          >
                            Rx: {t.rx_power_dbm.toFixed(1)} dBm
                          </div>
                        )}
                      </td>

                      <td className="py-3 px-4 max-w-xs">
                        <div className="text-xs font-semibold text-slate-900">{t.category}</div>
                        <p className="text-xs text-slate-600 mt-1 line-clamp-2">{t.issue_summary}</p>
                        {t.resolution_notes && (
                          <p className="text-[11px] text-emerald-800 bg-emerald-50/70 border border-emerald-200/80 rounded px-2 py-1 mt-1.5 line-clamp-2">
                            Tindakan: {t.resolution_notes}
                          </p>
                        )}
                      </td>

                      <td className="py-3 px-4 whitespace-nowrap space-y-1.5">
                        <div>
                          <TicketPriorityBadge priority={t.priority} />
                        </div>
                        <div>
                          <TicketStatusBadge status={t.status} />
                        </div>
                      </td>

                      <td className="py-3 px-4 whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-800">
                          <UserCheck className="w-3.5 h-3.5 text-slate-400 shrink-0" aria-hidden="true" />
                          <span>{t.assigned_to_name || 'Belum ditugaskan'}</span>
                        </div>
                        {t.resolved_at ? (
                          <div className="text-[11px] font-mono text-emerald-700 tabular-nums mt-1">
                            Selesai: {formatDateTimeWib(t.resolved_at)}
                          </div>
                        ) : (
                          <div className="text-[11px] font-mono text-slate-400 tabular-nums mt-1">
                            Update: {formatDateTimeWib(t.updated_at)}
                          </div>
                        )}
                      </td>

                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1">
                          {canManage && (
                            <button
                              type="button"
                              onClick={() => openEditModal(t)}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-red-700 bg-red-50/70 border border-red-200 hover:bg-red-100 rounded-md transition-colors whitespace-nowrap shrink-0"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                              Tindak Lanjut
                            </button>
                          )}
                          {onOpenMapping && (
                            <button
                              type="button"
                              onClick={() => onOpenMapping(t.customer_id)}
                              title="Lihat Topologi & ODP ONT"
                              className="p-1.5 text-slate-500 hover:text-red-700 hover:bg-red-50 rounded transition-colors"
                            >
                              <GitBranch className="w-4 h-4" />
                            </button>
                          )}
                          {onOpenChat && (
                            <button
                              type="button"
                              onClick={() => onOpenChat(t.customer_id)}
                              title="Buka Chat WhatsApp Pelanggan"
                              className="p-1.5 text-slate-500 hover:text-emerald-700 hover:bg-emerald-50 rounded transition-colors"
                            >
                              <MessageCircle className="w-4 h-4" />
                            </button>
                          )}
                          {canDelete && (
                            <button
                              type="button"
                              onClick={() => void handleDeleteTicket(t)}
                              title="Hapus Tiket (Admin)"
                              className="p-1.5 text-slate-400 hover:text-rose-700 hover:bg-rose-50 rounded transition-colors"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {subTab === 'recurrence' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
          {/* Riwayat Berulang per ODP */}
          <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200">
              <h2 className="text-sm font-semibold text-slate-900">
                Riwayat Gangguan per ODP Splitter
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Identifikasi ODP yang sering mengalami gangguan optik / dropcore berulang
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                    <th className="py-2.5 px-4">ODP &amp; Area</th>
                    <th className="py-2.5 px-4 text-right">Total Tiket</th>
                    <th className="py-2.5 px-4 text-right">Aktif / Selesai</th>
                    <th className="py-2.5 px-4">Gangguan Terakhir</th>
                    <th className="py-2.5 px-4 text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {odpRecurrence.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-10 text-center text-slate-500">
                        Belum ada riwayat tiket terhubung ke ODP.
                      </td>
                    </tr>
                  ) : (
                    odpRecurrence.map((item) => (
                      <tr key={item.odp_id} className="hover:bg-slate-50 transition-colors">
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono font-bold text-slate-900">{item.odp_code}</span>
                            {item.total_tickets >= 2 && (
                              <span className="px-1.5 py-0.5 text-[10px] font-semibold rounded border bg-amber-50 text-amber-800 border-amber-200 whitespace-nowrap">
                                Berulang ({item.total_tickets}x)
                              </span>
                            )}
                          </div>
                          <div className="text-slate-600 mt-0.5">{item.odp_name}</div>
                          <div className="text-[11px] font-mono text-slate-400">
                            {item.node_code || '—'} · {item.affected_customers} pelanggan terdampak
                          </div>
                        </td>
                        <td className="py-3 px-4 text-right font-mono font-bold text-slate-900 tabular-nums">
                          {item.total_tickets}
                        </td>
                        <td className="py-3 px-4 text-right font-mono tabular-nums whitespace-nowrap">
                          <span className={item.open_tickets > 0 ? 'text-rose-700 font-semibold' : 'text-slate-500'}>
                            {item.open_tickets} aktif
                          </span>
                          <span className="text-slate-300 mx-1">/</span>
                          <span className="text-emerald-700">{item.resolved_tickets} selesai</span>
                        </td>
                        <td className="py-3 px-4">
                          <div className="font-medium text-slate-800">{item.last_category}</div>
                          <div className="font-mono text-[11px] text-slate-400 tabular-nums mt-0.5">
                            {formatDateTimeWib(item.last_ticket_at)}
                          </div>
                        </td>
                        <td className="py-3 px-4 text-right whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => applyOdpContextFilter(item)}
                            className="px-2.5 py-1 text-xs font-medium text-red-700 bg-red-50/70 border border-red-200 hover:bg-red-100 rounded transition-colors whitespace-nowrap shrink-0"
                          >
                            Lihat Tiket
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {/* Riwayat Berulang per Pelanggan */}
          <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200">
              <h2 className="text-sm font-semibold text-slate-900">
                Riwayat Gangguan per Pelanggan &amp; ONT
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Pantau pelanggan dengan keluhan berulang untuk evaluasi penggantian kabel atau ONT
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                    <th className="py-2.5 px-4">Pelanggan &amp; ONT</th>
                    <th className="py-2.5 px-4 text-right">Total Tiket</th>
                    <th className="py-2.5 px-4 text-right">Aktif / Selesai</th>
                    <th className="py-2.5 px-4">Tiket Terakhir</th>
                    <th className="py-2.5 px-4 text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {customerRecurrence.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-10 text-center text-slate-500">
                        Belum ada riwayat tiket gangguan pelanggan.
                      </td>
                    </tr>
                  ) : (
                    customerRecurrence.map((item) => (
                      <tr key={item.customer_id} className="hover:bg-slate-50 transition-colors">
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-1.5">
                            <span className="font-semibold text-slate-900">{item.customer_name}</span>
                            {item.total_tickets >= 2 && (
                              <span className="px-1.5 py-0.5 text-[10px] font-semibold rounded border bg-rose-50 text-rose-800 border-rose-200 whitespace-nowrap">
                                Berulang ({item.total_tickets}x)
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5 text-[11px] font-mono text-slate-500 mt-0.5">
                            <span>{item.device_id}</span>
                            <span aria-hidden="true">·</span>
                            <span>{item.odp_code || '—'}</span>
                            <DeviceStatusLabel status={item.device_status} />
                          </div>
                        </td>
                        <td className="py-3 px-4 text-right font-mono font-bold text-slate-900 tabular-nums">
                          {item.total_tickets}
                        </td>
                        <td className="py-3 px-4 text-right font-mono tabular-nums whitespace-nowrap">
                          <span className={item.open_tickets > 0 ? 'text-rose-700 font-semibold' : 'text-slate-500'}>
                            {item.open_tickets} aktif
                          </span>
                          <span className="text-slate-300 mx-1">/</span>
                          <span className="text-emerald-700">{item.resolved_tickets} selesai</span>
                        </td>
                        <td className="py-3 px-4">
                          <div className="font-mono text-red-700 font-semibold">{item.last_ticket_code}</div>
                          <div className="text-slate-600">{item.last_category}</div>
                          <div className="font-mono text-[11px] text-slate-400 tabular-nums mt-0.5">
                            {formatDateTimeWib(item.last_ticket_at)}
                          </div>
                        </td>
                        <td className="py-3 px-4 text-right whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => applyCustomerContextFilter(item)}
                            className="px-2.5 py-1 text-xs font-medium text-red-700 bg-red-50/70 border border-red-200 hover:bg-red-100 rounded transition-colors whitespace-nowrap shrink-0"
                          >
                            Lihat Tiket
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}

      {/* Create Ticket Modal */}
      {createOpen && canManage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 overflow-y-auto">
          <div className="bg-white border border-slate-200 rounded-lg w-full max-w-xl shadow-xl my-auto">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Ticket className="w-4 h-4 text-red-700" />
                <h3 className="text-base font-semibold text-slate-900">
                  Buat Tiket Gangguan Baru
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setCreateOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-700 rounded"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateSubmit} className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Pelanggan &amp; Perangkat ONT / Router *
                </label>
                <select
                  required
                  value={createForm.customer_id}
                  onChange={(e) => setCreateForm({ ...createForm, customer_id: e.target.value })}
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-md bg-white focus:outline-none focus:border-red-600"
                >
                  <option value="">-- Pilih Pelanggan / Perangkat --</option>
                  {customerOptions.map((c) => (
                    <option key={c.id} value={String(c.id)}>
                      {c.device_id} · {c.name} ({c.customer_code}) — {c.device_status}
                      {c.odp_code ? ` [${c.odp_code}]` : ''}
                    </option>
                  ))}
                </select>
              </div>

              {selectedCreateCustomer && (
                <div className="bg-slate-50 border border-slate-200 rounded-md px-3.5 py-2.5 text-xs space-y-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-mono font-semibold text-slate-900">
                      {selectedCreateCustomer.device_id} ({selectedCreateCustomer.device_ip})
                    </span>
                    <DeviceStatusLabel status={selectedCreateCustomer.device_status} />
                  </div>
                  <div className="text-slate-600 flex flex-wrap items-center gap-2">
                    <span>Paket: {selectedCreateCustomer.package_name}</span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono">
                      Node: {selectedCreateCustomer.node_code || '—'} · ODP: {selectedCreateCustomer.odp_code || '—'}
                    </span>
                    {selectedCreateCustomer.rx_power_dbm !== null && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono">
                          Rx: {selectedCreateCustomer.rx_power_dbm.toFixed(1)} dBm
                        </span>
                      </>
                    )}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Sumber Laporan *
                  </label>
                  <select
                    value={createForm.source}
                    onChange={(e) =>
                      setCreateForm({ ...createForm, source: e.target.value as TicketSource })
                    }
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-md bg-white focus:outline-none focus:border-red-600"
                  >
                    {TICKET_SOURCES.map((src) => (
                      <option key={src} value={src}>
                        {src}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Kategori Gangguan *
                  </label>
                  <select
                    value={createForm.category}
                    onChange={(e) =>
                      setCreateForm({ ...createForm, category: e.target.value as TicketCategory })
                    }
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-md bg-white focus:outline-none focus:border-red-600"
                  >
                    {TICKET_CATEGORIES.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Prioritas *
                  </label>
                  <select
                    value={createForm.priority}
                    onChange={(e) =>
                      setCreateForm({ ...createForm, priority: e.target.value as TicketPriority })
                    }
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-md bg-white focus:outline-none focus:border-red-600"
                  >
                    {TICKET_PRIORITIES.map((p) => (
                      <option key={p.value} value={p.value}>
                        {p.label} ({p.hint})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Status Awal
                  </label>
                  <select
                    value={createForm.status}
                    onChange={(e) =>
                      setCreateForm({ ...createForm, status: e.target.value as TicketStatus })
                    }
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-md bg-white focus:outline-none focus:border-red-600"
                  >
                    {TICKET_STATUSES.map((st) => (
                      <option key={st.value} value={st.value}>
                        {st.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Tugaskan Teknisi
                  </label>
                  <select
                    value={createForm.assigned_to_user_id}
                    onChange={(e) =>
                      setCreateForm({ ...createForm, assigned_to_user_id: e.target.value })
                    }
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-md bg-white focus:outline-none focus:border-red-600"
                  >
                    <option value="">-- Belum Ditugaskan --</option>
                    {assignees.map((a) => (
                      <option key={a.id} value={String(a.id)}>
                        {a.full_name} ({a.role})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Ringkasan Keluhan / Gejala Gangguan *
                </label>
                <textarea
                  required
                  rows={3}
                  value={createForm.issue_summary}
                  onChange={(e) =>
                    setCreateForm({ ...createForm, issue_summary: e.target.value })
                  }
                  placeholder="Contoh: Lampu LOS ONT berkedip merah sejak subuh, redaman OLT terukur -34.0 dBm..."
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-md focus:outline-none focus:border-red-600"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Rencana / Catatan Tindakan Lapangan (Opsional)
                </label>
                <textarea
                  rows={2}
                  value={createForm.resolution_notes}
                  onChange={(e) =>
                    setCreateForm({ ...createForm, resolution_notes: e.target.value })
                  }
                  placeholder="Contoh: Bawa cadangan patchcord SC-APC & adaptor 12V..."
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-md focus:outline-none focus:border-red-600"
                />
              </div>

              <div className="pt-3 border-t border-slate-200 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setCreateOpen(false)}
                  className="px-4 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={creating || !createForm.customer_id}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-red-600 hover:bg-red-700 disabled:opacity-50 rounded-md transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  {creating ? 'Menyimpan...' : 'Terbitkan Tiket Gangguan'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit / Follow-up Ticket Modal */}
      {editingTicket && canManage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 overflow-y-auto">
          <div className="bg-white border border-slate-200 rounded-lg w-full max-w-xl shadow-xl my-auto">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm font-bold text-red-700">
                    {editingTicket.ticket_code}
                  </span>
                  <span className="text-slate-300" aria-hidden="true">·</span>
                  <span className="text-sm font-semibold text-slate-900">
                    {editingTicket.customer_name}
                  </span>
                </div>
                <div className="text-[11px] font-mono text-slate-500 mt-0.5 tabular-nums">
                  {editingTicket.device_id} · {editingTicket.odp_code || '—'} · Dibuat{' '}
                  {formatDateTimeWib(editingTicket.created_at)}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setEditingTicket(null)}
                className="p-1 text-slate-400 hover:text-slate-700 rounded"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleEditSubmit} className="p-5 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Status Penanganan *
                  </label>
                  <select
                    value={editForm.status}
                    onChange={(e) =>
                      setEditForm({ ...editForm, status: e.target.value as TicketStatus })
                    }
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-md bg-white focus:outline-none focus:border-red-600"
                  >
                    {TICKET_STATUSES.map((st) => (
                      <option key={st.value} value={st.value}>
                        {st.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Teknisi yang Menangani
                  </label>
                  <select
                    value={editForm.assigned_to_user_id}
                    onChange={(e) =>
                      setEditForm({ ...editForm, assigned_to_user_id: e.target.value })
                    }
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-md bg-white focus:outline-none focus:border-red-600"
                  >
                    <option value="">-- Belum Ditugaskan --</option>
                    {assignees.map((a) => (
                      <option key={a.id} value={String(a.id)}>
                        {a.full_name} ({a.role})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Prioritas
                  </label>
                  <select
                    value={editForm.priority}
                    onChange={(e) =>
                      setEditForm({ ...editForm, priority: e.target.value as TicketPriority })
                    }
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-md bg-white focus:outline-none focus:border-red-600"
                  >
                    {TICKET_PRIORITIES.map((p) => (
                      <option key={p.value} value={p.value}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Kategori
                  </label>
                  <select
                    value={editForm.category}
                    onChange={(e) =>
                      setEditForm({ ...editForm, category: e.target.value as TicketCategory })
                    }
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-md bg-white focus:outline-none focus:border-red-600"
                  >
                    {TICKET_CATEGORIES.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Sumber
                  </label>
                  <select
                    value={editForm.source}
                    onChange={(e) =>
                      setEditForm({ ...editForm, source: e.target.value as TicketSource })
                    }
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-md bg-white focus:outline-none focus:border-red-600"
                  >
                    {TICKET_SOURCES.map((src) => (
                      <option key={src} value={src}>
                        {src}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Ringkasan Keluhan
                </label>
                <textarea
                  required
                  rows={2}
                  value={editForm.issue_summary}
                  onChange={(e) => setEditForm({ ...editForm, issue_summary: e.target.value })}
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-md focus:outline-none focus:border-red-600"
                />
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-slate-700">
                    Catatan Tindakan di Lapangan
                  </label>
                  {editForm.status !== 'Resolved' && (
                    <button
                      type="button"
                      onClick={() => setEditForm({ ...editForm, status: 'Resolved' })}
                      className="text-[11px] font-medium text-emerald-700 hover:underline"
                    >
                      Tandai Selesai (Resolved)
                    </button>
                  )}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {FIELD_NOTE_SNIPPETS.map((snippet) => (
                    <button
                      key={snippet}
                      type="button"
                      onClick={() =>
                        setEditForm((prev) => ({
                          ...prev,
                          resolution_notes: prev.resolution_notes
                            ? `${prev.resolution_notes}; ${snippet}`
                            : snippet,
                        }))
                      }
                      className="px-2 py-1 text-[11px] text-slate-600 bg-slate-100 hover:bg-slate-200 rounded transition-colors"
                    >
                      + {snippet}
                    </button>
                  ))}
                </div>
                <textarea
                  rows={3}
                  value={editForm.resolution_notes}
                  onChange={(e) =>
                    setEditForm({ ...editForm, resolution_notes: e.target.value })
                  }
                  placeholder="Catat hasil pengecekan redaman, penggantian patchcord, sambungan dropcore, atau adaptor..."
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-md focus:outline-none focus:border-red-600"
                />
              </div>

              {editingTicket.resolved_at && (
                <div className="text-[11px] font-mono text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-3 py-2 tabular-nums">
                  Diselesaikan pada: {formatDateTimeWib(editingTicket.resolved_at)}
                </div>
              )}

              <div className="pt-3 border-t border-slate-200 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setEditingTicket(null)}
                  className="px-4 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={savingEdit}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-red-600 hover:bg-red-700 disabled:opacity-50 rounded-md transition-colors"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  {savingEdit ? 'Menyimpan...' : 'Simpan Pembaruan Tiket'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
