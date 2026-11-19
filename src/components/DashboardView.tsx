import {
  ArrowRight,
  CheckCircle2,
  ClipboardList,
  MessageCircle,
  Router,
  ShieldAlert,
  Users,
  Wallet,
  Wifi,
  WifiOff,
} from 'lucide-react';
import type { AuthUser, DashboardData, FeatureKey, Invoice } from '../types';
import {
  formatDateId,
  formatDateTimeId,
  formatDateTimeWib,
  formatPeriodLabel,
  formatRupiah,
} from '../utils/format';
import { canCollectBilling } from '../utils/auth';
import { DeviceStatusLabel, InvoiceStatusLabel } from './StatusText';
import { CategoryBadge, RoleBadge } from './ActivityLogsView';
import { ReadOnlyBadge } from './ReadOnlyIndicator';

interface DashboardViewProps {
  currentUser: AuthUser;
  data: DashboardData | null;
  loading: boolean;
  canAccess?: (feature: FeatureKey) => boolean;
  onNavigate: (
    tab: 'customers' | 'billing' | 'monitoring' | 'reports' | 'mapping' | 'tickets' | 'activity_logs'
  ) => void;
  onQuickPay: (invoice: Invoice) => void;
  onQuickWhatsApp: (invoice: Invoice) => void;
}

