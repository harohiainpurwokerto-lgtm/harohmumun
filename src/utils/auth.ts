import type { AuthUser, FeatureKey, UserRole, WhatsAppTemplateKey } from '../types';

export const AUTH_TOKEN_STORAGE_KEY = 'jatara_iphome_auth_token';

export interface FeatureCatalogItem {
  key: FeatureKey;
  label: string;
  description: string;
  group: 'Operasional' | 'Keuangan' | 'Jaringan' | 'Sistem';
}

export const ASSIGNABLE_FEATURE_CATALOG: FeatureCatalogItem[] = [
  {
    key: 'dashboard',
    label: 'Dasbor Utama',
    description: 'Ringkasan status layanan, pelanggan aktif, dan aktivitas harian.',
    group: 'Operasional',
  },
  {
    key: 'customers',
    label: 'Pelanggan & Paket',
    description: 'Lihat daftar pelanggan & paket (Read-Only untuk Teknisi & Keuangan; ubah data khusus Admin).',
    group: 'Operasional',
  },
  {
    key: 'whatsapp',
    label: 'Chat WhatsApp',
    description: 'Komunikasi WhatsApp pelanggan untuk info gangguan maupun penagihan.',
    group: 'Operasional',
  },
  {
    key: 'billing',
    label: 'Billing & Tagihan',
    description: 'Status tagihan (Read-Only untuk Teknisi; Catat Lunas oleh Keuangan/Admin; Batal Lunas khusus Admin).',
    group: 'Keuangan',
  },
  {
    key: 'reports',
    label: 'Laporan Keuangan',
    description: 'Rekapitulasi pemasukan, metode pembayaran, dan daftar tunggakan (Admin & Keuangan).',
    group: 'Keuangan',
  },
  {
    key: 'monitoring',
    label: 'Monitoring & Webhook',
    description: 'Pantau node MikroTik, OLT, isolir/buka isolir (Penuh: Admin & Teknisi; Lihat Saja: Keuangan).',
    group: 'Jaringan',
  },
  {
    key: 'mapping',
    label: 'Mapping & Topologi',
    description: 'Peta Google Maps FTTH, ODP splitter, dan ONT (Penuh: Admin & Teknisi; Lihat Saja: Keuangan).',
    group: 'Jaringan',
  },
  {
    key: 'tickets',
    label: 'Tiket Gangguan',
    description: 'Kelola tiket gangguan pelanggan, penugasan teknisi lapangan, & riwayat ODP (Penuh: Admin & Teknisi).',
    group: 'Jaringan',
  },
  {
    key: 'activity_logs',
    label: 'Log Aktivitas',
    description: 'Jejak audit read-only aktivitas operator & percobaan 403 (terbatas sesuai kategori peran).',
    group: 'Sistem',
  },
  {
    key: 'schema',
    label: 'Struktur Database',
    description: 'Inspeksi rancangan tabel dan relasi database sistem.',
    group: 'Sistem',
  },
];

export const ROLE_DEFAULT_PRESETS: Record<UserRole, FeatureKey[]> = {
  Admin: ['dashboard', 'customers', 'billing', 'whatsapp', 'monitoring', 'mapping', 'tickets', 'reports', 'activity_logs', 'schema', 'users', 'backup'],
  Teknisi: ['dashboard', 'monitoring', 'mapping', 'tickets', 'whatsapp', 'customers', 'billing', 'activity_logs'],
  Keuangan: ['dashboard', 'billing', 'reports', 'customers', 'whatsapp', 'activity_logs'],
};

export function hasFeatureAccess(user: AuthUser | null | undefined, feature: FeatureKey): boolean {
  if (!user) return false;
  if (user.role === 'Admin') return true;
  if (feature === 'users' || feature === 'backup') return false;
  return user.allowed_features.includes(feature);
}

/**
 * Hanya Admin yang dapat membuat/mengunduh snapshot backup penuh dan mengubah jadwal backup berkala.
 */
export function canManageBackups(user: AuthUser | null | undefined): boolean {
  return Boolean(user && user.role === 'Admin');
}

/**
 * Hanya Admin yang dapat menambah, mengedit, menghapus, atau mengimpor data pelanggan & paket internet.
 * Teknisi & Keuangan hanya dapat melihat (Read-Only).
 */
export function canEditCustomersPackages(user: AuthUser | null | undefined): boolean {
  return Boolean(user && user.role === 'Admin');
}

/**
 * Admin dan Bagian Keuangan (dengan akses billing) dapat menerbitkan tagihan otomatis,
 * mencatat pembayaran lunas (Catat Lunas), serta mengirim pengingat tagihan WA.
 * Teknisi hanya dapat melihat daftar status tagihan (Read-Only).
 */
