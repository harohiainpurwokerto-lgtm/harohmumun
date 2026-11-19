import express from 'express';
import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import {
  ALL_FEATURES_WITH_USERS,
  ASSIGNABLE_FEATURES,
  DEFAULT_CUSTOMER_PORTAL_PIN,
  DEFAULT_WHATSAPP_TEMPLATES,
  ROLE_DEFAULT_FEATURES,
  computeNextBackupRunIso,
  createBackupSnapshot,
  db,
  formatWibReadable,
  getBackupSettings,
  hashPassword,
  listBackupSnapshotMetas,
  recordActivityLog,
  runDueScheduledBackupIfNeeded,
  verifyPassword,
} from './db.ts';
import type {
  ActivityLog,
  ActivityLogCategory,
  ActorRole,
  AuthUser,
  BackupFrequency,
  Customer,
  CustomerPortalData,
  CustomerPortalProfile,
  DeviceLog,
  DeviceStatus,
  FeatureKey,
  InternetPackage,
  Invoice,
  NetworkNode,
  NetworkNodeStatus,
  NetworkNodeType,
  TableSchemaInfo,
  TicketAssigneeOption,
  TicketCategory,
  TicketCustomerRecurrence,
  TicketOdpRecurrence,
  TicketPriority,
  TicketSource,
  TicketStatus,
  TroubleTicket,
  UserRole,
  WebhookEvent,
  WhatsAppTemplate,
  WhatsAppTemplateKey,
} from '../src/types.ts';

export const apiRouter = express.Router();

interface DbUserRow {
  id: number;
  username: string;
  password_hash: string;
  full_name: string;
  role: UserRole;
  allowed_features_json: string;
  is_active: number;
  last_login_at: string | null;
  created_at: string;
}

interface DbCustomerAuthRow extends Customer {
  portal_pin_hash?: string | null;
}

interface AuthenticatedRequest extends Request {
  authUser?: AuthUser;
  authCustomer?: Customer;
  authToken?: string;
}

const VALID_ROLES: UserRole[] = ['Admin', 'Teknisi', 'Keuangan'];
const VALID_ACTIVITY_ROLES: ActorRole[] = ['Admin', 'Teknisi', 'Keuangan', 'Pelanggan'];

function sanitizeCustomerForStaff<T extends Record<string, unknown>>(
  row: T,
  viewerRole?: UserRole
): Customer {
  const { portal_pin_hash: _hash, ...rest } = row;
  if (viewerRole !== 'Admin') {
    return {
      ...rest,
      portal_pin_display: null,
      portal_pin_updated_at: null,
    } as unknown as Customer;
  }
  return rest as unknown as Customer;
}

function parseAllowedFeatures(role: UserRole, jsonStr: string): FeatureKey[] {
  if (role === 'Admin') {
    return [...ALL_FEATURES_WITH_USERS];
  }
  try {
    const parsed = JSON.parse(jsonStr);
    if (!Array.isArray(parsed)) return [...ROLE_DEFAULT_FEATURES[role]];
    const validSet = new Set<FeatureKey>(ASSIGNABLE_FEATURES);
    const filtered = parsed.filter((f): f is FeatureKey => typeof f === 'string' && validSet.has(f as FeatureKey));
    return Array.from(new Set(filtered));
  } catch {
    return [...ROLE_DEFAULT_FEATURES[role]];
  }
}

function sanitizeUser(row: DbUserRow): AuthUser {
  return {
    id: row.id,
    username: row.username,
    full_name: row.full_name,
    role: row.role,
    allowed_features: parseAllowedFeatures(row.role, row.allowed_features_json),
    is_active: row.is_active,
    last_login_at: row.last_login_at,
    created_at: row.created_at,
  };
}

function isPublicEndpoint(path: string, method: string): boolean {
  if (path === '/auth/login' && method === 'POST') return true;
  if (path === '/auth/customer-login' && method === 'POST') return true;
  if (path === '/maps-config' && method === 'GET') return true;
  if (path.startsWith('/webhook/') && method === 'POST') return true;
  return false;
}

function hasAnyFeature(user: AuthUser, required: FeatureKey[]): boolean {
  if (user.role === 'Admin') return true;
  return required.some((f) => user.allowed_features.includes(f));
}

function getAllowedLogCategories(role: UserRole): ActivityLogCategory[] {
  if (role === 'Admin') return ['billing', 'network', 'customer', 'auth'];
  if (role === 'Teknisi') return ['network', 'customer'];
  return ['billing', 'customer'];
}

function logOperatorAction(
  req: AuthenticatedRequest,
  category: ActivityLogCategory,
  action: string,
  targetLabel: string,
  details: string
): void {
  if (!req.authUser) return;
  recordActivityLog({
    userId: req.authUser.id,
    username: req.authUser.username,
    role: req.authUser.role,
    category,
    action,
    targetLabel,
    details,
  });
}

function formatRupiahServer(val: number): string {
  return `Rp ${Math.round(val).toLocaleString('id-ID')}`;
}

interface PermissionCheckResult {
  allowed: boolean;
  reason?: string;
}

function evaluateRoutePermission(path: string, method: string, user: AuthUser): PermissionCheckResult {
  if (path === '/portal' || path.startsWith('/portal/')) {
    return {
      allowed: false,
      reason: 'Akses ditolak: endpoint Portal Pelanggan terisolasi khusus untuk akun Pelanggan.',
    };
  }
  if (user.role === 'Admin') return { allowed: true };
  if (path === '/auth/me' || path === '/auth/logout') return { allowed: true };

  if (path.startsWith('/users')) {
    return {
      allowed: false,
      reason: `Akses ditolak: manajemen akun dan hak akses hanya diizinkan untuk Administrator (peran Anda: ${user.role}).`,
    };
  }

  if (path.startsWith('/backups')) {
    return {
      allowed: false,
      reason: `Akses ditolak: pembuatan/unduh snapshot backup penuh dan pengaturan jadwal backup hanya diizinkan untuk Administrator (peran Anda: ${user.role}).`,
    };
  }

  if (path === '/activity-logs/export') {
    if (method !== 'GET') {
      return { allowed: false, reason: 'Metode tidak diizinkan.' };
    }
    return hasAnyFeature(user, ['activity_logs'])
      ? { allowed: true }
      : { allowed: false, reason: 'Akun tidak memiliki izin untuk mengekspor Log Aktivitas.' };
  }

  if (path === '/exports/audit' && method === 'POST') {
    return { allowed: true };
  }

  if (path === '/activity-logs') {
    if (method !== 'GET') {
      return {
        allowed: false,
        reason: 'Log aktivitas bersifat permanen (Read-Only) dan tidak dapat diubah atau dihapus.',
      };
    }
    return hasAnyFeature(user, ['activity_logs'])
      ? { allowed: true }
      : { allowed: false, reason: 'Akun tidak memiliki izin untuk melihat Log Aktivitas.' };
  }
  if (path.startsWith('/activity-logs')) {
    return {
      allowed: false,
      reason: 'Log aktivitas bersifat permanen (Read-Only) dan tidak dapat diubah atau dihapus.',
    };
  }

  if (path === '/dashboard') {
    return hasAnyFeature(user, ['dashboard'])
      ? { allowed: true }
      : { allowed: false, reason: `Peran ${user.role} tidak memiliki akses ke Dasbor Utama.` };
  }

  if (path.startsWith('/packages')) {
    if (method === 'GET') {
      return hasAnyFeature(user, ['customers', 'billing', 'reports'])
        ? { allowed: true }
        : { allowed: false, reason: `Peran ${user.role} tidak memiliki akses melihat daftar paket internet.` };
    }
    return {
      allowed: false,
      reason: `Akses ditolak: master paket internet bersifat Lihat Saja (Read-Only) untuk peran ${user.role}. Tambah/Edit/Hapus paket khusus Administrator.`,
    };
  }

  if (path.startsWith('/customers')) {
    if (method === 'GET') {
      return hasAnyFeature(user, ['customers'])
        ? { allowed: true }
        : { allowed: false, reason: `Peran ${user.role} tidak memiliki akses melihat daftar pelanggan.` };
    }
    return {
      allowed: false,
      reason: `Akses ditolak: data pelanggan & perangkat bersifat Lihat Saja (Read-Only) untuk peran ${user.role}. Perubahan data pelanggan khusus Administrator.`,
    };
  }

  if (path.startsWith('/invoices')) {
    if (method === 'GET') {
      return hasAnyFeature(user, ['billing', 'reports'])
        ? { allowed: true }
        : { allowed: false, reason: `Peran ${user.role} tidak memiliki akses melihat status tagihan.` };
    }
    if (path.endsWith('/unpay')) {
      return {
        allowed: false,
        reason: `Akses ditolak: pembatalan status lunas (Batal Lunas) hanya diizinkan untuk Administrator (peran Anda: ${user.role}).`,
      };
    }
    if (user.role === 'Teknisi') {
      return {
        allowed: false,
        reason: 'Akses ditolak: peran Teknisi hanya memiliki akses Lihat Saja (Read-Only) pada tagihan dan tidak dapat menerbitkan tagihan, Catat Lunas, atau mengirim pengingat penagihan.',
      };
    }
    if (path.endsWith('/wa-reminder')) {
      return hasAnyFeature(user, ['billing', 'whatsapp', 'reports'])
        ? { allowed: true }
        : { allowed: false, reason: 'Akun Keuangan tidak memiliki izin fitur penagihan WhatsApp.' };
    }
    return hasAnyFeature(user, ['billing'])
      ? { allowed: true }
      : { allowed: false, reason: 'Akun Keuangan tidak memiliki izin kelola Billing & Tagihan.' };
  }

  if (path === '/monitoring') {
    return hasAnyFeature(user, ['monitoring'])
      ? { allowed: true }
      : { allowed: false, reason: `Peran ${user.role} tidak memiliki akses ke Monitoring NOC.` };
  }

  if (path.startsWith('/network-nodes')) {
    if (method === 'GET') {
      return hasAnyFeature(user, ['monitoring', 'mapping'])
        ? { allowed: true }
        : { allowed: false, reason: `Peran ${user.role} tidak memiliki akses melihat daftar node MikroTik & OLT.` };
    }
    if (user.role === 'Keuangan') {
      return {
        allowed: false,
        reason: 'Akses ditolak: pengelolaan node MikroTik/OLT ditolak untuk Bagian Keuangan (Read-Only).',
      };
    }
    return hasAnyFeature(user, ['monitoring', 'mapping'])
      ? { allowed: true }
      : { allowed: false, reason: 'Akun Teknisi tidak memiliki izin fitur Monitoring atau Mapping.' };
  }

  if (path.startsWith('/devices/')) {
    if (user.role === 'Keuangan') {
      return {
        allowed: false,
        reason: 'Akses ditolak: Bagian Keuangan tidak dapat melakukan isolir atau ubah status perangkat manual. Pembukaan isolir berjalan otomatis saat pelunasan tagihan.',
      };
    }
    return hasAnyFeature(user, ['monitoring', 'mapping'])
      ? { allowed: true }
      : { allowed: false, reason: 'Akun Teknisi tidak memiliki izin mengubah status perangkat.' };
  }

  if (path === '/reports') {
    if (user.role === 'Teknisi') {
      return {
        allowed: false,
        reason: 'Akses ditolak: Laporan Keuangan hanya dapat diakses oleh Administrator dan Bagian Keuangan.',
      };
    }
    return hasAnyFeature(user, ['reports'])
      ? { allowed: true }
      : { allowed: false, reason: 'Akun tidak memiliki izin membuka Laporan Keuangan.' };
  }

  if (path === '/schema') {
    return hasAnyFeature(user, ['schema'])
      ? { allowed: true }
      : { allowed: false, reason: `Peran ${user.role} tidak memiliki izin membuka Struktur Database.` };
  }

  if (path === '/whatsapp/gateway') {
    if (method === 'GET') {
      return hasAnyFeature(user, ['whatsapp', 'billing'])
        ? { allowed: true }
        : { allowed: false, reason: `Peran ${user.role} tidak memiliki izin melihat konfigurasi WA Gateway.` };
    }
    return {
      allowed: false,
      reason: `Akses ditolak: konfigurasi WA Gateway API hanya dapat diubah oleh Administrator (peran Anda: ${user.role}).`,
    };
  }

  if (path === '/whatsapp/templates') {
    if (method === 'GET') {
      return hasAnyFeature(user, ['whatsapp', 'billing', 'reports'])
        ? { allowed: true }
        : { allowed: false, reason: `Peran ${user.role} tidak memiliki izin melihat template pesan WhatsApp.` };
    }
    return {
      allowed: false,
      reason: `Metode ${method} tidak diizinkan pada daftar template.`,
    };
  }

  if (path.startsWith('/whatsapp/templates/')) {
    if (user.role === 'Teknisi') {
      return {
        allowed: false,
        reason: 'Akses ditolak: peran Teknisi hanya dapat melihat dan memakai template WhatsApp (Read-Only). Pengubahan template khusus Bagian Keuangan / Admin.',
      };
    }
    const segments = path.split('/').filter(Boolean);
    const tplKey = segments[2] ?? '';
    if (user.role === 'Keuangan') {
      if (tplKey === 'isolation_notice') {
        return {
          allowed: false,
          reason: 'Akses ditolak: template Pemberitahuan Isolir Layanan hanya dapat diubah atau di-reset oleh Administrator.',
        };
      }
      if ((method === 'PUT' || method === 'POST') && (tplKey === 'reminder_pre_due' || tplKey === 'due_overdue')) {
        return hasAnyFeature(user, ['whatsapp', 'billing'])
          ? { allowed: true }
          : { allowed: false, reason: 'Akun Keuangan tidak memiliki izin mengelola template penagihan WhatsApp.' };
      }
    }
    return {
      allowed: false,
      reason: `Akses ditolak untuk pengelolaan template WhatsApp (${path}).`,
    };
  }

  if (path === '/whatsapp/send') {
    if (user.role === 'Teknisi') {
      return hasAnyFeature(user, ['whatsapp'])
        ? { allowed: true }
        : { allowed: false, reason: 'Akun Teknisi tidak memiliki izin fitur Chat WhatsApp.' };
    }
    return hasAnyFeature(user, ['whatsapp', 'billing', 'reports'])
      ? { allowed: true }
      : { allowed: false, reason: 'Akun Keuangan tidak memiliki izin mengirim pesan WhatsApp.' };
  }

  if (path.startsWith('/whatsapp/')) {
    return hasAnyFeature(user, ['whatsapp'])
      ? { allowed: true }
      : { allowed: false, reason: `Peran ${user.role} tidak memiliki izin fitur Chat WhatsApp.` };
  }

  if (path === '/topology') {
    return hasAnyFeature(user, ['mapping', 'monitoring'])
      ? { allowed: true }
      : { allowed: false, reason: `Peran ${user.role} tidak memiliki akses ke Mapping & Topologi.` };
  }

  if (path.startsWith('/odps') || path.startsWith('/topology/')) {
    if (method === 'GET') {
      return hasAnyFeature(user, ['mapping', 'monitoring'])
        ? { allowed: true }
        : { allowed: false, reason: `Peran ${user.role} tidak memiliki akses melihat data ODP/topologi.` };
    }
    if (user.role === 'Keuangan') {
      return {
        allowed: false,
        reason: 'Akses ditolak: Bagian Keuangan tidak dapat menambah, mengubah, atau menghapus ODP splitter dan mapping topologi ONT (Read-Only).',
      };
    }
    return hasAnyFeature(user, ['mapping'])
      ? { allowed: true }
      : { allowed: false, reason: 'Akun Teknisi tidak memiliki izin fitur Mapping & Topologi.' };
  }

  if (path === '/tickets' || path.startsWith('/tickets/')) {
    if (method === 'GET') {
      return hasAnyFeature(user, ['tickets', 'monitoring', 'mapping', 'customers', 'whatsapp'])
        ? { allowed: true }
        : { allowed: false, reason: `Peran ${user.role} tidak memiliki akses melihat Tiket Gangguan.` };
    }
    if (method === 'DELETE') {
      return {
        allowed: false,
        reason: `Akses ditolak: penghapusan tiket gangguan hanya diizinkan untuk Administrator (peran Anda: ${user.role}).`,
      };
    }
    if (user.role === 'Keuangan') {
      return {
        allowed: false,
        reason: 'Akses ditolak: Bagian Keuangan hanya memiliki akses Lihat Saja (Read-Only) pada Tiket Gangguan dan tidak dapat membuat atau mengubah tiket.',
      };
    }
    return hasAnyFeature(user, ['tickets', 'monitoring', 'mapping', 'whatsapp'])
      ? { allowed: true }
      : { allowed: false, reason: 'Akun Teknisi tidak memiliki izin mengelola Tiket Gangguan.' };
  }

  return {
    allowed: false,
    reason: `Akses ditolak: peran ${user.role} tidak memiliki izin untuk endpoint ${method} /api${path}.`,
  };
}

apiRouter.use((req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';

  if (isPublicEndpoint(req.path, req.method)) {
    // Allow external machine webhooks without Bearer token, but enforce RBAC if an operator triggers device/node webhook while logged in
    if (
      token &&
      (req.path === '/webhook/device-status' || req.path === '/webhook/mikrotik-olt')
    ) {
      const sessionRow = db.prepare(`
        SELECT s.token, s.expires_at, u.*
        FROM user_sessions s
        JOIN users u ON u.id = s.user_id
        WHERE s.token = ?
        LIMIT 1
      `).get(token) as (DbUserRow & { token: string; expires_at: string }) | undefined;

      if (sessionRow && new Date(sessionRow.expires_at).getTime() >= Date.now() && sessionRow.is_active === 1) {
        const authUser = sanitizeUser(sessionRow);
        if (authUser.role === 'Keuangan') {
          const reason = 'Akses ditolak: Bagian Keuangan tidak diizinkan mengirim simulasi telemetry/status perangkat ke webhook NOC.';
          recordActivityLog({
            userId: authUser.id,
            username: authUser.username,
            role: authUser.role,
            category: 'auth',
            action: 'Akses Ditolak (403)',
            targetLabel: `${req.method} /api${req.path}`,
            details: reason,
          });
          res.status(403).json({ error: reason });
          return;
        }
      } else {
        const custSession = db.prepare(`
          SELECT c.customer_code
          FROM customer_sessions cs
          JOIN customers c ON c.id = cs.customer_id
          WHERE cs.token = ?
          LIMIT 1
        `).get(token) as { customer_code: string } | undefined;
        if (custSession) {
          const reason = 'Akses ditolak: akun Pelanggan tidak diizinkan mengakses endpoint webhook NOC.';
          recordActivityLog({
            userId: null,
            username: custSession.customer_code,
            role: 'Pelanggan',
            category: 'auth',
            action: 'Akses Ditolak (403)',
            targetLabel: `${req.method} /api${req.path}`,
            details: reason,
          });
          res.status(403).json({ error: reason });
          return;
        }
      }
    }
    next();
    return;
  }

  if (!token) {
    res.status(401).json({ error: 'Sesi login diperlukan. Silakan masuk terlebih dahulu.' });
    return;
  }

  const sessionRow = db.prepare(`
    SELECT
      s.token,
      s.expires_at,
      u.*
    FROM user_sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token = ?
    LIMIT 1
  `).get(token) as (DbUserRow & { token: string; expires_at: string }) | undefined;

  if (sessionRow) {
    if (new Date(sessionRow.expires_at).getTime() < Date.now()) {
      db.prepare('DELETE FROM user_sessions WHERE token = ?').run(token);
      res.status(401).json({ error: 'Sesi login sudah kedaluwarsa. Silakan login ulang.' });
      return;
    }

    if (sessionRow.is_active !== 1) {
      db.prepare('DELETE FROM user_sessions WHERE user_id = ?').run(sessionRow.id);
      const reason = 'Akun Anda sedang dinonaktifkan oleh Administrator.';
      recordActivityLog({
        userId: sessionRow.id,
        username: sessionRow.username,
        role: sessionRow.role,
        category: 'auth',
        action: 'Akses Ditolak (403)',
        targetLabel: `${req.method} /api${req.path}`,
        details: reason,
      });
      res.status(403).json({ error: reason });
      return;
    }

    const authUser = sanitizeUser(sessionRow);
    req.authUser = authUser;
    req.authToken = token;

    const perm = evaluateRoutePermission(req.path, req.method, authUser);
    if (!perm.allowed) {
      const reason = perm.reason || `Akses ditolak: peran ${authUser.role} tidak memiliki izin untuk fitur ini.`;
      recordActivityLog({
        userId: authUser.id,
        username: authUser.username,
        role: authUser.role,
        category: 'auth',
        action: 'Akses Ditolak (403)',
        targetLabel: `${req.method} /api${req.path}`,
        details: reason,
      });
      res.status(403).json({ error: reason });
      return;
    }

    next();
    return;
  }

  // Isolated Customer Session lookup
  const customerSession = db.prepare(`
    SELECT
      cs.token,
      cs.expires_at,
      c.*
    FROM customer_sessions cs
    JOIN customers c ON c.id = cs.customer_id
    WHERE cs.token = ?
    LIMIT 1
  `).get(token) as (DbCustomerAuthRow & { token: string; expires_at: string }) | undefined;

  if (!customerSession) {
    res.status(401).json({ error: 'Sesi tidak valid atau telah berakhir. Silakan login kembali.' });
    return;
  }

  if (new Date(customerSession.expires_at).getTime() < Date.now()) {
    db.prepare('DELETE FROM customer_sessions WHERE token = ?').run(token);
    res.status(401).json({ error: 'Sesi portal pelanggan sudah kedaluwarsa. Silakan login ulang.' });
    return;
  }

  if (customerSession.customer_active !== 1) {
    db.prepare('DELETE FROM customer_sessions WHERE customer_id = ?').run(customerSession.id);
    const reason = 'Akun pelanggan Anda sedang dinonaktifkan oleh Administrator Jatara IP-Home.';
    recordActivityLog({
      userId: null,
      username: customerSession.customer_code,
      role: 'Pelanggan',
      category: 'auth',
      action: 'Akses Ditolak (403)',
      targetLabel: `${req.method} /api${req.path}`,
      details: reason,
    });
    res.status(403).json({ error: reason });
    return;
  }

  req.authCustomer = sanitizeCustomerForStaff(customerSession as unknown as Record<string, unknown>, undefined);
  req.authToken = token;

  const isAllowedCustomerEndpoint =
    (req.path === '/auth/me' && req.method === 'GET') ||
    (req.path === '/auth/logout' && req.method === 'POST') ||
    (req.path === '/portal/me' && req.method === 'GET') ||
    (/^\/portal\/customers\/\d+$/.test(req.path) && req.method === 'GET');

  if (!isAllowedCustomerEndpoint) {
    const reason = `Akses ditolak: akun Pelanggan (${customerSession.customer_code}) terisolasi di Portal Pelanggan dan tidak dapat mengakses fitur internal staf (${req.method} /api${req.path}).`;
    recordActivityLog({
      userId: null,
      username: customerSession.customer_code,
      role: 'Pelanggan',
      category: 'auth',
      action: 'Akses Ditolak (403)',
      targetLabel: `${req.method} /api${req.path}`,
      details: reason,
    });
    res.status(403).json({ error: reason });
    return;
  }

  next();
});

