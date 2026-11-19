import { useMemo, useRef, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Copy,
  Download,
  Edit2,
  Eye,
  EyeOff,
  FileSpreadsheet,
  GitBranch,
  KeyRound,
  MessageCircle,
  Plus,
  RotateCcw,
  Search,
  Shuffle,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import type { AuthUser, Customer, DeviceStatus, InternetPackage } from '../types';
import {
  downloadCustomerTemplateExcel,
  exportCustomersToCsv,
  exportCustomersToExcel,
  formatRupiah,
  parseCustomerExcelFile,
} from '../utils/format';
import type { ParsedCustomerImportRow } from '../utils/format';
import { apiFetch, auditDataExport, canEditCustomersPackages } from '../utils/auth';
import { DeviceStatusLabel } from './StatusText';
import { ReadOnlyBanner } from './ReadOnlyIndicator';

interface CustomersPackagesViewProps {
  currentUser: AuthUser;
  customers: Customer[];
  packages: InternetPackage[];
  onRefresh: () => Promise<void>;
  onOpenChat?: (customerId: number) => void;
  onOpenMapping?: (customerId: number) => void;
  onNotify: (msg: string, type?: 'success' | 'error') => void;
}

export function CustomersPackagesView({
  currentUser,
  customers,
  packages,
  onRefresh,
  onOpenChat,
  onOpenMapping,
  onNotify,
}: CustomersPackagesViewProps) {
  const isReadOnly = !canEditCustomersPackages(currentUser);
  const [subTab, setSubTab] = useState<'customers' | 'packages'>('customers');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | DeviceStatus>('all');
  const [packageFilter, setPackageFilter] = useState<string>('all');

  // Customer Modal State
  const [custModalOpen, setCustModalOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [custForm, setCustForm] = useState({
    name: '',
    address: '',
    whatsapp: '',
    package_id: '',
    custom_price: '',
    device_id: '',
    device_ip: '',
    device_model: 'ZTE F609 v3',
    due_day: '10',
    device_status: 'Online' as DeviceStatus,
    customer_active: true,
  });

  // Package Modal State
  const [pkgModalOpen, setPkgModalOpen] = useState(false);
  const [editingPackage, setEditingPackage] = useState<InternetPackage | null>(null);
  const [pkgForm, setPkgForm] = useState({
    name: '',
    speed_down_mbps: '20',
    speed_up_mbps: '10',
    monthly_price: '165000',
    description: '',
  });

  const [submitting, setSubmitting] = useState(false);

  // Excel Upload / Import State
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importFileName, setImportFileName] = useState('');
  const [importRows, setImportRows] = useState<ParsedCustomerImportRow[]>([]);
  const [importMode, setImportMode] = useState<'upsert' | 'insert_only'>('upsert');
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{
    inserted_count: number;
    updated_count: number;
    skipped_count: number;
    errors: Array<{ row_number: number; name: string; reason: string }>;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Portal PIN Management State (Admin-only)
  const [revealedPinIds, setRevealedPinIds] = useState<Record<number, boolean>>({});
  const [copiedPinId, setCopiedPinId] = useState<number | null>(null);
  const [pinModalCustomer, setPinModalCustomer] = useState<Customer | null>(null);
  const [customPinInput, setCustomPinInput] = useState('');
  const [pinSubmitting, setPinSubmitting] = useState(false);

  const filteredCustomers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return customers.filter((c) => {
      if (statusFilter !== 'all' && c.device_status !== statusFilter) return false;
      if (packageFilter !== 'all' && String(c.package_id) !== packageFilter) return false;
      if (!q) return true;
      return (
        c.name.toLowerCase().includes(q) ||
        c.customer_code.toLowerCase().includes(q) ||
        c.address.toLowerCase().includes(q) ||
        c.device_id.toLowerCase().includes(q) ||
        c.device_ip.toLowerCase().includes(q) ||
        c.whatsapp.includes(q)
      );
    });
  }, [customers, search, statusFilter, packageFilter]);

  function openAddCustomer() {
    setEditingCustomer(null);
    const defaultPkgId = packages[0]?.id ? String(packages[0].id) : '';
    setCustForm({
      name: '',
      address: '',
      whatsapp: '',
      package_id: defaultPkgId,
      custom_price: '',
      device_id: `ONT-ZTE-${String(customers.length + 1).padStart(3, '0')}`,
      device_ip: `10.20.1.${101 + customers.length}`,
      device_model: 'ZTE F609 v3',
      due_day: '10',
      device_status: 'Online',
      customer_active: true,
    });
    setCustModalOpen(true);
  }

  function openEditCustomer(c: Customer) {
    setEditingCustomer(c);
    setCustForm({
      name: c.name,
      address: c.address,
      whatsapp: c.whatsapp,
      package_id: String(c.package_id),
      custom_price: c.custom_price ? String(c.custom_price) : '',
      device_id: c.device_id,
      device_ip: c.device_ip,
      device_model: c.device_model,
      due_day: String(c.due_day),
      device_status: c.device_status,
      customer_active: c.customer_active === 1,
    });
    setCustModalOpen(true);
  }

  async function handleSaveCustomer(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const payload = {
        ...custForm,
        package_id: Number(custForm.package_id),
        custom_price: custForm.custom_price ? Number(custForm.custom_price) : null,
        due_day: Number(custForm.due_day),
      };
      const url = editingCustomer ? `/api/customers/${editingCustomer.id}` : '/api/customers';
      const method = editingCustomer ? 'PUT' : 'POST';
      const res = await apiFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) {
        onNotify(json.error || 'Gagal menyimpan data pelanggan', 'error');
        return;
      }
      await onRefresh();
      setCustModalOpen(false);
      onNotify(
        editingCustomer ? 'Data pelanggan berhasil diperbarui.' : 'Pelanggan baru berhasil ditambahkan.',
        'success'
      );
    } catch {
      onNotify('Terjadi kesalahan koneksi saat menyimpan pelanggan.', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDeleteCustomer(c: Customer) {
    try {
      const res = await apiFetch(`/api/customers/${c.id}`, { method: 'DELETE' });
      const json = await res.json();
      if (!res.ok) {
        onNotify(json.error || 'Gagal menghapus pelanggan', 'error');
        return;
      }
      await onRefresh();
      onNotify(`Pelanggan ${c.name} telah dihapus.`, 'success');
    } catch {
      onNotify('Gagal menghapus pelanggan.', 'error');
    }
  }

  function openAddPackage() {
    setEditingPackage(null);
    setPkgForm({
      name: '',
      speed_down_mbps: '25',
      speed_up_mbps: '10',
      monthly_price: '175000',
      description: '',
    });
    setPkgModalOpen(true);
  }

  function openEditPackage(p: InternetPackage) {
    setEditingPackage(p);
    setPkgForm({
      name: p.name,
      speed_down_mbps: String(p.speed_down_mbps),
      speed_up_mbps: String(p.speed_up_mbps),
      monthly_price: String(p.monthly_price),
      description: p.description,
    });
    setPkgModalOpen(true);
  }

  async function handleSavePackage(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const payload = {
        name: pkgForm.name,
        speed_down_mbps: Number(pkgForm.speed_down_mbps),
        speed_up_mbps: Number(pkgForm.speed_up_mbps),
        monthly_price: Number(pkgForm.monthly_price),
        description: pkgForm.description,
      };
      const url = editingPackage ? `/api/packages/${editingPackage.id}` : '/api/packages';
      const method = editingPackage ? 'PUT' : 'POST';
      const res = await apiFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) {
        onNotify(json.error || 'Gagal menyimpan paket', 'error');
        return;
      }
      await onRefresh();
      setPkgModalOpen(false);
      onNotify(
        editingPackage ? 'Paket internet berhasil diperbarui.' : 'Paket internet baru berhasil dibuat.',
        'success'
      );
    } catch {
      onNotify('Terjadi kesalahan koneksi saat menyimpan paket.', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDeletePackage(p: InternetPackage) {
    try {
      const res = await apiFetch(`/api/packages/${p.id}`, { method: 'DELETE' });
      const json = await res.json();
      if (!res.ok) {
        onNotify(json.error || 'Gagal menghapus paket', 'error');
        return;
      }
      await onRefresh();
      onNotify(`Paket ${p.name} berhasil dihapus.`, 'success');
    } catch {
      onNotify('Gagal menghapus paket.', 'error');
    }
  }

  function openImportModal() {
    setImportModalOpen(true);
    setImportFileName('');
    setImportRows([]);
    setImportResult(null);
    setImportMode('upsert');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }

  async function handleFileSelected(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportResult(null);
    setImportFileName(file.name);
    try {
      const parsed = await parseCustomerExcelFile(file);
      setImportRows(parsed);
      if (parsed.length === 0) {
        onNotify('File Excel kosong atau header kolom tidak dikenali.', 'error');
      }
    } catch {
      onNotify('Gagal membaca file Excel. Pastikan format file .xlsx, .xls, atau .csv valid.', 'error');
    }
  }

  async function handleConfirmImport() {
    if (importRows.length === 0) return;
    setImporting(true);
    try {
      const res = await apiFetch('/api/customers/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rows: importRows,
          mode: importMode,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        onNotify(json.error || 'Gagal mengimpor data pelanggan.', 'error');
        return;
      }
      setImportResult(json);
      await onRefresh();
      onNotify(
        `Import selesai: ${json.inserted_count} ditambahkan, ${json.updated_count} diperbarui.`,
        'success'
      );
    } catch {
      onNotify('Terjadi kesalahan koneksi saat mengimpor Excel.', 'error');
    } finally {
      setImporting(false);
    }
  }

  function toggleRevealPin(customerId: number) {
    setRevealedPinIds((prev) => ({ ...prev, [customerId]: !prev[customerId] }));
  }

  function handleCopyPin(customerId: number, pinValue: string) {
    void navigator.clipboard.writeText(pinValue);
    setCopiedPinId(customerId);
    setTimeout(() => setCopiedPinId((prev) => (prev === customerId ? null : prev)), 1800);
  }

  function openPinModal(c: Customer) {
    setPinModalCustomer(c);
    setCustomPinInput('');
  }

  async function submitPortalPinUpdate(mode: 'custom' | 'reset_default' | 'generate') {
    if (!pinModalCustomer) return;
    if (mode === 'custom' && customPinInput.trim().length < 4) {
      onNotify('PIN / Password Portal minimal 4 karakter tanpa spasi.', 'error');
      return;
    }
    setPinSubmitting(true);
    try {
      const res = await apiFetch(`/api/customers/${pinModalCustomer.id}/portal-pin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          mode === 'custom' ? { mode: 'custom', pin: customPinInput.trim() } : { mode }
        ),
      });
      const json = await res.json();
      if (!res.ok) {
        onNotify(json.error || 'Gagal memperbarui PIN portal pelanggan.', 'error');
        return;
      }
      await onRefresh();
      setRevealedPinIds((prev) => ({ ...prev, [pinModalCustomer.id]: true }));
      setPinModalCustomer((prev) =>
        prev
          ? {
              ...prev,
              portal_pin_display: json.portal_pin_display,
              portal_pin_updated_at: json.portal_pin_updated_at,
            }
          : null
      );
      setCustomPinInput('');
      onNotify(
        `PIN Portal ${pinModalCustomer.customer_code} diperbarui menjadi ${json.portal_pin_display}.`,
        'success'
      );
    } catch {
      onNotify('Gagal terhubung ke server saat mengatur PIN portal.', 'error');
    } finally {
      setPinSubmitting(false);
    }
  }

  const selectedPkgObj = packages.find((p) => String(p.id) === custForm.package_id);

  return (
    <div className="space-y-5">
      {isReadOnly && (
        <ReadOnlyBanner
          description={`Peran ${currentUser.role} hanya dapat melihat daftar pelanggan, tarif paket, serta status perangkat atau mengekspor Excel. Penambahan, perubahan, dan penghapusan data pelanggan & paket hanya dapat dilakukan oleh Admin.`}
        />
      )}

      {/* Sub-tab & Action Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="inline-flex items-center gap-1 p-1 bg-slate-200/70 rounded-lg">
          <button
            type="button"
            onClick={() => setSubTab('customers')}
            className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
              subTab === 'customers'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Daftar Pelanggan ({customers.length})
          </button>
          <button
            type="button"
            onClick={() => setSubTab('packages')}
            className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
              subTab === 'packages'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Paket Internet ({packages.length})
          </button>
        </div>

        {subTab === 'customers' ? (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                exportCustomersToCsv(filteredCustomers);
                void auditDataExport(
                  'customers',
                  'CSV',
                  filteredCustomers.length,
                  statusFilter === 'all' ? 'Semua Pelanggan' : `Status ${statusFilter}`
                );
                onNotify(`Data pelanggan (${filteredCustomers.length} baris) diekspor ke CSV.`, 'success');
              }}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-md transition-colors whitespace-nowrap shrink-0"
            >
              <Download className="w-4 h-4 text-slate-500" />
              Ekspor CSV
            </button>
            <button
              type="button"
              onClick={() => {
                exportCustomersToExcel(filteredCustomers, packages);
                void auditDataExport(
                  'customers',
                  'Excel',
                  filteredCustomers.length,
                  statusFilter === 'all' ? 'Semua Pelanggan' : `Status ${statusFilter}`
                );
                onNotify(`Data pelanggan (${filteredCustomers.length} baris) diekspor ke Excel.`, 'success');
              }}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-emerald-800 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 rounded-md transition-colors whitespace-nowrap shrink-0"
            >
              <FileSpreadsheet className="w-4 h-4 text-emerald-700" />
              Ekspor Excel
            </button>
            {!isReadOnly && (
              <>
                <button
                  type="button"
                  onClick={openImportModal}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-md transition-colors whitespace-nowrap shrink-0"
                >
                  <Upload className="w-4 h-4 text-slate-500" />
                  Upload Excel
                </button>
                <button
                  type="button"
                  onClick={openAddCustomer}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-red-700 hover:bg-red-800 rounded-md transition-colors whitespace-nowrap shrink-0"
                >
                  <Plus className="w-4 h-4" />
                  Tambah Pelanggan
                </button>
              </>
            )}
          </div>
        ) : (
          !isReadOnly && (
            <button
              type="button"
              onClick={openAddPackage}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-red-700 hover:bg-red-800 rounded-md transition-colors whitespace-nowrap shrink-0"
            >
              <Plus className="w-4 h-4" />
              Tambah Paket Internet
            </button>
          )
        )}
      </div>

      {subTab === 'customers' ? (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          {/* Filter Toolbar */}
          <div className="p-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
            <div className="relative w-full sm:w-80">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Cari nama, alamat, ID perangkat, atau IP..."
                className="w-full pl-9 pr-3 py-1.5 text-sm border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-red-600/20 focus:border-red-600"
              />
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <select
                value={packageFilter}
                onChange={(e) => setPackageFilter(e.target.value)}
                aria-label="Filter paket internet"
                className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md focus:outline-none focus:border-red-600"
              >
                <option value="all">Semua Paket</option>
                {packages.map((p) => (
                  <option key={p.id} value={String(p.id)}>
                    {p.name}
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

          {/* Customers Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                  <th className="py-2.5 px-4">Pelanggan</th>
                  <th className="py-2.5 px-4">WhatsApp & Alamat</th>
                  <th className="py-2.5 px-4">Paket & Harga</th>
                  <th className="py-2.5 px-4">Perangkat (ONT/Router)</th>
                  <th className="py-2.5 px-4 text-center">Jatuh Tempo</th>
                  <th className="py-2.5 px-4">Status</th>
                  {!isReadOnly && <th className="py-2.5 px-4">PIN Portal</th>}
                  <th className="py-2.5 px-4 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {filteredCustomers.length === 0 ? (
                  <tr>
                    <td colSpan={isReadOnly ? 7 : 8} className="py-10 text-center text-slate-500 text-sm">
                      Tidak ada data pelanggan yang sesuai dengan filter.
                    </td>
                  </tr>
                ) : (
                  filteredCustomers.map((c) => {
                    const pinVal = c.portal_pin_display || '123456';
                    const isRevealed = Boolean(revealedPinIds[c.id]);
                    return (
                    <tr key={c.id} className="hover:bg-slate-50 transition-colors">
                      <td className="py-2.5 px-4">
                        <div className="font-medium text-slate-900">
                          {c.name}
                          {c.customer_active === 0 && (
                            <span className="ml-2 text-xs text-slate-400">(Nonaktif)</span>
                          )}
                        </div>
                        <div className="text-xs font-mono text-slate-500">{c.customer_code}</div>
                      </td>
                      <td className="py-2.5 px-4">
                        <div className="font-mono text-xs text-slate-800">{c.whatsapp}</div>
                        <div className="text-xs text-slate-500 max-w-xs truncate" title={c.address}>
                          {c.address}
                        </div>
                      </td>
                      <td className="py-2.5 px-4">
                        <div className="text-xs font-medium text-slate-800">{c.package_name}</div>
                        <div className="font-mono text-xs text-slate-600 tabular-nums">
                          {formatRupiah(c.effective_price)}/bln
                          {c.custom_price ? ' (khusus)' : ''}
                        </div>
                      </td>
                      <td className="py-2.5 px-4">
                        <div className="font-mono text-xs font-medium text-slate-800">
                          {c.device_id} · {c.device_ip}
                        </div>
                        <div className="text-xs text-slate-500">{c.device_model}</div>
                      </td>
                      <td className="py-2.5 px-4 text-center font-mono text-xs text-slate-700 tabular-nums whitespace-nowrap">
                        Tgl {String(c.due_day).padStart(2, '0')}
                      </td>
                      <td className="py-2.5 px-4 whitespace-nowrap">
                        <DeviceStatusLabel status={c.device_status} />
                      </td>
                      {!isReadOnly && (
                        <td className="py-2.5 px-4 whitespace-nowrap">
                          <div className="inline-flex items-center gap-1.5">
                            <span className="font-mono text-xs font-semibold text-slate-800 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded tabular-nums">
                              {isRevealed ? pinVal : '••••••'}
                            </span>
                            <button
                              type="button"
                              onClick={() => toggleRevealPin(c.id)}
                              title={isRevealed ? 'Sembunyikan PIN Portal' : 'Tampilkan PIN Portal'}
                              className="p-1 text-slate-400 hover:text-slate-700 rounded transition-colors"
                            >
                              {isRevealed ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleCopyPin(c.id, pinVal)}
                              title="Salin PIN Portal"
                              className="p-1 text-slate-400 hover:text-red-700 rounded transition-colors"
                            >
                              {copiedPinId === c.id ? (
                                <Check className="w-3.5 h-3.5 text-emerald-700" />
                              ) : (
                                <Copy className="w-3.5 h-3.5" />
                              )}
                            </button>
                          </div>
                        </td>
                      )}
                      <td className="py-2.5 px-4 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1">
                          {onOpenMapping && (
                            <button
                              type="button"
                              onClick={() => onOpenMapping(c.id)}
                              title="Lihat Mapping & Topologi ONT"
                              className="p-1.5 text-slate-500 hover:text-red-700 hover:bg-red-50 rounded transition-colors"
                            >
                              <GitBranch className="w-4 h-4" />
                            </button>
                          )}
                          {onOpenChat && (
                            <button
                              type="button"
                              onClick={() => onOpenChat(c.id)}
                              title="Chat WhatsApp Pelanggan"
                              className="p-1.5 text-slate-500 hover:text-emerald-700 hover:bg-emerald-50 rounded transition-colors"
                            >
                              <MessageCircle className="w-4 h-4" />
                            </button>
                          )}
                          {!isReadOnly && (
                            <>
                              <button
                                type="button"
                                onClick={() => openPinModal(c)}
                                title="Atur / Reset PIN Portal Pelanggan"
                                className="p-1.5 text-slate-500 hover:text-amber-700 hover:bg-amber-50 rounded transition-colors"
                              >
                                <KeyRound className="w-4 h-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() => openEditCustomer(c)}
                                title="Edit Pelanggan"
                                className="p-1.5 text-slate-500 hover:text-red-700 hover:bg-red-50 rounded transition-colors"
                              >
                                <Edit2 className="w-4 h-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteCustomer(c)}
                                title="Hapus Pelanggan"
                                className="p-1.5 text-slate-500 hover:text-rose-700 hover:bg-rose-50 rounded transition-colors"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </>
                          )}
                          {isReadOnly && !onOpenMapping && !onOpenChat && (
                            <span className="text-[11px] text-slate-400">Lihat Saja</span>
                          )}
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
      ) : (
        /* Packages Grid Table */
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                  <th className="py-2.5 px-4">Nama Paket</th>
                  <th className="py-2.5 px-4">Kecepatan (Down / Up)</th>
                  <th className="py-2.5 px-4 text-right">Harga Bulanan</th>
                  <th className="py-2.5 px-4 text-center">Pelanggan Aktif</th>
                  <th className="py-2.5 px-4">Keterangan</th>
                  {!isReadOnly && <th className="py-2.5 px-4 text-right">Aksi</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {packages.length === 0 ? (
                  <tr>
                    <td colSpan={isReadOnly ? 5 : 6} className="py-10 text-center text-slate-500">
                      Belum ada paket internet terdaftar.
                    </td>
                  </tr>
                ) : (
                  packages.map((p) => (
                    <tr key={p.id} className="hover:bg-slate-50 transition-colors">
                      <td className="py-3 px-4 font-medium text-slate-900">{p.name}</td>
                      <td className="py-3 px-4 font-mono text-xs text-slate-700 tabular-nums">
                        {p.speed_down_mbps} Mbps / {p.speed_up_mbps} Mbps
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-semibold text-slate-900 tabular-nums">
                        {formatRupiah(p.monthly_price)}
                      </td>
                      <td className="py-3 px-4 text-center font-mono text-xs text-slate-700 tabular-nums">
                        {p.customer_count ?? 0}
                      </td>
                      <td className="py-3 px-4 text-xs text-slate-600 max-w-sm">
                        {p.description || '—'}
                      </td>
                      {!isReadOnly && (
                        <td className="py-3 px-4 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => openEditPackage(p)}
                              title="Edit Paket"
                              className="p-1.5 text-slate-500 hover:text-red-700 hover:bg-red-50 rounded transition-colors"
                            >
                              <Edit2 className="w-4 h-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeletePackage(p)}
                              title="Hapus Paket"
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
      )}

      {/* Modal Tambah / Edit Pelanggan */}
      {!isReadOnly && custModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="bg-white border border-slate-200 rounded-lg w-full max-w-2xl max-h-[92vh] overflow-y-auto shadow-xl">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-900">
                {editingCustomer ? `Edit Pelanggan (${editingCustomer.customer_code})` : 'Tambah Pelanggan Baru'}
              </h3>
              <button
                type="button"
                onClick={() => setCustModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-700 rounded"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveCustomer} className="p-5 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Nama Lengkap Pelanggan *
                  </label>
                  <input
                    type="text"
                    required
                    value={custForm.name}
                    onChange={(e) => setCustForm({ ...custForm, name: e.target.value })}
                    placeholder="Contoh: Ahmad Fauzi"
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-md focus:outline-none focus:border-red-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Nomor WhatsApp *
                  </label>
                  <input
                    type="text"
                    required
                    value={custForm.whatsapp}
                    onChange={(e) => setCustForm({ ...custForm, whatsapp: e.target.value })}
                    placeholder="081234567890 atau 62812..."
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-md focus:outline-none focus:border-red-600"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Alamat Pemasangan *
                </label>
                <input
                  type="text"
                  required
                  value={custForm.address}
                  onChange={(e) => setCustForm({ ...custForm, address: e.target.value })}
                  placeholder="Perumahan / Jalan / Blok / RT-RW"
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-md focus:outline-none focus:border-red-600"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Paket Internet *
                  </label>
                  <select
                    required
                    value={custForm.package_id}
                    onChange={(e) => setCustForm({ ...custForm, package_id: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-md focus:outline-none focus:border-red-600"
                  >
                    {packages.map((p) => (
                      <option key={p.id} value={String(p.id)}>
                        {p.name} ({formatRupiah(p.monthly_price)})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Harga Khusus (Opsional)
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={custForm.custom_price}
                    onChange={(e) => setCustForm({ ...custForm, custom_price: e.target.value })}
                    placeholder={selectedPkgObj ? `Default ${selectedPkgObj.monthly_price}` : 'Kosongkan = tarif paket'}
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-md focus:outline-none focus:border-red-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Tgl Jatuh Tempo (1-28) *
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={28}
                    required
                    value={custForm.due_day}
                    onChange={(e) => setCustForm({ ...custForm, due_day: e.target.value })}
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-md focus:outline-none focus:border-red-600"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2 border-t border-slate-100">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    ID Perangkat (ONT/Router) *
                  </label>
                  <input
                    type="text"
                    required
                    value={custForm.device_id}
                    onChange={(e) => setCustForm({ ...custForm, device_id: e.target.value })}
                    placeholder="ONT-ZTE-013"
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-md focus:outline-none focus:border-red-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    IP Address Perangkat *
                  </label>
                  <input
                    type="text"
                    required
                    value={custForm.device_ip}
                    onChange={(e) => setCustForm({ ...custForm, device_ip: e.target.value })}
                    placeholder="10.20.1.113"
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-md focus:outline-none focus:border-red-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Tipe / Model Perangkat
                  </label>
                  <input
                    type="text"
                    value={custForm.device_model}
                    onChange={(e) => setCustForm({ ...custForm, device_model: e.target.value })}
                    placeholder="ZTE F609 v3"
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-md focus:outline-none focus:border-red-600"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Status Perangkat Awal
                  </label>
                  <select
                    value={custForm.device_status}
                    onChange={(e) =>
                      setCustForm({ ...custForm, device_status: e.target.value as DeviceStatus })
                    }
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-md focus:outline-none focus:border-red-600"
                  >
                    <option value="Online">Online</option>
                    <option value="Offline">Offline</option>
                    <option value="Isolir">Isolir</option>
                  </select>
                </div>
                <div className="flex items-end pb-2">
                  <label className="inline-flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={custForm.customer_active}
                      onChange={(e) => setCustForm({ ...custForm, customer_active: e.target.checked })}
                      className="rounded border-slate-300 text-red-700 focus:ring-red-600"
                    />
                    Pelanggan Aktif (ikut penagihan otomatis bulanan)
                  </label>
                </div>
              </div>

              <div className="pt-4 border-t border-slate-200 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setCustModalOpen(false)}
                  className="px-4 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 text-xs font-medium text-white bg-red-700 hover:bg-red-800 disabled:opacity-50 rounded-md transition-colors"
                >
                  {submitting ? 'Menyimpan...' : 'Simpan Pelanggan'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Tambah / Edit Paket */}
      {!isReadOnly && pkgModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="bg-white border border-slate-200 rounded-lg w-full max-w-lg shadow-xl">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-900">
                {editingPackage ? `Edit Paket: ${editingPackage.name}` : 'Tambah Paket Internet'}
              </h3>
              <button
                type="button"
                onClick={() => setPkgModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-700 rounded"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSavePackage} className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Nama Paket *</label>
                <input
                  type="text"
                  required
                  value={pkgForm.name}
                  onChange={(e) => setPkgForm({ ...pkgForm, name: e.target.value })}
                  placeholder="Contoh: Fiber Family 30 Mbps"
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-md focus:outline-none focus:border-red-600"
                />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Download (Mbps) *</label>
                  <input
                    type="number"
                    required
                    min={1}
                    value={pkgForm.speed_down_mbps}
                    onChange={(e) => setPkgForm({ ...pkgForm, speed_down_mbps: e.target.value })}
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-md focus:outline-none focus:border-red-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Upload (Mbps) *</label>
                  <input
                    type="number"
                    required
                    min={1}
                    value={pkgForm.speed_up_mbps}
                    onChange={(e) => setPkgForm({ ...pkgForm, speed_up_mbps: e.target.value })}
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-md focus:outline-none focus:border-red-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Harga / Bulan (Rp) *</label>
                  <input
                    type="number"
                    required
                    min={1000}
                    step={1000}
                    value={pkgForm.monthly_price}
                    onChange={(e) => setPkgForm({ ...pkgForm, monthly_price: e.target.value })}
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-md focus:outline-none focus:border-red-600"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Keterangan</label>
                <textarea
                  rows={2}
                  value={pkgForm.description}
                  onChange={(e) => setPkgForm({ ...pkgForm, description: e.target.value })}
                  placeholder="Deskripsi singkat peruntukan paket"
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-md focus:outline-none focus:border-red-600"
                />
              </div>

              <div className="pt-4 border-t border-slate-200 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setPkgModalOpen(false)}
                  className="px-4 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 text-xs font-medium text-white bg-red-700 hover:bg-red-800 disabled:opacity-50 rounded-md transition-colors"
                >
                  {submitting ? 'Menyimpan...' : 'Simpan Paket'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Upload & Import Pelanggan dari Excel */}
      {!isReadOnly && importModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="bg-white border border-slate-200 rounded-lg w-full max-w-3xl max-h-[92vh] overflow-y-auto shadow-xl">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileSpreadsheet className="w-5 h-5 text-emerald-700" />
                <h3 className="text-base font-semibold text-slate-900">
                  Upload &amp; Import Otomatis Pelanggan dari Excel
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setImportModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-700 rounded"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-5">
              {/* Step 1: Download Template & Select File */}
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 flex flex-wrap items-center justify-between gap-4">
                <div className="space-y-1">
                  <div className="text-xs font-semibold text-slate-900">
                    1. Siapkan File Excel (.xlsx / .xls / .csv)
                  </div>
                  <p className="text-xs text-slate-600">
                    Gunakan template resmi agar kolom Nama, Alamat, WhatsApp, Paket, ID/IP Perangkat, dan Jatuh Tempo langsung terbaca otomatis.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => downloadCustomerTemplateExcel(packages)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-100 rounded-md transition-colors whitespace-nowrap shrink-0"
                >
                  <Download className="w-3.5 h-3.5 text-slate-500" />
                  Unduh Template Excel
                </button>
              </div>

              <div className="space-y-2">
                <label className="block text-xs font-semibold text-slate-800">
                  2. Pilih File Excel untuk Diunggah
                </label>
                <div className="flex flex-wrap items-center gap-3">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    onChange={(e) => void handleFileSelected(e)}
                    className="block w-full text-xs text-slate-600 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border file:border-slate-200 file:text-xs file:font-medium file:bg-slate-100 file:text-slate-700 hover:file:bg-slate-200 cursor-pointer"
                  />
                </div>
                {importFileName && (
                  <div className="text-xs text-slate-500 font-mono">
                    File dipilih: <span className="text-slate-900">{importFileName}</span> · {importRows.length} baris terdeteksi
                  </div>
                )}
              </div>

              {/* Mode Selection */}
              <div className="space-y-2">
                <span className="block text-xs font-semibold text-slate-800">
                  3. Mode Sinkronisasi Data
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label className="flex items-start gap-2.5 p-3 border border-slate-200 rounded-md cursor-pointer hover:bg-slate-50">
                    <input
                      type="radio"
                      name="importMode"
                      checked={importMode === 'upsert'}
                      onChange={() => setImportMode('upsert')}
                      className="mt-0.5 text-red-700"
                    />
                    <div className="text-xs">
                      <div className="font-semibold text-slate-900">Tambah &amp; Perbarui Otomatis (Upsert)</div>
                      <div className="text-slate-500 mt-0.5">
                        Pelanggan baru ditambahkan; jika ID Perangkat / Kode sudah ada, datanya diperbarui.
                      </div>
                    </div>
                  </label>
                  <label className="flex items-start gap-2.5 p-3 border border-slate-200 rounded-md cursor-pointer hover:bg-slate-50">
                    <input
                      type="radio"
                      name="importMode"
                      checked={importMode === 'insert_only'}
                      onChange={() => setImportMode('insert_only')}
                      className="mt-0.5 text-red-700"
                    />
                    <div className="text-xs">
                      <div className="font-semibold text-slate-900">Hanya Tambah Pelanggan Baru</div>
                      <div className="text-slate-500 mt-0.5">
                        Baris dengan ID Perangkat atau Kode yang sudah ada di database akan dilewati.
                      </div>
                    </div>
                  </label>
                </div>
              </div>

              {/* Preview Table */}
              {importRows.length > 0 && (
                <div className="border border-slate-200 rounded-lg overflow-hidden">
                  <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-800">
                      Pratinjau Data Excel ({importRows.length} baris)
                    </span>
                    <span className="font-mono text-slate-600 tabular-nums">
                      {importRows.filter((r) => r.valid).length} valid ·{' '}
                      {importRows.filter((r) => !r.valid).length} kolom belum lengkap
                    </span>
                  </div>
                  <div className="overflow-x-auto max-h-60">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="border-b border-slate-200 bg-white text-slate-500">
                          <th className="py-2 px-3">#</th>
                          <th className="py-2 px-3">Nama</th>
                          <th className="py-2 px-3">WhatsApp</th>
                          <th className="py-2 px-3">Paket</th>
                          <th className="py-2 px-3">ID &amp; IP Perangkat</th>
                          <th className="py-2 px-3">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {importRows.slice(0, 20).map((r, i) => (
                          <tr key={i} className={r.valid ? '' : 'bg-rose-50/50'}>
                            <td className="py-2 px-3 font-mono text-slate-400">{i + 1}</td>
                            <td className="py-2 px-3">
                              <div className="font-medium text-slate-900">{r.name || '—'}</div>
                              <div className="text-[11px] text-slate-500 max-w-[180px] truncate">{r.address || '—'}</div>
                            </td>
                            <td className="py-2 px-3 font-mono text-slate-700">{r.whatsapp || '—'}</td>
                            <td className="py-2 px-3 text-slate-700">{r.package_name || 'Default Paket 1'}</td>
                            <td className="py-2 px-3 font-mono text-slate-700">
                              {r.device_id || '—'} · {r.device_ip || '—'}
                            </td>
                            <td className="py-2 px-3 whitespace-nowrap">
                              {r.valid ? (
                                <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
                                  <CheckCircle2 className="w-3.5 h-3.5" />
                                  Siap
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-rose-700 font-medium">
                                  <AlertCircle className="w-3.5 h-3.5" />
                                  Kolom Wajib Kosong
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Import Result Feedback */}
              {importResult && (
                <div className="border border-slate-200 rounded-lg p-4 bg-slate-50 space-y-2 text-xs">
                  <div className="font-semibold text-slate-900">
                    Hasil Import: {importResult.inserted_count} ditambahkan · {importResult.updated_count} diperbarui · {importResult.skipped_count} dilewati
                  </div>
                  {importResult.errors.length > 0 && (
                    <ul className="space-y-1 text-rose-700 max-h-28 overflow-y-auto">
                      {importResult.errors.map((err, idx) => (
                        <li key={idx}>
                          Baris {err.row_number} ({err.name}): {err.reason}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              <div className="pt-3 border-t border-slate-200 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setImportModalOpen(false)}
                  className="px-4 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors"
                >
                  Tutup
                </button>
                <button
                  type="button"
                  disabled={importing || importRows.length === 0}
                  onClick={() => void handleConfirmImport()}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-red-700 hover:bg-red-800 disabled:opacity-50 rounded-md transition-colors"
                >
                  <Upload className="w-4 h-4" />
                  {importing ? 'Mengimpor...' : `Import ${importRows.length} Baris Pelanggan`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal Atur / Reset PIN Portal Pelanggan (Khusus Admin) */}
      {!isReadOnly && pinModalCustomer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="bg-white border border-slate-200 rounded-lg w-full max-w-md shadow-xl">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <KeyRound className="w-4 h-4 text-red-700" />
                <h3 className="text-base font-semibold text-slate-900">
                  Atur / Reset PIN Portal Pelanggan
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setPinModalCustomer(null)}
                className="p-1 text-slate-400 hover:text-slate-700 rounded"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div className="bg-slate-50 border border-slate-200 rounded-md p-3.5 space-y-2 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-500">Pelanggan</span>
                  <span className="font-semibold text-slate-900">
                    {pinModalCustomer.name}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-500">ID Login Portal</span>
                  <span className="font-mono font-semibold text-slate-900">
                    {pinModalCustomer.customer_code}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-200">
                  <span className="text-slate-500">PIN Portal Saat Ini</span>
                  <div className="inline-flex items-center gap-1.5">
                    <span className="font-mono font-bold text-red-700 bg-white border border-slate-200 px-2 py-0.5 rounded tabular-nums">
                      {pinModalCustomer.portal_pin_display || '123456'}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        handleCopyPin(
                          pinModalCustomer.id,
                          pinModalCustomer.portal_pin_display || '123456'
                        )
                      }
                      className="p-1 text-slate-500 hover:text-red-700"
                      title="Salin PIN"
                    >
                      {copiedPinId === pinModalCustomer.id ? (
                        <Check className="w-3.5 h-3.5 text-emerald-700" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>
                </div>
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void submitPortalPinUpdate('custom');
                }}
                className="space-y-3"
              >
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Atur PIN / Password Khusus Baru (4–16 karakter)
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={customPinInput}
                      onChange={(e) => setCustomPinInput(e.target.value)}
                      placeholder="Contoh: 778899 atau jtr2026"
                      className="flex-1 px-3 py-2 text-sm font-mono border border-slate-200 rounded-md focus:outline-none focus:border-red-600"
                    />
                    <button
                      type="submit"
                      disabled={pinSubmitting || customPinInput.trim().length < 4}
                      className="px-3.5 py-2 text-xs font-medium text-white bg-red-700 hover:bg-red-800 disabled:opacity-50 rounded-md transition-colors whitespace-nowrap shrink-0"
                    >
                      {pinSubmitting ? 'Menyimpan...' : 'Simpan PIN'}
                    </button>
                  </div>
                </div>
              </form>

              <div className="pt-3 border-t border-slate-200 space-y-2">
                <div className="text-[11px] font-medium text-slate-500">
                  Opsi Reset Cepat (mencabut sesi portal pelanggan yang sedang aktif)
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <button
                    type="button"
                    disabled={pinSubmitting}
                    onClick={() => void submitPortalPinUpdate('generate')}
                    className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 rounded-md transition-colors whitespace-nowrap"
                  >
                    <Shuffle className="w-3.5 h-3.5" />
                    Buat PIN Acak 6-Digit
                  </button>
                  <button
                    type="button"
                    disabled={pinSubmitting}
                    onClick={() => void submitPortalPinUpdate('reset_default')}
                    className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-amber-800 bg-amber-50 border border-amber-200 hover:bg-amber-100 disabled:opacity-50 rounded-md transition-colors whitespace-nowrap"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    Reset Standar (123456)
                  </button>
                </div>
              </div>

              <div className="pt-2 flex justify-end">
                <button
                  type="button"
                  onClick={() => setPinModalCustomer(null)}
                  className="px-4 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors"
                >
                  Tutup
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
