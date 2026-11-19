import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import {
  CheckSquare,
  Edit2,
  Plus,
  ShieldCheck,
  Square,
  Trash2,
  UserCheck,
  Users,
  X,
} from 'lucide-react';
import type { AuthUser, FeatureKey, UserRole } from '../types';
import {
  ASSIGNABLE_FEATURE_CATALOG,
  ROLE_DEFAULT_PRESETS,
  apiFetch,
} from '../utils/auth';
import { formatDateTimeId } from '../utils/format';

interface UsersAccessViewProps {
  currentUser: AuthUser;
  onRefreshCurrentUser: () => Promise<void>;
  onNotify: (msg: string, type?: 'success' | 'error') => void;
}

const FEATURE_LABEL_MAP: Record<FeatureKey, string> = {
  dashboard: 'Dasbor Utama',
  customers: 'Pelanggan & Paket',
  billing: 'Billing & Tagihan',
  whatsapp: 'Chat WhatsApp',
  monitoring: 'Monitoring & Webhook',
  mapping: 'Mapping & Topologi',
  tickets: 'Tiket Gangguan',
  reports: 'Laporan Keuangan',
  activity_logs: 'Log Aktivitas',
  schema: 'Struktur Database',
  users: 'Manajemen Akun',
  backup: 'Backup & Ekspor',
};

