import { useMemo, useState } from 'react';
import {
  CalendarPlus,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Info,
  MessageCircle,
  RotateCcw,
  Search,
} from 'lucide-react';
import type { AuthUser, Invoice } from '../types';
import {
  exportInvoicesToCsv,
  exportInvoicesToExcel,
  formatDateId,
  formatDateTimeId,
  formatPeriodLabel,
  formatRupiah,
} from '../utils/format';
import { auditDataExport, canCollectBilling, canRevertPaidInvoice } from '../utils/auth';
import { InvoiceStatusLabel } from './StatusText';
import { ReadOnlyBanner } from './ReadOnlyIndicator';

interface BillingViewProps {
  currentUser: AuthUser;
  invoices: Invoice[];
  availablePeriods: string[];
  selectedPeriod: string;
  onChangePeriod: (period: string) => void;
  onGenerateInvoices: (period: string) => Promise<void>;
  onOpenPayModal: (invoice: Invoice) => void;
  onRevertPaid: (invoice: Invoice) => Promise<void>;
  onOpenWhatsAppModal: (invoice: Invoice) => void;
}

export function BillingView({
  currentUser,
  invoices,
  availablePeriods,
  selectedPeriod,
  onChangePeriod,
  onGenerateInvoices,
  onOpenPayModal,
  onRevertPaid,
  onOpenWhatsAppModal,
}: BillingViewProps) {
  const canCollect = canCollectBilling(currentUser);
  const canRevertPaid = canRevertPaidInvoice(currentUser);
  const isReadOnly = !canCollect;
  const [statusFilter, setStatusFilter] = useState<'all' | 'Belum Lunas' | 'Lunas'>('all');
  const [search, setSearch] = useState('');
  const [generatePeriod, setGeneratePeriod] = useState(selectedPeriod === 'all' ? '2026-11' : selectedPeriod);
  const [generating, setGenerating] = useState(false);

  const periodOptions = useMemo(() => {
    const set = new Set<string>(['2026-12', '2026-11', '2026-10', '2026-09', ...availablePeriods]);
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }, [availablePeriods]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return invoices.filter((inv) => {
      if (statusFilter !== 'all' && inv.status !== statusFilter) return false;
      if (!q) return true;
      return (
        inv.invoice_number.toLowerCase().includes(q) ||
        (inv.customer_name ?? '').toLowerCase().includes(q) ||
        (inv.customer_code ?? '').toLowerCase().includes(q) ||
        (inv.device_id ?? '').toLowerCase().includes(q)
      );
    });
  }, [invoices, statusFilter, search]);

  const summary = useMemo(() => {
    let totalPaid = 0;
    let totalUnpaid = 0;
    let paidCount = 0;
    let unpaidCount = 0;
    for (const inv of filtered) {
      if (inv.status === 'Lunas') {
        totalPaid += inv.amount;
        paidCount += 1;
      } else {
        totalUnpaid += inv.amount;
        unpaidCount += 1;
      }
    }
    return { totalPaid, totalUnpaid, paidCount, unpaidCount };
  }, [filtered]);

  async function handleGenerate() {
    setGenerating(true);
    try {
      await onGenerateInvoices(generatePeriod);
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="space-y-5">
      {isReadOnly && (
        <ReadOnlyBanner
          description="Peran Teknisi dapat memantau status tagihan dan tunggakan pelanggan di lapangan (termasuk status terisolir), namun aksi Buat Tagihan, Kirim Pengingat WA, Catat Lunas, dan Batal Lunas hanya tersedia untuk Bagian Keuangan / Admin."
        />
      )}

      {/* Zero-Penalty Policy Notice */}
      <div className="bg-white border border-slate-200 rounded-lg px-4 py-3 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-start sm:items-center gap-3 text-xs text-slate-700">
          <Info className="w-4 h-4 text-red-700 shrink-0 mt-0.5 sm:mt-0" aria-hidden="true" />
          <div>
            <span className="font-semibold text-slate-900">Kebijakan Billing Tanpa Denda Keterlambatan:</span>{' '}
            Seluruh tagihan bulanan diterbitkan tepat sesuai tarif paket pelanggan dengan biaya denda tetap{' '}
            <span className="font-mono font-semibold text-slate-900">Rp 0</span>.
            {currentUser.role === 'Keuangan' && (
              <span className="ml-2 inline-block px-2 py-0.5 text-[11px] font-medium rounded border bg-slate-100 text-slate-700 border-slate-200">
                Catatan: Batal Lunas khusus Admin
              </span>
            )}
          </div>
        </div>

        {canCollect && (
          <div className="flex items-center gap-2 shrink-0">
            <input
              type="month"
              value={generatePeriod}
              onChange={(e) => setGeneratePeriod(e.target.value)}
              aria-label="Pilih bulan pembuatan tagihan otomatis"
              className="px-2.5 py-1.5 text-xs font-mono border border-slate-200 rounded-md bg-white focus:outline-none focus:border-red-600"
            />
            <button
              type="button"
              disabled={generating}
              onClick={handleGenerate}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white bg-red-700 hover:bg-red-800 disabled:opacity-50 rounded-md transition-colors whitespace-nowrap shrink-0"
            >
              <CalendarPlus className="w-4 h-4" />
              {generating ? 'Membuat Tagihan...' : 'Buat Tagihan Otomatis'}
            </button>
          </div>
        )}
      </div>

      {/* Summary Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="text-xs text-slate-500">Total Tagihan Ditampilkan</div>
          <div className="mt-1 text-xl font-bold font-mono text-slate-900 tabular-nums">
            {filtered.length} invoice
          </div>
          <div className="mt-1 text-xs text-slate-500">
            Periode: {selectedPeriod === 'all' ? 'Semua Periode' : formatPeriodLabel(selectedPeriod)}
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="text-xs text-slate-500">Sudah Lunas ({summary.paidCount})</div>
          <div className="mt-1 text-xl font-bold font-mono text-emerald-700 tabular-nums">
            {formatRupiah(summary.totalPaid)}
          </div>
          <div className="mt-1 text-xs text-slate-500">Pembayaran terverifikasi</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="text-xs text-slate-500">Belum Lunas / Tunggakan ({summary.unpaidCount})</div>
          <div className="mt-1 text-xl font-bold font-mono text-rose-700 tabular-nums">
            {formatRupiah(summary.totalUnpaid)}
          </div>
          <div className="mt-1 text-xs text-slate-500">Denda keterlambatan: Rp 0</div>
        </div>
      </div>

      {/* Filter & Table */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="p-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <div className="relative w-full sm:w-80">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cari no. invoice, nama pelanggan, atau ID..."
              className="w-full pl-9 pr-3 py-1.5 text-sm border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-red-600/20 focus:border-red-600"
            />
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <select
              value={selectedPeriod}
              onChange={(e) => onChangePeriod(e.target.value)}
              aria-label="Filter periode billing"
              className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md focus:outline-none focus:border-red-600"
            >
              <option value="all">Semua Periode</option>
              {periodOptions.map((p) => (
                <option key={p} value={p}>
                  {formatPeriodLabel(p)}
                </option>
              ))}
            </select>

            <div className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-md">
              {(['all', 'Belum Lunas', 'Lunas'] as const).map((st) => (
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

            {canCollect && (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const label = selectedPeriod === 'all' ? 'Semua_Periode' : selectedPeriod;
                    exportInvoicesToCsv(filtered, label);
                    void auditDataExport(
                      'billing',
                      'CSV',
                      filtered.length,
                      selectedPeriod === 'all' ? 'Semua Periode' : formatPeriodLabel(selectedPeriod)
                    );
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-md transition-colors whitespace-nowrap shrink-0"
                >
                  <Download className="w-3.5 h-3.5 text-slate-500" />
                  Ekspor CSV
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const label = selectedPeriod === 'all' ? 'Semua_Periode' : selectedPeriod;
                    exportInvoicesToExcel(filtered, label);
                    void auditDataExport(
                      'billing',
                      'Excel',
                      filtered.length,
                      selectedPeriod === 'all' ? 'Semua Periode' : formatPeriodLabel(selectedPeriod)
                    );
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-emerald-800 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 rounded-md transition-colors whitespace-nowrap shrink-0"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-700" />
                  Ekspor Excel
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                <th className="py-2.5 px-4">No. Invoice</th>
                <th className="py-2.5 px-4">Pelanggan & Paket</th>
                <th className="py-2.5 px-4">Periode & Jatuh Tempo</th>
                <th className="py-2.5 px-4 text-right">Nominal Tagihan</th>
                <th className="py-2.5 px-4">Status</th>
                <th className="py-2.5 px-4">Keterangan Bayar / WA</th>
                <th className="py-2.5 px-4 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-10 text-center text-slate-500 text-sm">
                    Belum ada tagihan pada periode dan filter ini. Gunakan tombol &quot;Buat Tagihan Otomatis&quot; di atas.
                  </td>
                </tr>
              ) : (
                filtered.map((inv) => (
                  <tr key={inv.id} className="hover:bg-slate-50 transition-colors">
                    <td className="py-2.5 px-4 font-mono text-xs font-medium text-slate-800 whitespace-nowrap">
                      {inv.invoice_number}
                    </td>
                    <td className="py-2.5 px-4">
                      <div className="font-medium text-slate-900">{inv.customer_name}</div>
                      <div className="text-xs text-slate-500 flex items-center gap-1.5">
                        <span className="font-mono">{inv.customer_code}</span>
                        <span aria-hidden="true">·</span>
                        <span>{inv.package_name}</span>
                      </div>
                    </td>
                    <td className="py-2.5 px-4 whitespace-nowrap">
                      <div className="text-xs font-medium text-slate-800">
                        {formatPeriodLabel(inv.billing_period)}
                      </div>
                      <div className="text-xs font-mono text-slate-500 tabular-nums">
                        Tempo: {formatDateId(inv.due_date)}
                      </div>
                    </td>
                    <td className="py-2.5 px-4 text-right whitespace-nowrap">
                      <div className="font-mono font-semibold text-slate-900 tabular-nums">
                        {formatRupiah(inv.amount)}
                      </div>
                      <div className="text-[11px] font-mono text-slate-400 tabular-nums">
                        Denda: Rp 0
                      </div>
                    </td>
                    <td className="py-2.5 px-4 whitespace-nowrap">
                      <InvoiceStatusLabel status={inv.status} />
                    </td>
                    <td className="py-2.5 px-4 text-xs text-slate-500">
                      {inv.status === 'Lunas' ? (
                        <div>
                          <div className="font-medium text-slate-700">{inv.payment_method}</div>
                          <div className="font-mono text-[11px] tabular-nums">
                            {formatDateTimeId(inv.paid_at)}
                          </div>
                        </div>
                      ) : (
                        <div>
                          {inv.wa_reminder_sent_at ? (
                            <span className="text-emerald-700">
                              WA terkirim {formatDateTimeId(inv.wa_reminder_sent_at)}
                            </span>
                          ) : (
                            <span className="text-slate-400">Belum dikirim pengingat WA</span>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="py-2.5 px-4 text-right whitespace-nowrap">
                      {canCollect ? (
                        <div className="inline-flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => onOpenWhatsAppModal(inv)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-emerald-700 border border-emerald-200 bg-emerald-50/60 hover:bg-emerald-100 rounded-md transition-colors whitespace-nowrap shrink-0"
                          >
                            <MessageCircle className="w-3.5 h-3.5" />
                            Kirim WA
                          </button>
                          {inv.status === 'Belum Lunas' ? (
                            <button
                              type="button"
                              onClick={() => onOpenPayModal(inv)}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-white bg-red-700 hover:bg-red-800 rounded-md transition-colors whitespace-nowrap shrink-0"
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              Catat Lunas
                            </button>
                          ) : canRevertPaid ? (
                            <button
                              type="button"
                              onClick={() => onRevertPaid(inv)}
                              title="Kembalikan status menjadi Belum Lunas"
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-600 border border-slate-200 bg-white hover:bg-slate-100 rounded-md transition-colors whitespace-nowrap shrink-0"
                            >
                              <RotateCcw className="w-3.5 h-3.5" />
                              Batalkan
                            </button>
                          ) : (
                            <span className="text-[11px] text-slate-400 px-1.5">Lunas (Kunci Admin)</span>
                          )}
                        </div>
                      ) : (
                        <span className="text-[11px] text-slate-400">Lihat Saja</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