function buildCustomerPortalPayload(customerId: number): CustomerPortalData | null {
  const custRow = db.prepare(`
    SELECT
      c.id,
      c.customer_code,
      c.name,
      c.address,
      c.whatsapp,
      c.package_id,
      p.name AS package_name,
      p.speed_down_mbps,
      p.speed_up_mbps,
      COALESCE(c.custom_price, p.monthly_price) AS effective_price,
      c.device_id,
      c.device_model,
      c.device_status,
      c.due_day,
      c.customer_active,
      c.last_seen_at,
      c.latency_ms,
      c.uptime_session,
      o.odp_code,
      o.name AS odp_name,
      n.name AS node_name,
      c.portal_last_login_at
    FROM customers c
    JOIN packages p ON p.id = c.package_id
    LEFT JOIN network_odps o ON o.id = c.odp_id
    LEFT JOIN network_nodes n ON n.id = c.node_id
    WHERE c.id = ?
    LIMIT 1
  `).get(customerId) as CustomerPortalProfile | undefined;

  if (!custRow) return null;

  const allInvoices = db.prepare(`
    SELECT
      i.*,
      c.customer_code,
      c.name AS customer_name,
      c.whatsapp AS customer_whatsapp,
      c.address AS customer_address,
      p.name AS package_name,
      c.device_id,
      c.device_status
    FROM invoices i
    JOIN customers c ON c.id = i.customer_id
    JOIN packages p ON p.id = c.package_id
    WHERE i.customer_id = ?
    ORDER BY i.billing_period DESC, i.id DESC
  `).all(customerId) as Invoice[];

  const unpaidInvoices = allInvoices.filter((inv) => inv.status === 'Belum Lunas');
  const paidInvoices = allInvoices.filter((inv) => inv.status === 'Lunas');

  const gw = db
    .prepare('SELECT sender_number FROM whatsapp_gateway_config WHERE id = 1')
    .get() as { sender_number?: string } | undefined;

  return {
    customer: custRow,
    summary: {
      unpaid_count: unpaidInvoices.length,
      unpaid_total: unpaidInvoices.reduce((acc, inv) => acc + inv.amount, 0),
      paid_count: paidInvoices.length,
      paid_total: paidInvoices.reduce((acc, inv) => acc + inv.amount, 0),
      late_fee_policy: '0% Denda (Rp 0 biaya keterlambatan & Rp 0 biaya buka isolir)',
    },
    unpaid_invoices: unpaidInvoices,
    paid_invoices: paidInvoices,
    support_whatsapp: gw?.sender_number || '6281200004000',
  };
}

// ---------------------------------------------------------------------------
// 0. AUTENTIKASI & MANAJEMEN HAK AKSES (RBAC) + PORTAL PELANGGAN
// ---------------------------------------------------------------------------
apiRouter.post('/auth/login', (req: Request, res: Response) => {
  try {
    const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';

    if (!username || !password) {
      res.status(400).json({ error: 'Username dan password wajib diisi.' });
      return;
    }

    const userRow = db.prepare(`
      SELECT * FROM users WHERE LOWER(username) = LOWER(?) LIMIT 1
    `).get(username) as DbUserRow | undefined;

    if (!userRow || !verifyPassword(password, userRow.password_hash)) {
      res.status(401).json({ error: 'Username atau password salah.' });
      return;
    }

    if (userRow.is_active !== 1) {
      res.status(403).json({ error: 'Akun ini sedang dinonaktifkan. Hubungi Administrator.' });
      return;
    }

    const token = crypto.randomBytes(32).toString('hex');
    const nowIso = new Date().toISOString();
    const expiresIso = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    db.prepare(`
      INSERT INTO user_sessions (token, user_id, expires_at, created_at)
      VALUES (?, ?, ?, ?)
    `).run(token, userRow.id, expiresIso, nowIso);

    db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(nowIso, userRow.id);

    const updatedUser = db.prepare('SELECT * FROM users WHERE id = ?').get(userRow.id) as DbUserRow;
    const sanitized = sanitizeUser(updatedUser);

    recordActivityLog({
      userId: sanitized.id,
      username: sanitized.username,
      role: sanitized.role,
      category: 'auth',
      action: 'Login Sistem',
      targetLabel: `@${sanitized.username} (${sanitized.full_name})`,
      details: `Masuk ke panel Jatara IP-Home Billing & NOC sebagai ${sanitized.role}`,
      createdAt: nowIso,
    });

    res.json({
      account_type: 'staff',
      token,
      user: sanitized,
    });
  } catch (err) {
    res.status(500).json({ error: 'Gagal memproses login', details: String(err) });
  }
});

apiRouter.post('/auth/customer-login', (req: Request, res: Response) => {
  try {
    const customerCode = typeof req.body?.customer_code === 'string' ? req.body.customer_code.trim().toUpperCase() : '';
    const pin = typeof req.body?.pin === 'string' ? req.body.pin.trim() : '';

    if (!customerCode || !pin) {
      res.status(400).json({ error: 'Kode Pelanggan dan PIN / Password Portal wajib diisi.' });
      return;
    }

    const custRow = db.prepare(`
      SELECT * FROM customers WHERE UPPER(customer_code) = ? LIMIT 1
    `).get(customerCode) as DbCustomerAuthRow | undefined;

    if (!custRow || !custRow.portal_pin_hash || !verifyPassword(pin, custRow.portal_pin_hash)) {
      res.status(401).json({ error: 'Kode Pelanggan atau PIN Portal salah.' });
      return;
    }

    if (custRow.customer_active !== 1) {
      res.status(403).json({ error: 'Akun pelanggan ini sedang nonaktif. Silakan hubungi Admin Jatara IP-Home.' });
      return;
    }

    const token = crypto.randomBytes(32).toString('hex');
    const nowIso = new Date().toISOString();
    const expiresIso = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    db.prepare(`
      INSERT INTO customer_sessions (token, customer_id, expires_at, created_at)
      VALUES (?, ?, ?, ?)
    `).run(token, custRow.id, expiresIso, nowIso);

    db.prepare('UPDATE customers SET portal_last_login_at = ? WHERE id = ?').run(nowIso, custRow.id);

    const portal = buildCustomerPortalPayload(custRow.id);
    if (!portal) {
      res.status(500).json({ error: 'Gagal memuat profil portal pelanggan.' });
      return;
    }

    recordActivityLog({
      userId: null,
      username: custRow.customer_code,
      role: 'Pelanggan',
      category: 'auth',
      action: 'Login Portal Pelanggan',
      targetLabel: `${custRow.customer_code} · ${custRow.name}`,
      details: `Pelanggan masuk ke Portal Pelanggan Jatara IP-Home (status layanan: ${custRow.device_status})`,
      createdAt: nowIso,
    });

    res.json({
      account_type: 'customer',
      token,
      portal,
    });
  } catch (err) {
    res.status(500).json({ error: 'Gagal memproses login pelanggan', details: String(err) });
  }
});

apiRouter.get('/auth/me', (req: AuthenticatedRequest, res: Response) => {
  if (req.authUser) {
    res.json({ account_type: 'staff', user: req.authUser });
    return;
  }
  if (req.authCustomer) {
    const portal = buildCustomerPortalPayload(req.authCustomer.id);
    if (!portal) {
      res.status(404).json({ error: 'Profil pelanggan tidak ditemukan.' });
      return;
    }
    res.json({ account_type: 'customer', portal });
    return;
  }
  res.status(401).json({ error: 'Sesi tidak valid.' });
});

apiRouter.post('/auth/logout', (req: AuthenticatedRequest, res: Response) => {
  if (req.authToken) {
    db.prepare('DELETE FROM user_sessions WHERE token = ?').run(req.authToken);
    db.prepare('DELETE FROM customer_sessions WHERE token = ?').run(req.authToken);
  }
  res.json({ ok: true });
});

apiRouter.get('/portal/me', (req: AuthenticatedRequest, res: Response) => {
  if (!req.authCustomer) {
    res.status(403).json({ error: 'Akses ditolak: hanya akun Pelanggan yang dapat mengakses Portal Pelanggan.' });
    return;
  }
  const portal = buildCustomerPortalPayload(req.authCustomer.id);
  if (!portal) {
    res.status(404).json({ error: 'Data profil pelanggan tidak ditemukan.' });
    return;
  }
  res.json(portal);
});

apiRouter.get('/portal/customers/:id', (req: AuthenticatedRequest, res: Response) => {
  if (!req.authCustomer) {
    res.status(403).json({ error: 'Akses ditolak: hanya akun Pelanggan yang dapat mengakses Portal Pelanggan.' });
    return;
  }
  const requestedId = Number(req.params.id);
  if (requestedId !== req.authCustomer.id) {
    const reason = `Akses ditolak: pelanggan ${req.authCustomer.customer_code} mencoba mengakses data akun pelanggan ID #${req.params.id}.`;
    recordActivityLog({
      userId: null,
      username: req.authCustomer.customer_code,
      role: 'Pelanggan',
      category: 'auth',
      action: 'Akses Ditolak (403)',
      targetLabel: `GET /api/portal/customers/${req.params.id}`,
      details: reason,
    });
    res.status(403).json({ error: reason });
    return;
  }
  const portal = buildCustomerPortalPayload(req.authCustomer.id);
  if (!portal) {
    res.status(404).json({ error: 'Data profil pelanggan tidak ditemukan.' });
    return;
  }
  res.json(portal);
});

apiRouter.get('/users', (_req: AuthenticatedRequest, res: Response) => {
  try {
    const rows = db.prepare(`
      SELECT * FROM users
      ORDER BY
        CASE role WHEN 'Admin' THEN 0 WHEN 'Teknisi' THEN 1 ELSE 2 END,
        username ASC
    `).all() as DbUserRow[];
    res.json(rows.map(sanitizeUser));
  } catch (err) {
    res.status(500).json({ error: 'Gagal memuat daftar akun pengguna', details: String(err) });
  }
});

apiRouter.post('/users', (req: AuthenticatedRequest, res: Response) => {
  try {
    const username = typeof req.body?.username === 'string' ? req.body.username.trim().toLowerCase() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const fullName = typeof req.body?.full_name === 'string' ? req.body.full_name.trim() : '';
    const roleRaw = typeof req.body?.role === 'string' ? req.body.role.trim() : '';
    const isActive = req.body?.is_active === 0 || req.body?.is_active === false ? 0 : 1;

    if (!username || !/^[a-z0-9._-]{3,32}$/.test(username)) {
      res.status(400).json({ error: 'Username harus 3-32 karakter (huruf kecil, angka, titik, atau underscore).' });
      return;
    }
    if (password.length < 6) {
      res.status(400).json({ error: 'Password minimal 6 karakter.' });
      return;
    }
    if (!fullName) {
      res.status(400).json({ error: 'Nama lengkap staf wajib diisi.' });
      return;
    }
    if (!VALID_ROLES.includes(roleRaw as UserRole)) {
      res.status(400).json({ error: 'Peran harus Admin, Teknisi, atau Keuangan.' });
      return;
    }

    const role = roleRaw as UserRole;
    const rawFeatures = Array.isArray(req.body?.allowed_features) ? req.body.allowed_features : ROLE_DEFAULT_FEATURES[role];
    const validSet = new Set<FeatureKey>(ASSIGNABLE_FEATURES);
    const cleanFeatures: FeatureKey[] =
      role === 'Admin'
        ? [...ALL_FEATURES_WITH_USERS]
        : Array.from(
            new Set(
              rawFeatures.filter((f: unknown): f is FeatureKey => typeof f === 'string' && validSet.has(f as FeatureKey))
            )
          );

    const info = db.prepare(`
      INSERT INTO users (username, password_hash, full_name, role, allowed_features_json, is_active)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(username, hashPassword(password), fullName, role, JSON.stringify(cleanFeatures), isActive);

    const created = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid) as DbUserRow;
    const sanitized = sanitizeUser(created);

    logOperatorAction(
      req,
      'auth',
      'Tambah Akun Staf',
      `@${sanitized.username} (${sanitized.role})`,
      `Membuat akun baru ${sanitized.full_name} dengan ${sanitized.allowed_features.length} izin fitur (${sanitized.is_active === 1 ? 'Aktif' : 'Nonaktif'})`
    );

    res.status(201).json(sanitized);
  } catch (err) {
    const msg = String(err);
    if (msg.includes('UNIQUE constraint failed')) {
      res.status(409).json({ error: 'Username sudah digunakan oleh akun lain.' });
      return;
    }
    res.status(500).json({ error: 'Gagal membuat akun pengguna baru', details: msg });
  }
});

apiRouter.put('/users/:id', (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as DbUserRow | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Akun pengguna tidak ditemukan.' });
      return;
    }

    const fullName = typeof req.body?.full_name === 'string' && req.body.full_name.trim()
      ? req.body.full_name.trim()
      : existing.full_name;
    const roleRaw = typeof req.body?.role === 'string' ? req.body.role.trim() : existing.role;
    if (!VALID_ROLES.includes(roleRaw as UserRole)) {
      res.status(400).json({ error: 'Peran tidak valid.' });
      return;
    }
    const nextRole = roleRaw as UserRole;
    const nextActive = req.body?.is_active === undefined ? existing.is_active : (req.body.is_active ? 1 : 0);

    // Protect against demoting or deactivating the last active Admin
    if (existing.role === 'Admin' && (nextRole !== 'Admin' || nextActive === 0)) {
      const otherActiveAdmins = db.prepare(`
        SELECT COUNT(*) as cnt FROM users WHERE role = 'Admin' AND is_active = 1 AND id != ?
      `).get(id) as { cnt: number };
      if (otherActiveAdmins.cnt === 0) {
        res.status(400).json({ error: 'Tidak dapat menonaktifkan atau mengubah peran satu-satunya Admin aktif.' });
        return;
      }
    }

    let nextFeatures: FeatureKey[];
    if (nextRole === 'Admin') {
      nextFeatures = [...ALL_FEATURES_WITH_USERS];
    } else if (Array.isArray(req.body?.allowed_features)) {
      const validSet = new Set<FeatureKey>(ASSIGNABLE_FEATURES);
      nextFeatures = Array.from(
        new Set(
          req.body.allowed_features.filter(
            (f: unknown): f is FeatureKey => typeof f === 'string' && validSet.has(f as FeatureKey)
          )
        )
      );
    } else {
      nextFeatures = parseAllowedFeatures(nextRole, existing.allowed_features_json);
    }

    let nextPasswordHash = existing.password_hash;
    if (typeof req.body?.password === 'string' && req.body.password.length > 0) {
      if (req.body.password.length < 6) {
        res.status(400).json({ error: 'Password baru minimal 6 karakter.' });
        return;
      }
      nextPasswordHash = hashPassword(req.body.password);
    }

    db.prepare(`
      UPDATE users
      SET full_name = ?, role = ?, allowed_features_json = ?, is_active = ?, password_hash = ?
      WHERE id = ?
    `).run(fullName, nextRole, JSON.stringify(nextFeatures), nextActive, nextPasswordHash, id);

    if (nextActive === 0) {
      db.prepare('DELETE FROM user_sessions WHERE user_id = ?').run(id);
    }

    const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as DbUserRow;
    const sanitized = sanitizeUser(updated);

    const featureCountLabel =
      sanitized.role === 'Admin'
        ? 'Akses Penuh (Semua Fitur)'
        : `${sanitized.allowed_features.length} fitur pilihan (${sanitized.allowed_features.join(', ')})`;

    logOperatorAction(
      req,
      'auth',
      'Ubah Hak Akses & Akun',
      `@${sanitized.username} (${sanitized.role})`,
      `Memperbarui hak akses akun ${sanitized.full_name}: peran ${sanitized.role}, status ${sanitized.is_active === 1 ? 'Aktif' : 'Nonaktif'}, ${featureCountLabel}`
    );

    res.json(sanitized);
  } catch (err) {
    res.status(500).json({ error: 'Gagal memperbarui akun & hak akses', details: String(err) });
  }
});

apiRouter.delete('/users/:id', (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (req.authUser && req.authUser.id === id) {
      res.status(400).json({ error: 'Anda tidak dapat menghapus akun yang sedang digunakan login.' });
      return;
    }

    const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as DbUserRow | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Akun tidak ditemukan.' });
      return;
    }

    if (existing.role === 'Admin') {
      const otherAdmins = db.prepare(`
        SELECT COUNT(*) as cnt FROM users WHERE role = 'Admin' AND is_active = 1 AND id != ?
      `).get(id) as { cnt: number };
      if (otherAdmins.cnt === 0) {
        res.status(400).json({ error: 'Minimal harus ada 1 akun Admin aktif di sistem.' });
        return;
      }
    }

    db.prepare('DELETE FROM users WHERE id = ?').run(id);
    logOperatorAction(
      req,
      'auth',
      'Hapus Akun Staf',
      `@${existing.username} (${existing.role})`,
      `Menghapus akun ${existing.full_name} dari daftar pengguna sistem`
    );
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: 'Gagal menghapus akun pengguna', details: String(err) });
  }
});

// ---------------------------------------------------------------------------
// 0B. ACTIVITY LOG (JEJAK AUDIT READ-ONLY)
// ---------------------------------------------------------------------------
apiRouter.get('/activity-logs', (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.authUser;
    if (!user) {
      res.status(401).json({ error: 'Sesi tidak valid.' });
      return;
    }

    const allowedCategories = getAllowedLogCategories(user.role);
    const categoryParam = typeof req.query.category === 'string' ? req.query.category.trim() : 'all';
    const roleParam = typeof req.query.role === 'string' ? req.query.role.trim() : 'all';
    const searchParam = typeof req.query.search === 'string' ? req.query.search.trim().toLowerCase() : '';
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 15));
    const offset = (page - 1) * limit;

    const whereClauses: string[] = [];
    const params: unknown[] = [];

    // Enforce role-based category visibility strictly on the server
    const catPlaceholders = allowedCategories.map(() => '?').join(', ');
    whereClauses.push(`category IN (${catPlaceholders})`);
    params.push(...allowedCategories);

    if (categoryParam && categoryParam !== 'all') {
      if (!allowedCategories.includes(categoryParam as ActivityLogCategory)) {
        res.json({
          logs: [],
          total: 0,
          page,
          limit,
          total_pages: 1,
          allowed_categories: allowedCategories,
        });
        return;
      }
      whereClauses.push('category = ?');
      params.push(categoryParam);
    }

    if (roleParam && roleParam !== 'all' && VALID_ACTIVITY_ROLES.includes(roleParam as ActorRole)) {
      whereClauses.push('role = ?');
      params.push(roleParam);
    }

    if (searchParam) {
      const likeTerm = `%${searchParam}%`;
      whereClauses.push(
        '(LOWER(username) LIKE ? OR LOWER(action) LIKE ? OR LOWER(target_label) LIKE ? OR LOWER(details) LIKE ?)'
      );
      params.push(likeTerm, likeTerm, likeTerm, likeTerm);
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
    const countRow = db
      .prepare(`SELECT COUNT(*) AS cnt FROM activity_logs ${whereSql}`)
      .get(...params) as { cnt: number };

    const total = countRow.cnt;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const safePage = Math.min(page, totalPages);
    const safeOffset = (safePage - 1) * limit;

    const logs = db
      .prepare(
        `SELECT * FROM activity_logs ${whereSql} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`
      )
      .all(...params, limit, safeOffset) as ActivityLog[];

    res.json({
      logs,
      total,
      page: safePage,
      limit,
      total_pages: totalPages,
      allowed_categories: allowedCategories,
    });
  } catch (err) {
    res.status(500).json({ error: 'Gagal memuat log aktivitas', details: String(err) });
  }
});

apiRouter.get('/activity-logs/export', (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.authUser;
    if (!user) {
      res.status(401).json({ error: 'Sesi tidak valid.' });
      return;
    }

    const allowedCategories = getAllowedLogCategories(user.role);
    const categoryParam = typeof req.query.category === 'string' ? req.query.category.trim() : 'all';
    const roleParam = typeof req.query.role === 'string' ? req.query.role.trim() : 'all';
    const searchParam = typeof req.query.search === 'string' ? req.query.search.trim().toLowerCase() : '';
    const formatParam = typeof req.query.format === 'string' && req.query.format.toUpperCase() === 'CSV' ? 'CSV' : 'Excel';

    const whereClauses: string[] = [];
    const params: unknown[] = [];
    const catPlaceholders = allowedCategories.map(() => '?').join(', ');
    whereClauses.push(`category IN (${catPlaceholders})`);
    params.push(...allowedCategories);

    if (categoryParam && categoryParam !== 'all') {
      if (!allowedCategories.includes(categoryParam as ActivityLogCategory)) {
        res.json({ logs: [], total: 0, allowed_categories: allowedCategories });
        return;
      }
      whereClauses.push('category = ?');
      params.push(categoryParam);
    }

    if (roleParam && roleParam !== 'all' && VALID_ACTIVITY_ROLES.includes(roleParam as ActorRole)) {
      whereClauses.push('role = ?');
      params.push(roleParam);
    }

    if (searchParam) {
      const likeTerm = `%${searchParam}%`;
      whereClauses.push(
        '(LOWER(username) LIKE ? OR LOWER(action) LIKE ? OR LOWER(target_label) LIKE ? OR LOWER(details) LIKE ?)'
      );
      params.push(likeTerm, likeTerm, likeTerm, likeTerm);
    }

    const whereSql = `WHERE ${whereClauses.join(' AND ')}`;
    const logs = db
      .prepare(`SELECT * FROM activity_logs ${whereSql} ORDER BY created_at DESC, id DESC LIMIT 5000`)
      .all(...params) as ActivityLog[];

    const logCat: ActivityLogCategory =
      user.role === 'Teknisi' ? 'network' : user.role === 'Keuangan' ? 'billing' : 'auth';

    logOperatorAction(
      req,
      logCat,
      `Ekspor Log Aktivitas (${formatParam})`,
      `${logs.length} baris log`,
      `Mengunduh arsip Log Aktivitas format ${formatParam} (filter kategori: ${categoryParam}, peran: ${roleParam})`
    );

    res.json({
      logs,
      total: logs.length,
      allowed_categories: allowedCategories,
      exported_at_wib: formatWibReadable(),
    });
  } catch (err) {
    res.status(500).json({ error: 'Gagal mengekspor log aktivitas', details: String(err) });
  }
});

apiRouter.post('/exports/audit', (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.authUser;
    if (!user) {
      res.status(401).json({ error: 'Sesi tidak valid.' });
      return;
    }

    const exportType = typeof req.body?.export_type === 'string' ? req.body.export_type.trim() : '';
    const format = req.body?.format === 'CSV' ? 'CSV' : 'Excel';
    const rowCount = Math.max(0, Number(req.body?.row_count) || 0);
    const scopeLabel = typeof req.body?.scope_label === 'string' ? req.body.scope_label.trim() : '';

    if (exportType === 'backup') {
      const reason = `Akses ditolak: ekspor snapshot backup penuh hanya diizinkan untuk Administrator.`;
      logOperatorAction(req, 'auth', 'Akses Ditolak (403)', 'POST /api/exports/audit', reason);
      res.status(403).json({ error: reason });
      return;
    }

    if ((exportType === 'billing' || exportType === 'reports') && user.role === 'Teknisi') {
      const reason = `Akses ditolak: peran Teknisi tidak memiliki izin mengekspor data tagihan/laporan keuangan.`;
      logOperatorAction(req, 'auth', 'Akses Ditolak (403)', 'POST /api/exports/audit', reason);
      res.status(403).json({ error: reason });
      return;
    }

    let category: ActivityLogCategory = 'customer';
    let action = `Ekspor Data (${format})`;
    if (exportType === 'customers') {
      category = 'customer';
      action = `Ekspor Data Pelanggan (${format})`;
    } else if (exportType === 'billing') {
      category = 'billing';
      action = `Ekspor Tagihan & Pembayaran (${format})`;
    } else if (exportType === 'reports') {
      category = 'billing';
      action = `Ekspor Laporan Keuangan (${format})`;
    } else if (exportType === 'activity_logs') {
      category = user.role === 'Teknisi' ? 'network' : user.role === 'Keuangan' ? 'billing' : 'auth';
      action = `Ekspor Log Aktivitas (${format})`;
    } else {
      res.status(400).json({ error: 'Jenis ekspor data tidak dikenali.' });
      return;
    }

    logOperatorAction(
      req,
      category,
      action,
      scopeLabel || `${rowCount} baris`,
      `Mengunduh file ${format} berisi ${rowCount} baris data (${scopeLabel || exportType})`
    );

    res.json({ logged: true });
  } catch (err) {
    res.status(500).json({ error: 'Gagal mencatat audit ekspor data', details: String(err) });
  }
});

function formatMonthLabel(period: string): string {
  const [year, month] = period.split('-').map(Number);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  if (!year || !month || month < 1 || month > 12) return period;
  return `${months[month - 1]} ${year}`;
}

function normalizeWhatsapp(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.startsWith('0')) {
    return `62${digits.slice(1)}`;
  }
  if (digits.startsWith('62')) {
    return digits;
  }
  return `62${digits}`;
}

function normalizeDeviceStatus(raw: unknown): DeviceStatus | null {
  if (typeof raw !== 'string') return null;
  const val = raw.trim().toLowerCase();
  if (['online', 'up', 'connected', 'active', 'ok'].includes(val)) return 'Online';
  if (['offline', 'down', 'disconnected', 'los', 'timeout'].includes(val)) return 'Offline';
  if (['isolir', 'isolated', 'suspend', 'suspended', 'blocked'].includes(val)) return 'Isolir';
  return null;
}

// ---------------------------------------------------------------------------
// 1. DASBOR UTAMA
// ---------------------------------------------------------------------------
apiRouter.get('/dashboard', (req: AuthenticatedRequest, res: Response) => {
  try {
    const period = typeof req.query.period === 'string' && /^\d{4}-\d{2}$/.test(req.query.period)
      ? req.query.period
      : '2026-11';

    const customerStats = db.prepare(`
      SELECT
        SUM(CASE WHEN customer_active = 1 THEN 1 ELSE 0 END) AS active_customers,
        SUM(CASE WHEN customer_active = 0 THEN 1 ELSE 0 END) AS inactive_customers,
        SUM(CASE WHEN customer_active = 1 AND device_status = 'Online' THEN 1 ELSE 0 END) AS devices_online,
        SUM(CASE WHEN customer_active = 1 AND device_status = 'Offline' THEN 1 ELSE 0 END) AS devices_offline,
        SUM(CASE WHEN customer_active = 1 AND device_status = 'Isolir' THEN 1 ELSE 0 END) AS devices_isolir
      FROM customers
    `).get() as {
      active_customers: number | null;
      inactive_customers: number | null;
      devices_online: number | null;
      devices_offline: number | null;
      devices_isolir: number | null;
    };

    const periodInvoiceStats = db.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN status = 'Lunas' THEN amount ELSE 0 END), 0) AS current_month_revenue,
        COALESCE(SUM(amount), 0) AS current_month_target,
        SUM(CASE WHEN status = 'Lunas' THEN 1 ELSE 0 END) AS paid_invoices_count,
        COUNT(*) AS total_invoices_count
      FROM invoices
      WHERE billing_period = ?
    `).get(period) as {
      current_month_revenue: number;
      current_month_target: number;
      paid_invoices_count: number | null;
      total_invoices_count: number;
    };

    const allArrears = db.prepare(`
      SELECT
        COALESCE(SUM(amount), 0) AS total_arrears_all_time,
        COUNT(*) AS arrears_invoices_count
      FROM invoices
      WHERE status = 'Belum Lunas'
    `).get() as {
      total_arrears_all_time: number;
      arrears_invoices_count: number;
    };

    const trendRows = db.prepare(`
      SELECT
        billing_period AS period,
        COALESCE(SUM(CASE WHEN status = 'Lunas' THEN amount ELSE 0 END), 0) AS paid_total,
        COALESCE(SUM(CASE WHEN status = 'Belum Lunas' THEN amount ELSE 0 END), 0) AS unpaid_total,
        SUM(CASE WHEN status = 'Lunas' THEN 1 ELSE 0 END) AS paid_count,
        SUM(CASE WHEN status = 'Belum Lunas' THEN 1 ELSE 0 END) AS unpaid_count
      FROM invoices
      GROUP BY billing_period
      ORDER BY billing_period ASC
      LIMIT 6
    `).all() as Array<{
      period: string;
      paid_total: number;
      unpaid_total: number;
      paid_count: number;
      unpaid_count: number;
    }>;

    const monthly_trend = trendRows.map((row) => ({
      ...row,
      label: formatMonthLabel(row.period),
    }));

    const priority_unpaid = db.prepare(`
      SELECT
        i.*,
        c.customer_code,
        c.name AS customer_name,
        c.whatsapp AS customer_whatsapp,
        c.address AS customer_address,
        c.device_id,
        c.device_status,
        p.name AS package_name
      FROM invoices i
      JOIN customers c ON c.id = i.customer_id
      JOIN packages p ON p.id = c.package_id
      WHERE i.status = 'Belum Lunas'
      ORDER BY i.due_date ASC, i.id ASC
      LIMIT 8
    `).all() as Invoice[];

    const recent_device_logs = db.prepare(`
      SELECT
        l.*,
        c.name AS customer_name,
        c.customer_code,
        c.device_ip
      FROM device_logs l
      JOIN customers c ON c.id = l.customer_id
      ORDER BY l.logged_at DESC, l.id DESC
      LIMIT 8
    `).all() as DeviceLog[];

    const network_nodes = db.prepare(`
      SELECT * FROM network_nodes ORDER BY node_type ASC, node_code ASC
    `).all() as NetworkNode[];

    const allowedCategories = req.authUser
      ? getAllowedLogCategories(req.authUser.role)
      : (['billing', 'network', 'customer', 'auth'] as ActivityLogCategory[]);
    const catPlaceholders = allowedCategories.map(() => '?').join(', ');
    const recent_activity_logs = db
      .prepare(
        `SELECT * FROM activity_logs WHERE category IN (${catPlaceholders}) ORDER BY created_at DESC, id DESC LIMIT 5`
      )
      .all(...allowedCategories) as ActivityLog[];

    const mikrotikNodes = network_nodes.filter((n) => n.node_type === 'MikroTik');
    const oltNodes = network_nodes.filter((n) => n.node_type === 'OLT');

    res.json({
      period,
      kpis: {
        active_customers: customerStats.active_customers ?? 0,
        inactive_customers: customerStats.inactive_customers ?? 0,
        current_month_revenue: periodInvoiceStats.current_month_revenue ?? 0,
        current_month_target: periodInvoiceStats.current_month_target ?? 0,
        paid_invoices_count: periodInvoiceStats.paid_invoices_count ?? 0,
        total_invoices_count: periodInvoiceStats.total_invoices_count ?? 0,
        total_arrears_all_time: allArrears.total_arrears_all_time ?? 0,
        arrears_invoices_count: allArrears.arrears_invoices_count ?? 0,
        devices_online: customerStats.devices_online ?? 0,
        devices_offline: customerStats.devices_offline ?? 0,
        devices_isolir: customerStats.devices_isolir ?? 0,
        mikrotik_online: mikrotikNodes.filter((n) => n.status === 'Online').length,
        mikrotik_total: mikrotikNodes.length,
        olt_online: oltNodes.filter((n) => n.status !== 'Offline').length,
        olt_total: oltNodes.length,
      },
      monthly_trend,
      priority_unpaid,
      recent_device_logs,
      network_nodes,
      recent_activity_logs,
    });
  } catch (err) {
    res.status(500).json({ error: 'Gagal memuat data dasbor', details: String(err) });
  }
});

