import { useCallback, useEffect, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Download,
  FileSpreadsheet,
  Lock,
  RefreshCw,
  Search,
} from 'lucide-react';
import type {
  ActivityLog,
  ActivityLogCategory,
  ActivityLogsResponse,
  ActorRole,
  AuthUser,
  UserRole,
} from '../types';
import { apiFetch } from '../utils/auth';
import {
  exportActivityLogsToCsv,
  exportActivityLogsToExcel,
  formatDateTimeWib,
} from '../utils/format';

interface ActivityLogsViewProps {
  currentUser: AuthUser;
  onNotify: (msg: string, type?: 'success' | 'error') => void;
}

export const CATEGORY_META: Record<
  ActivityLogCategory,
  { label: string; badgeClass: string }
> = {
  billing: {
    label: 'Billing',
    badgeClass: 'bg-amber-50 text-amber-800 border-amber-200',
  },
  network: {
    label: 'Jaringan',
    badgeClass: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  },
  customer: {
    label: 'Pelanggan',
    badgeClass: 'bg-slate-100 text-slate-700 border-slate-200',
  },
  auth: {
    label: 'Autentikasi',
    badgeClass: 'bg-rose-50 text-rose-700 border-rose-200',
  },
};

export const ROLE_BADGE_CLASS: Record<ActorRole, string> = {
  Admin: 'bg-red-50 text-red-700 border-red-200',
  Teknisi: 'bg-sky-50 text-sky-700 border-sky-200',
  Keuangan: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  Pelanggan: 'bg-slate-100 text-slate-700 border-slate-300',
};

export function RoleBadge({ role }: { role: ActorRole }) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 text-[11px] font-semibold rounded border whitespace-nowrap ${
        ROLE_BADGE_CLASS[role] ?? 'bg-slate-50 text-slate-700 border-slate-200'
      }`}
    >
      {role}
    </span>
  );
}

export function CategoryBadge({ category }: { category: ActivityLogCategory }) {
  const meta = CATEGORY_META[category] ?? {
    label: category,
    badgeClass: 'bg-slate-100 text-slate-700 border-slate-200',
  };
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 text-[11px] font-medium rounded border whitespace-nowrap ${meta.badgeClass}`}
    >
      {meta.label}
    </span>
  );
}

function getDefaultAllowedCategories(role: UserRole): ActivityLogCategory[] {
  if (role === 'Admin') return ['billing', 'network', 'customer', 'auth'];
  if (role === 'Teknisi') return ['network', 'customer'];
  return ['billing', 'customer'];
}