export function UsersAccessView({
  currentUser,
  onRefreshCurrentUser,
  onNotify,
}: UsersAccessViewProps) {
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [roleFilter, setRoleFilter] = useState<'all' | UserRole>('all');

  // Add / Edit Modal
  const [modalOpen, setModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<AuthUser | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formState, setFormState] = useState<{
    username: string;
    full_name: string;
    password: string;
    role: UserRole;
    is_active: boolean;
    allowed_features: FeatureKey[];
  }>({
    username: '',
    full_name: '',
    password: '',
    role: 'Teknisi',
    is_active: true,
    allowed_features: [...ROLE_DEFAULT_PRESETS.Teknisi],
  });

  const loadUsers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch('/api/users');
      if (res.ok) {
        setUsers(await res.json());
      } else {
        const json = await res.json();
        onNotify(json.error || 'Gagal memuat daftar akun pengguna.', 'error');
      }
    } catch {
      onNotify('Gagal terhubung ke server untuk memuat akun.', 'error');
    } finally {
      setLoading(false);
    }
  }, [onNotify]);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  const filteredUsers = users.filter((u) =>
    roleFilter === 'all' ? true : u.role === roleFilter
  );

  const activeCount = users.filter((u) => u.is_active === 1).length;
  const adminCount = users.filter((u) => u.role === 'Admin').length;
  const techCount = users.filter((u) => u.role === 'Teknisi').length;
  const financeCount = users.filter((u) => u.role === 'Keuangan').length;

  function openCreateModal() {
    setEditingUser(null);
    setFormState({
      username: '',
      full_name: '',
      password: '',
      role: 'Teknisi',
      is_active: true,
      allowed_features: [...ROLE_DEFAULT_PRESETS.Teknisi],
    });
    setModalOpen(true);
  }

  function openEditModal(u: AuthUser) {
    setEditingUser(u);
    setFormState({
      username: u.username,
      full_name: u.full_name,
      password: '',
      role: u.role,
      is_active: u.is_active === 1,
      allowed_features:
        u.role === 'Admin'
          ? [...ROLE_DEFAULT_PRESETS.Admin]
          : u.allowed_features.filter((f) => f !== 'users'),
    });
    setModalOpen(true);
  }

  function handleRoleChange(nextRole: UserRole) {
    setFormState((prev) => ({
      ...prev,
      role: nextRole,
      allowed_features: editingUser && prev.role === nextRole
        ? prev.allowed_features
        : [...ROLE_DEFAULT_PRESETS[nextRole]],
    }));
  }

  function toggleFeature(key: FeatureKey) {
    if (formState.role === 'Admin') return;
    setFormState((prev) => {
      const exists = prev.allowed_features.includes(key);
      return {
        ...prev,
        allowed_features: exists
          ? prev.allowed_features.filter((f) => f !== key)
          : [...prev.allowed_features, key],
      };
    });
  }

  async function handleSaveUser(e: FormEvent) {
    e.preventDefault();
    if (formState.role !== 'Admin' && formState.allowed_features.length === 0) {
      onNotify('Pilih minimal 1 fitur yang dapat diakses oleh akun ini.', 'error');
      return;
    }

    setSubmitting(true);
    try {
      const isEdit = Boolean(editingUser);
      const url = isEdit ? `/api/users/${editingUser!.id}` : '/api/users';
      const method = isEdit ? 'PUT' : 'POST';
      const payload: Record<string, unknown> = {
        full_name: formState.full_name,
        role: formState.role,
        is_active: formState.is_active,
        allowed_features:
          formState.role === 'Admin'
            ? ROLE_DEFAULT_PRESETS.Admin
            : formState.allowed_features,
      };
      if (!isEdit) {
        payload.username = formState.username;
        payload.password = formState.password;
      } else if (formState.password.trim()) {
        payload.password = formState.password;
      }

      const res = await apiFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) {
        onNotify(json.error || 'Gagal menyimpan akun staf.', 'error');
        return;
      }

      setModalOpen(false);
      await loadUsers();
      if (editingUser && editingUser.id === currentUser.id) {
        await onRefreshCurrentUser();
      }
      onNotify(
        isEdit
          ? `Hak akses akun ${json.username} berhasil diperbarui.`
          : `Akun ${json.username} (${json.role}) berhasil ditambahkan.`,
        'success'
      );
    } catch {
      onNotify('Terjadi kesalahan koneksi saat menyimpan akun.', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDeleteUser(u: AuthUser) {
    try {
      const res = await apiFetch(`/api/users/${u.id}`, { method: 'DELETE' });
      const json = await res.json();
      if (!res.ok) {
        onNotify(json.error || 'Gagal menghapus akun.', 'error');
        return;
      }
      await loadUsers();
      onNotify(`Akun ${u.username} berhasil dihapus.`, 'success');
    } catch {
      onNotify('Gagal menghapus akun.', 'error');
    }
  }

  return (
    <div className="space-y-6">
      {/* Summary KPIs */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Total Akun Staf</span>
            <Users className="w-4 h-4 text-slate-400" aria-hidden="true" />
          </div>
          <div className="mt-2.5 text-2xl font-bold font-mono tabular-nums text-slate-900">
            {users.length}
          </div>
          <div className="mt-1 text-xs text-slate-500 tabular-nums">
            {activeCount} akun aktif
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Administrator</span>
            <ShieldCheck className="w-4 h-4 text-red-600" aria-hidden="true" />
          </div>
          <div className="mt-2.5 text-2xl font-bold font-mono tabular-nums text-red-700">
            {adminCount}
          </div>
          <div className="mt-1 text-xs text-slate-500">
            Akses penuh semua fitur
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Akun Teknisi</span>
            <UserCheck className="w-4 h-4 text-slate-400" aria-hidden="true" />
          </div>
          <div className="mt-2.5 text-2xl font-bold font-mono tabular-nums text-slate-900">
            {techCount}
          </div>
          <div className="mt-1 text-xs text-slate-500">
            Akses fitur pilihan jaringan
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Bagian Keuangan</span>
            <UserCheck className="w-4 h-4 text-emerald-600" aria-hidden="true" />
          </div>
          <div className="mt-2.5 text-2xl font-bold font-mono tabular-nums text-slate-900">
            {financeCount}
          </div>
          <div className="mt-1 text-xs text-slate-500">
            Akses fitur pilihan billing &amp; kas
          </div>
        </div>
      </section>

      {/* Main Accounts & Permissions Table */}
      <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              Manajemen Akun &amp; Pembatasan Fitur Staf
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Admin memiliki akses penuh. Atur fitur pilihan untuk setiap akun Teknisi dan Bagian Keuangan.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-md">
              {(['all', 'Admin', 'Teknisi', 'Keuangan'] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRoleFilter(r)}
                  className={`px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                    roleFilter === r
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {r === 'all' ? 'Semua Peran' : r}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={openCreateModal}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-red-600 hover:bg-red-700 rounded-md transition-colors whitespace-nowrap shrink-0"
            >
              <Plus className="w-4 h-4" />
              Tambah Akun Staf
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                <th className="py-3 px-4">Nama &amp; Username</th>
                <th className="py-3 px-4">Peran</th>
                <th className="py-3 px-4">Hak Akses / Fitur Pilihan</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Login Terakhir</th>
                <th className="py-3 px-4 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {loading ? (
                <tr>
                  <td colSpan={6} className="py-10 text-center text-xs text-slate-500">
                    Memuat daftar akun pengguna...
                  </td>
                </tr>
              ) : filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-10 text-center text-xs text-slate-500">
                    Tidak ada akun untuk filter peran ini.
                  </td>
                </tr>
              ) : (
                filteredUsers.map((u) => {
                  const isSelf = u.id === currentUser.id;
                  const roleTextClass =
                    u.role === 'Admin'
                      ? 'text-red-700 font-semibold'
                      : u.role === 'Teknisi'
                        ? 'text-slate-900 font-semibold'
                        : 'text-emerald-700 font-semibold';

                  const featureSummary =
                    u.role === 'Admin'
                      ? 'Akses Penuh (Semua 11 Fitur, Backup Snapshot, Log Aktivitas & Manajemen Akun)'
                      : u.allowed_features.length > 0
                        ? u.allowed_features.map((f) => FEATURE_LABEL_MAP[f] || f).join(' · ')
                        : 'Belum ada fitur dipilih';

                  return (
                    <tr key={u.id} className="hover:bg-slate-50 transition-colors">
                      <td className="py-3 px-4">
                        <div className="font-medium text-slate-900">
                          {u.full_name}
                          {isSelf && (
                            <span className="ml-2 text-[11px] font-normal text-red-700">
                              (Sedang Login)
                            </span>
                          )}
                        </div>
                        <div className="font-mono text-xs text-slate-500">@{u.username}</div>
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap text-xs">
                        <span className={roleTextClass}>{u.role}</span>
                      </td>
                      <td className="py-3 px-4 max-w-md">
                        <div className="text-xs text-slate-700 leading-relaxed">
                          {featureSummary}
                        </div>
                        {u.role !== 'Admin' && (
                          <div className="text-[11px] text-slate-400 mt-0.5 tabular-nums">
                            {u.allowed_features.length} dari {ASSIGNABLE_FEATURE_CATALOG.length} fitur diizinkan
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap text-xs">
                        <span
                          className={
                            u.is_active === 1
                              ? 'text-emerald-700 font-medium'
                              : 'text-rose-700 font-medium'
                          }
                        >
                          {u.is_active === 1 ? 'Aktif' : 'Nonaktif'}
                        </span>
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap font-mono text-xs text-slate-500 tabular-nums">
                        {u.last_login_at ? formatDateTimeId(u.last_login_at) : 'Belum pernah'}
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => openEditModal(u)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 border border-slate-200 bg-white hover:bg-slate-50 rounded-md transition-colors whitespace-nowrap shrink-0"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                            Atur Akses
                          </button>
                          {!isSelf && (
                            <button
                              type="button"
                              onClick={() => void handleDeleteUser(u)}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-rose-700 border border-rose-200 bg-rose-50/60 hover:bg-rose-100 rounded-md transition-colors whitespace-nowrap shrink-0"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              Hapus
                            </button>
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
      </section>

      {/* Matriks Hak Akses Detail Peran (Granular RBAC Matrix) */}
      <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              Matriks Hak Akses Detail Peran (Admin · Teknisi · Bagian Keuangan)
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Pembatasan ketat berlaku seragam di antarmuka (UI) dan validasi API backend (HTTP 403 tercatat otomatis ke Log Aktivitas).
            </p>
          </div>
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded border bg-slate-50 text-slate-700 border-slate-200 whitespace-nowrap">
            Penegakan API + UI Aktif
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 font-medium text-slate-500">
                <th className="py-3 px-4">Modul &amp; Aksi Sistem</th>
                <th className="py-3 px-4">Admin</th>
                <th className="py-3 px-4">Teknisi</th>
                <th className="py-3 px-4">Bagian Keuangan</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              <tr className="hover:bg-slate-50/70">
                <td className="py-3 px-4 font-medium text-slate-900">
                  Monitoring NOC, Node MikroTik / OLT &amp; Isolir / Buka Isolir
                </td>
                <td className="py-3 px-4">
                  <span className="inline-block px-2 py-0.5 rounded border bg-emerald-50 text-emerald-800 border-emerald-200 font-medium">
                    Akses Penuh
                  </span>
                </td>
                <td className="py-3 px-4">
                  <span className="inline-block px-2 py-0.5 rounded border bg-emerald-50 text-emerald-800 border-emerald-200 font-medium">
                    Akses Penuh
                  </span>
                </td>
                <td className="py-3 px-4">
                  <span className="inline-block px-2 py-0.5 rounded border bg-rose-50 text-rose-800 border-rose-200 font-medium">
                    Ditolak 403 (Buka otomatis saat lunas)
                  </span>
                </td>
              </tr>
              <tr className="hover:bg-slate-50/70">
                <td className="py-3 px-4 font-medium text-slate-900">
                  Mapping Topologi ONT &amp; Kelola ODP Splitter
                </td>
                <td className="py-3 px-4">
                  <span className="inline-block px-2 py-0.5 rounded border bg-emerald-50 text-emerald-800 border-emerald-200 font-medium">
                    Akses Penuh
                  </span>
                </td>
                <td className="py-3 px-4">
                  <span className="inline-block px-2 py-0.5 rounded border bg-emerald-50 text-emerald-800 border-emerald-200 font-medium">
                    Akses Penuh
                  </span>
                </td>
                <td className="py-3 px-4">
                  <span className="inline-block px-2 py-0.5 rounded border bg-amber-50 text-amber-800 border-amber-200 font-medium">
                    Lihat Saja / Ditolak Tulis (403)
                  </span>
                </td>
              </tr>
              <tr className="hover:bg-slate-50/70">
                <td className="py-3 px-4 font-medium text-slate-900">
                  Data Pelanggan, Paket Internet &amp; Import Excel
                </td>
                <td className="py-3 px-4">
                  <span className="inline-block px-2 py-0.5 rounded border bg-emerald-50 text-emerald-800 border-emerald-200 font-medium">
                    Akses Penuh (CRUD)
                  </span>
                </td>
                <td className="py-3 px-4">
                  <span className="inline-block px-2 py-0.5 rounded border bg-amber-50 text-amber-800 border-amber-200 font-medium">
                    Lihat Saja (Read-Only)
                  </span>
                </td>
                <td className="py-3 px-4">
                  <span className="inline-block px-2 py-0.5 rounded border bg-amber-50 text-amber-800 border-amber-200 font-medium">
                    Lihat Saja (Read-Only)
                  </span>
                </td>
              </tr>
              <tr className="hover:bg-slate-50/70">
                <td className="py-3 px-4 font-medium text-slate-900">
                  Tagihan Bulanan, Catat Lunas &amp; Pengingat WA Tagihan
                </td>
                <td className="py-3 px-4">
                  <span className="inline-block px-2 py-0.5 rounded border bg-emerald-50 text-emerald-800 border-emerald-200 font-medium">
                    Akses Penuh
                  </span>
                </td>
                <td className="py-3 px-4">
                  <span className="inline-block px-2 py-0.5 rounded border bg-amber-50 text-amber-800 border-amber-200 font-medium">
                    Lihat Status Tunggakan (Read-Only)
                  </span>
                </td>
                <td className="py-3 px-4">
                  <span className="inline-block px-2 py-0.5 rounded border bg-emerald-50 text-emerald-800 border-emerald-200 font-medium">
                    Akses Penuh
                  </span>
                </td>
              </tr>
              <tr className="hover:bg-slate-50/70">
                <td className="py-3 px-4 font-medium text-slate-900">
                  Pembatalan Status Lunas (Batal Lunas)
                </td>
                <td className="py-3 px-4">
                  <span className="inline-block px-2 py-0.5 rounded border bg-emerald-50 text-emerald-800 border-emerald-200 font-medium">
                    Khusus Admin
                  </span>
                </td>
                <td className="py-3 px-4">
                  <span className="inline-block px-2 py-0.5 rounded border bg-rose-50 text-rose-800 border-rose-200 font-medium">
                    Ditolak (403)
                  </span>
                </td>
                <td className="py-3 px-4">
                  <span className="inline-block px-2 py-0.5 rounded border bg-rose-50 text-rose-800 border-rose-200 font-medium">
                    Ditolak (403)
                  </span>
                </td>
              </tr>
              <tr className="hover:bg-slate-50/70">
                <td className="py-3 px-4 font-medium text-slate-900">
                  Laporan Keuangan &amp; Ekspor Excel Keuangan
                </td>
                <td className="py-3 px-4">
                  <span className="inline-block px-2 py-0.5 rounded border bg-emerald-50 text-emerald-800 border-emerald-200 font-medium">
                    Akses Penuh
                  </span>
                </td>
                <td className="py-3 px-4">
                  <span className="inline-block px-2 py-0.5 rounded border bg-rose-50 text-rose-800 border-rose-200 font-medium">
                    Ditolak (403)
                  </span>
                </td>
                <td className="py-3 px-4">
                  <span className="inline-block px-2 py-0.5 rounded border bg-emerald-50 text-emerald-800 border-emerald-200 font-medium">
                    Akses Penuh
                  </span>
                </td>
              </tr>
              <tr className="hover:bg-slate-50/70">
                <td className="py-3 px-4 font-medium text-slate-900">
                  Manajemen Akun Staf, Pengaturan WA Gateway &amp; Log Audit Penuh
                </td>
                <td className="py-3 px-4">
                  <span className="inline-block px-2 py-0.5 rounded border bg-emerald-50 text-emerald-800 border-emerald-200 font-medium">
                    Khusus Admin
                  </span>
                </td>
                <td className="py-3 px-4">
                  <span className="inline-block px-2 py-0.5 rounded border bg-slate-100 text-slate-700 border-slate-200 font-medium">
                    Log Jaringan/Auth Saja
                  </span>
                </td>
                <td className="py-3 px-4">
                  <span className="inline-block px-2 py-0.5 rounded border bg-slate-100 text-slate-700 border-slate-200 font-medium">
                    Log Billing/Auth Saja
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* Modal Tambah / Edit Akun & Pilihan Fitur */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 overflow-y-auto">
          <div className="bg-white border border-slate-200 rounded-lg w-full max-w-2xl shadow-xl my-8">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h3 className="text-base font-semibold text-slate-900">
                  {editingUser ? `Atur Akun & Hak Akses: @${editingUser.username}` : 'Tambah Akun Staf Baru'}
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Tentukan peran dan pilih fitur yang boleh diakses oleh akun ini
                </p>
              </div>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-700 rounded"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveUser} className="p-5 space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Nama Lengkap
                  </label>
                  <input
                    type="text"
                    required
                    value={formState.full_name}
                    onChange={(e) => setFormState((s) => ({ ...s, full_name: e.target.value }))}
                    placeholder="Contoh: Dimas Pratama"
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-md focus:outline-none focus:border-red-600"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Username Login
                  </label>
                  <input
                    type="text"
                    required
                    disabled={Boolean(editingUser)}
                    value={formState.username}
                    onChange={(e) =>
                      setFormState((s) => ({ ...s, username: e.target.value.toLowerCase() }))
                    }
                    placeholder="Contoh: teknisi_andi"
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-md focus:outline-none focus:border-red-600 disabled:bg-slate-50 disabled:text-slate-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Peran (Role)
                  </label>
                  <select
                    value={formState.role}
                    onChange={(e) => handleRoleChange(e.target.value as UserRole)}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-md focus:outline-none focus:border-red-600"
                  >
                    <option value="Admin">Admin (Akses Semua Fitur)</option>
                    <option value="Teknisi">Teknisi (Fitur Pilihan / Terbatas)</option>
                    <option value="Keuangan">Bagian Keuangan (Fitur Pilihan / Terbatas)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    {editingUser ? 'Reset Password (Opsional)' : 'Password Awal (Min. 6 Karakter)'}
                  </label>
                  <input
                    type="password"
                    required={!editingUser}
                    minLength={editingUser ? undefined : 6}
                    value={formState.password}
                    onChange={(e) => setFormState((s) => ({ ...s, password: e.target.value }))}
                    placeholder={editingUser ? 'Kosongkan jika tidak diubah' : 'Minimal 6 karakter'}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-md focus:outline-none focus:border-red-600"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-md">
                <div>
                  <div className="text-xs font-medium text-slate-800">Status Akun</div>
                  <div className="text-[11px] text-slate-500">
                    Akun nonaktif tidak dapat masuk ke sistem
                  </div>
                </div>
                <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-800 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formState.is_active}
                    onChange={(e) => setFormState((s) => ({ ...s, is_active: e.target.checked }))}
                    className="w-4 h-4 accent-red-600 rounded"
                  />
                  <span>{formState.is_active ? 'Aktif' : 'Nonaktif'}</span>
                </label>
              </div>

              {/* Selectable Feature Permissions */}
              <div className="space-y-3 pt-1">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-xs font-semibold text-slate-900">
                      Fitur Pilihan yang Diizinkan
                    </div>
                    <div className="text-[11px] text-slate-500">
                      {formState.role === 'Admin'
                        ? 'Peran Admin otomatis memiliki akses penuh tanpa pembatasan.'
                        : 'Centang modul yang boleh dibuka oleh akun ini.'}
                    </div>
                  </div>

                  {formState.role !== 'Admin' && (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() =>
                          setFormState((s) => ({
                            ...s,
                            allowed_features: [...ROLE_DEFAULT_PRESETS.Teknisi],
                          }))
                        }
                        className="px-2.5 py-1 text-[11px] font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded whitespace-nowrap"
                      >
                        Preset Teknisi
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setFormState((s) => ({
                            ...s,
                            allowed_features: [...ROLE_DEFAULT_PRESETS.Keuangan],
                          }))
                        }
                        className="px-2.5 py-1 text-[11px] font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded whitespace-nowrap"
                      >
                        Preset Keuangan
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setFormState((s) => ({
                            ...s,
                            allowed_features: ASSIGNABLE_FEATURE_CATALOG.map((f) => f.key),
                          }))
                        }
                        className="px-2.5 py-1 text-[11px] font-medium text-red-700 bg-red-50 hover:bg-red-100 rounded whitespace-nowrap"
                      >
                        Pilih Semua
                      </button>
                    </div>
                  )}
                </div>

                {formState.role === 'Admin' ? (
                  <div className="p-4 bg-red-50/70 border border-red-200 rounded-md text-xs text-red-900">
                    Akun dengan peran <strong>Admin</strong> selalu dapat mengakses seluruh modul (Dasbor, Pelanggan &amp; Paket, Billing, Chat WhatsApp, Monitoring, Mapping Topologi, Laporan Keuangan, Struktur Database, dan Manajemen Akun).
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {ASSIGNABLE_FEATURE_CATALOG.map((feat) => {
                      const checked = formState.allowed_features.includes(feat.key);
                      return (
                        <button
                          key={feat.key}
                          type="button"
                          onClick={() => toggleFeature(feat.key)}
                          className={`text-left p-3 rounded-md border transition-colors flex items-start gap-2.5 ${
                            checked
                              ? 'border-red-300 bg-red-50/40'
                              : 'border-slate-200 bg-white hover:bg-slate-50'
                          }`}
                        >
                          {checked ? (
                            <CheckSquare className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                          ) : (
                            <Square className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
                          )}
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 text-xs font-semibold text-slate-900">
                              <span>{feat.label}</span>
                              <span aria-hidden="true" className="text-slate-300">·</span>
                              <span className="font-normal text-[11px] text-slate-500">
                                {feat.group}
                              </span>
                            </div>
                            <p className="text-[11px] text-slate-500 mt-0.5 leading-snug">
                              {feat.description}
                            </p>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="pt-3 border-t border-slate-200 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="px-4 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 text-xs font-medium text-white bg-red-600 hover:bg-red-700 disabled:opacity-50 rounded-md transition-colors"
                >
                  {submitting ? 'Menyimpan...' : editingUser ? 'Simpan Perubahan Akses' : 'Buat Akun Staf'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