// ---------------------------------------------------------------------------
// 2. PAKET INTERNET
// ---------------------------------------------------------------------------
apiRouter.get('/packages', (_req: Request, res: Response) => {
  try {
    const rows = db.prepare(`
      SELECT
        p.*,
        COUNT(c.id) AS customer_count
      FROM packages p
      LEFT JOIN customers c ON c.package_id = p.id AND c.customer_active = 1
      GROUP BY p.id
      ORDER BY p.monthly_price ASC
    `).all() as InternetPackage[];
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Gagal memuat daftar paket', details: String(err) });
  }
});

apiRouter.post('/packages', (req: AuthenticatedRequest, res: Response) => {
  try {
    const { name, speed_down_mbps, speed_up_mbps, monthly_price, description } = req.body;
    if (!name || !speed_down_mbps || !speed_up_mbps || !monthly_price) {
      res.status(400).json({ error: 'Nama paket, kecepatan, dan harga bulanan wajib diisi.' });
      return;
    }
    const info = db.prepare(`
      INSERT INTO packages (name, speed_down_mbps, speed_up_mbps, monthly_price, description)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      String(name).trim(),
      Number(speed_down_mbps),
      Number(speed_up_mbps),
      Number(monthly_price),
      String(description ?? '').trim()
    );
    const created = db.prepare('SELECT * FROM packages WHERE id = ?').get(info.lastInsertRowid) as InternetPackage;

    logOperatorAction(
      req,
      'customer',
      'Tambah Paket Internet',
      created.name,
      `Menambahkan paket ${created.speed_down_mbps}/${created.speed_up_mbps} Mbps dengan tarif ${formatRupiahServer(created.monthly_price)}/bulan`
    );

    res.status(201).json(created);
  } catch (err) {
    res.status(500).json({ error: 'Gagal menambahkan paket internet', details: String(err) });
  }
});

apiRouter.put('/packages/:id', (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    const { name, speed_down_mbps, speed_up_mbps, monthly_price, description } = req.body;
    const existing = db.prepare('SELECT * FROM packages WHERE id = ?').get(id) as InternetPackage | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Paket tidak ditemukan.' });
      return;
    }
    db.prepare(`
      UPDATE packages
      SET name = ?, speed_down_mbps = ?, speed_up_mbps = ?, monthly_price = ?, description = ?
      WHERE id = ?
    `).run(
      String(name).trim(),
      Number(speed_down_mbps),
      Number(speed_up_mbps),
      Number(monthly_price),
      String(description ?? '').trim(),
      id
    );
    const updated = db.prepare('SELECT * FROM packages WHERE id = ?').get(id) as InternetPackage;

    logOperatorAction(
      req,
      'customer',
      'Edit Paket Internet',
      updated.name,
      `Memperbarui paket (${updated.speed_down_mbps}/${updated.speed_up_mbps} Mbps, tarif ${formatRupiahServer(updated.monthly_price)}/bulan)`
    );

    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: 'Gagal memperbarui paket internet', details: String(err) });
  }
});

apiRouter.delete('/packages/:id', (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    const existing = db.prepare('SELECT id, name FROM packages WHERE id = ?').get(id) as { id: number; name: string } | undefined;
    const used = db.prepare('SELECT COUNT(*) as cnt FROM customers WHERE package_id = ?').get(id) as { cnt: number };
    if (used.cnt > 0) {
      res.status(409).json({
        error: `Paket masih digunakan oleh ${used.cnt} pelanggan. Pindahkan pelanggan ke paket lain terlebih dahulu.`,
      });
      return;
    }
    db.prepare('DELETE FROM packages WHERE id = ?').run(id);
    if (existing) {
      logOperatorAction(
        req,
        'customer',
        'Hapus Paket Internet',
        existing.name,
        `Menghapus paket internet "${existing.name}" dari master layanan`
      );
    }
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: 'Gagal menghapus paket', details: String(err) });
  }
});

// ---------------------------------------------------------------------------
// 3. PELANGGAN & PERANGKAT
// ---------------------------------------------------------------------------
apiRouter.get('/customers', (req: AuthenticatedRequest, res: Response) => {
  try {
    const rows = db.prepare(`
      SELECT
        c.*,
        p.name AS package_name,
        p.speed_down_mbps,
        p.speed_up_mbps,
        p.monthly_price AS package_price,
        COALESCE(c.custom_price, p.monthly_price) AS effective_price,
        n.node_code,
        n.name AS node_name,
        n.node_type,
        o.odp_code,
        o.name AS odp_name
      FROM customers c
      JOIN packages p ON p.id = c.package_id
      LEFT JOIN network_nodes n ON n.id = c.node_id
      LEFT JOIN network_odps o ON o.id = c.odp_id
      ORDER BY c.customer_code ASC
    `).all() as Array<Record<string, unknown>>;
    res.json(rows.map((r) => sanitizeCustomerForStaff(r, req.authUser?.role)));
  } catch (err) {
    res.status(500).json({ error: 'Gagal memuat data pelanggan', details: String(err) });
  }
});

apiRouter.post('/customers', (req: AuthenticatedRequest, res: Response) => {
  try {
    const {
      name,
      address,
      whatsapp,
      package_id,
      custom_price,
      device_id,
      device_ip,
      device_model,
      due_day,
      device_status,
      customer_active,
    } = req.body;

    if (!name || !address || !whatsapp || !package_id || !device_id || !device_ip) {
      res.status(400).json({ error: 'Nama, alamat, WhatsApp, paket, ID perangkat, dan IP perangkat wajib diisi.' });
      return;
    }

    const lastRow = db.prepare('SELECT id FROM customers ORDER BY id DESC LIMIT 1').get() as { id: number } | undefined;
    const nextSeq = (lastRow?.id ?? 0) + 1;
    const customerCode = `PLG-${String(nextSeq).padStart(3, '0')}`;
    const dueDayNum = Math.min(28, Math.max(1, Number(due_day) || 10));
    const normalizedStatus = normalizeDeviceStatus(device_status) ?? 'Online';
    const nowIso = new Date().toISOString();
    const initialPin =
      typeof req.body?.portal_pin === 'string' && req.body.portal_pin.trim().length >= 4
        ? req.body.portal_pin.trim()
        : DEFAULT_CUSTOMER_PORTAL_PIN;

    const info = db.prepare(`
      INSERT INTO customers (
        customer_code, name, address, whatsapp, package_id, custom_price,
        device_id, device_ip, device_model, due_day, device_status, customer_active, last_seen_at,
        portal_pin_hash, portal_pin_display, portal_pin_updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      customerCode,
      String(name).trim(),
      String(address).trim(),
      normalizeWhatsapp(String(whatsapp)),
      Number(package_id),
      custom_price ? Number(custom_price) : null,
      String(device_id).trim(),
      String(device_ip).trim(),
      String(device_model || 'ONT Fiber').trim(),
      dueDayNum,
      normalizedStatus,
      customer_active === 0 || customer_active === false ? 0 : 1,
      nowIso,
      hashPassword(initialPin),
      initialPin,
      nowIso
    );

    const createdRow = db.prepare(`
      SELECT
        c.*,
        p.name AS package_name,
        p.speed_down_mbps,
        p.speed_up_mbps,
        p.monthly_price AS package_price,
        COALESCE(c.custom_price, p.monthly_price) AS effective_price
      FROM customers c
      JOIN packages p ON p.id = c.package_id
      WHERE c.id = ?
    `).get(info.lastInsertRowid) as Record<string, unknown>;
    const created = sanitizeCustomerForStaff(createdRow, req.authUser?.role);

    logOperatorAction(
      req,
      'customer',
      'Tambah Pelanggan',
      `${created.customer_code} · ${created.name}`,
      `Mendaftarkan pelanggan baru paket ${created.package_name ?? '-'} (${created.device_id} · ${created.device_ip}) + PIN Portal awal`
    );

    res.status(201).json(created);
  } catch (err) {
    const msg = String(err);
    if (msg.includes('UNIQUE constraint failed')) {
      res.status(409).json({ error: 'ID Perangkat (ONT/Router) sudah terdaftar pada pelanggan lain.' });
      return;
    }
    res.status(500).json({ error: 'Gagal menyimpan pelanggan baru', details: msg });
  }
});

apiRouter.put('/customers/:id', (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    const existing = db.prepare('SELECT * FROM customers WHERE id = ?').get(id) as Customer | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Pelanggan tidak ditemukan.' });
      return;
    }

    const {
      name,
      address,
      whatsapp,
      package_id,
      custom_price,
      device_id,
      device_ip,
      device_model,
      due_day,
      device_status,
      customer_active,
    } = req.body;

    const dueDayNum = Math.min(28, Math.max(1, Number(due_day) || existing.due_day));
    const newStatus = normalizeDeviceStatus(device_status) ?? existing.device_status;
    const nowIso = new Date().toISOString();

    db.prepare(`
      UPDATE customers
      SET
        name = ?,
        address = ?,
        whatsapp = ?,
        package_id = ?,
        custom_price = ?,
        device_id = ?,
        device_ip = ?,
        device_model = ?,
        due_day = ?,
        device_status = ?,
        customer_active = ?
      WHERE id = ?
    `).run(
      String(name ?? existing.name).trim(),
      String(address ?? existing.address).trim(),
      whatsapp ? normalizeWhatsapp(String(whatsapp)) : existing.whatsapp,
      Number(package_id ?? existing.package_id),
      custom_price !== undefined && custom_price !== null && custom_price !== '' ? Number(custom_price) : null,
      String(device_id ?? existing.device_id).trim(),
      String(device_ip ?? existing.device_ip).trim(),
      String(device_model ?? existing.device_model).trim(),
      dueDayNum,
      newStatus,
      customer_active === undefined ? existing.customer_active : customer_active ? 1 : 0,
      id
    );

    if (newStatus !== existing.device_status) {
      db.prepare(`
        INSERT INTO device_logs (
          customer_id, device_id, previous_status, new_status, event_source, reason, latency_ms, logged_at
        ) VALUES (?, ?, ?, ?, 'Manual Operator', 'Perubahan status melalui form pelanggan', NULL, ?)
      `).run(id, String(device_id ?? existing.device_id).trim(), existing.device_status, newStatus, nowIso);
    }

    const updatedRow = db.prepare(`
      SELECT
        c.*,
        p.name AS package_name,
        p.speed_down_mbps,
        p.speed_up_mbps,
        p.monthly_price AS package_price,
        COALESCE(c.custom_price, p.monthly_price) AS effective_price
      FROM customers c
      JOIN packages p ON p.id = c.package_id
      WHERE c.id = ?
    `).get(id) as Record<string, unknown>;
    const updated = sanitizeCustomerForStaff(updatedRow, req.authUser?.role);

    logOperatorAction(
      req,
      'customer',
      'Edit Pelanggan',
      `${updated.customer_code} · ${updated.name}`,
      `Memperbarui data pelanggan (paket ${updated.package_name ?? '-'}, tarif ${formatRupiahServer(updated.effective_price)}, perangkat ${updated.device_id}, status ${updated.customer_active === 1 ? 'Aktif' : 'Nonaktif'})`
    );

    if (newStatus !== existing.device_status) {
      logOperatorAction(
        req,
        'network',
        newStatus === 'Isolir' ? 'Isolir Perangkat' : existing.device_status === 'Isolir' && newStatus === 'Online' ? 'Buka Isolir Perangkat' : 'Ubah Status Perangkat',
        `${updated.device_id} (${updated.name})`,
        `Status perangkat diubah ${existing.device_status} → ${newStatus} melalui form pelanggan`
      );
    }

    res.json(updated);
  } catch (err) {
    const msg = String(err);
    if (msg.includes('UNIQUE constraint failed')) {
      res.status(409).json({ error: 'ID Perangkat (ONT/Router) bentrok dengan pelanggan lain.' });
      return;
    }
    res.status(500).json({ error: 'Gagal memperbarui pelanggan', details: msg });
  }
});

