import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import {
  Archive,
  CalendarClock,
  Check,
  DatabaseBackup,
  Download,
  FileSpreadsheet,
  HardDriveDownload,
  RefreshCw,
  ShieldAlert,
} from 'lucide-react';
import type {
  ActivityLog,
  AuthUser,
  BackupFrequency,
  BackupSettings,
  BackupSnapshotMeta,
  Customer,
  InternetPackage,
  Invoice,
} from '../types';
import { apiFetch, auditDataExport, canManageBackups } from '../utils/auth';
import {
  downloadBlobFile,
  exportActivityLogsToCsv,
  exportActivityLogsToExcel,
  exportCustomersToCsv,
  exportCustomersToExcel,
  exportInvoicesToCsv,
  exportInvoicesToExcel,
  formatBytes,
  formatDateTimeWib,
} from '../utils/format';

interface BackupExportViewProps {
  currentUser: AuthUser;
  customers: Customer[];
  packages: InternetPackage[];
  onNotify: (msg: string, type?: 'success' | 'error') => void;
}

const FREQUENCY_LABELS: Record<BackupFrequency, string> = {
  disabled: 'Nonaktif',
  daily: 'Harian (Setiap Hari)',
  weekly: 'Mingguan (Setiap 7 Hari)',
};

export function BackupExportView({
  currentUser,
  customers,
  packages,
  onNotify,
}: BackupExportViewProps) {
  const isAdmin = canManageBackups(currentUser);
  const [settings, setSettings] = useState<BackupSettings | null>(null);
  const [snapshots, setSnapshots] = useState<BackupSnapshotMeta[]>([]);
  const [loading, setLoading] = useState(true);

  const [frequency, setFrequency] = useState<BackupFrequency>('daily');
  const [backupHourWib, setBackupHourWib] = useState<number>(2);
  const [retentionCount, setRetentionCount] = useState<number>(7);

  const [savingSchedule, setSavingSchedule] = useState(false);
  const [runningBackup, setRunningBackup] = useState(false);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);
  const [exportingKey, setExportingKey] = useState<string | null>(null);

  const loadBackupState = useCallback(async () => {
    if (!isAdmin) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await apiFetch('/api/backups');
      const json = (await res.json()) as {
        settings?: BackupSettings;
        snapshots?: BackupSnapshotMeta[];
        error?: string;
      };
      if (!res.ok) {
        onNotify(json.error || 'Gagal memuat riwayat backup.', 'error');
        return;
      }
      if (json.settings) {
        setSettings(json.settings);
        setFrequency(json.settings.schedule_frequency);
        setBackupHourWib(json.settings.backup_hour_wib);
        setRetentionCount(json.settings.retention_count);
      }
      setSnapshots(json.snapshots ?? []);
    } catch {
      onNotify('Gagal terhubung ke server saat memuat backup.', 'error');
    } finally {
      setLoading(false);
    }
  }, [isAdmin, onNotify]);

  useEffect(() => {
    void loadBackupState();
  }, [loadBackupState]);

  async function handleSaveSchedule(e: FormEvent) {
    e.preventDefault();
    if (!isAdmin) return;
    setSavingSchedule(true);
    try {
      const res = await apiFetch('/api/backups/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          schedule_frequency: frequency,
          backup_hour_wib: backupHourWib,
          retention_count: retentionCount,
        }),
      });
      const json = (await res.json()) as {
        settings?: BackupSettings;
        snapshots?: BackupSnapshotMeta[];
        error?: string;
      };
      if (!res.ok) {
        onNotify(json.error || 'Gagal menyimpan jadwal backup.', 'error');
        return;
      }
      if (json.settings) setSettings(json.settings);
      if (json.snapshots) setSnapshots(json.snapshots);
      onNotify(
        `Jadwal backup berkala diperbarui (${FREQUENCY_LABELS[frequency]}, retensi maks. ${retentionCount} arsip).`,
        'success'
      );
    } catch {
      onNotify('Terjadi kesalahan saat menyimpan jadwal backup.', 'error');
    } finally {
      setSavingSchedule(false);
    }
  }

  async function handleRunBackupNow() {
    if (!isAdmin) return;
    setRunningBackup(true);
    try {
      const res = await apiFetch('/api/backups/run', { method: 'POST' });
      const json = (await res.json()) as {
        snapshot_meta?: BackupSnapshotMeta;
        snapshot?: Record<string, unknown>;
        settings?: BackupSettings;
        snapshots?: BackupSnapshotMeta[];
        error?: string;
      };
      if (!res.ok) {
        onNotify(json.error || 'Gagal membuat snapshot backup.', 'error');
        return;
      }
      if (json.settings) setSettings(json.settings);
      if (json.snapshots) setSnapshots(json.snapshots);

      if (json.snapshot && json.snapshot_meta) {
        const blob = new Blob([JSON.stringify(json.snapshot, null, 2)], {
          type: 'application/json;charset=utf-8;',
        });
        downloadBlobFile(blob, json.snapshot_meta.filename);
        onNotify(
          `Snapshot ${json.snapshot_meta.filename} (${json.snapshot_meta.total_records} catatan) berhasil dibuat dan diunduh.`,
          'success'
        );
      }
    } catch {
      onNotify('Gagal terhubung ke server saat membuat snapshot backup.', 'error');
    } finally {
      setRunningBackup(false);
    }
  }

  async function handleDownloadSnapshot(meta: BackupSnapshotMeta) {
    if (!isAdmin) return;
    setDownloadingId(meta.id);
    try {
      const res = await apiFetch(`/api/backups/${meta.id}/download`);
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        onNotify(json.error || 'Gagal mengunduh ulang snapshot.', 'error');
        return;
      }
      const blob = await res.blob();
      downloadBlobFile(blob, meta.filename);
      onNotify(`Arsip ${meta.filename} berhasil diunduh.`, 'success');
    } catch {
      onNotify('Terjadi kesalahan saat mengunduh arsip backup.', 'error');
    } finally {
      setDownloadingId(null);
    }
  }

  async function handleQuickExportCustomers(format: 'CSV' | 'Excel') {
    const key = `cust-${format}`;
    setExportingKey(key);
    try {
      if (format === 'CSV') {
        exportCustomersToCsv(customers);
      } else {
        exportCustomersToExcel(customers, packages);
      }
      await auditDataExport('customers', format, customers.length, 'Semua Pelanggan');
      onNotify(`Data pelanggan (${customers.length} baris) berhasil diekspor ke ${format}.`, 'success');
    } catch {
      onNotify(`Gagal mengekspor data pelanggan (${format}).`, 'error');
    } finally {
      setExportingKey(null);
    }
  }

  async function handleQuickExportInvoices(format: 'CSV' | 'Excel') {
    const key = `inv-${format}`;
    setExportingKey(key);
    try {
      const res = await apiFetch('/api/invoices?period=all');
      const json = (await res.json()) as { invoices?: Invoice[]; error?: string };
      if (!res.ok) {
        onNotify(json.error || 'Gagal memuat seluruh tagihan untuk diekspor.', 'error');
        return;
      }
      const allInvoices = json.invoices ?? [];
      if (format === 'CSV') {
        exportInvoicesToCsv(allInvoices, 'Semua_Periode');
      } else {
        exportInvoicesToExcel(allInvoices, 'Semua_Periode');
      }
      await auditDataExport('billing', format, allInvoices.length, 'Semua Periode');
      onNotify(
        `Data tagihan & pembayaran (${allInvoices.length} invoice) berhasil diekspor ke ${format}.`,
        'success'
      );
    } catch {
      onNotify(`Gagal mengekspor data tagihan (${format}).`, 'error');
    } finally {
      setExportingKey(null);
    }
  }

  async function handleQuickExportLogs(format: 'CSV' | 'Excel') {
    const key = `logs-${format}`;
    setExportingKey(key);
    try {
      const params = new URLSearchParams({
        category: 'all',
        role: 'all',
        search: '',
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
        exportActivityLogsToExcel(rows, 'Semua');
      }
      onNotify(`Log aktivitas (${rows.length} baris) berhasil diekspor ke ${format}.`, 'success');
    } catch {
      onNotify(`Gagal mengekspor log aktivitas (${format}).`, 'error');
    } finally {
      setExportingKey(null);
    }
  }

  if (!isAdmin) {
    return (
      <div className="bg-white border border-rose-200 rounded-lg p-6 flex items-start gap-3">
        <ShieldAlert className="w-5 h-5 text-rose-700 shrink-0 mt-0.5" />
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Akses Terbatas (Khusus Admin)</h2>
          <p className="text-xs text-slate-600 mt-1">
            Pembuatan snapshot backup penuh (.json) dan pengaturan jadwal backup berkala hanya diizinkan untuk peran Administrator.
          </p>
        </div>
      </div>
    );
  }

  const latestSnapshot = snapshots[0] ?? null;

  return (
    <div className="space-y-6">
      {/* Top Action Strip */}
      <section className="bg-white border border-slate-200 rounded-lg p-5 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-md bg-red-50 border border-red-200 flex items-center justify-center text-red-700 shrink-0">
            <DatabaseBackup className="w-5 h-5" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              Snapshot Backup Penuh &amp; Ekspor Data Berkala
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              Unduh arsip JSON lengkap (Pelanggan, Paket, Tagihan, Node Jaringan, ODP, Template WA, Log Aktivitas) berstempel waktu WIB, atur jadwal otomatis, atau ekspor CSV/Excel.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={() => void loadBackupState()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-md transition-colors whitespace-nowrap shrink-0"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Muat Ulang
          </button>
          <button
            type="button"
            disabled={runningBackup}
            onClick={() => void handleRunBackupNow()}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-red-700 hover:bg-red-800 disabled:opacity-50 rounded-md transition-colors whitespace-nowrap shrink-0"
          >
            <HardDriveDownload className="w-4 h-4" />
            {runningBackup ? 'Membuat Snapshot...' : 'Backup Sekarang (.json)'}
          </button>
        </div>
      </section>

      {/* 4 Summary KPI Boxes */}
      <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="text-xs text-slate-500">Status Jadwal Otomatis</div>
          <div className="mt-1.5 text-lg font-bold text-slate-900">
            {settings ? FREQUENCY_LABELS[settings.schedule_frequency].split(' ')[0] : '—'}
          </div>
          <div className="mt-1 text-xs font-mono text-slate-500 tabular-nums">
            {settings && settings.schedule_frequency !== 'disabled'
              ? `Pukul ${String(settings.backup_hour_wib).padStart(2, '0')}:00 WIB`
              : 'Penjadwalan otomatis nonaktif'}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="text-xs text-slate-500">Arsip Snapshot Tersimpan</div>
          <div className="mt-1.5 text-lg font-bold font-mono text-slate-900 tabular-nums">
            {snapshots.length} / {settings?.retention_count ?? retentionCount} arsip
          </div>
          <div className="mt-1 text-xs text-slate-500">
            Batas retensi otomatis aktif
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="text-xs text-slate-500">Backup Terakhir (WIB)</div>
          <div className="mt-1.5 text-sm font-bold font-mono text-slate-900 tabular-nums">
            {latestSnapshot ? formatDateTimeWib(latestSnapshot.created_at) : 'Belum ada'}
          </div>
          <div className="mt-1 text-xs text-slate-500 tabular-nums">
            {latestSnapshot
              ? `${latestSnapshot.total_records} catatan · ${formatBytes(latestSnapshot.size_bytes)}`
              : 'Tekan Backup Sekarang untuk membuat'}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="text-xs text-slate-500">Jadwal Berikutnya (WIB)</div>
          <div className="mt-1.5 text-sm font-bold font-mono text-red-700 tabular-nums">
            {settings?.next_run_at ? formatDateTimeWib(settings.next_run_at) : 'Tidak Terjadwal'}
          </div>
          <div className="mt-1 text-xs text-slate-500">
            Diperbarui oleh @{settings?.updated_by ?? currentUser.username}
          </div>
        </div>
      </section>

      {/* 2-Column Split: Schedule Settings + Operational CSV/Excel Export */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Backup Schedule Form */}
        <form
          onSubmit={handleSaveSchedule}
          className="lg:col-span-5 bg-white border border-slate-200 rounded-lg overflow-hidden flex flex-col justify-between"
        >
          <div>
            <div className="px-5 py-4 border-b border-slate-200 flex items-center gap-2">
              <CalendarClock className="w-4 h-4 text-red-700" aria-hidden="true" />
              <h3 className="text-sm font-semibold text-slate-900">
                Pengaturan Jadwal Backup Otomatis
              </h3>
            </div>

            <div className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  Frekuensi Backup Berkala
                </label>
                <select
                  value={frequency}
                  onChange={(e) => setFrequency(e.target.value as BackupFrequency)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-md bg-white focus:outline-none focus:border-red-600"
                >
                  <option value="daily">Harian (Setiap Hari)</option>
                  <option value="weekly">Mingguan (Setiap 7 Hari)</option>
                  <option value="disabled">Nonaktif (Manual Saja)</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1.5">
                    Jam Eksekusi (WIB)
                  </label>
                  <select
                    value={backupHourWib}
                    disabled={frequency === 'disabled'}
                    onChange={(e) => setBackupHourWib(Number(e.target.value))}
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-md bg-white focus:outline-none focus:border-red-600 disabled:bg-slate-50 disabled:text-slate-400"
                  >
                    {Array.from({ length: 24 }, (_, hr) => (
                      <option key={hr} value={hr}>
                        {String(hr).padStart(2, '0')}:00 WIB
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1.5">
                    Arsip Dipertahankan
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={50}
                    required
                    value={retentionCount}
                    onChange={(e) => setRetentionCount(Math.max(1, Math.min(50, Number(e.target.value) || 1)))}
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-md focus:outline-none focus:border-red-600"
                  />
                </div>
              </div>

              <p className="text-[11px] text-slate-500 leading-relaxed">
                Sistem menyimpan maksimal <strong className="text-slate-800">{retentionCount} arsip snapshot</strong> terbaru di server. Arsip terlama otomatis dipangkas ketika batas terlampaui.
              </p>
            </div>
          </div>

          <div className="px-5 py-3.5 border-t border-slate-200 bg-slate-50/70 flex items-center justify-end">
            <button
              type="submit"
              disabled={savingSchedule}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-50 rounded-md transition-colors whitespace-nowrap shrink-0"
            >
              <Check className="w-3.5 h-3.5" />
              {savingSchedule ? 'Menyimpan...' : 'Simpan Jadwal Backup'}
            </button>
          </div>
        </form>

        {/* Right: Operational Data Exports (CSV & Excel) */}
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <FileSpreadsheet className="w-4 h-4 text-emerald-700" aria-hidden="true" />
              <h3 className="text-sm font-semibold text-slate-900">
                Ekspor Data Operasional (CSV &amp; Excel .xlsx)
              </h3>
            </div>
            <span className="text-[11px] text-slate-500">Tercatat otomatis ke Log Aktivitas</span>
          </div>

          <div className="divide-y divide-slate-100">
            {/* Row 1: Customers */}
            <div className="px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-slate-900">
                  Data Pelanggan &amp; Referensi Paket
                </div>
                <div className="text-xs text-slate-500 mt-0.5 tabular-nums">
                  {customers.length} pelanggan terdaftar · {packages.length} paket internet
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  disabled={exportingKey !== null}
                  onClick={() => void handleQuickExportCustomers('CSV')}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-md transition-colors whitespace-nowrap shrink-0"
                >
                  <Download className="w-3.5 h-3.5 text-slate-500" />
                  Ekspor CSV
                </button>
                <button
                  type="button"
                  disabled={exportingKey !== null}
                  onClick={() => void handleQuickExportCustomers('Excel')}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-emerald-800 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 rounded-md transition-colors whitespace-nowrap shrink-0"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-700" />
                  Ekspor Excel
                </button>
              </div>
            </div>

            {/* Row 2: Billing & Payments */}
            <div className="px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-slate-900">
                  Data Tagihan &amp; Riwayat Pembayaran
                </div>
                <div className="text-xs text-slate-500 mt-0.5">
                  Seluruh invoice lintas periode beserta status lunas, metode bayar &amp; tunggakan
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  disabled={exportingKey !== null}
                  onClick={() => void handleQuickExportInvoices('CSV')}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-md transition-colors whitespace-nowrap shrink-0"
                >
                  <Download className="w-3.5 h-3.5 text-slate-500" />
                  {exportingKey === 'inv-CSV' ? 'Memproses...' : 'Ekspor CSV'}
                </button>
                <button
                  type="button"
                  disabled={exportingKey !== null}
                  onClick={() => void handleQuickExportInvoices('Excel')}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-emerald-800 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 rounded-md transition-colors whitespace-nowrap shrink-0"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-700" />
                  {exportingKey === 'inv-Excel' ? 'Memproses...' : 'Ekspor Excel'}
                </button>
              </div>
            </div>

            {/* Row 3: Activity Logs */}
            <div className="px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-slate-900">
                  Log Aktivitas &amp; Jejak Audit Sistem
                </div>
                <div className="text-xs text-slate-500 mt-0.5">
                  Riwayat login, pelunasan, pengiriman WA, isolir/buka isolir, backup &amp; penolakan 403
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  disabled={exportingKey !== null}
                  onClick={() => void handleQuickExportLogs('CSV')}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-md transition-colors whitespace-nowrap shrink-0"
                >
                  <Download className="w-3.5 h-3.5 text-slate-500" />
                  {exportingKey === 'logs-CSV' ? 'Memproses...' : 'Ekspor CSV'}
                </button>
                <button
                  type="button"
                  disabled={exportingKey !== null}
                  onClick={() => void handleQuickExportLogs('Excel')}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-emerald-800 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 rounded-md transition-colors whitespace-nowrap shrink-0"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-700" />
                  {exportingKey === 'logs-Excel' ? 'Memproses...' : 'Ekspor Excel'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Snapshot Backup History Table */}
      <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Archive className="w-4 h-4 text-slate-600" aria-hidden="true" />
            <div>
              <h3 className="text-sm font-semibold text-slate-900">
                Riwayat Snapshot Backup Tersimpan
              </h3>
              <p className="text-xs text-slate-500">
                Arsip JSON siap unduh ulang kapan saja selama masih dalam batas retensi ({settings?.retention_count ?? retentionCount} arsip terakhir).
              </p>
            </div>
          </div>
          <span className="text-xs font-mono text-slate-600 tabular-nums">
            Total: {snapshots.length} arsip
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                <th className="py-3 px-4 whitespace-nowrap">Waktu (WIB)</th>
                <th className="py-3 px-4">Nama File Snapshot</th>
                <th className="py-3 px-4 whitespace-nowrap">Jenis</th>
                <th className="py-3 px-4 whitespace-nowrap">Pemicu</th>
                <th className="py-3 px-4">Ringkasan Isi Data</th>
                <th className="py-3 px-4 text-right whitespace-nowrap">Ukuran</th>
                <th className="py-3 px-4 text-right whitespace-nowrap">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {loading && snapshots.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-10 text-center text-slate-500">
                    Memuat daftar snapshot backup...
                  </td>
                </tr>
              ) : snapshots.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-10 text-center text-slate-500">
                    Belum ada arsip snapshot backup. Klik &quot;Backup Sekarang (.json)&quot; untuk membuat snapshot pertama.
                  </td>
                </tr>
              ) : (
                snapshots.map((snap) => (
                  <tr key={snap.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="py-3 px-4 font-mono text-[11px] text-slate-600 tabular-nums whitespace-nowrap">
                      {formatDateTimeWib(snap.created_at)}
                    </td>
                    <td className="py-3 px-4 font-mono text-[11px] font-medium text-slate-900 whitespace-nowrap">
                      {snap.filename}
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      <span
                        className={`inline-block px-2 py-0.5 text-[11px] font-medium rounded border ${
                          snap.backup_type === 'manual'
                            ? 'bg-red-50 text-red-700 border-red-200'
                            : 'bg-slate-100 text-slate-700 border-slate-200'
                        }`}
                      >
                        {snap.backup_type === 'manual' ? 'Manual' : 'Terjadwal'}
                      </span>
                    </td>
                    <td className="py-3 px-4 font-mono text-[11px] text-slate-700 whitespace-nowrap">
                      {snap.triggered_by}
                    </td>
                    <td className="py-3 px-4 text-slate-600 tabular-nums">
                      <span className="font-semibold text-slate-900">{snap.total_records} catatan</span>
                      <span className="text-slate-400 mx-1.5" aria-hidden="true">·</span>
                      <span>
                        {snap.counts.customers} plg, {snap.counts.invoices} inv, {snap.counts.network_nodes} node, {snap.counts.network_odps} odp, {snap.counts.activity_logs} log
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right font-mono text-[11px] text-slate-700 tabular-nums whitespace-nowrap">
                      {formatBytes(snap.size_bytes)}
                    </td>
                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      <button
                        type="button"
                        disabled={downloadingId === snap.id}
                        onClick={() => void handleDownloadSnapshot(snap)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-100 disabled:opacity-50 rounded-md transition-colors whitespace-nowrap shrink-0"
                      >
                        <Download className="w-3.5 h-3.5 text-slate-500" />
                        {downloadingId === snap.id ? 'Mengunduh...' : 'Unduh Ulang'}
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
  );
}
