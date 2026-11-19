import { Database, KeyRound } from 'lucide-react';
import type { TableSchemaInfo } from '../types';

interface SchemaViewProps {
  tables: TableSchemaInfo[];
}

const TABLE_DESCRIPTIONS: Record<string, string> = {
  network_nodes: 'Konfigurasi, posisi topologi, dan metrik API perangkat inti MikroTik RouterOS dan OLT GPON/EPON.',
  network_odps: 'Inventaris box ODP / splitter distribusi fiber optik beserta kapasitas port, area cluster, dan koordinat peta.',
  packages: 'Master paket internet beserta kecepatan download/upload dan harga bulanan standar.',
  customers: 'Data pelanggan, alamat, nomor WhatsApp, relasi paket, perangkat ONT/Router (ID, IP, ODP, PON Port, dBm optik, GPS), serta jatuh tempo.',
  invoices: 'Tagihan bulanan otomatis dengan constraint late_fee = 0 (tanpa denda keterlambatan), status Lunas/Belum Lunas, dan log pengingat WA.',
  device_logs: 'Riwayat kronologis perubahan status perangkat (Online, Offline, Isolir) dan catatan disconnect.',
  webhook_events: 'Audit log setiap HTTP POST webhook yang diterima otomatis dari MikroTik, OLT, atau WhatsApp Gateway.',
  whatsapp_messages: 'Riwayat percakapan WhatsApp dua arah (outbound & inbound) per pelanggan beserta status pengiriman dan jenis template.',
  whatsapp_gateway_config: 'Konfigurasi integrasi WhatsApp Gateway API (Fonnte, Wablas, WAHA, dll.) beserta nomor pengirim dan status aktif.',
};

export function SchemaView({ tables }: SchemaViewProps) {
  return (
    <div className="space-y-6">
      <div className="bg-white border border-slate-200 rounded-lg p-5">
        <div className="flex items-start gap-3">
          <Database className="w-5 h-5 text-red-700 shrink-0 mt-0.5" />
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              Struktur Database Relasional SQLite (Aktif & Terintegrasi)
            </h2>
            <p className="text-xs text-slate-600 mt-1">
              Seluruh fitur aplikasi berjalan langsung di atas {tables.length || 9} tabel SQLite dengan integritas foreign key serta aturan database{' '}
              <span className="font-mono font-semibold text-slate-800">CHECK(late_fee = 0)</span> untuk menjamin tagihan bebas denda keterlambatan.
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {tables.map((tbl) => (
          <div key={tbl.name} className="bg-white border border-slate-200 rounded-lg overflow-hidden flex flex-col">
            <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <div>
                <h3 className="font-mono text-sm font-semibold text-slate-900">{tbl.name}</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  {TABLE_DESCRIPTIONS[tbl.name] || 'Tabel sistem'}
                </p>
              </div>
              <span className="font-mono text-xs text-slate-700 tabular-nums shrink-0 ml-3">
                {tbl.row_count} baris
              </span>
            </div>

            <div className="overflow-x-auto flex-1">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-100 text-[11px] font-medium text-slate-400">
                    <th className="py-2 px-4">Kolom</th>
                    <th className="py-2 px-4">Tipe Data</th>
                    <th className="py-2 px-4">Atribut</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {tbl.columns.map((col) => (
                    <tr key={col.name}>
                      <td className="py-1.5 px-4 font-mono text-slate-800 flex items-center gap-1.5">
                        {col.pk === 1 && <KeyRound className="w-3 h-3 text-amber-600 shrink-0" />}
                        <span>{col.name}</span>
                      </td>
                      <td className="py-1.5 px-4 font-mono text-slate-600">{col.type || 'TEXT'}</td>
                      <td className="py-1.5 px-4 text-[11px] text-slate-500 font-mono">
                        {[
                          col.pk === 1 ? 'PK' : null,
                          col.notnull === 1 ? 'NOT NULL' : 'NULL',
                          col.dflt_value ? `DEFAULT ${col.dflt_value}` : null,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