apiRouter.delete('/customers/:id', (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    const existing = db.prepare('SELECT id, customer_code, name, device_id FROM customers WHERE id = ?').get(id) as {
      id: number;
      customer_code: string;
      name: string;
      device_id: string;
    } | undefined;
    db.prepare('DELETE FROM customers WHERE id = ?').run(id);
    if (existing) {
      logOperatorAction(
        req,
        'customer',
        'Hapus Pelanggan',
        `${existing.customer_code} · ${existing.name}`,
        `Menghapus data pelanggan dan perangkat ${existing.device_id}`
      );
    }
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: 'Gagal menghapus pelanggan', details: String(err) });
  }
});

apiRouter.post('/customers/:id/portal-pin', (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    const existing = db.prepare(`
      SELECT id, customer_code, name
      FROM customers
      WHERE id = ?
      LIMIT 1
    `).get(id) as { id: number; customer_code: string; name: string } | undefined;

    if (!existing) {
      res.status(404).json({ error: 'Pelanggan tidak ditemukan.' });
      return;
    }

    const modeRaw = typeof req.body?.mode === 'string' ? req.body.mode.trim() : 'custom';
    let nextPin = '';
    let actionLabel = 'Atur PIN Portal Pelanggan';

    if (modeRaw === 'reset_default') {
      nextPin = DEFAULT_CUSTOMER_PORTAL_PIN;
      actionLabel = 'Reset PIN Portal Pelanggan';
    } else if (modeRaw === 'generate') {
      nextPin = String(crypto.randomInt(100000, 999999));
      actionLabel = 'Reset PIN Acak Portal Pelanggan';
    } else {
      const customPin = typeof req.body?.pin === 'string' ? req.body.pin.trim() : '';
      if (customPin.length < 4 || customPin.length > 16 || /\s/.test(customPin)) {
        res.status(400).json({
          error: 'PIN / Password Portal harus 4–16 karakter tanpa spasi.',
        });
        return;
      }
      nextPin = customPin;
      actionLabel = 'Atur PIN Portal Pelanggan';
    }

    const nowIso = new Date().toISOString();
    db.prepare(`
      UPDATE customers
      SET portal_pin_hash = ?,
          portal_pin_display = ?,
          portal_pin_updated_at = ?
      WHERE id = ?
    `).run(hashPassword(nextPin), nextPin, nowIso, id);

    // Revoke active customer portal sessions so customer logs in with the new PIN
    db.prepare('DELETE FROM customer_sessions WHERE customer_id = ?').run(id);

    logOperatorAction(
      req,
      'auth',
      actionLabel,
      `${existing.customer_code} · ${existing.name}`,
      modeRaw === 'reset_default'
        ? `Mereset PIN portal pelanggan ${existing.customer_code} ke PIN standar dan mencabut sesi portal aktif`
        : modeRaw === 'generate'
          ? `Membuat PIN acak 6-digit baru untuk portal pelanggan ${existing.customer_code} dan mencabut sesi aktif`
          : `Memperbarui PIN / password portal pelanggan ${existing.customer_code} dan mencabut sesi portal aktif`
    );

    res.json({
      customer_id: id,
      customer_code: existing.customer_code,
      portal_pin_display: nextPin,
      portal_pin_updated_at: nowIso,
    });
  } catch (err) {
    res.status(500).json({ error: 'Gagal mengatur PIN portal pelanggan', details: String(err) });
  }
});