export function canCollectBilling(user: AuthUser | null | undefined): boolean {
  if (!user) return false;
  if (user.role === 'Admin') return true;
  return user.role === 'Keuangan' && hasFeatureAccess(user, 'billing');
}

/**
 * Pembatalan status Lunas (Batal Lunas) hanya diizinkan untuk Admin.
 */
export function canRevertPaidInvoice(user: AuthUser | null | undefined): boolean {
  return Boolean(user && user.role === 'Admin');
}

/**
 * Admin dan Teknisi (dengan akses monitoring/mapping) dapat mengelola node MikroTik/OLT,
 * ODP splitter, mapping ONT, serta melakukan aksi Isolir / Buka Isolir perangkat.
 * Bagian Keuangan bersifat Read-Only (isolir terbuka otomatis saat pelunasan tagihan).
 */
export function canManageNetworkInfra(user: AuthUser | null | undefined): boolean {
  if (!user) return false;
  return user.role === 'Admin' || user.role === 'Teknisi';
}

/**
 * Admin dan Teknisi dapat membuat, menugaskan teknisi, memperbarui progres,
 * dan menyelesaikan tiket gangguan. Bagian Keuangan bersifat Read-Only.
 */
export function canManageTroubleTickets(user: AuthUser | null | undefined): boolean {
  if (!user) return false;
  return user.role === 'Admin' || user.role === 'Teknisi';
}

/**
 * Penghapusan permanen tiket gangguan hanya diizinkan untuk Admin.
 */
export function canDeleteTroubleTicket(user: AuthUser | null | undefined): boolean {
  return Boolean(user && user.role === 'Admin');
}

/**
 * Hanya Admin yang dapat mengubah pengaturan WA Gateway API.
 */
export function canConfigureWaGateway(user: AuthUser | null | undefined): boolean {
  return Boolean(user && user.role === 'Admin');
}

/**
 * Admin dapat mengubah & mereset seluruh template WA.
 * Bagian Keuangan (dengan akses whatsapp/billing) dapat mengubah template penagihan
 * (reminder_pre_due & due_overdue), sedangkan isolation_notice khusus Admin.
 * Teknisi hanya dapat melihat/memakai template (Read-Only).
 */
export function canEditWhatsAppTemplate(
  user: AuthUser | null | undefined,
  templateKey: WhatsAppTemplateKey
): boolean {
  if (!user) return false;
  if (user.role === 'Admin') return true;
  if (user.role === 'Keuangan') {
    if (templateKey === 'isolation_notice') return false;
    return hasFeatureAccess(user, 'whatsapp') || hasFeatureAccess(user, 'billing');
  }
  return false;
}

/**
 * Admin dan Bagian Keuangan dapat mengirim pengingat tagihan & konfirmasi lunas WhatsApp.
 * Teknisi difokuskan pada komunikasi teknis (isolir / gangguan) di Chat WA.
 */
export function canSendBillingWhatsApp(user: AuthUser | null | undefined): boolean {
  if (!user) return false;
  if (user.role === 'Admin') return true;
  return (
    user.role === 'Keuangan' &&
    (hasFeatureAccess(user, 'whatsapp') || hasFeatureAccess(user, 'billing') || hasFeatureAccess(user, 'reports'))
  );
}

export function getStoredToken(): string | null {
  try {
    return window.localStorage.getItem(AUTH_TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setStoredToken(token: string | null): void {
  try {
    if (token) {
      window.localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, token);
    } else {
      window.localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
    }
  } catch {
    // ignore storage errors
  }
}

let unauthorizedHandler: (() => void) | null = null;

export function setUnauthorizedHandler(handler: (() => void) | null): void {
  unauthorizedHandler = handler;
}

function resolveRequestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.pathname + input.search;
  return input.url;
}

export async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const rawUrl = resolveRequestUrl(input);
  const token = getStoredToken();
  const headers = new Headers(
    init?.headers ?? (input instanceof Request ? input.headers : undefined)
  );

  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const response = await window.fetch(input, {
    ...init,
    headers,
  });

  if (
    response.status === 401 &&
    !rawUrl.includes('/api/auth/login') &&
    !rawUrl.includes('/api/auth/customer-login') &&
    unauthorizedHandler
  ) {
    unauthorizedHandler();
  }

  return response;
}

export async function auditDataExport(
  exportType: 'customers' | 'billing' | 'reports' | 'activity_logs',
  format: 'CSV' | 'Excel',
  rowCount: number,
  scopeLabel?: string
): Promise<void> {
  try {
    await apiFetch('/api/exports/audit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        export_type: exportType,
        format,
        row_count: rowCount,
        scope_label: scopeLabel ?? '',
      }),
    });
  } catch {
    // non-fatal audit logging
  }
}

