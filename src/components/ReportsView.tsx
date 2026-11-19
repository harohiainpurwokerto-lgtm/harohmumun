import { Download, FileSpreadsheet, MessageCircle } from 'lucide-react';
import type { FinancialReportData, Invoice } from '../types';
import {
  exportReportToCsv,
  exportReportToExcel,
  formatDateId,
  formatDateTimeId,
  formatPeriodLabel,
  formatRupiah,
} from '../utils/format';
import { auditDataExport } from '../utils/auth';
import { DeviceStatusLabel, InvoiceStatusLabel } from './StatusText';

interface ReportsViewProps {
  report: FinancialReportData | null;
  loading: boolean;
  selectedPeriod: string;
  availablePeriods: string[];
  onChangePeriod: (period: string) => void;
  onOpenWhatsAppModal: (invoice: Invoice) => void;
}

export function ReportsView({
  report,
  loading,
  selectedPeriod,
  availablePeriods,
  onChangePeriod,
  onOpenWhatsAppModal,
}: ReportsViewProps) {
  const periodOptions = Array.from(
    new Set(['2026-12', '2026-11', '2026-10', '2026-09', ...availablePeriods])
  ).sort((a, b) => b.localeCompare(a));

  if (loading && !report) {
    return (
      <div className="space-y-4">
        <div className="h-24 bg-white border border-slate-200 rounded-lg animate-pulse" />
        <div className="h-64 bg-white border border-slate-200 rounded-lg animate-pulse" />
      </div>
    );
  }

  if (!report) return null;

  const { summary, by_payment_method, by_package, paid_invoices, unpaid_invoices } = report;

  return (
    <div className="space-y-6">
      {/* Toolbar: Period Selector + Excel/CSV Export */}
      <div className="bg-white border border-slate-200 rounded-lg p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <label htmlFor="report-period" className="text-xs font-medium text-slate-600">
            Periode Laporan:
          </label>
          <select
            id="report-period"
            value={selectedPeriod}
            onChange={(e) => onChangePeriod(e.target.value)}
            className="px-3 py-1.5 text-xs font-medium text-slate-800 bg-white border border-slate-200 rounded-md focus:outline-none focus:border-red-600"
          >
            {periodOptions.map((p) => (
              <option key={p} value={p}>
                {formatPeriodLabel(p)}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => {
              exportReportToCsv(report);
              void auditDataExport(
                'reports',
                'CSV',
                paid_invoices.length + unpaid_invoices.length,
                formatPeriodLabel(report.period)
              );
            }}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-md transition-colors whitespace-nowrap shrink-0"
          >
            <Download className="w-4 h-4 text-slate-500" />
            Ekspor CSV (.csv)
          </button>
          <button
            type="button"
            onClick={() => {
              exportReportToExcel(report);
              void auditDataExport(
                'reports',
                'Excel',
                paid_invoices.length + unpaid_invoices.length,
                formatPeriodLabel(report.period)
              );
            }}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white bg-emerald-700 hover:bg-emerald-800 rounded-md transition-colors whitespace-nowrap shrink-0"
          >
            <FileSpreadsheet className="w-4 h-4" />
            Ekspor Excel (.xlsx)
          </button>
        </div>
      </div>

      {/* 4 Summary Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="text-xs text-slate-500">
            Pemasukan Lunas ({formatPeriodLabel(report.period)})
          </div>
          <div className="mt-1.5 text-xl font-bold font-mono text-emerald-700 tabular-nums">
            {formatRupiah(summary.total_paid)}
          </div>
          <div className="mt-1 text-xs text-slate-500 tabular-nums">
            {summary.paid_count} transaksi terbayar
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="text-xs text-slate-500">
            Tunggakan Periode ({formatPeriodLabel(report.period)})
          </div>
          <div className="mt-1.5 text-xl font-bold font-mono text-rose-700 tabular-nums">
            {formatRupiah(summary.total_unpaid_period)}
          </div>
          <div className="mt-1 text-xs text-slate-500 tabular-nums">
            {summary.unpaid_period_count} invoice belum lunas
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="text-xs text-slate-500">Total Tunggakan Akumulatif</div>
          <div className="mt-1.5 text-xl font-bold font-mono text-slate-900 tabular-nums">
            {formatRupiah(summary.total_unpaid_all_time)}
          </div>
          <div className="mt-1 text-xs text-slate-500 tabular-nums">
            {summary.unpaid_all_time_count} invoice lintas bulan (Rp 0 denda)
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="text-xs text-slate-500">Rasio Penagihan Periode Ini</div>
          <div className="mt-1.5 text-xl font-bold font-mono text-red-700 tabular-nums">
            {summary.collection_rate_pct}%
          </div>
          <div className="mt-1 text-xs text-slate-500 tabular-nums">
            Dari total tagihan {formatRupiah(summary.total_billed)}
          </div>
        </div>
      </div>

      {/* Breakdown by Method and Package */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200">
            <h2 className="text-sm font-semibold text-slate-900">
              Rekap Pemasukan per Metode Pembayaran
            </h2>
          </div>
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                <th className="py-2 px-4">Metode Pembayaran</th>
                <th className="py-2 px-4 text-center">Transaksi</th>
                <th className="py-2 px-4 text-right">Total Nominal</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {by_payment_method.length === 0 ? (
                <tr>
                  <td colSpan={3} className="py-6 text-center text-slate-500">
                    Belum ada pemasukan lunas pada periode ini.
                  </td>
                </tr>
              ) : (
                by_payment_method.map((m) => (
                  <tr key={m.payment_method}>
                    <td className="py-2.5 px-4 font-medium text-slate-800">{m.payment_method}</td>
                    <td className="py-2.5 px-4 text-center font-mono tabular-nums text-slate-600">
                      {m.count}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono font-semibold text-slate-900 tabular-nums">
                      {formatRupiah(m.total_amount)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200">
            <h2 className="text-sm font-semibold text-slate-900">
              Rekap Tagihan per Paket Internet
            </h2>
          </div>
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                <th className="py-2 px-4">Paket</th>
                <th className="py-2 px-4 text-right">Lunas</th>
                <th className="py-2 px-4 text-right">Belum Lunas</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {by_package.length === 0 ? (
                <tr>
                  <td colSpan={3} className="py-6 text-center text-slate-500">
                    Belum ada tagihan pada periode ini.
                  </td>
                </tr>
              ) : (
                by_package.map((pkg) => (
                  <tr key={pkg.package_name}>
                    <td className="py-2.5 px-4 font-medium text-slate-800">{pkg.package_name}</td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums text-emerald-700">
                      {formatRupiah(pkg.paid_amount)} ({pkg.paid_count})
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums text-rose-700">
                      {formatRupiah(pkg.unpaid_amount)} ({pkg.unpaid_count})
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Paid Income Detail Table */}
      <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              Rincian Pemasukan Lunas ({formatPeriodLabel(report.period)})
            </h2>
          </div>
          <span className="text-xs font-mono font-semibold text-emerald-700 tabular-nums">
            Total: {formatRupiah(summary.total_paid)}
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                <th className="py-2.5 px-4">No. Invoice</th>
                <th className="py-2.5 px-4">Pelanggan</th>
                <th className="py-2.5 px-4">Paket</th>
                <th className="py-2.5 px-4">Metode Bayar</th>
                <th className="py-2.5 px-4">Waktu Pembayaran</th>
                <th className="py-2.5 px-4 text-right">Nominal</th>
                <th className="py-2.5 px-4">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {paid_invoices.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-500">
                    Belum ada pemasukan lunas pada periode {formatPeriodLabel(report.period)}.
                  </td>
                </tr>
              ) : (
                paid_invoices.map((inv) => (
                  <tr key={inv.id} className="hover:bg-slate-50">
                    <td className="py-2.5 px-4 font-mono text-slate-700 whitespace-nowrap">
                      {inv.invoice_number}
                    </td>
                    <td className="py-2.5 px-4 font-medium text-slate-900">
                      {inv.customer_name}{' '}
                      <span className="font-mono text-slate-400 font-normal">({inv.customer_code})</span>
                    </td>
                    <td className="py-2.5 px-4 text-slate-600">{inv.package_name}</td>
                    <td className="py-2.5 px-4 text-slate-700">{inv.payment_method}</td>
                    <td className="py-2.5 px-4 font-mono text-slate-500 tabular-nums whitespace-nowrap">
                      {formatDateTimeId(inv.paid_at)}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono font-semibold text-slate-900 tabular-nums whitespace-nowrap">
                      {formatRupiah(inv.amount)}
                    </td>
                    <td className="py-2.5 px-4 whitespace-nowrap">
                      <InvoiceStatusLabel status={inv.status} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Unpaid Arrears List (All Periods) */}
      <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              Daftar Tunggakan Aktif (Semua Periode, Tanpa Denda)
            </h2>
          </div>
          <span className="text-xs font-mono font-semibold text-rose-700 tabular-nums">
            Total Tunggakan: {formatRupiah(summary.total_unpaid_all_time)}
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                <th className="py-2.5 px-4">No. Invoice</th>
                <th className="py-2.5 px-4">Pelanggan</th>
                <th className="py-2.5 px-4">Periode</th>
                <th className="py-2.5 px-4">Jatuh Tempo</th>
                <th className="py-2.5 px-4">Perangkat</th>
                <th className="py-2.5 px-4 text-right">Nominal (Denda Rp 0)</th>
                <th className="py-2.5 px-4 text-right">Tindak Lanjut</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {unpaid_invoices.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-500">
                    Tidak ada daftar tunggakan saat ini.
                  </td>
                </tr>
              ) : (
                unpaid_invoices.map((inv) => (
                  <tr key={inv.id} className="hover:bg-slate-50">
                    <td className="py-2.5 px-4 font-mono text-slate-700 whitespace-nowrap">
                      {inv.invoice_number}
                    </td>
                    <td className="py-2.5 px-4">
                      <div className="font-medium text-slate-900">{inv.customer_name}</div>
                      <div className="text-slate-500">{inv.package_name}</div>
                    </td>
                    <td className="py-2.5 px-4 text-slate-700 whitespace-nowrap">
                      {formatPeriodLabel(inv.billing_period)}
                    </td>
                    <td className="py-2.5 px-4 font-mono text-slate-600 tabular-nums whitespace-nowrap">
                      {formatDateId(inv.due_date)}
                    </td>
                    <td className="py-2.5 px-4 whitespace-nowrap">
                      {inv.device_status ? <DeviceStatusLabel status={inv.device_status} /> : '—'}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono font-semibold text-rose-700 tabular-nums whitespace-nowrap">
                      {formatRupiah(inv.amount)}
                    </td>
                    <td className="py-2.5 px-4 text-right whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => onOpenWhatsAppModal(inv)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-emerald-700 border border-emerald-200 bg-emerald-50/60 hover:bg-emerald-100 rounded-md transition-colors whitespace-nowrap shrink-0"
                      >
                        <MessageCircle className="w-3.5 h-3.5" />
                        Ingatkan WA
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