apiRouter.post('/customers/import', (req: AuthenticatedRequest, res: Response) => {
  try {
    const rows = Array.isArray(req.body?.rows) ? (req.body.rows as Array<Record<string, unknown>>) : [];
    const mode = req.body?.mode === 'insert_only' ? 'insert_only' : 'upsert';

    if (rows.length === 0) {
      res.status(400).json({ error: 'Tidak ada baris data pelanggan yang dikirim untuk diimpor.' });
      return;
    }

    const allPackages = db.prepare('SELECT id, name FROM packages ORDER BY id ASC').all() as Array<{
      id: number;
      name: string;
    }>;

    if (allPackages.length === 0) {
      res.status(400).json({ error: 'Belum ada paket internet terdaftar. Tambahkan minimal 1 paket terlebih dahulu.' });
      return;
    }

    const findPackageId = (pkgVal: unknown): number | null => {
      if (pkgVal === undefined || pkgVal === null || String(pkgVal).trim() === '') {
        return allPackages[0].id;
      }
      if (typeof pkgVal === 'number' || /^\d+$/.test(String(pkgVal).trim())) {
        const numId = Number(pkgVal);
        const byId = allPackages.find((p) => p.id === numId);
        if (byId) return byId.id;
      }
      const target = String(pkgVal).trim().toLowerCase();
      const exact = allPackages.find((p) => p.name.toLowerCase() === target);
      if (exact) return exact.id;
      const partial = allPackages.find(
        (p) => p.name.toLowerCase().includes(target) || target.includes(p.name.toLowerCase())
      );
      return partial ? partial.id : null;
    };

    const findExisting = db.prepare(`
      SELECT id, customer_code FROM customers
      WHERE device_id = ? OR (customer_code = ? AND ? != '')
      LIMIT 1
    `);

    const maxIdRow = db.prepare('SELECT COALESCE(MAX(id), 0) AS max_id FROM customers').get() as { max_id: number };
    let nextSeq = maxIdRow.max_id + 1;

    const insertStmt = db.prepare(`
      INSERT INTO customers (
        customer_code, name, address, whatsapp, package_id, custom_price,
        device_id, device_ip, device_model, due_day, device_status, customer_active,
        last_seen_at, pon_port, pppoe_username,
        portal_pin_hash, portal_pin_display, portal_pin_updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const updateStmt = db.prepare(`
      UPDATE customers
      SET name = ?, address = ?, whatsapp = ?, package_id = ?, custom_price = ?,
          device_id = ?, device_ip = ?, device_model = ?, due_day = ?,
          device_status = ?, customer_active = ?,
          pon_port = COALESCE(?, pon_port),
          pppoe_username = COALESCE(?, pppoe_username)
      WHERE id = ?
    `);

    let insertedCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;
    const errors: Array<{ row_number: number; name: string; reason: string }> = [];
    const nowIso = new Date().toISOString();

    const runTx = db.transaction(() => {
      rows.forEach((row, index) => {
        const rowNum = index + 1;
        const name = String(row.name ?? '').trim();
        const address = String(row.address ?? '').trim();
        const whatsappRaw = String(row.whatsapp ?? '').trim();
        const deviceId = String(row.device_id ?? '').trim();
        const deviceIp = String(row.device_ip ?? '').trim();
        const custCodeInput = String(row.customer_code ?? '').trim();

        if (!name || !address || !whatsappRaw || !deviceId || !deviceIp) {
          skippedCount += 1;
          errors.push({
            row_number: rowNum,
            name: name || `Baris ${rowNum}`,
            reason: 'Kolom wajib (Nama, Alamat, WhatsApp, ID Perangkat, atau IP Perangkat) kosong.',
          });
          return;
        }

        const packageId = findPackageId(row.package_id ?? row.package_name);
        if (!packageId) {
          skippedCount += 1;
          errors.push({
            row_number: rowNum,
            name,
            reason: `Nama paket "${String(row.package_name ?? row.package_id)}" tidak cocok dengan master paket.`,
          });
          return;
        }

        const customPriceRaw = row.custom_price;
        const customPrice =
          customPriceRaw !== undefined && customPriceRaw !== null && String(customPriceRaw).trim() !== '' && Number(customPriceRaw) > 0
            ? Number(customPriceRaw)
            : null;
        const deviceModel = String(row.device_model ?? 'ONT Fiber').trim() || 'ONT Fiber';
        const dueDayParsed = Number(row.due_day);
        const dueDay = Number.isFinite(dueDayParsed) && dueDayParsed >= 1 && dueDayParsed <= 28 ? Math.round(dueDayParsed) : 10;
        const deviceStatus = normalizeDeviceStatus(row.device_status) ?? 'Online';
        const activeStr = String(row.customer_active ?? '1').trim().toLowerCase();
        const customerActive = ['0', 'false', 'nonaktif', 'tidak', 'no'].includes(activeStr) ? 0 : 1;
        const ponPort = row.pon_port ? String(row.pon_port).trim() : null;
        const pppoeUsername = row.pppoe_username ? String(row.pppoe_username).trim() : null;
        const normalizedWa = normalizeWhatsapp(whatsappRaw);

        const existing = findExisting.get(deviceId, custCodeInput, custCodeInput) as {
          id: number;
          customer_code: string;
        } | undefined;

        if (existing) {
          if (mode === 'insert_only') {
            skippedCount += 1;
            return;
          }
          updateStmt.run(
            name,
            address,
            normalizedWa,
            packageId,
            customPrice,
            deviceId,
            deviceIp,
            deviceModel,
            dueDay,
            deviceStatus,
            customerActive,
            ponPort,
            pppoeUsername,
            existing.id
          );
          updatedCount += 1;
          return;
        }

        let newCode = custCodeInput || `PLG-${String(nextSeq).padStart(3, '0')}`;
        while (db.prepare('SELECT 1 FROM customers WHERE customer_code = ?').get(newCode)) {
          nextSeq += 1;
          newCode = `PLG-${String(nextSeq).padStart(3, '0')}`;
        }
        nextSeq += 1;

        insertStmt.run(
          newCode,
          name,
          address,
          normalizedWa,
          packageId,
          customPrice,
          deviceId,
          deviceIp,
          deviceModel,
          dueDay,
          deviceStatus,
          customerActive,
          nowIso,
          ponPort,
          pppoeUsername,
          hashPassword(DEFAULT_CUSTOMER_PORTAL_PIN),
          DEFAULT_CUSTOMER_PORTAL_PIN,
          nowIso
        );
        insertedCount += 1;
      });
    });

    runTx();

    logOperatorAction(
      req,
      'customer',
      'Import Excel Pelanggan',
      `${rows.length} baris diproses`,
      `Import mode ${mode}: ${insertedCount} ditambah, ${updatedCount} diperbarui, ${skippedCount} dilewati`
    );

    res.json({
      inserted_count: insertedCount,
      updated_count: updatedCount,
      skipped_count: skippedCount,
      errors,
    });
  } catch (err) {
    res.status(500).json({ error: 'Gagal mengimpor data pelanggan dari Excel', details: String(err) });
  }
});

// ---------------------------------------------------------------------------
// 4. SISTEM BILLING & TAGIHAN (TANPA DENDA KETERLAMBATAN)
// ---------------------------------------------------------------------------
apiRouter.get('/invoices', (req: Request, res: Response) => {
  try {
    const period = typeof req.query.period === 'string' ? req.query.period : '';
    const status = typeof req.query.status === 'string' ? req.query.status : 'all';

    const whereClauses: string[] = [];
    const params: unknown[] = [];

    if (period && period !== 'all') {
      whereClauses.push('i.billing_period = ?');
      params.push(period);
    }
    if (status === 'Lunas' || status === 'Belum Lunas') {
      whereClauses.push('i.status = ?');
      params.push(status);
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    const rows = db.prepare(`
      SELECT
        i.*,
        c.customer_code,
        c.name AS customer_name,
        c.whatsapp AS customer_whatsapp,
        c.address AS customer_address,
        c.device_id,
        c.device_status,
        p.name AS package_name
      FROM invoices i
      JOIN customers c ON c.id = i.customer_id
      JOIN packages p ON p.id = c.package_id
      ${whereSql}
      ORDER BY i.billing_period DESC, i.status DESC, i.due_date ASC, c.customer_code ASC
    `).all(...params) as Invoice[];

    const periodsRows = db.prepare(`
      SELECT DISTINCT billing_period FROM invoices ORDER BY billing_period DESC
    `).all() as Array<{ billing_period: string }>;

    res.json({
      invoices: rows,
      available_periods: periodsRows.map((p) => p.billing_period),
    });
  } catch (err) {
    res.status(500).json({ error: 'Gagal memuat daftar tagihan', details: String(err) });
  }
});

apiRouter.post('/invoices/generate', (req: AuthenticatedRequest, res: Response) => {
  try {
    const billingPeriod = typeof req.body.billing_period === 'string' && /^\d{4}-\d{2}$/.test(req.body.billing_period)
      ? req.body.billing_period
      : '2026-11';

    const activeCustomers = db.prepare(`
      SELECT
        c.id,
        c.customer_code,
        c.due_day,
        COALESCE(c.custom_price, p.monthly_price) AS amount
      FROM customers c
      JOIN packages p ON p.id = c.package_id
      WHERE c.customer_active = 1
      ORDER BY c.id ASC
    `).all() as Array<{ id: number; customer_code: string; due_day: number; amount: number }>;

    const checkStmt = db.prepare('SELECT id FROM invoices WHERE customer_id = ? AND billing_period = ?');
    const insertStmt = db.prepare(`
      INSERT INTO invoices (
        invoice_number, customer_id, billing_period, amount, late_fee,
        due_date, status, notes
      ) VALUES (?, ?, ?, ?, 0, ?, 'Belum Lunas', 'Tagihan otomatis bulanan (tanpa denda keterlambatan)')
    `);

    const ymCompact = billingPeriod.replace('-', '');
    let createdCount = 0;
    let skippedCount = 0;

    const runTx = db.transaction(() => {
      for (const cust of activeCustomers) {
        const exists = checkStmt.get(cust.id, billingPeriod);
        if (exists) {
          skippedCount += 1;
          continue;
        }
        const dueDate = `${billingPeriod}-${String(cust.due_day).padStart(2, '0')}`;
        const invNumber = `INV-${ymCompact}-${cust.customer_code.replace('PLG-', '')}`;
        insertStmt.run(invNumber, cust.id, billingPeriod, cust.amount, dueDate);
        createdCount += 1;
      }
    });

    runTx();

    logOperatorAction(
      req,
      'billing',
      'Terbitkan Tagihan Bulanan',
      `Periode ${formatMonthLabel(billingPeriod)}`,
      `${createdCount} invoice baru diterbitkan (${skippedCount} sudah tersedia) dengan 0% denda`
    );

    res.json({
      billing_period: billingPeriod,
      created_count: createdCount,
      skipped_count: skippedCount,
      message:
        createdCount > 0
          ? `${createdCount} tagihan baru berhasil dibuat untuk periode ${formatMonthLabel(billingPeriod)} (tanpa denda).`
          : `Semua pelanggan aktif sudah memiliki tagihan untuk periode ${formatMonthLabel(billingPeriod)}.`,
    });
  } catch (err) {
    res.status(500).json({ error: 'Gagal membuat tagihan otomatis', details: String(err) });
  }
});

apiRouter.patch('/invoices/:id/pay', (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    const paymentMethod = String(req.body.payment_method || 'Transfer BCA').trim();
    const notes = req.body.notes ? String(req.body.notes).trim() : null;
    const paidAt = new Date().toISOString();

    const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(id) as Invoice | undefined;
    if (!inv) {
      res.status(404).json({ error: 'Tagihan tidak ditemukan.' });
      return;
    }

    db.prepare(`
      UPDATE invoices
      SET status = 'Lunas', payment_method = ?, paid_at = ?, notes = COALESCE(?, notes)
      WHERE id = ?
    `).run(paymentMethod, paidAt, notes, id);

    // If customer device was Isolir and no remaining unpaid invoices exist, automatically restore to Online
    const remainingUnpaid = db.prepare(`
      SELECT COUNT(*) AS cnt FROM invoices WHERE customer_id = ? AND status = 'Belum Lunas'
    `).get(inv.customer_id) as { cnt: number };

    const cust = db.prepare('SELECT id, name, device_id, device_status FROM customers WHERE id = ?').get(inv.customer_id) as {
      id: number;
      name: string;
      device_id: string;
      device_status: DeviceStatus;
    } | undefined;

    logOperatorAction(
      req,
      'billing',
      'Catat Lunas',
      `${inv.invoice_number}${cust ? ` (${cust.name})` : ''}`,
      `Pembayaran lunas sebesar ${formatRupiahServer(inv.amount)} via ${paymentMethod} (0 denda)`
    );

    if (cust && cust.device_status === 'Isolir' && remainingUnpaid.cnt === 0) {
      db.prepare(`UPDATE customers SET device_status = 'Online', last_seen_at = ? WHERE id = ?`).run(paidAt, cust.id);
      db.prepare(`
        INSERT INTO device_logs (
          customer_id, device_id, previous_status, new_status, event_source, reason, latency_ms, logged_at
        ) VALUES (?, ?, 'Isolir', 'Online', 'Sistem Auto', 'Otomatis buka isolir setelah seluruh tunggakan lunas', 8, ?)
      `).run(cust.id, cust.device_id, paidAt);

      logOperatorAction(
        req,
        'network',
        'Buka Isolir Otomatis',
        `${cust.device_id} (${cust.name})`,
        `Perangkat dipulihkan Isolir → Online otomatis setelah pelunasan ${inv.invoice_number}`
      );
    }

    res.json({ updated: true, paid_at: paidAt });
  } catch (err) {
    res.status(500).json({ error: 'Gagal mencatat pembayaran', details: String(err) });
  }
});

apiRouter.patch('/invoices/:id/unpay', (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    const inv = db.prepare(`
      SELECT i.*, c.name AS customer_name
      FROM invoices i
      JOIN customers c ON c.id = i.customer_id
      WHERE i.id = ?
    `).get(id) as (Invoice & { customer_name: string }) | undefined;

    db.prepare(`
      UPDATE invoices
      SET status = 'Belum Lunas', payment_method = NULL, paid_at = NULL
      WHERE id = ?
    `).run(id);

    if (inv) {
      logOperatorAction(
        req,
        'billing',
        'Batalkan Status Lunas',
        `${inv.invoice_number} (${inv.customer_name})`,
        `Status tagihan ${formatRupiahServer(inv.amount)} dikembalikan ke Belum Lunas`
      );
    }

    res.json({ updated: true });
  } catch (err) {
    res.status(500).json({ error: 'Gagal membatalkan status lunas', details: String(err) });
  }
});

apiRouter.patch('/invoices/:id/wa-reminder', (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    const nowIso = new Date().toISOString();
    const rawKey = typeof req.body?.template_key === 'string' ? req.body.template_key.trim() : '';
    const rawType = typeof req.body?.template_type === 'string' ? req.body.template_type.trim() : '';

    const inv = db.prepare(`
      SELECT i.*, c.name AS customer_name, c.whatsapp AS customer_whatsapp
      FROM invoices i
      JOIN customers c ON c.id = i.customer_id
      WHERE i.id = ?
    `).get(id) as (Invoice & { customer_name: string; customer_whatsapp: string }) | undefined;

    db.prepare('UPDATE invoices SET wa_reminder_sent_at = ? WHERE id = ?').run(nowIso, id);

    if (inv) {
      const tplRow = rawKey
        ? (db.prepare('SELECT title, template_key FROM whatsapp_templates WHERE template_key = ?').get(rawKey) as {
            title: string;
            template_key: WhatsAppTemplateKey;
          } | undefined)
        : undefined;
      const tplLabel = tplRow?.title || rawType || 'Pengingat Tagihan';
      const logCat: ActivityLogCategory = rawKey === 'isolation_notice' ? 'network' : 'billing';
      const actionLabel =
        rawKey === 'isolation_notice'
          ? 'Kirim Pemberitahuan Isolir WA'
          : 'Kirim Pengingat WA';

      logOperatorAction(
        req,
        logCat,
        actionLabel,
        `${inv.customer_name} · ${inv.invoice_number}`,
        `Template: ${tplLabel}${rawKey ? ` (${rawKey})` : ''} · Periode ${formatMonthLabel(inv.billing_period)} · ${formatRupiahServer(inv.amount)} ke ${inv.customer_whatsapp}`
      );
    }

    res.json({ updated: true, wa_reminder_sent_at: nowIso });
  } catch (err) {
    res.status(500).json({ error: 'Gagal mencatat waktu kirim pengingat WA', details: String(err) });
  }
});

// ---------------------------------------------------------------------------
// 5. MONITORING JARINGAN, LOG DISCONNECT & WEBHOOK API RECEIVER
// ---------------------------------------------------------------------------
apiRouter.get('/monitoring', (req: AuthenticatedRequest, res: Response) => {
  try {
    const network_nodes = db.prepare(`
      SELECT * FROM network_nodes
      ORDER BY node_type ASC, node_code ASC
    `).all() as NetworkNode[];

    const devicesRaw = db.prepare(`
      SELECT
        c.*,
        p.name AS package_name,
        p.speed_down_mbps,
        p.speed_up_mbps,
        p.monthly_price AS package_price,
        COALESCE(c.custom_price, p.monthly_price) AS effective_price,
        n.node_code,
        n.name AS node_name,
        n.node_type,
        o.odp_code,
        o.name AS odp_name
      FROM customers c
      JOIN packages p ON p.id = c.package_id
      LEFT JOIN network_nodes n ON n.id = c.node_id
      LEFT JOIN network_odps o ON o.id = c.odp_id
      ORDER BY
        CASE c.device_status WHEN 'Offline' THEN 0 WHEN 'Isolir' THEN 1 ELSE 2 END,
        c.customer_code ASC
    `).all() as Array<Record<string, unknown>>;
    const devices = devicesRaw.map((r) => sanitizeCustomerForStaff(r, req.authUser?.role));

    const device_logs = db.prepare(`
      SELECT
        l.*,
        c.name AS customer_name,
        c.customer_code,
        c.device_ip
      FROM device_logs l
      JOIN customers c ON c.id = l.customer_id
      ORDER BY l.logged_at DESC, l.id DESC
      LIMIT 50
    `).all() as DeviceLog[];

    const webhook_events = db.prepare(`
      SELECT * FROM webhook_events
      ORDER BY received_at DESC, id DESC
      LIMIT 40
    `).all() as WebhookEvent[];

    res.json({
      network_nodes,
      devices,
      device_logs,
      webhook_events,
    });
  } catch (err) {
    res.status(500).json({ error: 'Gagal memuat data monitoring jaringan', details: String(err) });
  }
});

// ---------------------------------------------------------------------------
// 5B. INTEGRASI API MIKROTIK & OLT (NODE MANAGEMENT & LIVE SYNC)
// ---------------------------------------------------------------------------
apiRouter.get('/network-nodes', (_req: Request, res: Response) => {
  try {
    const rows = db.prepare('SELECT * FROM network_nodes ORDER BY node_type ASC, node_code ASC').all() as NetworkNode[];
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Gagal memuat daftar node MikroTik & OLT', details: String(err) });
  }
});

apiRouter.post('/network-nodes', (req: AuthenticatedRequest, res: Response) => {
  try {
    const {
      node_code,
      name,
      node_type,
      vendor_model,
      host_ip,
      api_protocol,
      api_port,
      api_base_url,
      api_username,
      api_secret,
      poll_interval_sec,
    } = req.body;

    if (!name || !host_ip || !api_base_url || (node_type !== 'MikroTik' && node_type !== 'OLT')) {
      res.status(400).json({ error: 'Nama node, tipe (MikroTik/OLT), IP host, dan URL API wajib diisi.' });
      return;
    }

    const prefix = node_type === 'MikroTik' ? 'MK' : 'OLT';
    const countRow = db.prepare('SELECT COUNT(*) as cnt FROM network_nodes').get() as { cnt: number };
    const code = node_code && String(node_code).trim()
      ? String(node_code).trim().toUpperCase()
      : `${prefix}-NODE-${String(countRow.cnt + 1).padStart(2, '0')}`;

    const rawSecret = typeof api_secret === 'string' && api_secret.trim() ? api_secret.trim() : 'token';
    const masked = `****${rawSecret.slice(-4)}`;
    const nowIso = new Date().toISOString();

    const info = db.prepare(`
      INSERT INTO network_nodes (
        node_code, name, node_type, vendor_model, host_ip, api_protocol, api_port,
        api_base_url, api_username, api_token_masked, poll_interval_sec, status,
        last_sync_at, last_sync_message
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Online', ?, ?)
    `).run(
      code,
      String(name).trim(),
      node_type as NetworkNodeType,
      String(vendor_model || (node_type === 'MikroTik' ? 'MikroTik RouterOS v7' : 'GPON OLT')).trim(),
      String(host_ip).trim(),
      String(api_protocol || (node_type === 'MikroTik' ? 'RouterOS REST API' : 'OLT HTTP / SNMP API')).trim(),
      Number(api_port) || (node_type === 'MikroTik' ? 443 : 8080),
      String(api_base_url).trim(),
      String(api_username || 'api_noc').trim(),
      masked,
      Math.max(10, Number(poll_interval_sec) || 30),
      nowIso,
      'Node terdaftar, siap disinkronkan melalui API atau Push Agent'
    );

    const created = db.prepare('SELECT * FROM network_nodes WHERE id = ?').get(info.lastInsertRowid) as NetworkNode;
    logOperatorAction(
      req,
      'network',
      'Tambah Node Jaringan',
      `${created.node_code} · ${created.name}`,
      `Mendaftarkan node ${created.node_type} (${created.host_ip}) via ${created.api_protocol}`
    );
    res.status(201).json(created);
  } catch (err) {
    const msg = String(err);
    if (msg.includes('UNIQUE constraint failed')) {
      res.status(409).json({ error: 'Kode Node sudah terdaftar.' });
      return;
    }
    res.status(500).json({ error: 'Gagal menambahkan node MikroTik/OLT', details: msg });
  }
});

apiRouter.put('/network-nodes/:id', (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    const existing = db.prepare('SELECT * FROM network_nodes WHERE id = ?').get(id) as NetworkNode | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Node tidak ditemukan.' });
      return;
    }

    const {
      name,
      node_type,
      vendor_model,
      host_ip,
      api_protocol,
      api_port,
      api_base_url,
      api_username,
      api_secret,
      poll_interval_sec,
      status,
    } = req.body;

    const masked =
      typeof api_secret === 'string' && api_secret.trim()
        ? `****${api_secret.trim().slice(-4)}`
        : existing.api_token_masked;

    db.prepare(`
      UPDATE network_nodes
      SET name = ?, node_type = ?, vendor_model = ?, host_ip = ?, api_protocol = ?,
          api_port = ?, api_base_url = ?, api_username = ?, api_token_masked = ?,
          poll_interval_sec = ?, status = ?
      WHERE id = ?
    `).run(
      String(name ?? existing.name).trim(),
      node_type === 'MikroTik' || node_type === 'OLT' ? node_type : existing.node_type,
      String(vendor_model ?? existing.vendor_model).trim(),
      String(host_ip ?? existing.host_ip).trim(),
      String(api_protocol ?? existing.api_protocol).trim(),
      Number(api_port ?? existing.api_port),
      String(api_base_url ?? existing.api_base_url).trim(),
      String(api_username ?? existing.api_username).trim(),
      masked,
      Math.max(10, Number(poll_interval_sec ?? existing.poll_interval_sec)),
      (['Online', 'Degraded', 'Offline'].includes(String(status)) ? status : existing.status) as NetworkNodeStatus,
      id
    );

    const updated = db.prepare('SELECT * FROM network_nodes WHERE id = ?').get(id) as NetworkNode;
    logOperatorAction(
      req,
      'network',
      'Edit Konfigurasi Node',
      `${updated.node_code} · ${updated.name}`,
      `Memperbarui konfigurasi ${updated.node_type} (${updated.host_ip}), status ${updated.status}`
    );
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: 'Gagal memperbarui konfigurasi node', details: String(err) });
  }
});

apiRouter.delete('/network-nodes/:id', (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    const existing = db.prepare('SELECT node_code, name, node_type FROM network_nodes WHERE id = ?').get(id) as {
      node_code: string;
      name: string;
      node_type: string;
    } | undefined;
    db.prepare('UPDATE customers SET node_id = NULL WHERE node_id = ?').run(id);
    db.prepare('DELETE FROM network_nodes WHERE id = ?').run(id);
    if (existing) {
      logOperatorAction(
        req,
        'network',
        'Hapus Node Jaringan',
        `${existing.node_code} · ${existing.name}`,
        `Menghapus node ${existing.node_type} dari daftar infrastruktur`
      );
    }
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: 'Gagal menghapus node', details: String(err) });
  }
});

apiRouter.post('/network-nodes/:id/sync', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    const node = db.prepare('SELECT * FROM network_nodes WHERE id = ?').get(id) as NetworkNode | undefined;
    if (!node) {
      res.status(404).json({ error: 'Node MikroTik/OLT tidak ditemukan.' });
      return;
    }

    const nowIso = new Date().toISOString();
    const targetUrl = node.node_type === 'MikroTik'
      ? `${node.api_base_url.replace(/\/$/, '')}/system/resource`
      : `${node.api_base_url.replace(/\/$/, '')}/status`;

    // Attempt live HTTP API poll to the configured MikroTik/OLT REST endpoint
    try {
      const response = await fetch(targetUrl, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(2500),
      });

      if (response.ok) {
        const body = await response.json() as Record<string, unknown>;
        const cpu = Number(body['cpu-load'] ?? body.cpu_load_pct ?? node.cpu_load_pct);
        const totalMem = Number(body['total-memory'] ?? 0);
        const freeMem = Number(body['free-memory'] ?? 0);
        const memPct = totalMem > 0 ? Math.round(((totalMem - freeMem) / totalMem) * 100) : Number(body.memory_used_pct ?? node.memory_used_pct);
        const uptimeText = String(body.uptime ?? body.uptime_text ?? node.uptime_text);

        db.prepare(`
          UPDATE network_nodes
          SET status = 'Online', cpu_load_pct = ?, memory_used_pct = ?, uptime_text = ?,
              last_sync_at = ?, last_sync_message = ?
          WHERE id = ?
        `).run(cpu, memPct, uptimeText, nowIso, `Live HTTP API poll berhasil dari ${targetUrl}`, id);

        const updated = db.prepare('SELECT * FROM network_nodes WHERE id = ?').get(id);
        logOperatorAction(
          req,
          'network',
          'Sinkronisasi Node API',
          `${node.node_code} (${node.host_ip})`,
          `Live HTTP poll berhasil dari ${targetUrl} (CPU ${cpu}%, RAM ${memPct}%)`
        );
        res.json({ mode: 'live_http', reachable: true, node: updated });
        return;
      }

      const msg = `Endpoint ${targetUrl} merespons HTTP ${response.status}.`;
      db.prepare('UPDATE network_nodes SET last_sync_at = ?, last_sync_message = ? WHERE id = ?').run(nowIso, msg, id);
      const updated = db.prepare('SELECT * FROM network_nodes WHERE id = ?').get(id);
      logOperatorAction(
        req,
        'network',
        'Sinkronisasi Node API',
        `${node.node_code} (${node.host_ip})`,
        msg
      );
      res.json({ mode: 'live_http', reachable: false, message: msg, node: updated });
    } catch {
      // Private LAN IP (10.x / 192.168.x) or offline host cannot be polled directly from cloud container;
      // inform operator clearly to use the Push Telemetry Agent (/api/webhook/mikrotik-olt).
      const connectedCustomers = db.prepare(`
        SELECT COUNT(*) as total,
               SUM(CASE WHEN device_status = 'Online' THEN 1 ELSE 0 END) as online_cnt,
               SUM(CASE WHEN device_status = 'Offline' THEN 1 ELSE 0 END) as offline_cnt
        FROM customers WHERE node_id = ?
      `).get(id) as { total: number; online_cnt: number | null; offline_cnt: number | null };

      const offlineCnt = connectedCustomers.offline_cnt ?? 0;
      const derivedStatus: NetworkNodeStatus = offlineCnt > 0 ? 'Degraded' : 'Online';
      const msg = `IP ${node.host_ip} berada di jaringan lokal/privat; gunakan Push Agent (/api/webhook/mikrotik-olt) atau VPN tunnel untuk polling langsung.`;

      db.prepare(`
        UPDATE network_nodes
        SET status = ?, active_sessions = ?, last_sync_at = ?, last_sync_message = ?
        WHERE id = ?
      `).run(derivedStatus, connectedCustomers.online_cnt ?? node.active_sessions, nowIso, msg, id);

      const updated = db.prepare('SELECT * FROM network_nodes WHERE id = ?').get(id);
      logOperatorAction(
        req,
        'network',
        'Sinkronisasi Node API',
        `${node.node_code} (${node.host_ip})`,
        `Sinkronisasi status lokal: ${derivedStatus} (${connectedCustomers.online_cnt ?? 0} ONT Online, ${offlineCnt} Offline)`
      );
      res.json({ mode: 'local_summary', reachable: false, message: msg, node: updated });
    }
  } catch (err) {
    res.status(500).json({ error: 'Gagal melakukan sinkronisasi API node', details: String(err) });
  }
});

apiRouter.post('/webhook/mikrotik-olt', (req: Request, res: Response) => {
  const receivedAt = new Date().toISOString();
  const sourceIp = req.ip || req.socket.remoteAddress || 'unknown';
  const body = req.body ?? {};

  const nodeCode = typeof body.node_code === 'string' ? body.node_code.trim() : '';
  const hostIp = typeof body.host_ip === 'string' ? body.host_ip.trim() : '';

  if (!nodeCode && !hostIp) {
    const msg = 'Payload tidak valid: wajib menyertakan node_code atau host_ip.';
    db.prepare(`
      INSERT INTO webhook_events (
        received_at, source_ip, endpoint, device_id, device_ip, reported_status, http_status, processed, message, payload_json
      ) VALUES (?, ?, '/api/webhook/mikrotik-olt', NULL, NULL, NULL, 400, 0, ?, ?)
    `).run(receivedAt, sourceIp, msg, JSON.stringify(body));
    res.status(400).json({ error: msg });
    return;
  }

  const node = db.prepare(`
    SELECT * FROM network_nodes
    WHERE (node_code = ? AND ? != '') OR (host_ip = ? AND ? != '')
    LIMIT 1
  `).get(nodeCode, nodeCode, hostIp, hostIp) as NetworkNode | undefined;

  if (!node) {
    const msg = `Node MikroTik/OLT (${nodeCode || hostIp}) belum terdaftar.`;
    db.prepare(`
      INSERT INTO webhook_events (
        received_at, source_ip, endpoint, device_id, device_ip, reported_status, http_status, processed, message, payload_json
      ) VALUES (?, ?, '/api/webhook/mikrotik-olt', ?, ?, NULL, 404, 0, ?, ?)
    `).run(receivedAt, sourceIp, nodeCode || null, hostIp || null, msg, JSON.stringify(body));
    res.status(404).json({ error: msg });
    return;
  }

  const nextStatus: NetworkNodeStatus = ['Online', 'Degraded', 'Offline'].includes(String(body.status))
    ? (body.status as NetworkNodeStatus)
    : 'Online';

  const cpu = body.cpu_load_pct !== undefined ? Number(body.cpu_load_pct) : node.cpu_load_pct;
  const mem = body.memory_used_pct !== undefined ? Number(body.memory_used_pct) : node.memory_used_pct;
  const temp = body.temperature_c !== undefined ? Number(body.temperature_c) : node.temperature_c;
  const rxMbps = body.rx_throughput_mbps !== undefined ? Number(body.rx_throughput_mbps) : node.rx_throughput_mbps;
  const txMbps = body.tx_throughput_mbps !== undefined ? Number(body.tx_throughput_mbps) : node.tx_throughput_mbps;
  const activeSessions = body.active_sessions !== undefined ? Number(body.active_sessions) : node.active_sessions;
  const uptimeText = typeof body.uptime_text === 'string' && body.uptime_text.trim() ? body.uptime_text.trim() : node.uptime_text;

  const onuList: Array<Record<string, unknown>> = Array.isArray(body.devices)
    ? body.devices
    : Array.isArray(body.onus)
      ? body.onus
      : [];

  let updatedDevicesCount = 0;

  const tx = db.transaction(() => {
    const syncMessage = `Telemetry Push ${node.node_type} diterima (CPU ${cpu}%, Rx ${rxMbps} Mbps, Sesi/ONT ${activeSessions}${onuList.length > 0 ? `, ${onuList.length} perangkat disinkronkan` : ''})`;

    db.prepare(`
      UPDATE network_nodes
      SET status = ?, cpu_load_pct = ?, memory_used_pct = ?, temperature_c = ?,
          rx_throughput_mbps = ?, tx_throughput_mbps = ?, active_sessions = ?,
          uptime_text = ?, last_sync_at = ?, last_sync_message = ?
      WHERE id = ?
    `).run(nextStatus, cpu, mem, temp, rxMbps, txMbps, activeSessions, uptimeText, receivedAt, syncMessage, node.id);

    const findCust = db.prepare(`
      SELECT id, device_id, device_status FROM customers
      WHERE (device_id = ? AND ? != '') OR (device_ip = ? AND ? != '')
      LIMIT 1
    `);

    const updateCust = db.prepare(`
      UPDATE customers
      SET device_status = ?,
          last_seen_at = ?,
          node_id = COALESCE(?, node_id),
          pon_port = COALESCE(?, pon_port),
          rx_power_dbm = COALESCE(?, rx_power_dbm),
          latency_ms = COALESCE(?, latency_ms),
          uptime_session = COALESCE(?, uptime_session)
      WHERE id = ?
    `);

    const insertLog = db.prepare(`
      INSERT INTO device_logs (
        customer_id, device_id, previous_status, new_status, event_source, reason, latency_ms, logged_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const item of onuList) {
      const dId = typeof item.device_id === 'string' ? item.device_id.trim() : '';
      const dIp = typeof item.device_ip === 'string' ? item.device_ip.trim() : '';
      const st = normalizeDeviceStatus(item.status);
      if ((!dId && !dIp) || !st) continue;

      const cust = findCust.get(dId, dId, dIp, dIp) as {
        id: number;
        device_id: string;
        device_status: DeviceStatus;
      } | undefined;
      if (!cust) continue;

      const rxDbm = item.rx_power_dbm !== undefined && item.rx_power_dbm !== null ? Number(item.rx_power_dbm) : null;
      const latMs = item.latency_ms !== undefined && item.latency_ms !== null ? Number(item.latency_ms) : null;
      const ponPort = typeof item.pon_port === 'string' ? item.pon_port : null;
      const upSess = typeof item.uptime_session === 'string' ? item.uptime_session : null;

      updateCust.run(st, receivedAt, node.id, ponPort, rxDbm, latMs, upSess, cust.id);
      updatedDevicesCount += 1;

      if (cust.device_status !== st || (rxDbm !== null && rxDbm <= -28 && st === 'Offline')) {
        const logReason = rxDbm !== null && rxDbm <= -28
          ? `Redaman optik lemah (${rxDbm} dBm) terdeteksi via ${node.node_code}`
          : `Sinkronisasi API ${node.node_type} (${node.node_code})`;
        insertLog.run(cust.id, cust.device_id, cust.device_status, st, `API ${node.node_type}`, logReason, latMs, receivedAt);
      }
    }

    db.prepare(`
      INSERT INTO webhook_events (
        received_at, source_ip, endpoint, device_id, device_ip, reported_status, http_status, processed, message, payload_json
      ) VALUES (?, ?, '/api/webhook/mikrotik-olt', ?, ?, ?, 200, 1, ?, ?)
    `).run(receivedAt, sourceIp, node.node_code, node.host_ip, nextStatus, syncMessage, JSON.stringify(body));
  });

  try {
    tx();
    const updatedNode = db.prepare('SELECT * FROM network_nodes WHERE id = ?').get(node.id);
    res.json({
      ok: true,
      received_at: receivedAt,
      node: updatedNode,
      updated_devices_count: updatedDevicesCount,
    });
  } catch (err) {
    res.status(500).json({ error: 'Gagal memproses telemetry MikroTik/OLT', details: String(err) });
  }
});

apiRouter.post('/devices/:id/status', (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    const newStatus = normalizeDeviceStatus(req.body.status);
    const reason = String(req.body.reason || 'Perubahan status manual oleh operator NOC').trim();

    if (!newStatus) {
      res.status(400).json({ error: 'Status perangkat harus Online, Offline, atau Isolir.' });
      return;
    }

    const cust = db.prepare('SELECT id, name, device_id, device_status FROM customers WHERE id = ?').get(id) as {
      id: number;
      name: string;
      device_id: string;
      device_status: DeviceStatus;
    } | undefined;

    if (!cust) {
      res.status(404).json({ error: 'Perangkat / pelanggan tidak ditemukan.' });
      return;
    }

    const nowIso = new Date().toISOString();
    db.prepare('UPDATE customers SET device_status = ?, last_seen_at = ? WHERE id = ?').run(newStatus, nowIso, id);

    db.prepare(`
      INSERT INTO device_logs (
        customer_id, device_id, previous_status, new_status, event_source, reason, latency_ms, logged_at
      ) VALUES (?, ?, ?, ?, 'Manual Operator', ?, ?, ?)
    `).run(id, cust.device_id, cust.device_status, newStatus, reason, newStatus === 'Online' ? 7 : null, nowIso);

    const actionLabel =
      newStatus === 'Isolir'
        ? 'Isolir Perangkat'
        : cust.device_status === 'Isolir' && newStatus === 'Online'
          ? 'Buka Isolir Perangkat'
          : newStatus === 'Online'
            ? 'Pulihkan Perangkat Online'
            : 'Tandai Perangkat Offline';

    logOperatorAction(
      req,
      'network',
      actionLabel,
      `${cust.device_id} (${cust.name})`,
      `Status diubah ${cust.device_status} → ${newStatus}. Alasan: ${reason}`
    );

    res.json({ updated: true, previous_status: cust.device_status, new_status: newStatus });
  } catch (err) {
    res.status(500).json({ error: 'Gagal mengubah status perangkat', details: String(err) });
  }
});