export function DashboardView({
  currentUser,
  data,
  loading,
  canAccess = () => true,
  onNavigate,
  onQuickPay,
  onQuickWhatsApp,
}: DashboardViewProps) {
  if (loading && !data) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-32 bg-white border border-slate-200 rounded-lg p-5 animate-pulse">
              <div className="h-3 w-28 bg-slate-200 rounded mb-4" />
              <div className="h-7 w-36 bg-slate-200 rounded mb-2" />
              <div className="h-3 w-24 bg-slate-100 rounded" />
            </div>
          ))}
        </div>
        <div className="h-64 bg-white border border-slate-200 rounded-lg" />
      </div>
    );
  }

  if (!data) return null;

  const canViewBillingStatus = canAccess('billing') || canAccess('reports');
  const hasFinanceSummary =
    (currentUser.role === 'Admin' || currentUser.role === 'Keuangan') && canViewBillingStatus;
  const canCollect = canCollectBilling(currentUser);
  const hasNocAccess = canAccess('monitoring') || canAccess('mapping');

  const { kpis, monthly_trend, priority_unpaid, recent_device_logs } = data;
  const totalDevices = kpis.devices_online + kpis.devices_offline + kpis.devices_isolir;
  const maxTrendValue = Math.max(
    1,
    ...monthly_trend.map((m) => m.paid_total + m.unpaid_total)
  );
  const collectionPct =
    kpis.current_month_target > 0
      ? Math.round((kpis.current_month_revenue / kpis.current_month_target) * 100)
      : 0;

  return (
    <div className="space-y-6">
      {/* 4-Column KPI Strip */}
      <section aria-label="Ringkasan Utama" className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {/* KPI 1: Pelanggan Aktif */}
        <div className="bg-white border border-slate-200 rounded-lg p-5 flex flex-col justify-between">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-slate-500">Pelanggan Aktif</span>
            <Users className="w-4 h-4 text-slate-400 shrink-0" aria-hidden="true" />
          </div>
          <div className="mt-3">
            <div className="text-2xl font-bold text-slate-900 font-mono tabular-nums">
              {kpis.active_customers}
            </div>
            <div className="mt-1.5 flex items-center gap-2 text-xs text-slate-500">
              <span>{kpis.inactive_customers} nonaktif</span>
              {canAccess('customers') && (
                <>
                  <span aria-hidden="true">·</span>
                  <button
                    type="button"
                    onClick={() => onNavigate('customers')}
                    className="text-red-700 hover:underline font-medium"
                  >
                    Kelola pelanggan
                  </button>
                </>
              )}
            </div>
          </div>
        </div>

        {/* KPI 2: Pendapatan Bulan Berjalan */}
        <div className="bg-white border border-slate-200 rounded-lg p-5 flex flex-col justify-between">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-slate-500">
              Pendapatan ({formatPeriodLabel(data.period)})
            </span>
            <Wallet className="w-4 h-4 text-emerald-600 shrink-0" aria-hidden="true" />
          </div>
          <div className="mt-3">
            {hasFinanceSummary ? (
              <>
                <div className="text-2xl font-bold text-slate-900 font-mono tabular-nums">
                  {formatRupiah(kpis.current_month_revenue)}
                </div>
                <div className="mt-1.5 flex items-center gap-2 text-xs text-slate-500 tabular-nums">
                  <span>
                    {kpis.paid_invoices_count}/{kpis.total_invoices_count} tagihan lunas
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="text-emerald-700 font-medium">{collectionPct}%</span>
                </div>
              </>
            ) : (
              <>
                <div className="text-lg font-semibold text-slate-400">
                  Akses Terbatas
                </div>
                <div className="mt-1.5 text-xs text-slate-400">
                  Khusus Admin / Bagian Keuangan
                </div>
              </>
            )}
          </div>
        </div>

        {/* KPI 3: Total Tunggakan */}
        <div className="bg-white border border-slate-200 rounded-lg p-5 flex flex-col justify-between">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-slate-500">Total Tunggakan Aktif</span>
            <CheckCircle2 className="w-4 h-4 text-rose-600 shrink-0" aria-hidden="true" />
          </div>
          <div className="mt-3">
            {hasFinanceSummary ? (
              <>
                <div className="text-2xl font-bold text-rose-700 font-mono tabular-nums">
                  {formatRupiah(kpis.total_arrears_all_time)}
                </div>
                <div className="mt-1.5 flex items-center gap-2 text-xs text-slate-500 tabular-nums">
                  <span>{kpis.arrears_invoices_count} invoice belum lunas</span>
                  <span aria-hidden="true">·</span>
                  <span>Rp 0 denda</span>
                </div>
              </>
            ) : (
              <>
                <div className="text-lg font-semibold text-slate-400">
                  Akses Terbatas
                </div>
                <div className="mt-1.5 text-xs text-slate-400">
                  Khusus Admin / Bagian Keuangan
                </div>
              </>
            )}
          </div>
        </div>

        {/* KPI 4: Status Perangkat Jaringan */}
        <div className="bg-white border border-slate-200 rounded-lg p-5 flex flex-col justify-between">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-slate-500">Status Perangkat (ONT/Router)</span>
            <Router className="w-4 h-4 text-slate-400 shrink-0" aria-hidden="true" />
          </div>
          <div className="mt-3">
            <div className="flex items-baseline gap-3 font-mono tabular-nums">
              <span className="inline-flex items-center gap-1 text-base font-semibold text-emerald-700">
                <Wifi className="w-4 h-4" aria-hidden="true" />
                {kpis.devices_online}
              </span>
              <span className="text-slate-300">/</span>
              <span className="inline-flex items-center gap-1 text-base font-semibold text-rose-700">
                <WifiOff className="w-4 h-4" aria-hidden="true" />
                {kpis.devices_offline}
              </span>
              <span className="text-slate-300">/</span>
              <span className="inline-flex items-center gap-1 text-base font-semibold text-amber-700">
                <ShieldAlert className="w-4 h-4" aria-hidden="true" />
                {kpis.devices_isolir}
              </span>
            </div>
            <div className="mt-1.5 flex items-center gap-2 text-xs text-slate-500">
              <span>
                {totalDevices} ONT/Router · {kpis.mikrotik_online}/{kpis.mikrotik_total} MikroTik · {kpis.olt_online}/{kpis.olt_total} OLT
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Main Split: Monthly Trend & Device Summary */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        {/* Revenue vs Arrears Chart (Visible only for Admin & Keuangan) */}
        {hasFinanceSummary && (
          <div className={`${hasNocAccess ? 'lg:col-span-7' : 'lg:col-span-12'} bg-white border border-slate-200 rounded-lg p-5 flex flex-col justify-between`}>
            <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-100">
              <div>
                <h2 className="text-base font-semibold text-slate-900">
                  Perbandingan Pemasukan &amp; Tunggakan Bulanan
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Rekapitulasi tagihan tanpa denda keterlambatan per periode billing
                </p>
              </div>
              <div className="flex items-center gap-4 text-xs text-slate-600">
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 bg-red-700 rounded-xs inline-block" aria-hidden="true" />
                  Lunas
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 bg-rose-400 rounded-xs inline-block" aria-hidden="true" />
                  Belum Lunas
                </span>
              </div>
            </div>

            <div className="mt-5 space-y-4 flex-1 flex flex-col justify-center">
              {monthly_trend.length === 0 ? (
                <div className="py-10 text-center text-sm text-slate-500">
                  Belum ada riwayat tagihan bulanan.
                </div>
              ) : (
                monthly_trend.map((item) => {
                  const paidWidthPct = Math.round((item.paid_total / maxTrendValue) * 100);
                  const unpaidWidthPct = Math.round((item.unpaid_total / maxTrendValue) * 100);
                  return (
                    <div key={item.period} className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-medium text-slate-800">{item.label}</span>
                        <div className="flex items-center gap-3 font-mono tabular-nums">
                          <span className="text-slate-700">
                            Lunas: <strong className="text-slate-900">{formatRupiah(item.paid_total)}</strong> ({item.paid_count})
                          </span>
                          <span aria-hidden="true" className="text-slate-300">|</span>
                          <span className="text-rose-700">
                            Tunggakan: <strong>{formatRupiah(item.unpaid_total)}</strong> ({item.unpaid_count})
                          </span>
                        </div>
                      </div>
                      <div className="w-full h-3 bg-slate-100 rounded-sm overflow-hidden flex">
                        <div
                          className="h-full bg-red-700 transition-all duration-300"
                          style={{ width: `${paidWidthPct}%` }}
                          title={`Lunas: ${formatRupiah(item.paid_total)}`}
                        />
                        <div
                          className="h-full bg-rose-400 transition-all duration-300"
                          style={{ width: `${unpaidWidthPct}%` }}
                          title={`Belum Lunas: ${formatRupiah(item.unpaid_total)}`}
                        />
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <div className="mt-5 pt-4 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
              <span>Kebijakan billing: Nominal tetap sesuai paket bulanan (0% denda)</span>
              {canAccess('reports') && (
                <button
                  type="button"
                  onClick={() => onNavigate('reports')}
                  className="inline-flex items-center gap-1 font-medium text-red-700 hover:underline whitespace-nowrap shrink-0"
                >
                  Lihat Laporan Keuangan
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        )}

        {/* Recent Device Logs (Visible when user has Monitoring/Mapping access) */}
        {hasNocAccess && (
          <div className={`${hasFinanceSummary ? 'lg:col-span-5' : 'lg:col-span-12'} bg-white border border-slate-200 rounded-lg p-5 flex flex-col justify-between`}>
            <div className="flex items-center justify-between gap-2 pb-4 border-b border-slate-100">
              <div>
                <h2 className="text-base font-semibold text-slate-900">
                  Aktivitas Jaringan &amp; Disconnect Terbaru
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Log status perangkat dari Webhook API dan operator
                </p>
              </div>
              {canAccess('monitoring') && (
                <button
                  type="button"
                  onClick={() => onNavigate('monitoring')}
                  className="text-xs font-medium text-red-700 hover:underline whitespace-nowrap shrink-0"
                >
                  Buka NOC
                </button>
              )}
            </div>

            <div className="divide-y divide-slate-100 my-1 flex-1">
              {recent_device_logs.length === 0 ? (
                <div className="py-10 text-center text-sm text-slate-500">
                  Belum ada riwayat perubahan status perangkat.
                </div>
              ) : (
                recent_device_logs.slice(0, 5).map((log) => (
                  <div key={log.id} className="py-3 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-xs">
                        <span className="font-mono font-semibold text-slate-900">{log.device_id}</span>
                        <span aria-hidden="true" className="text-slate-300">·</span>
                        <span className="text-slate-700 truncate">{log.customer_name}</span>
                      </div>
                      <p className="text-xs text-slate-500 mt-1 line-clamp-1">
                        {log.reason || `Perubahan status ${log.previous_status} menjadi ${log.new_status}`}
                      </p>
                      <div className="mt-1 flex items-center gap-2 text-[11px] text-slate-400 font-mono tabular-nums">
                        <span>{formatDateTimeId(log.logged_at)}</span>
                        <span aria-hidden="true">·</span>
                        <span>{log.event_source}</span>
                      </div>
                    </div>
                    <div className="shrink-0 pt-0.5">
                      <DeviceStatusLabel status={log.new_status} />
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      {/* MikroTik & OLT API Infrastructure Strip */}
      {hasNocAccess && data.network_nodes && data.network_nodes.length > 0 && (
        <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">
                Status Node MikroTik &amp; OLT (Terintegrasi API)
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Metrik CPU, memori, trafik, serta jumlah sesi PPPoE dan ONT aktif dari perangkat inti jaringan
              </p>
            </div>
            {canAccess('monitoring') ? (
              <button
                type="button"
                onClick={() => onNavigate('monitoring')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-700 bg-red-50/70 border border-red-200 hover:bg-red-100 rounded-md transition-colors whitespace-nowrap shrink-0"
              >
                Kelola API Node
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            ) : canAccess('mapping') ? (
              <button
                type="button"
                onClick={() => onNavigate('mapping')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-700 bg-red-50/70 border border-red-200 hover:bg-red-100 rounded-md transition-colors whitespace-nowrap shrink-0"
              >
                Buka Mapping Topologi
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            ) : null}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-slate-200">
            {data.network_nodes.map((node) => (
              <div key={node.id} className="p-4 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-mono text-xs font-semibold text-red-700">
                      {node.node_code} · {node.node_type}
                    </div>
                    <div className="text-sm font-medium text-slate-900 truncate">{node.name}</div>
                  </div>
                  <span
                    className={`text-xs font-medium shrink-0 ${
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
                <div className="flex items-center justify-between text-xs font-mono text-slate-600 tabular-nums pt-1">
                  <span>CPU {node.cpu_load_pct}% · RAM {node.memory_used_pct}%</span>
                  <span>{node.active_sessions} {node.node_type === 'MikroTik' ? 'PPPoE' : 'ONT'}</span>
                </div>
                <div className="flex items-center justify-between text-[11px] font-mono text-slate-400 tabular-nums">
                  <span>{node.host_ip}</span>
                  <span>Rx {Number(node.rx_throughput_mbps).toFixed(1)} Mbps</span>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Priority Unpaid Invoices Table (Read-Only for Teknisi) */}
      {canViewBillingStatus && (
        <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="flex flex-wrap items-center gap-2.5">
                <h2 className="text-base font-semibold text-slate-900">
                  Tagihan Belum Lunas &amp; Prioritas Penagihan
                </h2>
                {!canCollect && <ReadOnlyBadge />}
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                {canCollect
                  ? 'Catat pembayaran atau kirim pengingat langsung ke WhatsApp pelanggan tanpa tambahan denda'
                  : 'Daftar status tunggakan pelanggan untuk pengecekan lapangan (aksi penagihan hanya untuk Keuangan / Admin)'}
              </p>
            </div>
            {canAccess('billing') && (
              <button
                type="button"
                onClick={() => onNavigate('billing')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors whitespace-nowrap shrink-0"
              >
                Semua Tagihan
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                  <th className="py-2.5 px-4">No. Invoice</th>
                  <th className="py-2.5 px-4">Pelanggan</th>
                  <th className="py-2.5 px-4">Periode</th>
                  <th className="py-2.5 px-4">Jatuh Tempo</th>
                  <th className="py-2.5 px-4 text-right">Tagihan</th>
                  <th className="py-2.5 px-4">Status</th>
                  <th className="py-2.5 px-4 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {priority_unpaid.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-10 text-center text-slate-500 text-sm">
                      Seluruh tagihan sudah lunas. Tidak ada tunggakan aktif.
                    </td>
                  </tr>
                ) : (
                  priority_unpaid.map((inv) => (
                    <tr key={inv.id} className="hover:bg-slate-50 transition-colors">
                      <td className="py-2.5 px-4 font-mono text-xs text-slate-700 whitespace-nowrap">
                        {inv.invoice_number}
                      </td>
                      <td className="py-2.5 px-4">
                        <div className="font-medium text-slate-900">{inv.customer_name}</div>
                        <div className="text-xs text-slate-500 flex items-center gap-1.5">
                          <span>{inv.package_name}</span>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono">{inv.device_id}</span>
                        </div>
                      </td>
                      <td className="py-2.5 px-4 text-xs text-slate-600 whitespace-nowrap">
                        {formatPeriodLabel(inv.billing_period)}
                      </td>
                      <td className="py-2.5 px-4 font-mono text-xs text-slate-600 tabular-nums whitespace-nowrap">
                        {formatDateId(inv.due_date)}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono font-semibold text-slate-900 tabular-nums whitespace-nowrap">
                        {formatRupiah(inv.amount)}
                      </td>
                      <td className="py-2.5 px-4 whitespace-nowrap">
                        <InvoiceStatusLabel status={inv.status} />
                      </td>
                      <td className="py-2.5 px-4 text-right whitespace-nowrap">
                        {canCollect ? (
                          <div className="inline-flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => onQuickWhatsApp(inv)}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-emerald-700 border border-emerald-200 bg-emerald-50/60 hover:bg-emerald-100 rounded-md transition-colors whitespace-nowrap shrink-0"
                            >
                              <MessageCircle className="w-3.5 h-3.5" />
                              Kirim WA
                            </button>
                            <button
                              type="button"
                              onClick={() => onQuickPay(inv)}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-white bg-red-700 hover:bg-red-800 rounded-md transition-colors whitespace-nowrap shrink-0"
                            >
                              Catat Lunas
                            </button>
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
        </section>
      )}
      {/* 5 Aktivitas Operator Terbaru (Jejak Audit Ringkas) */}
      <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <ClipboardList className="w-4 h-4 text-red-700 shrink-0" aria-hidden="true" />
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                5 Aktivitas Operator Terbaru
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Ringkasan jejak audit sistem terkini dalam zona waktu WIB (read-only)
              </p>
            </div>
          </div>

          {canAccess('activity_logs') && (
            <button
              type="button"
              onClick={() => onNavigate('activity_logs')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-700 bg-red-50/70 border border-red-200 hover:bg-red-100 rounded-md transition-colors whitespace-nowrap shrink-0"
            >
              Buka Log Aktivitas
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <div className="divide-y divide-slate-100">
          {(data.recent_activity_logs ?? []).length === 0 ? (
            <div className="py-10 text-center text-sm text-slate-500">
              Belum ada catatan aktivitas operator untuk kategori peran Anda.
            </div>
          ) : (
            (data.recent_activity_logs ?? []).slice(0, 5).map((log) => (
              <div
                key={log.id}
                className="px-5 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-slate-50/70 transition-colors"
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <RoleBadge role={log.role} />
                    <CategoryBadge category={log.category} />
                    <span className="font-mono font-semibold text-slate-900">
                      @{log.username}
                    </span>
                    <span className="text-slate-300" aria-hidden="true">·</span>
                    <span className="font-semibold text-slate-900">{log.action}</span>
                    {log.target_label && (
                      <>
                        <span className="text-slate-300" aria-hidden="true">→</span>
                        <span className="font-mono text-[11px] text-slate-700">
                          {log.target_label}
                        </span>
                      </>
                    )}
                  </div>
                  {log.details && (
                    <p className="text-xs text-slate-600 line-clamp-1">{log.details}</p>
                  )}
                </div>

                <div className="text-[11px] font-mono text-slate-500 tabular-nums whitespace-nowrap shrink-0">
                  {formatDateTimeWib(log.created_at)}
                </div>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}

