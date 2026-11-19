import { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  LogOut,
  MessageCircle,
  Receipt,
  RefreshCw,
  Router,
  ShieldCheck,
  Wifi,
  WifiOff,
} from 'lucide-react';
import type { CustomerPortalData, Invoice } from '../types';
import {
  buildWhatsAppUrl,
  formatDateId,
  formatDateTimeWib,
  formatPeriodLabel,
  formatRupiah,
} from '../utils/format';

interface CustomerPortalViewProps {
  portal: CustomerPortalData;
  refreshing: boolean;
  onRefresh: () => Promise<void>;
  onLogout: () => Promise<void>;
}

function buildCustomerPaymentConfirmText(
  portal: CustomerPortalData,
  specificInvoice?: Invoice
): string {
  const { customer, unpaid_invoices, summary } = portal;
  if (specificInvoice) {
    return [
      `Halo Admin *Jatara IP-Home*,`,
      ``,
      `Saya pelanggan *${customer.name}* (${customer.customer_code}) ingin konfirmasi pembayaran / bertanya mengenai tagihan berikut:`,
      `• No. Invoice: ${specificInvoice.invoice_number}`,
      `• Periode: ${formatPeriodLabel(specificInvoice.billing_period)}`,
      `• Paket: ${customer.package_name}`,
      `• Nominal: ${formatRupiah(specificInvoice.amount)} (0% Denda)`,
      `• Status Koneksi: ${customer.device_status}`,
      ``,
      `Mohon dibantu verifikasi. Terima kasih.`,
    ].join('\n');
  }

  if (unpaid_invoices.length > 0) {
    const invList = unpaid_invoices
      .map((inv) => `${inv.invoice_number} (${formatPeriodLabel(inv.billing_period)} · ${formatRupiah(inv.amount)})`)
      .join(', ');
    return [
      `Halo Admin *Jatara IP-Home*,`,
      ``,
      `Saya *${customer.name}* (${customer.customer_code}) ingin melakukan konfirmasi pembayaran / meminta bantuan tagihan:`,
      `• Daftar Tagihan: ${invList}`,
      `• Total Tagihan: ${formatRupiah(summary.unpaid_total)} (Kebijakan 0% Denda)`,
      `• Status Perangkat: ${customer.device_status}`,
      ``,
      `Terima kasih.`,
    ].join('\n');
  }

  return [
    `Halo Tim *Jatara IP-Home*,`,
    ``,
    `Saya pelanggan *${customer.name}* (${customer.customer_code}), paket *${customer.package_name}*, perangkat *${customer.device_id}* (status saat ini: ${customer.device_status}).`,
    `Saya membutuhkan bantuan layanan / informasi tagihan. Terima kasih.`,
  ].join('\n');
}