apiRouter.post('/webhook/device-status', (req: Request, res: Response) => {
  const receivedAt = new Date().toISOString();
  const sourceIp = req.ip || req.socket.remoteAddress || 'unknown';
  const rawBody = req.body;

  const items: Array<Record<string, unknown>> = Array.isArray(rawBody?.events)
    ? rawBody.events
    : Array.isArray(rawBody)
      ? rawBody
      : [rawBody ?? {}];

  const results: Array<{ device_id: string | null; status: string | null; ok: boolean; message: string }> = [];

  const findByIdOrIp = db.prepare(`
    SELECT id, name, device_id, device_ip, device_status
    FROM customers
    WHERE (device_id = ? AND ? != '') OR (device_ip = ? AND ? != '')
    LIMIT 1
  `);

  const updateCustomerStatus = db.prepare(`
    UPDATE customers SET device_status = ?, last_seen_at = ? WHERE id = ?
  `);

  const insertDeviceLog = db.prepare(`
    INSERT INTO device_logs (
      customer_id, device_id, previous_status, new_status, event_source, reason, latency_ms, logged_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertWebhookEvent = db.prepare(`
    INSERT INTO webhook_events (
      received_at, source_ip, endpoint, device_id, device_ip, reported_status, http_status, processed, message, payload_json
    ) VALUES (?, ?, '/api/webhook/device-status', ?, ?, ?, ?, ?, ?, ?)
  `);

  const processBatch = db.transaction(() => {
    for (const item of items) {
      const devId = typeof item.device_id === 'string' ? item.device_id.trim() : '';
      const devIp = typeof item.device_ip === 'string' ? item.device_ip.trim() : '';
      const normalizedStatus = normalizeDeviceStatus(item.status);
      const reason = typeof item.reason === 'string' && item.reason.trim()
        ? item.reason.trim()
        : normalizedStatus === 'Offline'
          ? 'Disconnect terdeteksi otomatis via Webhook'
          : normalizedStatus === 'Isolir'
            ? 'Status isolir diterima via Webhook'
            : 'Perangkat terhubung kembali (Webhook)';
      const latency = item.latency_ms !== undefined && item.latency_ms !== null && item.latency_ms !== ''
        ? Number(item.latency_ms)
        : null;
      const sourceLabel = typeof item.source === 'string' && item.source.trim()
        ? `Webhook (${item.source.trim()})`
        : 'Webhook API';

      if ((!devId && !devIp) || !normalizedStatus) {
        const msg = 'Payload tidak valid: wajib menyertakan device_id atau device_ip serta status (Online/Offline/Isolir).';
        insertWebhookEvent.run(
          receivedAt,
          sourceIp,
          devId || null,
          devIp || null,
          typeof item.status === 'string' ? item.status : null,
          400,
          0,
          msg,
          JSON.stringify(item)
        );
        results.push({ device_id: devId || devIp || null, status: null, ok: false, message: msg });
        continue;
      }

      const cust = findByIdOrIp.get(devId, devId, devIp, devIp) as {
        id: number;
        name: string;
        device_id: string;
        device_ip: string;
        device_status: DeviceStatus;
      } | undefined;

      if (!cust) {
        const msg = `Perangkat (${devId || devIp}) tidak terdaftar di database pelanggan.`;
        insertWebhookEvent.run(
          receivedAt,
          sourceIp,
          devId || null,
          devIp || null,
          normalizedStatus,
          404,
          0,
          msg,
          JSON.stringify(item)
        );
        results.push({ device_id: devId || devIp, status: normalizedStatus, ok: false, message: msg });
        continue;
      }

      updateCustomerStatus.run(normalizedStatus, receivedAt, cust.id);

      if (cust.device_status !== normalizedStatus || normalizedStatus === 'Offline') {
        insertDeviceLog.run(
          cust.id,
          cust.device_id,
          cust.device_status,
          normalizedStatus,
          sourceLabel,
          reason,
          Number.isFinite(latency) ? latency : null,
          receivedAt
        );
      }

      const msg = `Status ${cust.device_id} (${cust.name}) diperbarui: ${cust.device_status} -> ${normalizedStatus}`;
      insertWebhookEvent.run(
        receivedAt,
        sourceIp,
        cust.device_id,
        cust.device_ip,
        normalizedStatus,
        200,
        1,
        msg,
        JSON.stringify(item)
      );
      results.push({ device_id: cust.device_id, status: normalizedStatus, ok: true, message: msg });
    }
  });

  try {
    processBatch();
    const allFailed = results.length > 0 && results.every((r) => !r.ok);
    res.status(allFailed ? 400 : 200).json({
      received_at: receivedAt,
      processed_count: results.filter((r) => r.ok).length,
      failed_count: results.filter((r) => !r.ok).length,
      results,
    });
  } catch (err) {
    res.status(500).json({ error: 'Gagal memproses webhook perangkat', details: String(err) });
  }
});

// ---------------------------------------------------------------------------
// 6. LAPORAN KEUANGAN
// ---------------------------------------------------------------------------
apiRouter.get('/reports', (req: Request, res: Response) => {
  try {
    const period = typeof req.query.period === 'string' && /^\d{4}-\d{2}$/.test(req.query.period)
      ? req.query.period
      : '2026-11';

    const paid_invoices = db.prepare(`
      SELECT
        i.*,
        c.customer_code,
        c.name AS customer_name,
        c.whatsapp AS customer_whatsapp,
        c.address AS customer_address,
        c.device_id,
        c.device_status,
        p.name AS package_name
      FROM invoices i
      JOIN customers c ON c.id = i.customer_id
      JOIN packages p ON p.id = c.package_id
      WHERE i.billing_period = ? AND i.status = 'Lunas'
      ORDER BY i.paid_at DESC, c.customer_code ASC
    `).all(period) as Invoice[];

    const unpaid_invoices = db.prepare(`
      SELECT
        i.*,
        c.customer_code,
        c.name AS customer_name,
        c.whatsapp AS customer_whatsapp,
        c.address AS customer_address,
        c.device_id,
        c.device_status,
        p.name AS package_name
      FROM invoices i
      JOIN customers c ON c.id = i.customer_id
      JOIN packages p ON p.id = c.package_id
      WHERE i.status = 'Belum Lunas'
      ORDER BY i.billing_period ASC, i.due_date ASC, c.customer_code ASC
    `).all() as Invoice[];

    const periodUnpaid = unpaid_invoices.filter((i) => i.billing_period === period);
    const totalPaid = paid_invoices.reduce((acc, i) => acc + i.amount, 0);
    const totalUnpaidPeriod = periodUnpaid.reduce((acc, i) => acc + i.amount, 0);
    const totalUnpaidAllTime = unpaid_invoices.reduce((acc, i) => acc + i.amount, 0);
    const totalBilled = totalPaid + totalUnpaidPeriod;

    const by_payment_method = db.prepare(`
      SELECT
        COALESCE(payment_method, 'Lainnya') AS payment_method,
        COUNT(*) AS count,
        COALESCE(SUM(amount), 0) AS total_amount
      FROM invoices
      WHERE billing_period = ? AND status = 'Lunas'
      GROUP BY COALESCE(payment_method, 'Lainnya')
      ORDER BY total_amount DESC
    `).all(period) as Array<{ payment_method: string; count: number; total_amount: number }>;

    const by_package = db.prepare(`
      SELECT
        p.name AS package_name,
        SUM(CASE WHEN i.status = 'Lunas' THEN 1 ELSE 0 END) AS paid_count,
        COALESCE(SUM(CASE WHEN i.status = 'Lunas' THEN i.amount ELSE 0 END), 0) AS paid_amount,
        SUM(CASE WHEN i.status = 'Belum Lunas' THEN 1 ELSE 0 END) AS unpaid_count,
        COALESCE(SUM(CASE WHEN i.status = 'Belum Lunas' THEN i.amount ELSE 0 END), 0) AS unpaid_amount
      FROM invoices i
      JOIN customers c ON c.id = i.customer_id
      JOIN packages p ON p.id = c.package_id
      WHERE i.billing_period = ?
      GROUP BY p.id
      ORDER BY p.monthly_price ASC
    `).all(period) as Array<{
      package_name: string;
      paid_count: number;
      paid_amount: number;
      unpaid_count: number;
      unpaid_amount: number;
    }>;

    res.json({
      period,
      summary: {
        total_billed: totalBilled,
        total_paid: totalPaid,
        total_unpaid_period: totalUnpaidPeriod,
        total_unpaid_all_time: totalUnpaidAllTime,
        paid_count: paid_invoices.length,
        unpaid_period_count: periodUnpaid.length,
        unpaid_all_time_count: unpaid_invoices.length,
        collection_rate_pct: totalBilled > 0 ? Math.round((totalPaid / totalBilled) * 100) : 0,
      },
      by_payment_method,
      by_package,
      paid_invoices,
      unpaid_invoices,
    });
  } catch (err) {
    res.status(500).json({ error: 'Gagal memuat laporan keuangan', details: String(err) });
  }
});

// ---------------------------------------------------------------------------
// 7. INSPEKSI STRUKTUR DATABASE (SCHEMA VIEW)
// ---------------------------------------------------------------------------
apiRouter.get('/schema', (_req: Request, res: Response) => {
  try {
    const tables = db.prepare(`
      SELECT name, sql FROM sqlite_master
      WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
      ORDER BY name ASC
    `).all() as Array<{ name: string; sql: string }>;

    const result: TableSchemaInfo[] = tables.map((t) => {
      const columns = db.prepare(`PRAGMA table_info(${t.name})`).all() as TableSchemaInfo['columns'];
      const countRow = db.prepare(`SELECT COUNT(*) as cnt FROM ${t.name}`).get() as { cnt: number };
      return {
        name: t.name,
        row_count: countRow.cnt,
        sql: t.sql,
        columns,
      };
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Gagal membaca struktur database', details: String(err) });
  }
});

// ---------------------------------------------------------------------------
// 8. CHAT WHATSAPP PELANGGAN & WA GATEWAY API
// ---------------------------------------------------------------------------
apiRouter.get('/whatsapp/conversations', (_req: Request, res: Response) => {
  try {
    const rows = db.prepare(`
      SELECT
        c.id AS customer_id,
        c.customer_code,
        c.name,
        c.whatsapp,
        c.address,
        p.name AS package_name,
        COALESCE(c.custom_price, p.monthly_price) AS effective_price,
        c.device_id,
        c.device_status,
        COALESCE((SELECT COUNT(*) FROM invoices i WHERE i.customer_id = c.id AND i.status = 'Belum Lunas'), 0) AS unpaid_count,
        COALESCE((SELECT SUM(i.amount) FROM invoices i WHERE i.customer_id = c.id AND i.status = 'Belum Lunas'), 0) AS unpaid_total,
        (SELECT i.invoice_number FROM invoices i WHERE i.customer_id = c.id ORDER BY CASE WHEN i.status = 'Belum Lunas' THEN 0 ELSE 1 END ASC, i.billing_period DESC, i.id DESC LIMIT 1) AS latest_invoice_number,
        (SELECT i.billing_period FROM invoices i WHERE i.customer_id = c.id ORDER BY CASE WHEN i.status = 'Belum Lunas' THEN 0 ELSE 1 END ASC, i.billing_period DESC, i.id DESC LIMIT 1) AS latest_billing_period,
        (SELECT i.due_date FROM invoices i WHERE i.customer_id = c.id ORDER BY CASE WHEN i.status = 'Belum Lunas' THEN 0 ELSE 1 END ASC, i.billing_period DESC, i.id DESC LIMIT 1) AS latest_due_date,
        (SELECT i.amount FROM invoices i WHERE i.customer_id = c.id ORDER BY CASE WHEN i.status = 'Belum Lunas' THEN 0 ELSE 1 END ASC, i.billing_period DESC, i.id DESC LIMIT 1) AS latest_invoice_amount,
        (SELECT m.message FROM whatsapp_messages m WHERE m.customer_id = c.id ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS last_message,
        (SELECT m.direction FROM whatsapp_messages m WHERE m.customer_id = c.id ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS last_direction,
        (SELECT m.created_at FROM whatsapp_messages m WHERE m.customer_id = c.id ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS last_message_at,
        COALESCE((SELECT COUNT(*) FROM whatsapp_messages m WHERE m.customer_id = c.id), 0) AS message_count
      FROM customers c
      JOIN packages p ON p.id = c.package_id
      ORDER BY
        CASE WHEN last_message_at IS NULL THEN 1 ELSE 0 END ASC,
        last_message_at DESC,
        c.customer_code ASC
    `).all();
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Gagal memuat daftar percakapan WhatsApp', details: String(err) });
  }
});

apiRouter.get('/whatsapp/messages/:customerId', (req: Request, res: Response) => {
  try {
    const customerId = Number(req.params.customerId);
    const rows = db.prepare(`
      SELECT * FROM whatsapp_messages
      WHERE customer_id = ?
      ORDER BY created_at ASC, id ASC
    `).all(customerId);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Gagal memuat riwayat pesan WhatsApp', details: String(err) });
  }
});

apiRouter.post('/whatsapp/send', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const customerId = Number(req.body.customer_id);
    const message = typeof req.body.message === 'string' ? req.body.message.trim() : '';
    const templateKey = typeof req.body.template_key === 'string' ? req.body.template_key.trim() : '';
    const templateTypeRaw = typeof req.body.template_type === 'string' ? req.body.template_type.trim() : '';
    const invoiceNumber = typeof req.body.invoice_number === 'string' ? req.body.invoice_number.trim() : '';
    const billingPeriod = typeof req.body.billing_period === 'string' ? req.body.billing_period.trim() : '';
    const via = req.body.via === 'gateway' ? 'gateway' : 'web';
    const skipAuditLog = req.body.from_wa_reminder_modal === true;

    if (!customerId || !message) {
      res.status(400).json({ error: 'Pelanggan dan isi pesan WhatsApp wajib diisi.' });
      return;
    }

    if (
      req.authUser?.role === 'Teknisi' &&
      (templateKey === 'reminder_pre_due' || templateKey === 'due_overdue')
    ) {
      const reason = 'Akses ditolak: peran Teknisi tidak diizinkan mengirim template pengingat tagihan (khusus Bagian Keuangan / Admin).';
      logOperatorAction(
        req,
        'auth',
        'Akses Ditolak (403)',
        'POST /api/whatsapp/send',
        reason
      );
      res.status(403).json({ error: reason });
      return;
    }

    const cust = db.prepare('SELECT id, name, whatsapp FROM customers WHERE id = ?').get(customerId) as {
      id: number;
      name: string;
      whatsapp: string;
    } | undefined;

    if (!cust) {
      res.status(404).json({ error: 'Pelanggan tidak ditemukan.' });
      return;
    }

    const tplRow = templateKey
      ? (db.prepare('SELECT title, template_key FROM whatsapp_templates WHERE template_key = ?').get(templateKey) as {
          title: string;
          template_key: WhatsAppTemplateKey;
        } | undefined)
      : undefined;
    const resolvedTemplateType = tplRow?.title || templateTypeRaw || null;

    const nowIso = new Date().toISOString();
    let deliveryChannel = 'WhatsApp Web';
    let deliveryStatus = 'Terkirim';

    if (via === 'gateway') {
      const gw = db.prepare('SELECT * FROM whatsapp_gateway_config WHERE id = 1').get() as {
        provider_name: string;
        api_url: string;
        api_token_raw: string;
        is_active: number;
      } | undefined;

      deliveryChannel = 'WA Gateway API';

      if (!gw || gw.is_active !== 1 || !gw.api_url.trim()) {
        deliveryStatus = 'Tercatat (Gateway belum diaktifkan)';
      } else {
        try {
          const gwRes = await fetch(gw.api_url.trim(), {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(gw.api_token_raw ? { Authorization: gw.api_token_raw } : {}),
            },
            body: JSON.stringify({
              target: cust.whatsapp,
              phone: cust.whatsapp,
              message,
            }),
            signal: AbortSignal.timeout(4000),
          });
          deliveryStatus = gwRes.ok ? 'Terkirim via Gateway' : `Respons Gateway HTTP ${gwRes.status}`;
        } catch {
          deliveryStatus = 'Gagal terhubung ke URL Gateway';
        }
      }
    }

    const info = db.prepare(`
      INSERT INTO whatsapp_messages (
        customer_id, direction, message, template_type, delivery_channel, delivery_status, created_at
      ) VALUES (?, 'outbound', ?, ?, ?, ?, ?)
    `).run(cust.id, message, resolvedTemplateType, deliveryChannel, deliveryStatus, nowIso);

    if (!skipAuditLog) {
      const tplLower = `${templateKey} ${resolvedTemplateType ?? ''}`.toLowerCase();
      const logCat: ActivityLogCategory =
        templateKey === 'isolation_notice' ||
        tplLower.includes('isolir') ||
        tplLower.includes('gangguan') ||
        tplLower.includes('teknisi')
          ? 'network'
          : templateKey === 'reminder_pre_due' ||
              templateKey === 'due_overdue' ||
              tplLower.includes('tagihan') ||
              tplLower.includes('tempo') ||
              tplLower.includes('lunas')
            ? 'billing'
            : 'customer';

      const targetText = invoiceNumber
        ? `${cust.name} · ${invoiceNumber}`
        : `${cust.name} (${cust.whatsapp})`;
      const periodText = billingPeriod ? ` · Periode ${formatMonthLabel(billingPeriod)}` : '';
      const tplDesc = resolvedTemplateType
        ? `Template: ${resolvedTemplateType}${templateKey ? ` (${templateKey})` : ''}`
        : 'Pesan WA Kustom';

      logOperatorAction(
        req,
        logCat,
        resolvedTemplateType ? `Kirim WA (${resolvedTemplateType})` : 'Kirim Pesan WA',
        targetText,
        `${tplDesc}${periodText} · Via ${deliveryChannel} (${deliveryStatus})`
      );
    }

    const created = db.prepare('SELECT * FROM whatsapp_messages WHERE id = ?').get(info.lastInsertRowid);
    res.status(201).json(created);
  } catch (err) {
    res.status(500).json({ error: 'Gagal mengirim/mencatat pesan WhatsApp', details: String(err) });
  }
});

apiRouter.post('/webhook/whatsapp-inbound', (req: Request, res: Response) => {
  const receivedAt = new Date().toISOString();
  const sourceIp = req.ip || req.socket.remoteAddress || 'unknown';
  const body = req.body ?? {};

  const rawPhone = String(body.whatsapp ?? body.sender ?? body.phone ?? body.from ?? '').trim();
  const text = String(body.message ?? body.text ?? body.body ?? '').trim();

  if (!rawPhone || !text) {
    const msg = 'Payload tidak valid: wajib menyertakan nomor WhatsApp (whatsapp/sender) dan message.';
    db.prepare(`
      INSERT INTO webhook_events (
        received_at, source_ip, endpoint, device_id, device_ip, reported_status, http_status, processed, message, payload_json
      ) VALUES (?, ?, '/api/webhook/whatsapp-inbound', ?, NULL, 'Inbound', 400, 0, ?, ?)
    `).run(receivedAt, sourceIp, rawPhone || null, msg, JSON.stringify(body));
    res.status(400).json({ error: msg });
    return;
  }

  const normalized = normalizeWhatsapp(rawPhone);
  const cust = db.prepare('SELECT id, name, whatsapp FROM customers WHERE whatsapp = ? LIMIT 1').get(normalized) as {
    id: number;
    name: string;
    whatsapp: string;
  } | undefined;

  if (!cust) {
    const msg = `Nomor WhatsApp ${normalized} tidak cocok dengan data pelanggan terdaftar.`;
    db.prepare(`
      INSERT INTO webhook_events (
        received_at, source_ip, endpoint, device_id, device_ip, reported_status, http_status, processed, message, payload_json
      ) VALUES (?, ?, '/api/webhook/whatsapp-inbound', ?, NULL, 'Inbound', 404, 0, ?, ?)
    `).run(receivedAt, sourceIp, normalized, msg, JSON.stringify(body));
    res.status(404).json({ error: msg });
    return;
  }

  const info = db.prepare(`
    INSERT INTO whatsapp_messages (
      customer_id, direction, message, template_type, delivery_channel, delivery_status, created_at
    ) VALUES (?, 'inbound', ?, NULL, 'Webhook Masuk', 'Diterima', ?)
  `).run(cust.id, text, receivedAt);

  db.prepare(`
    INSERT INTO webhook_events (
      received_at, source_ip, endpoint, device_id, device_ip, reported_status, http_status, processed, message, payload_json
    ) VALUES (?, ?, '/api/webhook/whatsapp-inbound', ?, NULL, 'Inbound', 200, 1, ?, ?)
  `).run(receivedAt, sourceIp, cust.whatsapp, `Pesan WhatsApp masuk dari ${cust.name} (${cust.whatsapp})`, JSON.stringify(body));

  const created = db.prepare('SELECT * FROM whatsapp_messages WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json({ ok: true, customer_id: cust.id, customer_name: cust.name, message: created });
});

apiRouter.get('/whatsapp/gateway', (_req: Request, res: Response) => {
  try {
    const row = db.prepare(`
      SELECT id, provider_name, api_url, api_token_masked, sender_number, is_active, updated_at
      FROM whatsapp_gateway_config WHERE id = 1
    `).get();
    res.json(row ?? {
      id: 1,
      provider_name: 'WA Gateway (Fonnte / Wablas / WAHA)',
      api_url: '',
      api_token_masked: '',
      sender_number: '6281200004000',
      is_active: 0,
      updated_at: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: 'Gagal memuat konfigurasi WA Gateway', details: String(err) });
  }
});

apiRouter.put('/whatsapp/gateway', (req: Request, res: Response) => {
  try {
    const { provider_name, api_url, api_token, sender_number, is_active } = req.body;
    const existing = db.prepare('SELECT * FROM whatsapp_gateway_config WHERE id = 1').get() as {
      api_token_masked: string;
      api_token_raw: string;
    } | undefined;

    const rawToken = typeof api_token === 'string' && api_token.trim() ? api_token.trim() : (existing?.api_token_raw ?? '');
    const maskedToken = typeof api_token === 'string' && api_token.trim()
      ? `****${api_token.trim().slice(-4)}`
      : (existing?.api_token_masked ?? '');
    const nowIso = new Date().toISOString();

    db.prepare(`
      INSERT INTO whatsapp_gateway_config (
        id, provider_name, api_url, api_token_masked, api_token_raw, sender_number, is_active, updated_at
      ) VALUES (1, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        provider_name = excluded.provider_name,
        api_url = excluded.api_url,
        api_token_masked = excluded.api_token_masked,
        api_token_raw = excluded.api_token_raw,
        sender_number = excluded.sender_number,
        is_active = excluded.is_active,
        updated_at = excluded.updated_at
    `).run(
      String(provider_name || 'WA Gateway').trim(),
      String(api_url || '').trim(),
      maskedToken,
      rawToken,
      normalizeWhatsapp(String(sender_number || '6281200004000')),
      is_active ? 1 : 0,
      nowIso
    );

    const updated = db.prepare(`
      SELECT id, provider_name, api_url, api_token_masked, sender_number, is_active, updated_at
      FROM whatsapp_gateway_config WHERE id = 1
    `).get();
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: 'Gagal menyimpan konfigurasi WA Gateway', details: String(err) });
  }
});

// ---------------------------------------------------------------------------
// 8B. STANDARISASI TEMPLATE PESAN WHATSAPP
// ---------------------------------------------------------------------------
const VALID_WA_TEMPLATE_KEYS: WhatsAppTemplateKey[] = [
  'reminder_pre_due',
  'due_overdue',
  'isolation_notice',
];

apiRouter.get('/whatsapp/templates', (_req: Request, res: Response) => {
  try {
    const rows = db.prepare(`
      SELECT * FROM whatsapp_templates
      ORDER BY CASE template_key
        WHEN 'reminder_pre_due' THEN 1
        WHEN 'due_overdue' THEN 2
        WHEN 'isolation_notice' THEN 3
        ELSE 4
      END ASC
    `).all() as WhatsAppTemplate[];
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Gagal memuat daftar template pesan WhatsApp', details: String(err) });
  }
});

apiRouter.put('/whatsapp/templates/:key', (req: AuthenticatedRequest, res: Response) => {
  try {
    const key = String(req.params.key || '').trim() as WhatsAppTemplateKey;
    if (!VALID_WA_TEMPLATE_KEYS.includes(key)) {
      res.status(404).json({ error: 'Kategori template pesan WhatsApp tidak ditemukan.' });
      return;
    }

    const existing = db.prepare('SELECT * FROM whatsapp_templates WHERE template_key = ?').get(key) as
      | WhatsAppTemplate
      | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Template pesan belum terdaftar di database.' });
      return;
    }

    const title = typeof req.body?.title === 'string' && req.body.title.trim()
      ? req.body.title.trim()
      : existing.title;
    const bodyTemplate = typeof req.body?.body_template === 'string'
      ? req.body.body_template.trim()
      : '';

    if (!bodyTemplate) {
      res.status(400).json({ error: 'Isi template pesan WhatsApp tidak boleh kosong.' });
      return;
    }

    const nowIso = new Date().toISOString();
    const updatedBy = req.authUser?.username ?? 'admin';

    db.prepare(`
      UPDATE whatsapp_templates
      SET title = ?, body_template = ?, updated_by = ?, updated_at = ?
      WHERE template_key = ?
    `).run(title, bodyTemplate, updatedBy, nowIso, key);

    const updated = db.prepare('SELECT * FROM whatsapp_templates WHERE template_key = ?').get(key) as WhatsAppTemplate;

    logOperatorAction(
      req,
      key === 'isolation_notice' ? 'network' : 'billing',
      'Ubah Template Pesan WA',
      `${updated.title} (${key})`,
      `Memperbarui standarisasi isi template WhatsApp (${updated.body_template.length} karakter)`
    );

    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: 'Gagal menyimpan perubahan template pesan WhatsApp', details: String(err) });
  }
});

apiRouter.post('/whatsapp/templates/:key/reset', (req: AuthenticatedRequest, res: Response) => {
  try {
    const key = String(req.params.key || '').trim() as WhatsAppTemplateKey;
    if (!VALID_WA_TEMPLATE_KEYS.includes(key)) {
      res.status(404).json({ error: 'Kategori template pesan WhatsApp tidak ditemukan.' });
      return;
    }

    const existing = db.prepare('SELECT * FROM whatsapp_templates WHERE template_key = ?').get(key) as
      | WhatsAppTemplate
      | undefined;
    const defaultSpec = DEFAULT_WHATSAPP_TEMPLATES.find((t) => t.template_key === key);
    if (!existing || !defaultSpec) {
      res.status(404).json({ error: 'Template default tidak ditemukan.' });
      return;
    }

    const nowIso = new Date().toISOString();
    const updatedBy = req.authUser?.username ?? 'admin';

    db.prepare(`
      UPDATE whatsapp_templates
      SET title = ?, description = ?, body_template = ?, updated_by = ?, updated_at = ?
      WHERE template_key = ?
    `).run(
      defaultSpec.title,
      defaultSpec.description,
      defaultSpec.default_body,
      updatedBy,
      nowIso,
      key
    );

    const updated = db.prepare('SELECT * FROM whatsapp_templates WHERE template_key = ?').get(key) as WhatsAppTemplate;

    logOperatorAction(
      req,
      key === 'isolation_notice' ? 'network' : 'billing',
      'Reset Template Pesan WA',
      `${updated.title} (${key})`,
      'Mengembalikan isi template pesan WhatsApp ke teks standar default (kebijakan 0% denda)'
    );

    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: 'Gagal mereset template pesan WhatsApp ke default', details: String(err) });
  }
});

// ---------------------------------------------------------------------------
// 9. TOPOLOGI JARINGAN, ODP SPLITTER & MAPPING ONT
// ---------------------------------------------------------------------------
apiRouter.get('/maps-config', (_req: Request, res: Response) => {
  const apiKey = process.env.VITE_GOOGLE_MAPS_API_KEY || process.env.GOOGLE_MAPS_API_KEY || '';
  res.json({ apiKey });
});

apiRouter.get('/topology', (req: AuthenticatedRequest, res: Response) => {
  try {
    const nodes = db.prepare(`
      SELECT
        n.*,
        pn.node_code AS parent_node_code
      FROM network_nodes n
      LEFT JOIN network_nodes pn ON pn.id = n.parent_node_id
      ORDER BY n.node_type ASC, n.node_code ASC
    `).all() as NetworkNode[];

    const odps = db.prepare(`
      SELECT
        o.*,
        n.node_code,
        n.name AS node_name,
        n.node_type,
        COUNT(c.id) AS used_ports
      FROM network_odps o
      LEFT JOIN network_nodes n ON n.id = o.node_id
      LEFT JOIN customers c ON c.odp_id = o.id
      GROUP BY o.id
      ORDER BY o.odp_code ASC
    `).all();

    const ontsRaw = db.prepare(`
      SELECT
        c.*,
        p.name AS package_name,
        p.speed_down_mbps,
        p.speed_up_mbps,
        p.monthly_price AS package_price,
        COALESCE(c.custom_price, p.monthly_price) AS effective_price,
        n.node_code,
        n.name AS node_name,
        n.node_type,
        o.odp_code,
        o.name AS odp_name
      FROM customers c
      JOIN packages p ON p.id = c.package_id
      LEFT JOIN network_nodes n ON n.id = c.node_id
      LEFT JOIN network_odps o ON o.id = c.odp_id
      ORDER BY c.customer_code ASC
    `).all() as Array<Record<string, unknown>>;
    const onts = ontsRaw.map((r) => sanitizeCustomerForStaff(r, req.authUser?.role));

    const recent_logs = db.prepare(`
      SELECT
        l.*,
        c.name AS customer_name,
        c.customer_code,
        c.device_ip
      FROM device_logs l
      JOIN customers c ON c.id = l.customer_id
      ORDER BY l.logged_at DESC, l.id DESC
      LIMIT 40
    `).all() as DeviceLog[];

    res.json({
      nodes,
      odps,
      onts,
      recent_logs,
    });
  } catch (err) {
    res.status(500).json({ error: 'Gagal memuat data topologi & mapping ONT', details: String(err) });
  }
});

apiRouter.post('/odps', (req: AuthenticatedRequest, res: Response) => {
  try {
    const {
      odp_code,
      name,
      node_id,
      pon_port,
      splitter_ratio,
      capacity_ports,
      area_zone,
      latitude,
      longitude,
      map_x,
      map_y,
      notes,
    } = req.body;

    if (!name || !area_zone) {
      res.status(400).json({ error: 'Nama ODP dan area/cluster wajib diisi.' });
      return;
    }

    const cntRow = db.prepare('SELECT COUNT(*) as cnt FROM network_odps').get() as { cnt: number };
    const code = odp_code && String(odp_code).trim()
      ? String(odp_code).trim().toUpperCase()
      : `ODP-AREA-${String(cntRow.cnt + 1).padStart(2, '0')}`;

    const ratio = String(splitter_ratio || '1:8').trim();
    const defaultCap = ratio === '1:16' ? 16 : ratio === '1:4' ? 4 : 8;
    const cap = Number(capacity_ports) || defaultCap;

    const info = db.prepare(`
      INSERT INTO network_odps (
        odp_code, name, node_id, pon_port, splitter_ratio, capacity_ports,
        area_zone, latitude, longitude, map_x, map_y, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      code,
      String(name).trim(),
      node_id ? Number(node_id) : null,
      String(pon_port || 'GPON 0/1/1').trim(),
      ratio,
      cap,
      String(area_zone).trim(),
      latitude !== undefined && latitude !== null && latitude !== '' ? Number(latitude) : null,
      longitude !== undefined && longitude !== null && longitude !== '' ? Number(longitude) : null,
      map_x !== undefined && map_x !== null ? Math.min(96, Math.max(4, Number(map_x))) : 50,
      map_y !== undefined && map_y !== null ? Math.min(94, Math.max(8, Number(map_y))) : 55,
      String(notes || '').trim()
    );

    const created = db.prepare(`
      SELECT o.*, n.node_code, n.name AS node_name, n.node_type, 0 AS used_ports
      FROM network_odps o
      LEFT JOIN network_nodes n ON n.id = o.node_id
      WHERE o.id = ?
    `).get(info.lastInsertRowid) as { odp_code: string; name: string; area_zone: string; splitter_ratio: string };

    logOperatorAction(
      req,
      'network',
      'Tambah ODP Splitter',
      `${created.odp_code} · ${created.name}`,
      `Menambahkan ODP area ${created.area_zone} (rasio ${created.splitter_ratio})`
    );

    res.status(201).json(created);
  } catch (err) {
    const msg = String(err);
    if (msg.includes('UNIQUE constraint failed')) {
      res.status(409).json({ error: 'Kode ODP sudah terdaftar.' });
      return;
    }
    res.status(500).json({ error: 'Gagal menambahkan ODP baru', details: msg });
  }
});

apiRouter.put('/odps/:id', (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    const existing = db.prepare('SELECT * FROM network_odps WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!existing) {
      res.status(404).json({ error: 'ODP tidak ditemukan.' });
      return;
    }

    const {
      odp_code,
      name,
      node_id,
      pon_port,
      splitter_ratio,
      capacity_ports,
      area_zone,
      latitude,
      longitude,
      map_x,
      map_y,
      notes,
    } = req.body;

    db.prepare(`
      UPDATE network_odps
      SET odp_code = ?, name = ?, node_id = ?, pon_port = ?, splitter_ratio = ?,
          capacity_ports = ?, area_zone = ?, latitude = ?, longitude = ?,
          map_x = ?, map_y = ?, notes = ?
      WHERE id = ?
    `).run(
      odp_code !== undefined ? String(odp_code).trim().toUpperCase() : existing.odp_code,
      name !== undefined ? String(name).trim() : existing.name,
      node_id === null || node_id === '' ? null : (node_id !== undefined ? Number(node_id) : existing.node_id),
      pon_port !== undefined ? String(pon_port).trim() : existing.pon_port,
      splitter_ratio !== undefined ? String(splitter_ratio).trim() : existing.splitter_ratio,
      capacity_ports !== undefined ? Number(capacity_ports) : existing.capacity_ports,
      area_zone !== undefined ? String(area_zone).trim() : existing.area_zone,
      latitude === null || latitude === '' ? null : (latitude !== undefined ? Number(latitude) : existing.latitude),
      longitude === null || longitude === '' ? null : (longitude !== undefined ? Number(longitude) : existing.longitude),
      map_x !== undefined ? Math.min(96, Math.max(4, Number(map_x))) : existing.map_x,
      map_y !== undefined ? Math.min(94, Math.max(8, Number(map_y))) : existing.map_y,
      notes !== undefined ? String(notes).trim() : existing.notes,
      id
    );

    const updated = db.prepare(`
      SELECT o.*, n.node_code, n.name AS node_name, n.node_type,
             (SELECT COUNT(*) FROM customers c WHERE c.odp_id = o.id) AS used_ports
      FROM network_odps o
      LEFT JOIN network_nodes n ON n.id = o.node_id
      WHERE o.id = ?
    `).get(id) as { odp_code: string; name: string; area_zone: string; splitter_ratio: string };

    logOperatorAction(
      req,
      'network',
      'Edit ODP & Koordinat',
      `${updated.odp_code} · ${updated.name}`,
      `Memperbarui ODP area ${updated.area_zone} (${updated.splitter_ratio})`
    );

    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: 'Gagal memperbarui data ODP', details: String(err) });
  }
});

apiRouter.delete('/odps/:id', (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    const existing = db.prepare('SELECT odp_code, name FROM network_odps WHERE id = ?').get(id) as {
      odp_code: string;
      name: string;
    } | undefined;
    db.prepare('UPDATE customers SET odp_id = NULL, odp_port = NULL WHERE odp_id = ?').run(id);
    db.prepare('DELETE FROM network_odps WHERE id = ?').run(id);
    if (existing) {
      logOperatorAction(
        req,
        'network',
        'Hapus ODP Splitter',
        `${existing.odp_code} · ${existing.name}`,
        `Menghapus titik ODP dari topologi jaringan`
      );
    }
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: 'Gagal menghapus ODP', details: String(err) });
  }
});