export function ActivityLogsView({ currentUser, onNotify }: ActivityLogsViewProps) {
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [allowedCategories, setAllowedCategories] = useState<ActivityLogCategory[]>(
    () => getDefaultAllowedCategories(currentUser.role)
  );
  const [categoryFilter, setCategoryFilter] = useState<'all' | ActivityLogCategory>('all');
  const [roleFilter, setRoleFilter] = useState<'all' | ActorRole>('all');
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [exportingFormat, setExportingFormat] = useState<'CSV' | 'Excel' | null>(null);
  const limit = 15;

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchInput.trim());
      setPage(1);
    }, 220);
    return () => clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    const defaults = getDefaultAllowedCategories(currentUser.role);
    setAllowedCategories(defaults);
    if (categoryFilter !== 'all' && !defaults.includes(categoryFilter)) {
      setCategoryFilter('all');
    }
  }, [currentUser.role, categoryFilter]);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        category: categoryFilter,
        role: roleFilter,
        search: debouncedSearch,
        page: String(page),
        limit: String(limit),
      });
      const res = await apiFetch(`/api/activity-logs?${params.toString()}`);
      const json = (await res.json()) as ActivityLogsResponse & { error?: string };
      if (!res.ok) {
        onNotify(json.error || 'Gagal memuat log aktivitas.', 'error');
        return;
      }
      setLogs(json.logs ?? []);
      setTotal(json.total ?? 0);
      setTotalPages(json.total_pages ?? 1);
      if (Array.isArray(json.allowed_categories) && json.allowed_categories.length > 0) {
        setAllowedCategories(json.allowed_categories);
      }
    } catch {
      onNotify('Gagal terhubung ke server saat memuat log aktivitas.', 'error');
    } finally {
      setLoading(false);
    }
  }, [categoryFilter, roleFilter, debouncedSearch, page, onNotify]);

  useEffect(() => {
    void fetchLogs();
  }, [fetchLogs]);

  async function handleExportLogs(format: 'CSV' | 'Excel') {
    setExportingFormat(format);
    try {
      const params = new URLSearchParams({
        category: categoryFilter,
        role: roleFilter,
        search: debouncedSearch,
        format,
      });
      const res = await apiFetch(`/api/activity-logs/export?${params.toString()}`);
      const json = (await res.json()) as { logs?: ActivityLog[]; error?: string };
      if (!res.ok) {
        onNotify(json.error || 'Gagal mengekspor log aktivitas.', 'error');
        return;
      }
      const rows = json.logs ?? [];
      if (format === 'CSV') {
        exportActivityLogsToCsv(rows);
      } else {
        exportActivityLogsToExcel(rows, categoryFilter);
      }
      onNotify(`Log aktivitas (${rows.length} baris) berhasil diekspor ke ${format}.`, 'success');
      void fetchLogs();
    } catch {
      onNotify(`Gagal mengekspor log aktivitas (${format}).`, 'error');
    } finally {
      setExportingFormat(null);
    }
  }

  const allowedLabels = allowedCategories
    .map((c) => CATEGORY_META[c]?.label ?? c)
    .join(', ');

  return (
    <div className="space-y-6">
      {/* Scope & Read-Only Header Strip */}
      <section className="bg-white border border-slate-200 rounded-lg p-5 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-md bg-red-50 border border-red-200 flex items-center justify-center text-red-700 shrink-0">
            <ClipboardList className="w-5 h-5" aria-hidden="true" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold text-slate-900">
                Jejak Audit &amp; Log Aktivitas Operator
              </h2>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium rounded border bg-slate-100 text-slate-700 border-slate-200">
                <Lock className="w-3 h-3" aria-hidden="true" />
                Read-Only (Permanen)
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              {currentUser.role === 'Admin'
                ? 'Menampilkan seluruh aktivitas sistem: Login, Billing, WhatsApp, Jaringan/Isolir, Pelanggan, dan Perubahan Hak Akses.'
                : `Menampilkan aktivitas sesuai cakupan tugas peran ${currentUser.role}: ${allowedLabels}.`}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <div className="text-right mr-1">
            <div className="text-[11px] text-slate-500">Total Catatan Audit</div>
            <div className="text-lg font-bold font-mono tabular-nums text-slate-900">
              {total}
            </div>
          </div>
          <button
            type="button"
            disabled={exportingFormat !== null}
            onClick={() => void handleExportLogs('CSV')}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-50 rounded-md transition-colors whitespace-nowrap shrink-0"
          >
            <Download className="w-3.5 h-3.5 text-slate-500" />
            {exportingFormat === 'CSV' ? 'Mengekspor...' : 'Ekspor CSV'}
          </button>
          <button
            type="button"
            disabled={exportingFormat !== null}
            onClick={() => void handleExportLogs('Excel')}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-emerald-800 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 disabled:opacity-50 rounded-md transition-colors whitespace-nowrap shrink-0"
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-700" />
            {exportingFormat === 'Excel' ? 'Mengekspor...' : 'Ekspor Excel'}
          </button>
          <button
            type="button"
            onClick={() => void fetchLogs()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-md transition-colors whitespace-nowrap shrink-0"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Muat Ulang
          </button>
        </div>
      </section>

      {/* Filter & Search Bar + Audit Table */}
      <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="p-4 border-b border-slate-200 space-y-3">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            {/* Category Filter Tabs (strictly scoped to user's allowed categories) */}
            <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-md">
              <button
                type="button"
                onClick={() => {
                  setCategoryFilter('all');
                  setPage(1);
                }}
                className={`px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                  categoryFilter === 'all'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Semua Kategori
              </button>
              {allowedCategories.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => {
                    setCategoryFilter(cat);
                    setPage(1);
                  }}
                  className={`px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                    categoryFilter === cat
                      ? 'bg-white text-red-700 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {CATEGORY_META[cat].label}
                </button>
              ))}
            </div>

            {/* Search & Role Filter */}
            <div className="flex flex-wrap items-center gap-2.5">
              <div className="relative flex-1 sm:w-64">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  placeholder="Cari user, aksi, target, detail..."
                  className="w-full pl-8 pr-3 py-1.5 text-xs border border-slate-200 rounded-md focus:outline-none focus:border-red-600"
                />
              </div>

              <select
                value={roleFilter}
                onChange={(e) => {
                  setRoleFilter(e.target.value as 'all' | ActorRole);
                  setPage(1);
                }}
                aria-label="Filter peran operator"
                className="px-3 py-1.5 text-xs border border-slate-200 rounded-md bg-white text-slate-700 focus:outline-none focus:border-red-600"
              >
                <option value="all">Semua Peran</option>
                <option value="Admin">Admin</option>
                <option value="Teknisi">Teknisi</option>
                <option value="Keuangan">Keuangan</option>
                <option value="Pelanggan">Pelanggan</option>
              </select>
            </div>
          </div>
        </div>

        {/* Audit Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                <th className="py-3 px-4 whitespace-nowrap">Waktu (WIB)</th>
                <th className="py-3 px-4 whitespace-nowrap">Operator</th>
                <th className="py-3 px-4 whitespace-nowrap">Peran</th>
                <th className="py-3 px-4 whitespace-nowrap">Kategori</th>
                <th className="py-3 px-4 whitespace-nowrap">Aksi</th>
                <th className="py-3 px-4 whitespace-nowrap">Target</th>
                <th className="py-3 px-4">Detail Aktivitas</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {loading && logs.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-500">
                    Memuat riwayat jejak audit...
                  </td>
                </tr>
              ) : logs.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-500">
                    Tidak ada catatan aktivitas yang cocok dengan filter saat ini.
                  </td>
                </tr>
              ) : (
                logs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50/80 transition-colors align-top">
                    <td className="py-3 px-4 font-mono text-[11px] text-slate-600 tabular-nums whitespace-nowrap">
                      {formatDateTimeWib(log.created_at)}
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      <span className="font-mono font-semibold text-slate-900">
                        @{log.username}
                      </span>
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      <RoleBadge role={log.role} />
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      <CategoryBadge category={log.category} />
                    </td>
                    <td className="py-3 px-4 font-semibold text-slate-900 whitespace-nowrap">
                      {log.action}
                    </td>
                    <td className="py-3 px-4 font-mono text-[11px] text-slate-700 whitespace-nowrap">
                      {log.target_label || '—'}
                    </td>
                    <td className="py-3 px-4 text-slate-600 leading-relaxed min-w-[260px]">
                      {log.details || '—'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Footer */}
        <div className="px-4 py-3 border-t border-slate-200 bg-slate-50/60 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-600">
          <div className="tabular-nums">
            Menampilkan <strong className="text-slate-900">{logs.length}</strong> dari{' '}
            <strong className="text-slate-900">{total}</strong> catatan log · Halaman{' '}
            <strong className="text-slate-900">{page}</strong> dari{' '}
            <strong className="text-slate-900">{totalPages}</strong>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={page <= 1 || loading}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-100 disabled:opacity-45 disabled:pointer-events-none rounded-md transition-colors"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              Sebelumnya
            </button>
            <button
              type="button"
              disabled={page >= totalPages || loading}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-100 disabled:opacity-45 disabled:pointer-events-none rounded-md transition-colors"
            >
              Berikutnya
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