export function CustomerPortalView({
  portal,
  refreshing,
  onRefresh,
  onLogout,
}: CustomerPortalViewProps) {
  const [logoError, setLogoError] = useState(false);
  const { customer, summary, unpaid_invoices, paid_invoices, support_whatsapp } = portal;

  const isIsolir = customer.device_status === 'Isolir';
  const isOffline = customer.device_status === 'Offline';

  const statusConfig = isIsolir
    ? {
        icon: AlertTriangle,
        title: 'Layanan Sedang Isolir Sementara',
        badgeText: 'ISOLIR SEMENTARA',
        badgeClass: 'bg-rose-100 text-rose-800 border-rose-200',
        containerClass: 'bg-rose-50 border-rose-200 text-rose-950',
        description:
          'Akses internet sementara ditangguhkan karena terdapat tagihan yang belum lunas. Tidak ada denda keterlambatan maupun biaya buka isolir (0% Denda). Setelah pembayaran diverifikasi Admin/Keuangan, layanan otomatis aktif kembali.',
      }
    : isOffline
      ? {
          icon: WifiOff,
          title: 'Perangkat Terdeteksi Offline / Tidak Terjangkau',
          badgeText: 'OFFLINE',
          badgeClass: 'bg-amber-100 text-amber-800 border-amber-200',
          containerClass: 'bg-amber-50 border-amber-200 text-amber-950',
          description:
            'Modem/ONT Anda saat ini tidak merespons monitoring jaringan. Pastikan adaptor listrik terpasang dan cek kabel fiber optik. Jika lampu LOS merah berkedip, hubungi tim teknis melalui WhatsApp.',
        }
      : {
          icon: Wifi,
          title: 'Layanan Internet Aktif & Terhubung',
          badgeText: 'ONLINE',
          badgeClass: 'bg-emerald-100 text-emerald-800 border-emerald-200',
          containerClass: 'bg-emerald-50/70 border-emerald-200 text-emerald-950',
          description:
            'Koneksi fiber optik rumah Anda berjalan normal tanpa kendala isolir. Terima kasih telah berlangganan Jatara IP-Home.',
        };

  const StatusIcon = statusConfig.icon;
  const generalWaUrl = buildWhatsAppUrl(
    support_whatsapp,
    buildCustomerPaymentConfirmText(portal)
  );

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
      {/* Top Portal Header */}
      <header className="sticky top-0 z-30 bg-red-700 text-white border-b border-red-800">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="bg-white rounded-md px-2.5 py-1.5 shadow-xs flex items-center gap-2 shrink-0">
              {!logoError ? (
                <img
                  src="/assets/jatara_logo_full.png"
                  alt="Logo Jatara"
                  referrerPolicy="no-referrer"
                  onError={() => setLogoError(true)}
                  className="h-6 w-auto object-contain shrink-0"
                />
              ) : (
                <span className="font-display text-sm font-bold text-red-700 whitespace-nowrap">
                  Jatara
                </span>
              )}
              <span className="h-4 w-px bg-red-200 shrink-0" aria-hidden="true" />
              <div className="flex items-center gap-1">
                <span className="font-display text-sm font-bold tracking-tight text-red-700 whitespace-nowrap">
                  IP-Home
                </span>
                <svg
                  viewBox="0 0 36 32"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                  className="w-6 h-5 text-red-600 shrink-0"
                  aria-label="Sketsa Rumah IP-Home"
                >
                  <path
                    d="M2.5 16.5L18 4.2L33.5 16.5"
                    stroke="currentColor"
                    strokeWidth="1.65"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <path
                    d="M7 13.5V27.5H29V13.5"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <path
                    d="M15.2 27.5V20.5C15.2 19.7 15.8 19 16.6 19H19.4C20.2 19 20.8 19.7 20.8 20.5V27.5"
                    stroke="currentColor"
                    strokeWidth="1.3"
                    strokeLinecap="round"
                  />
                  <path
                    d="M14.2 14.2C16.3 12.4 19.7 12.4 21.8 14.2"
                    stroke="currentColor"
                    strokeWidth="1.25"
                    strokeLinecap="round"
                  />
                </svg>
              </div>
            </div>

            <div className="min-w-0">
              <div className="text-xs font-semibold text-white truncate">
                Portal Pelanggan
              </div>
              <div className="text-[11px] font-mono text-red-100 truncate">
                {customer.customer_code} · {customer.name}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              disabled={refreshing}
              onClick={() => void onRefresh()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-red-800/80 hover:bg-red-800 border border-red-600 rounded-md transition-colors whitespace-nowrap shrink-0 disabled:opacity-60"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
              Perbarui Status
            </button>
            <button
              type="button"
              onClick={() => void onLogout()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-700 bg-white hover:bg-red-50 rounded-md transition-colors whitespace-nowrap shrink-0"
            >
              <LogOut className="w-3.5 h-3.5" />
              Keluar Portal
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-5xl w-full mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* Status Banner */}
        <section className={`border rounded-lg p-5 ${statusConfig.containerClass}`}>
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-start gap-3.5">
              <div className="p-2.5 bg-white/80 border border-black/10 rounded-md shrink-0">
                <StatusIcon className="w-5 h-5" aria-hidden="true" />
              </div>
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="font-display text-base sm:text-lg font-bold">
                    {statusConfig.title}
                  </h1>
                  <span
                    className={`inline-flex items-center px-2 py-0.5 text-[11px] font-semibold font-mono rounded border ${statusConfig.badgeClass}`}
                  >
                    {statusConfig.badgeText}
                  </span>
                </div>
                <p className="text-xs leading-relaxed opacity-90 max-w-2xl">
                  {statusConfig.description}
                </p>
              </div>
            </div>

            <a
              href={generalWaUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-md transition-colors whitespace-nowrap shrink-0"
            >
              <MessageCircle className="w-4 h-4 shrink-0" />
              WhatsApp Konfirmasi &amp; Bantuan
              <ExternalLink className="w-3.5 h-3.5 shrink-0 opacity-80" />
            </a>
          </div>
        </section>

        {/* 3 Summary Cards */}
        <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-2">
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>Paket Layanan Anda</span>
              <Router className="w-4 h-4 text-red-600" aria-hidden="true" />
            </div>
            <div className="text-base font-bold text-slate-900">{customer.package_name}</div>
            <div className="flex items-center justify-between text-xs pt-1 border-t border-slate-100">
              <span className="font-mono text-slate-600 tabular-nums">
                {customer.speed_down_mbps} / {customer.speed_up_mbps} Mbps
              </span>
              <span className="font-mono font-semibold text-red-700 tabular-nums">
                {formatRupiah(customer.effective_price)}/bln
              </span>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-2">
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>Tagihan Aktif (Belum Lunas)</span>
              <Receipt className="w-4 h-4 text-red-600" aria-hidden="true" />
            </div>
            <div
              className={`text-xl font-bold font-mono tabular-nums ${
                summary.unpaid_count > 0 ? 'text-rose-700' : 'text-emerald-700'
              }`}
            >
              {summary.unpaid_count > 0 ? formatRupiah(summary.unpaid_total) : 'Rp 0 (Lunas)'}
            </div>
            <div className="text-xs text-slate-600 pt-1 border-t border-slate-100 tabular-nums">
              {summary.unpaid_count > 0
                ? `${summary.unpaid_count} invoice menunggu pembayaran`
                : 'Tidak ada tunggakan aktif saat ini'}
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-2">
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>Kebijakan Denda &amp; Tempo</span>
              <ShieldCheck className="w-4 h-4 text-emerald-700" aria-hidden="true" />
            </div>
            <div className="text-base font-bold text-emerald-700">
              0% Denda Keterlambatan
            </div>
            <div className="flex items-center justify-between text-xs text-slate-600 pt-1 border-t border-slate-100">
              <span>Jatuh Tempo Bulanan</span>
              <span className="font-mono font-semibold text-slate-900 tabular-nums">
                Setiap Tanggal {String(customer.due_day).padStart(2, '0')}
              </span>
            </div>
          </div>
        </section>

        {/* Active Unpaid Invoices */}
        <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">
                Daftar Tagihan Aktif ({unpaid_invoices.length})
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Semua tagihan tanpa denda keterlambatan (Rp 0). Kirim bukti transfer melalui tombol WhatsApp.
              </p>
            </div>
            <span className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium rounded border bg-emerald-50 text-emerald-800 border-emerald-200">
              Kebijakan Resmi: 0% Denda
            </span>
          </div>

          {unpaid_invoices.length === 0 ? (
            <div className="px-5 py-10 text-center space-y-2">
              <CheckCircle2 className="w-8 h-8 text-emerald-600 mx-auto" aria-hidden="true" />
              <div className="text-sm font-semibold text-slate-900">
                Seluruh Tagihan Sudah Lunas
              </div>
              <p className="text-xs text-slate-500 max-w-md mx-auto">
                Terima kasih, tidak ada tagihan yang menunggu pembayaran pada akun {customer.customer_code}.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                    <th className="py-2.5 px-4">No. Invoice</th>
                    <th className="py-2.5 px-4">Periode</th>
                    <th className="py-2.5 px-4">Jatuh Tempo</th>
                    <th className="py-2.5 px-4 text-right">Tagihan</th>
                    <th className="py-2.5 px-4 text-right">Denda</th>
                    <th className="py-2.5 px-4">Status</th>
                    <th className="py-2.5 px-4 text-right">Konfirmasi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {unpaid_invoices.map((inv) => {
                    const invWaUrl = buildWhatsAppUrl(
                      support_whatsapp,
                      buildCustomerPaymentConfirmText(portal, inv)
                    );
                    return (
                      <tr key={inv.id} className="hover:bg-slate-50 transition-colors">
                        <td className="py-3 px-4 font-mono font-semibold text-slate-900 whitespace-nowrap">
                          {inv.invoice_number}
                        </td>
                        <td className="py-3 px-4 text-slate-700 whitespace-nowrap">
                          {formatPeriodLabel(inv.billing_period)}
                        </td>
                        <td className="py-3 px-4 font-mono text-slate-700 tabular-nums whitespace-nowrap">
                          {formatDateId(inv.due_date)}
                        </td>
                        <td className="py-3 px-4 text-right font-mono font-bold text-slate-900 tabular-nums whitespace-nowrap">
                          {formatRupiah(inv.amount)}
                        </td>
                        <td className="py-3 px-4 text-right font-mono text-emerald-700 tabular-nums whitespace-nowrap">
                          Rp 0 (0%)
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap">
                          <span className="inline-flex items-center px-2 py-0.5 text-[11px] font-semibold rounded border bg-rose-50 text-rose-700 border-rose-200">
                            Belum Lunas
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right whitespace-nowrap">
                          <a
                            href={invWaUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-emerald-700 hover:bg-emerald-800 rounded-md transition-colors whitespace-nowrap"
                          >
                            <MessageCircle className="w-3.5 h-3.5" />
                            Konfirmasi Bayar
                          </a>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Paid Invoice History & Account Details */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Paid History */}
          <section className="lg:col-span-8 bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-900">
                Riwayat Pembayaran Lunas ({paid_invoices.length})
              </h2>
              <span className="text-xs font-mono text-slate-500 tabular-nums">
                Total Lunas: {formatRupiah(summary.paid_total)}
              </span>
            </div>

            {paid_invoices.length === 0 ? (
              <div className="px-5 py-8 text-center text-xs text-slate-500">
                Belum ada riwayat pembayaran lunas yang tercatat.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                      <th className="py-2.5 px-4">Invoice</th>
                      <th className="py-2.5 px-4">Periode</th>
                      <th className="py-2.5 px-4">Metode</th>
                      <th className="py-2.5 px-4">Tanggal Bayar (WIB)</th>
                      <th className="py-2.5 px-4 text-right">Nominal</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-xs">
                    {paid_invoices.map((inv) => (
                      <tr key={inv.id} className="hover:bg-slate-50 transition-colors">
                        <td className="py-2.5 px-4 font-mono font-medium text-slate-900 whitespace-nowrap">
                          {inv.invoice_number}
                        </td>
                        <td className="py-2.5 px-4 text-slate-700 whitespace-nowrap">
                          {formatPeriodLabel(inv.billing_period)}
                        </td>
                        <td className="py-2.5 px-4 text-slate-700 whitespace-nowrap">
                          {inv.payment_method || 'Transfer'}
                        </td>
                        <td className="py-2.5 px-4 font-mono text-[11px] text-slate-600 tabular-nums whitespace-nowrap">
                          {inv.paid_at ? formatDateTimeWib(inv.paid_at) : '—'}
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono font-semibold text-emerald-700 tabular-nums whitespace-nowrap">
                          {formatRupiah(inv.amount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Customer Installation Profile */}
          <section className="lg:col-span-4 bg-white border border-slate-200 rounded-lg p-5 space-y-4">
            <h2 className="text-sm font-semibold text-slate-900 border-b border-slate-100 pb-3">
              Informasi Akun &amp; Perangkat
            </h2>
            <dl className="space-y-2.5 text-xs">
              <div className="flex justify-between gap-2">
                <dt className="text-slate-500">Kode Pelanggan</dt>
                <dd className="font-mono font-semibold text-slate-900">{customer.customer_code}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-slate-500">Nama</dt>
                <dd className="font-medium text-slate-900 text-right">{customer.name}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-slate-500">WhatsApp Terdaftar</dt>
                <dd className="font-mono text-slate-800">{customer.whatsapp}</dd>
              </div>
              <div className="pt-2 border-t border-slate-100">
                <dt className="text-slate-500 mb-0.5">Alamat Pemasangan</dt>
                <dd className="text-slate-800 leading-relaxed">{customer.address}</dd>
              </div>
              <div className="pt-2 border-t border-slate-100 flex justify-between gap-2">
                <dt className="text-slate-500">Perangkat Modem</dt>
                <dd className="font-mono text-slate-800 text-right">{customer.device_id}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-slate-500">Model</dt>
                <dd className="text-slate-700 text-right">{customer.device_model}</dd>
              </div>
              {(customer.odp_code || customer.node_name) && (
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-500">Jalur ODP / Node</dt>
                  <dd className="font-mono text-slate-700 text-right">
                    {customer.odp_code || customer.node_name}
                  </dd>
                </div>
              )}
              <div className="flex justify-between gap-2">
                <dt className="text-slate-500">Latency / Uptime</dt>
                <dd className="font-mono text-slate-700 tabular-nums text-right">
                  {customer.latency_ms !== null ? `${customer.latency_ms} ms` : '—'}
                  {customer.uptime_session ? ` · ${customer.uptime_session}` : ''}
                </dd>
              </div>
            </dl>
          </section>
        </div>
      </main>
    </div>
  );
}