apiRouter.patch('/topology/nodes/:id', (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    const existing = db.prepare('SELECT * FROM network_nodes WHERE id = ?').get(id) as NetworkNode | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Node jaringan tidak ditemukan.' });
      return;
    }

    const { parent_node_id, area_zone, latitude, longitude, map_x, map_y } = req.body;
    const safeParentId =
      parent_node_id === null || parent_node_id === ''
        ? null
        : parent_node_id !== undefined && Number(parent_node_id) !== id
          ? Number(parent_node_id)
          : existing.parent_node_id ?? null;

    db.prepare(`
      UPDATE network_nodes
      SET parent_node_id = ?, area_zone = ?, latitude = ?, longitude = ?, map_x = ?, map_y = ?
      WHERE id = ?
    `).run(
      safeParentId,
      area_zone !== undefined ? String(area_zone).trim() : existing.area_zone ?? 'NOC Pusat',
      latitude === null || latitude === '' ? null : (latitude !== undefined ? Number(latitude) : existing.latitude ?? null),
      longitude === null || longitude === '' ? null : (longitude !== undefined ? Number(longitude) : existing.longitude ?? null),
      map_x !== undefined ? Math.min(96, Math.max(4, Number(map_x))) : (existing.map_x ?? 50),
      map_y !== undefined ? Math.min(94, Math.max(6, Number(map_y))) : (existing.map_y ?? 18),
      id
    );

    const updated = db.prepare(`
      SELECT n.*, pn.node_code AS parent_node_code
      FROM network_nodes n
      LEFT JOIN network_nodes pn ON pn.id = n.parent_node_id
      WHERE n.id = ?
    `).get(id) as NetworkNode;

    logOperatorAction(
      req,
      'network',
      'Update Topologi Node',
      `${updated.node_code} · ${updated.name}`,
      `Memperbarui posisi & uplink topologi area ${updated.area_zone ?? '-'}`
    );

    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: 'Gagal memperbarui posisi/topologi node', details: String(err) });
  }
});

apiRouter.patch('/topology/ont/:id', (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    const existing = db.prepare('SELECT * FROM customers WHERE id = ?').get(id) as Customer | undefined;
    if (!existing) {
      res.status(404).json({ error: 'ONT / perangkat pelanggan tidak ditemukan.' });
      return;
    }

    const {
      node_id,
      odp_id,
      odp_port,
      pon_port,
      cable_length_m,
      rx_power_dbm,
      pppoe_username,
      latitude,
      longitude,
      map_x,
      map_y,
    } = req.body;

    const nextOdpId = odp_id === null || odp_id === '' ? null : (odp_id !== undefined ? Number(odp_id) : existing.odp_id ?? null);
    let nextNodeId = node_id === null || node_id === '' ? null : (node_id !== undefined ? Number(node_id) : existing.node_id ?? null);
    let nextPonPort = pon_port !== undefined ? (pon_port ? String(pon_port).trim() : null) : existing.pon_port;

    // Auto-inherit OLT/MikroTik and PON Port from ODP if caller assigns ODP without explicitly overriding node_id
    if (nextOdpId && node_id === undefined) {
      const odpRow = db.prepare('SELECT node_id, pon_port FROM network_odps WHERE id = ?').get(nextOdpId) as {
        node_id: number | null;
        pon_port: string;
      } | undefined;
      if (odpRow?.node_id) {
        nextNodeId = odpRow.node_id;
      }
      if (odpRow?.pon_port && pon_port === undefined) {
        nextPonPort = odpRow.pon_port;
      }
    }

    db.prepare(`
      UPDATE customers
      SET node_id = ?, odp_id = ?, odp_port = ?, pon_port = ?, cable_length_m = ?,
          rx_power_dbm = ?, pppoe_username = ?, latitude = ?, longitude = ?, map_x = ?, map_y = ?
      WHERE id = ?
    `).run(
      nextNodeId,
      nextOdpId,
      odp_port === null || odp_port === '' ? null : (odp_port !== undefined ? Number(odp_port) : existing.odp_port ?? null),
      nextPonPort,
      cable_length_m === null || cable_length_m === '' ? null : (cable_length_m !== undefined ? Number(cable_length_m) : existing.cable_length_m ?? null),
      rx_power_dbm === null || rx_power_dbm === '' ? null : (rx_power_dbm !== undefined ? Number(rx_power_dbm) : existing.rx_power_dbm),
      pppoe_username !== undefined ? (pppoe_username ? String(pppoe_username).trim() : null) : existing.pppoe_username,
      latitude === null || latitude === '' ? null : (latitude !== undefined ? Number(latitude) : existing.latitude ?? null),
      longitude === null || longitude === '' ? null : (longitude !== undefined ? Number(longitude) : existing.longitude ?? null),
      map_x !== undefined ? Math.min(96, Math.max(4, Number(map_x))) : (existing.map_x ?? 50),
      map_y !== undefined ? Math.min(94, Math.max(8, Number(map_y))) : (existing.map_y ?? 78),
      id
    );

    const updatedRow = db.prepare(`
      SELECT
        c.*,
        p.name AS package_name,
        p.speed_down_mbps,
        p.speed_up_mbps,
        p.monthly_price AS package_price,
        COALESCE(c.custom_price, p.monthly_price) AS effective_price,
        n.node_code,
        n.name AS node_name,
        n.node_type,
        o.odp_code,
        o.name AS odp_name
      FROM customers c
      JOIN packages p ON p.id = c.package_id
      LEFT JOIN network_nodes n ON n.id = c.node_id
      LEFT JOIN network_odps o ON o.id = c.odp_id
      WHERE c.id = ?
    `).get(id) as Record<string, unknown>;
    const updated = sanitizeCustomerForStaff(updatedRow, req.authUser?.role);

    logOperatorAction(
      req,
      'network',
      'Mapping Jalur ONT',
      `${updated.device_id} (${updated.name})`,
      `Memperbarui mapping ODP ${updated.odp_code ?? '-'} Port ${updated.odp_port ?? '-'} / ${updated.pon_port ?? '-'}`
    );

    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: 'Gagal menyimpan mapping ONT', details: String(err) });
  }
});

// ---------------------------------------------------------------------------
// 10. BACKUP SNAPSHOT JSON & JADWAL BACKUP BERKALA (KHUSUS ADMIN)
// ---------------------------------------------------------------------------
apiRouter.get('/backups', (_req: AuthenticatedRequest, res: Response) => {
  try {
    runDueScheduledBackupIfNeeded();
    const settings = getBackupSettings();
    const snapshots = listBackupSnapshotMetas();
    res.json({ settings, snapshots });
  } catch (err) {
    res.status(500).json({ error: 'Gagal memuat konfigurasi & riwayat backup', details: String(err) });
  }
});

apiRouter.put('/backups/settings', (req: AuthenticatedRequest, res: Response) => {
  try {
    const freqRaw = String(req.body?.schedule_frequency || '').trim() as BackupFrequency;
    if (!['disabled', 'daily', 'weekly'].includes(freqRaw)) {
      res.status(400).json({ error: 'Frekuensi jadwal backup harus daily, weekly, atau disabled.' });
      return;
    }

    const retentionRaw = Number(req.body?.retention_count);
    const retentionCount = Number.isFinite(retentionRaw)
      ? Math.max(1, Math.min(50, Math.round(retentionRaw)))
      : 7;

    const hourRaw = Number(req.body?.backup_hour_wib);
    const backupHourWib = Number.isFinite(hourRaw)
      ? Math.max(0, Math.min(23, Math.floor(hourRaw)))
      : 2;

    const now = new Date();
    const nowIso = now.toISOString();
    const nextRun = computeNextBackupRunIso(freqRaw, backupHourWib, now);
    const updatedBy = req.authUser?.username ?? 'admin';

    getBackupSettings();
    db.prepare(`
      UPDATE backup_settings
      SET schedule_frequency = ?, retention_count = ?, backup_hour_wib = ?,
          next_run_at = ?, updated_by = ?, updated_at = ?
      WHERE id = 1
    `).run(freqRaw, retentionCount, backupHourWib, nextRun, updatedBy, nowIso);

    // Prune older snapshots immediately if retention count was lowered
    const prunedInfo = db.prepare(`
      DELETE FROM backup_snapshots
      WHERE id NOT IN (
        SELECT id FROM backup_snapshots
        ORDER BY created_at DESC, id DESC
        LIMIT ?
      )
    `).run(retentionCount);

    const freqLabel =
      freqRaw === 'daily' ? 'Harian' : freqRaw === 'weekly' ? 'Mingguan' : 'Nonaktif';

    logOperatorAction(
      req,
      'auth',
      'Ubah Jadwal Backup',
      `Jadwal: ${freqLabel}`,
      `Frekuensi ${freqLabel} (pukul ${String(backupHourWib).padStart(2, '0')}:00 WIB), simpan maks. ${retentionCount} arsip${prunedInfo.changes > 0 ? `, ${prunedInfo.changes} arsip lama dibersihkan` : ''}`
    );

    res.json({
      settings: getBackupSettings(),
      snapshots: listBackupSnapshotMetas(),
    });
  } catch (err) {
    res.status(500).json({ error: 'Gagal menyimpan jadwal backup berkala', details: String(err) });
  }
});

apiRouter.post('/backups/run', (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = createBackupSnapshot({
      backupType: 'manual',
      triggeredBy: `@${req.authUser?.username ?? 'admin'}`,
      userId: req.authUser?.id ?? null,
      username: req.authUser?.username ?? 'admin',
      role: req.authUser?.role ?? 'Admin',
    });

    res.status(201).json({
      snapshot_meta: result.meta,
      snapshot: result.snapshot,
      pruned_count: result.pruned_count,
      settings: getBackupSettings(),
      snapshots: listBackupSnapshotMetas(),
    });
  } catch (err) {
    res.status(500).json({ error: 'Gagal membuat snapshot backup', details: String(err) });
  }
});

apiRouter.get('/backups/snapshot-live', (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = createBackupSnapshot({
      backupType: 'manual',
      triggeredBy: `@${req.authUser?.username ?? 'admin'}`,
      userId: req.authUser?.id ?? null,
      username: req.authUser?.username ?? 'admin',
      role: req.authUser?.role ?? 'Admin',
    });
    const jsonText = JSON.stringify(result.snapshot, null, 2);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${result.meta.filename}"`);
    res.send(jsonText);
  } catch (err) {
    res.status(500).json({ error: 'Gagal mengunduh snapshot backup langsung', details: String(err) });
  }
});

apiRouter.get('/backups/:id/download', (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    const row = db.prepare(`
      SELECT id, filename, backup_type, total_records, snapshot_json
      FROM backup_snapshots WHERE id = ?
    `).get(id) as
      | {
          id: number;
          filename: string;
          backup_type: string;
          total_records: number;
          snapshot_json: string;
        }
      | undefined;

    if (!row) {
      res.status(404).json({ error: 'Arsip snapshot backup tidak ditemukan.' });
      return;
    }

    logOperatorAction(
      req,
      'auth',
      'Unduh Snapshot Backup',
      row.filename,
      `Mengunduh ulang arsip snapshot (${row.backup_type}, ${row.total_records} catatan)`
    );

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${row.filename}"`);
    res.send(row.snapshot_json);
  } catch (err) {
    res.status(500).json({ error: 'Gagal mengunduh arsip snapshot backup', details: String(err) });
  }
});

// ---------------------------------------------------------------------------
// 11. TIKET GANGGUAN & PENUGASAN LAPANGAN (trouble_tickets)
// ---------------------------------------------------------------------------
const VALID_TICKET_SOURCES: TicketSource[] = [
  'WA Pelanggan',
  'Alarm NOC / Webhook',
  'Cek Lapangan',
  'Manual Admin',
];
const VALID_TICKET_CATEGORIES: TicketCategory[] = [
  'LOS / Optik Putus',
  'Redaman / Optik Lemah',
  'Perangkat Mati / Adaptor',
  'Koneksi Lambat / Latency',
  'Lainnya',
];
const VALID_TICKET_PRIORITIES: TicketPriority[] = ['Kritis', 'Tinggi', 'Normal'];
const VALID_TICKET_STATUSES: TicketStatus[] = [
  'Open',
  'In Progress',
  'Menunggu Konfirmasi',
  'Resolved',
];

function getWibYearMonthCompact(date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(date);
  const year = parts.find((p) => p.type === 'year')?.value ?? '2026';
  const month = parts.find((p) => p.type === 'month')?.value ?? '11';
  return `${year}${month}`;
}

function generateNextTicketCode(): string {
  const ym = getWibYearMonthCompact();
  const prefix = `TKT-${ym}-`;
  const lastRow = db.prepare(`
    SELECT ticket_code FROM trouble_tickets
    WHERE ticket_code LIKE ?
    ORDER BY ticket_code DESC
    LIMIT 1
  `).get(`${prefix}%`) as { ticket_code: string } | undefined;

  let seq = 1;
  if (lastRow?.ticket_code) {
    const tail = lastRow.ticket_code.slice(prefix.length);
    const parsed = Number.parseInt(tail, 10);
    if (Number.isFinite(parsed) && parsed >= 1) {
      seq = parsed + 1;
    }
  }
  return `${prefix}${String(seq).padStart(3, '0')}`;
}

function queryJoinedTicketById(id: number): TroubleTicket | undefined {
  return db.prepare(`
    SELECT
      t.*,
      c.customer_code,
      c.name AS customer_name,
      c.whatsapp AS customer_whatsapp,
      c.address AS customer_address,
      p.name AS package_name,
      c.device_id,
      c.device_ip,
      c.device_model,
      c.device_status,
      c.rx_power_dbm,
      c.pon_port,
      n.node_code,
      n.name AS node_name,
      o.odp_code,
      o.name AS odp_name,
      u.username AS assigned_to_username
    FROM trouble_tickets t
    JOIN customers c ON c.id = t.customer_id
    JOIN packages p ON p.id = c.package_id
    LEFT JOIN network_nodes n ON n.id = COALESCE(t.node_id, c.node_id)
    LEFT JOIN network_odps o ON o.id = COALESCE(t.odp_id, c.odp_id)
    LEFT JOIN users u ON u.id = t.assigned_to_user_id
    WHERE t.id = ?
    LIMIT 1
  `).get(id) as TroubleTicket | undefined;
}

apiRouter.get('/tickets', (req: AuthenticatedRequest, res: Response) => {
  try {
    const statusFilter = typeof req.query.status === 'string' ? req.query.status.trim() : '';
    const priorityFilter = typeof req.query.priority === 'string' ? req.query.priority.trim() : '';
    const categoryFilter = typeof req.query.category === 'string' ? req.query.category.trim() : '';
    const sourceFilter = typeof req.query.source === 'string' ? req.query.source.trim() : '';
    const customerIdFilter = req.query.customer_id ? Number(req.query.customer_id) : 0;
    const odpIdFilter = req.query.odp_id ? Number(req.query.odp_id) : 0;
    const search = typeof req.query.search === 'string' ? req.query.search.trim().toLowerCase() : '';

    const conditions: string[] = [];
    const params: Array<string | number> = [];

    if (statusFilter && statusFilter !== 'all') {
      conditions.push('t.status = ?');
      params.push(statusFilter);
    }
    if (priorityFilter && priorityFilter !== 'all') {
      conditions.push('t.priority = ?');
      params.push(priorityFilter);
    }
    if (categoryFilter && categoryFilter !== 'all') {
      conditions.push('t.category = ?');
      params.push(categoryFilter);
    }
    if (sourceFilter && sourceFilter !== 'all') {
      conditions.push('t.source = ?');
      params.push(sourceFilter);
    }
    if (Number.isFinite(customerIdFilter) && customerIdFilter > 0) {
      conditions.push('t.customer_id = ?');
      params.push(customerIdFilter);
    }
    if (Number.isFinite(odpIdFilter) && odpIdFilter > 0) {
      conditions.push('COALESCE(t.odp_id, c.odp_id) = ?');
      params.push(odpIdFilter);
    }
    if (search) {
      const like = `%${search}%`;
      conditions.push(`(
        LOWER(t.ticket_code) LIKE ?
        OR LOWER(c.name) LIKE ?
        OR LOWER(c.customer_code) LIKE ?
        OR LOWER(c.device_id) LIKE ?
        OR LOWER(COALESCE(o.odp_code, '')) LIKE ?
        OR LOWER(COALESCE(n.node_code, '')) LIKE ?
        OR LOWER(t.issue_summary) LIKE ?
        OR LOWER(t.resolution_notes) LIKE ?
        OR LOWER(COALESCE(t.assigned_to_name, '')) LIKE ?
      )`);
      params.push(like, like, like, like, like, like, like, like, like);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const tickets = db.prepare(`
      SELECT
        t.*,
        c.customer_code,
        c.name AS customer_name,
        c.whatsapp AS customer_whatsapp,
        c.address AS customer_address,
        p.name AS package_name,
        c.device_id,
        c.device_ip,
        c.device_model,
        c.device_status,
        c.rx_power_dbm,
        c.pon_port,
        n.node_code,
        n.name AS node_name,
        o.odp_code,
        o.name AS odp_name,
        u.username AS assigned_to_username
      FROM trouble_tickets t
      JOIN customers c ON c.id = t.customer_id
      JOIN packages p ON p.id = c.package_id
      LEFT JOIN network_nodes n ON n.id = COALESCE(t.node_id, c.node_id)
      LEFT JOIN network_odps o ON o.id = COALESCE(t.odp_id, c.odp_id)
      LEFT JOIN users u ON u.id = t.assigned_to_user_id
      ${whereClause}
      ORDER BY
        CASE t.status WHEN 'Resolved' THEN 1 ELSE 0 END ASC,
        CASE t.priority WHEN 'Kritis' THEN 0 WHEN 'Tinggi' THEN 1 ELSE 2 END ASC,
        t.created_at DESC,
        t.id DESC
    `).all(...params) as TroubleTicket[];

    const assignees = db.prepare(`
      SELECT id, username, full_name, role
      FROM users
      WHERE is_active = 1 AND role IN ('Teknisi', 'Admin')
      ORDER BY CASE role WHEN 'Teknisi' THEN 0 ELSE 1 END, full_name ASC
    `).all() as TicketAssigneeOption[];

    const countsRow = db.prepare(`
      SELECT
        COUNT(*) AS total_count,
        SUM(CASE WHEN status = 'Open' THEN 1 ELSE 0 END) AS open_count,
        SUM(CASE WHEN status = 'In Progress' THEN 1 ELSE 0 END) AS in_progress_count,
        SUM(CASE WHEN status = 'Menunggu Konfirmasi' THEN 1 ELSE 0 END) AS waiting_count,
        SUM(CASE WHEN status = 'Resolved' THEN 1 ELSE 0 END) AS resolved_count,
        SUM(CASE WHEN status != 'Resolved' AND priority = 'Kritis' THEN 1 ELSE 0 END) AS critical_open_count
      FROM trouble_tickets
    `).get() as {
      total_count: number;
      open_count: number | null;
      in_progress_count: number | null;
      waiting_count: number | null;
      resolved_count: number | null;
      critical_open_count: number | null;
    };

    const customerRecurrence = db.prepare(`
      SELECT
        c.id AS customer_id,
        c.customer_code,
        c.name AS customer_name,
        c.device_id,
        c.device_status,
        o.odp_code,
        COUNT(t.id) AS total_tickets,
        SUM(CASE WHEN t.status != 'Resolved' THEN 1 ELSE 0 END) AS open_tickets,
        SUM(CASE WHEN t.status = 'Resolved' THEN 1 ELSE 0 END) AS resolved_tickets,
        MAX(t.created_at) AS last_ticket_at,
        (
          SELECT t2.category FROM trouble_tickets t2
          WHERE t2.customer_id = c.id
          ORDER BY t2.created_at DESC, t2.id DESC LIMIT 1
        ) AS last_category,
        (
          SELECT t2.ticket_code FROM trouble_tickets t2
          WHERE t2.customer_id = c.id
          ORDER BY t2.created_at DESC, t2.id DESC LIMIT 1
        ) AS last_ticket_code
      FROM trouble_tickets t
      JOIN customers c ON c.id = t.customer_id
      LEFT JOIN network_odps o ON o.id = COALESCE(t.odp_id, c.odp_id)
      GROUP BY c.id
      ORDER BY total_tickets DESC, open_tickets DESC, last_ticket_at DESC
    `).all() as TicketCustomerRecurrence[];

    const odpRecurrence = db.prepare(`
      SELECT
        o.id AS odp_id,
        o.odp_code,
        o.name AS odp_name,
        o.area_zone,
        n.node_code,
        COUNT(t.id) AS total_tickets,
        SUM(CASE WHEN t.status != 'Resolved' THEN 1 ELSE 0 END) AS open_tickets,
        SUM(CASE WHEN t.status = 'Resolved' THEN 1 ELSE 0 END) AS resolved_tickets,
        COUNT(DISTINCT t.customer_id) AS affected_customers,
        MAX(t.created_at) AS last_ticket_at,
        (
          SELECT t2.category FROM trouble_tickets t2
          JOIN customers c2 ON c2.id = t2.customer_id
          WHERE COALESCE(t2.odp_id, c2.odp_id) = o.id
          ORDER BY t2.created_at DESC, t2.id DESC LIMIT 1
        ) AS last_category
      FROM trouble_tickets t
      JOIN customers c ON c.id = t.customer_id
      JOIN network_odps o ON o.id = COALESCE(t.odp_id, c.odp_id)
      LEFT JOIN network_nodes n ON n.id = o.node_id
      GROUP BY o.id
      ORDER BY total_tickets DESC, open_tickets DESC, last_ticket_at DESC
    `).all() as TicketOdpRecurrence[];

    const recurringCustomersCount = customerRecurrence.filter((r) => r.total_tickets >= 2).length;
    const recurringOdpsCount = odpRecurrence.filter((r) => r.total_tickets >= 2).length;

    const customerOptions = db.prepare(`
      SELECT
        c.id,
        c.customer_code,
        c.name,
        c.device_id,
        c.device_ip,
        c.device_status,
        c.rx_power_dbm,
        c.pon_port,
        p.name AS package_name,
        n.node_code,
        o.odp_code
      FROM customers c
      JOIN packages p ON p.id = c.package_id
      LEFT JOIN network_nodes n ON n.id = c.node_id
      LEFT JOIN network_odps o ON o.id = c.odp_id
      ORDER BY
        CASE c.device_status WHEN 'Offline' THEN 0 WHEN 'Isolir' THEN 1 ELSE 2 END ASC,
        c.customer_code ASC
    `).all();

    res.json({
      tickets,
      assignees,
      customer_options: customerOptions,
      summary: {
        total_count: countsRow.total_count ?? 0,
        open_count: countsRow.open_count ?? 0,
        in_progress_count: countsRow.in_progress_count ?? 0,
        waiting_count: countsRow.waiting_count ?? 0,
        resolved_count: countsRow.resolved_count ?? 0,
        critical_open_count: countsRow.critical_open_count ?? 0,
        recurring_customers_count: recurringCustomersCount,
        recurring_odps_count: recurringOdpsCount,
      },
      customer_recurrence: customerRecurrence,
      odp_recurrence: odpRecurrence,
    });
  } catch (err) {
    res.status(500).json({ error: 'Gagal memuat daftar tiket gangguan', details: String(err) });
  }
});

apiRouter.post('/tickets', (req: AuthenticatedRequest, res: Response) => {
  try {
    const customerId = Number(req.body?.customer_id);
    if (!Number.isFinite(customerId) || customerId <= 0) {
      res.status(400).json({ error: 'Pelanggan / perangkat ONT wajib dipilih.' });
      return;
    }

    const customer = db.prepare(`
      SELECT id, customer_code, name, device_id, node_id, odp_id
      FROM customers WHERE id = ? LIMIT 1
    `).get(customerId) as
      | {
          id: number;
          customer_code: string;
          name: string;
          device_id: string;
          node_id: number | null;
          odp_id: number | null;
        }
      | undefined;

    if (!customer) {
      res.status(404).json({ error: 'Data pelanggan tidak ditemukan.' });
      return;
    }

    const source = (typeof req.body?.source === 'string' ? req.body.source.trim() : 'Manual Admin') as TicketSource;
    if (!VALID_TICKET_SOURCES.includes(source)) {
      res.status(400).json({ error: 'Sumber tiket tidak valid.' });
      return;
    }

    const category = (typeof req.body?.category === 'string' ? req.body.category.trim() : 'Lainnya') as TicketCategory;
    if (!VALID_TICKET_CATEGORIES.includes(category)) {
      res.status(400).json({ error: 'Kategori gangguan tidak valid.' });
      return;
    }

    const priority = (typeof req.body?.priority === 'string' ? req.body.priority.trim() : 'Normal') as TicketPriority;
    if (!VALID_TICKET_PRIORITIES.includes(priority)) {
      res.status(400).json({ error: 'Prioritas tiket harus Kritis, Tinggi, atau Normal.' });
      return;
    }

    const status = (typeof req.body?.status === 'string' ? req.body.status.trim() : 'Open') as TicketStatus;
    if (!VALID_TICKET_STATUSES.includes(status)) {
      res.status(400).json({ error: 'Status tiket tidak valid.' });
      return;
    }

    const issueSummary = typeof req.body?.issue_summary === 'string' ? req.body.issue_summary.trim() : '';
    if (!issueSummary) {
      res.status(400).json({ error: 'Ringkasan keluhan / gangguan wajib diisi.' });
      return;
    }

    const resolutionNotes =
      typeof req.body?.resolution_notes === 'string' ? req.body.resolution_notes.trim() : '';

    let assignedUserId: number | null = null;
    let assignedToName: string | null = null;
    if (req.body?.assigned_to_user_id !== undefined && req.body?.assigned_to_user_id !== null && req.body?.assigned_to_user_id !== '') {
      const uid = Number(req.body.assigned_to_user_id);
      if (Number.isFinite(uid) && uid > 0) {
        const assignee = db.prepare('SELECT id, full_name FROM users WHERE id = ? LIMIT 1').get(uid) as
          | { id: number; full_name: string }
          | undefined;
        if (assignee) {
          assignedUserId = assignee.id;
          assignedToName = assignee.full_name;
        }
      }
    }

    const nodeId = req.body?.node_id !== undefined && req.body?.node_id !== null && req.body?.node_id !== ''
      ? Number(req.body.node_id)
      : customer.node_id;
    const odpId = req.body?.odp_id !== undefined && req.body?.odp_id !== null && req.body?.odp_id !== ''
      ? Number(req.body.odp_id)
      : customer.odp_id;

    const ticketCode = generateNextTicketCode();
    const nowIso = new Date().toISOString();
    const resolvedAt = status === 'Resolved' ? nowIso : null;
    const createdBy = req.authUser ? `@${req.authUser.username}` : 'system';

    const info = db.prepare(`
      INSERT INTO trouble_tickets (
        ticket_code, customer_id, node_id, odp_id, source, category, priority, status,
        assigned_to_user_id, assigned_to_name, issue_summary, resolution_notes,
        created_by, created_at, updated_at, resolved_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      ticketCode,
      customer.id,
      nodeId,
      odpId,
      source,
      category,
      priority,
      status,
      assignedUserId,
      assignedToName,
      issueSummary,
      resolutionNotes,
      createdBy,
      nowIso,
      nowIso,
      resolvedAt
    );

    const created = queryJoinedTicketById(Number(info.lastInsertRowid));

    logOperatorAction(
      req,
      'network',
      'Buat Tiket Gangguan',
      `${ticketCode} · ${customer.device_id} (${customer.name})`,
      `Sumber: ${source} · Kategori: ${category} · Prioritas: ${priority} · Status: ${status}${assignedToName ? ` · Teknisi: ${assignedToName}` : ''} — ${issueSummary}`
    );

    res.status(201).json(created);
  } catch (err) {
    res.status(500).json({ error: 'Gagal membuat tiket gangguan baru', details: String(err) });
  }
});

apiRouter.patch('/tickets/:id', (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    const existing = queryJoinedTicketById(id);
    if (!existing) {
      res.status(404).json({ error: 'Tiket gangguan tidak ditemukan.' });
      return;
    }

    const nextSource = (
      typeof req.body?.source === 'string' && req.body.source.trim()
        ? req.body.source.trim()
        : existing.source
    ) as TicketSource;
    if (!VALID_TICKET_SOURCES.includes(nextSource)) {
      res.status(400).json({ error: 'Sumber tiket tidak valid.' });
      return;
    }

    const nextCategory = (
      typeof req.body?.category === 'string' && req.body.category.trim()
        ? req.body.category.trim()
        : existing.category
    ) as TicketCategory;
    if (!VALID_TICKET_CATEGORIES.includes(nextCategory)) {
      res.status(400).json({ error: 'Kategori gangguan tidak valid.' });
      return;
    }

    const nextPriority = (
      typeof req.body?.priority === 'string' && req.body.priority.trim()
        ? req.body.priority.trim()
        : existing.priority
    ) as TicketPriority;
    if (!VALID_TICKET_PRIORITIES.includes(nextPriority)) {
      res.status(400).json({ error: 'Prioritas tiket tidak valid.' });
      return;
    }

    const nextStatus = (
      typeof req.body?.status === 'string' && req.body.status.trim()
        ? req.body.status.trim()
        : existing.status
    ) as TicketStatus;
    if (!VALID_TICKET_STATUSES.includes(nextStatus)) {
      res.status(400).json({ error: 'Status tiket tidak valid.' });
      return;
    }

    const nextIssueSummary =
      typeof req.body?.issue_summary === 'string' && req.body.issue_summary.trim()
        ? req.body.issue_summary.trim()
        : existing.issue_summary;

    const nextResolutionNotes =
      req.body?.resolution_notes !== undefined
        ? String(req.body.resolution_notes ?? '').trim()
        : existing.resolution_notes;

    let nextAssigneeId = existing.assigned_to_user_id;
    let nextAssigneeName = existing.assigned_to_name;
    if (req.body?.assigned_to_user_id !== undefined) {
      if (req.body.assigned_to_user_id === null || req.body.assigned_to_user_id === '') {
        nextAssigneeId = null;
        nextAssigneeName = null;
      } else {
        const uid = Number(req.body.assigned_to_user_id);
        const assignee = db.prepare('SELECT id, full_name FROM users WHERE id = ? LIMIT 1').get(uid) as
          | { id: number; full_name: string }
          | undefined;
        if (!assignee) {
          res.status(400).json({ error: 'Teknisi yang ditugaskan tidak ditemukan.' });
          return;
        }
        nextAssigneeId = assignee.id;
        nextAssigneeName = assignee.full_name;
      }
    }

    const nowIso = new Date().toISOString();
    let nextResolvedAt = existing.resolved_at;
    if (nextStatus === 'Resolved' && existing.status !== 'Resolved') {
      nextResolvedAt = nowIso;
    } else if (nextStatus !== 'Resolved' && existing.status === 'Resolved') {
      nextResolvedAt = null;
    }

    db.prepare(`
      UPDATE trouble_tickets
      SET source = ?, category = ?, priority = ?, status = ?,
          assigned_to_user_id = ?, assigned_to_name = ?,
          issue_summary = ?, resolution_notes = ?,
          updated_at = ?, resolved_at = ?
      WHERE id = ?
    `).run(
      nextSource,
      nextCategory,
      nextPriority,
      nextStatus,
      nextAssigneeId,
      nextAssigneeName,
      nextIssueSummary,
      nextResolutionNotes,
      nowIso,
      nextResolvedAt,
      id
    );

    const updated = queryJoinedTicketById(id)!;

    const changes: string[] = [];
    if (existing.status !== nextStatus) {
      changes.push(`Status: ${existing.status} → ${nextStatus}`);
    }
    if (existing.assigned_to_user_id !== nextAssigneeId) {
      changes.push(`Teknisi: ${existing.assigned_to_name ?? 'Belum ditugaskan'} → ${nextAssigneeName ?? 'Belum ditugaskan'}`);
    }
    if (existing.priority !== nextPriority) {
      changes.push(`Prioritas: ${existing.priority} → ${nextPriority}`);
    }
    if (nextResolutionNotes && nextResolutionNotes !== existing.resolution_notes) {
      changes.push(`Catatan lapangan: ${nextResolutionNotes}`);
    }

    const actionLabel =
      nextStatus === 'Resolved' && existing.status !== 'Resolved'
        ? 'Selesaikan Tiket Gangguan'
        : existing.status !== nextStatus
          ? 'Ubah Status Tiket'
          : existing.assigned_to_user_id !== nextAssigneeId
            ? 'Tugaskan Teknisi Tiket'
            : 'Perbarui Catatan Tiket';

    logOperatorAction(
      req,
      'network',
      actionLabel,
      `${updated.ticket_code} · ${updated.device_id} (${updated.customer_name})`,
      changes.length > 0
        ? changes.join(' · ')
        : `Pembaruan detail tiket kategori ${updated.category}`
    );

    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: 'Gagal memperbarui tiket gangguan', details: String(err) });
  }
});

apiRouter.delete('/tickets/:id', (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    const existing = queryJoinedTicketById(id);
    if (!existing) {
      res.status(404).json({ error: 'Tiket gangguan tidak ditemukan.' });
      return;
    }

    db.prepare('DELETE FROM trouble_tickets WHERE id = ?').run(id);
    logOperatorAction(
      req,
      'network',
      'Hapus Tiket Gangguan',
      `${existing.ticket_code} · ${existing.device_id} (${existing.customer_name})`,
      `Menghapus tiket (${existing.category}, status ${existing.status}) dari daftar gangguan`
    );

    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: 'Gagal menghapus tiket gangguan', details: String(err) });
  }
});

