import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type {
  ActivityLogCategory,
  ActorRole,
  BackupFrequency,
  BackupSettings,
  BackupSnapshotCounts,
  BackupSnapshotMeta,
  FeatureKey,
  UserRole,
  WhatsAppTemplateKey,
} from '../src/types.ts';

export const ASSIGNABLE_FEATURES: FeatureKey[] = [
  'dashboard',
  'customers',
  'billing',
  'whatsapp',
  'monitoring',
  'mapping',
  'tickets',
  'reports',
  'activity_logs',
  'schema',
];

export const ALL_FEATURES_WITH_USERS: FeatureKey[] = [
  ...ASSIGNABLE_FEATURES,
  'users',
  'backup',
];

export const ROLE_DEFAULT_FEATURES: Record<UserRole, FeatureKey[]> = {
  Admin: ALL_FEATURES_WITH_USERS,
  Teknisi: ['dashboard', 'monitoring', 'mapping', 'tickets', 'whatsapp', 'customers', 'billing', 'activity_logs'],
  Keuangan: ['dashboard', 'billing', 'reports', 'customers', 'whatsapp', 'activity_logs'],
};

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [salt, keyHex] = parts;
  if (!salt || !keyHex) return false;
  const keyBuf = Buffer.from(keyHex, 'hex');
  const derivedBuf = crypto.scryptSync(password, salt, 64);
  if (keyBuf.length !== derivedBuf.length) return false;
  return crypto.timingSafeEqual(keyBuf, derivedBuf);
}

const dataDir = path.resolve(process.cwd(), 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'lajunet.db');
export const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export function initDatabase(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS packages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      speed_down_mbps INTEGER NOT NULL,
      speed_up_mbps INTEGER NOT NULL,
      monthly_price INTEGER NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS network_nodes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      node_code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      node_type TEXT NOT NULL CHECK(node_type IN ('MikroTik', 'OLT')),
      vendor_model TEXT NOT NULL,
      host_ip TEXT NOT NULL,
      api_protocol TEXT NOT NULL,
      api_port INTEGER NOT NULL DEFAULT 443,
      api_base_url TEXT NOT NULL,
      api_username TEXT NOT NULL DEFAULT 'api_noc',
      api_token_masked TEXT NOT NULL DEFAULT '****',
      poll_interval_sec INTEGER NOT NULL DEFAULT 30,
      status TEXT NOT NULL CHECK(status IN ('Online', 'Degraded', 'Offline')) DEFAULT 'Online',
      cpu_load_pct INTEGER NOT NULL DEFAULT 0,
      memory_used_pct INTEGER NOT NULL DEFAULT 0,
      temperature_c INTEGER NOT NULL DEFAULT 0,
      rx_throughput_mbps REAL NOT NULL DEFAULT 0,
      tx_throughput_mbps REAL NOT NULL DEFAULT 0,
      active_sessions INTEGER NOT NULL DEFAULT 0,
      uptime_text TEXT NOT NULL DEFAULT '0d 0h',
      last_sync_at TEXT NOT NULL,
      last_sync_message TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      address TEXT NOT NULL,
      whatsapp TEXT NOT NULL,
      package_id INTEGER NOT NULL REFERENCES packages(id),
      custom_price INTEGER,
      device_id TEXT UNIQUE NOT NULL,
      device_ip TEXT NOT NULL,
      device_model TEXT NOT NULL,
      due_day INTEGER NOT NULL CHECK(due_day BETWEEN 1 AND 28),
      device_status TEXT NOT NULL CHECK(device_status IN ('Online', 'Offline', 'Isolir')) DEFAULT 'Online',
      customer_active INTEGER NOT NULL DEFAULT 1,
      last_seen_at TEXT NOT NULL,
      node_id INTEGER REFERENCES network_nodes(id),
      pon_port TEXT,
      rx_power_dbm REAL,
      pppoe_username TEXT,
      latency_ms INTEGER,
      uptime_session TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS invoices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_number TEXT UNIQUE NOT NULL,
      customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      billing_period TEXT NOT NULL,
      amount INTEGER NOT NULL,
      late_fee INTEGER NOT NULL DEFAULT 0 CHECK(late_fee = 0),
      due_date TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('Lunas', 'Belum Lunas')) DEFAULT 'Belum Lunas',
      payment_method TEXT,
      paid_at TEXT,
      wa_reminder_sent_at TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(customer_id, billing_period)
    );

    CREATE TABLE IF NOT EXISTS device_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      device_id TEXT NOT NULL,
      previous_status TEXT NOT NULL,
      new_status TEXT NOT NULL CHECK(new_status IN ('Online', 'Offline', 'Isolir')),
      event_source TEXT NOT NULL,
      reason TEXT,
      latency_ms INTEGER,
      logged_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS webhook_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      received_at TEXT NOT NULL,
      source_ip TEXT,
      endpoint TEXT NOT NULL,
      device_id TEXT,
      device_ip TEXT,
      reported_status TEXT,
      http_status INTEGER NOT NULL,
      processed INTEGER NOT NULL DEFAULT 1,
      message TEXT NOT NULL,
      payload_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS whatsapp_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      direction TEXT NOT NULL CHECK(direction IN ('outbound', 'inbound')),
      message TEXT NOT NULL,
      template_type TEXT,
      delivery_channel TEXT NOT NULL DEFAULT 'WhatsApp Web',
      delivery_status TEXT NOT NULL DEFAULT 'Terkirim',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS whatsapp_gateway_config (
      id INTEGER PRIMARY KEY CHECK(id = 1),
      provider_name TEXT NOT NULL DEFAULT 'WA Gateway (Fonnte / Wablas / WAHA)',
      api_url TEXT NOT NULL DEFAULT '',
      api_token_masked TEXT NOT NULL DEFAULT '',
      api_token_raw TEXT NOT NULL DEFAULT '',
      sender_number TEXT NOT NULL DEFAULT '6281200004000',
      is_active INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS whatsapp_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      template_key TEXT UNIQUE NOT NULL CHECK(template_key IN ('reminder_pre_due', 'due_overdue', 'isolation_notice')),
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      body_template TEXT NOT NULL,
      default_body TEXT NOT NULL,
      updated_by TEXT NOT NULL DEFAULT 'system',
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS network_odps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      odp_code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      node_id INTEGER REFERENCES network_nodes(id) ON DELETE SET NULL,
      pon_port TEXT NOT NULL DEFAULT 'GPON 0/1/1',
      splitter_ratio TEXT NOT NULL DEFAULT '1:8',
      capacity_ports INTEGER NOT NULL DEFAULT 8,
      area_zone TEXT NOT NULL DEFAULT 'Area Pusat',
      latitude REAL,
      longitude REAL,
      map_x REAL NOT NULL DEFAULT 50,
      map_y REAL NOT NULL DEFAULT 50,
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      full_name TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('Admin', 'Teknisi', 'Keuangan')),
      allowed_features_json TEXT NOT NULL DEFAULT '[]',
      is_active INTEGER NOT NULL DEFAULT 1,
      last_login_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS user_sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS customer_sessions (
      token TEXT PRIMARY KEY,
      customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_customer_sessions_customer_id ON customer_sessions(customer_id);

    CREATE TABLE IF NOT EXISTS activity_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      username TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('Admin', 'Teknisi', 'Keuangan', 'Pelanggan')),
      category TEXT NOT NULL CHECK(category IN ('billing', 'network', 'customer', 'auth')),
      action TEXT NOT NULL,
      target_label TEXT NOT NULL DEFAULT '',
      details TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_activity_logs_created_at ON activity_logs(created_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS idx_activity_logs_category ON activity_logs(category);

    CREATE TABLE IF NOT EXISTS app_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS backup_settings (
      id INTEGER PRIMARY KEY CHECK(id = 1),
      schedule_frequency TEXT NOT NULL CHECK(schedule_frequency IN ('disabled', 'daily', 'weekly')) DEFAULT 'daily',
      retention_count INTEGER NOT NULL DEFAULT 7,
      backup_hour_wib INTEGER NOT NULL DEFAULT 2,
      last_run_at TEXT,
      next_run_at TEXT,
      updated_by TEXT NOT NULL DEFAULT 'system',
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS backup_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT UNIQUE NOT NULL,
      backup_type TEXT NOT NULL CHECK(backup_type IN ('manual', 'scheduled')),
      triggered_by TEXT NOT NULL,
      total_records INTEGER NOT NULL DEFAULT 0,
      counts_json TEXT NOT NULL,
      size_bytes INTEGER NOT NULL DEFAULT 0,
      snapshot_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_backup_snapshots_created_at ON backup_snapshots(created_at DESC, id DESC);

    CREATE TABLE IF NOT EXISTS trouble_tickets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_code TEXT UNIQUE NOT NULL,
      customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      node_id INTEGER REFERENCES network_nodes(id) ON DELETE SET NULL,
      odp_id INTEGER REFERENCES network_odps(id) ON DELETE SET NULL,
      source TEXT NOT NULL CHECK(source IN ('WA Pelanggan', 'Alarm NOC / Webhook', 'Cek Lapangan', 'Manual Admin')),
      category TEXT NOT NULL CHECK(category IN ('LOS / Optik Putus', 'Redaman / Optik Lemah', 'Perangkat Mati / Adaptor', 'Koneksi Lambat / Latency', 'Lainnya')),
      priority TEXT NOT NULL CHECK(priority IN ('Kritis', 'Tinggi', 'Normal')) DEFAULT 'Normal',
      status TEXT NOT NULL CHECK(status IN ('Open', 'In Progress', 'Menunggu Konfirmasi', 'Resolved')) DEFAULT 'Open',
      assigned_to_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      assigned_to_name TEXT,
      issue_summary TEXT NOT NULL,
      resolution_notes TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL DEFAULT 'system',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      resolved_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_trouble_tickets_created_at ON trouble_tickets(created_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS idx_trouble_tickets_customer_id ON trouble_tickets(customer_id);
    CREATE INDEX IF NOT EXISTS idx_trouble_tickets_odp_id ON trouble_tickets(odp_id);
    CREATE INDEX IF NOT EXISTS idx_trouble_tickets_status ON trouble_tickets(status);
  `);

  migrateCustomerTelemetryColumns();
  migrateTopologyColumns();
  migrateCustomerPortalColumns();
  migrateActivityLogsCustomerRoleOnce();

  const pkgCount = db.prepare('SELECT COUNT(*) as cnt FROM packages').get() as { cnt: number };
  if (pkgCount.cnt === 0) {
    seedInitialData();
  }

  seedDefaultCustomerPortalPins();

  const nodeCount = db.prepare('SELECT COUNT(*) as cnt FROM network_nodes').get() as { cnt: number };
  if (nodeCount.cnt === 0) {
    seedNetworkNodesAndTelemetry();
  }

  const waCount = db.prepare('SELECT COUNT(*) as cnt FROM whatsapp_messages').get() as { cnt: number };
  if (waCount.cnt === 0) {
    seedWhatsAppData();
  }

  const odpCount = db.prepare('SELECT COUNT(*) as cnt FROM network_odps').get() as { cnt: number };
  if (odpCount.cnt === 0) {
    seedTopologyMappingData();
  }

  const userCount = db.prepare('SELECT COUNT(*) as cnt FROM users').get() as { cnt: number };
  if (userCount.cnt === 0) {
    seedDefaultUsers();
  }

  const activityCount = db.prepare('SELECT COUNT(*) as cnt FROM activity_logs').get() as { cnt: number };
  if (activityCount.cnt === 0) {
    grantActivityLogsFeatureToExistingUsers();
    seedInitialActivityLogs();
  }

  migrateTeknisiBillingReadOnlyOnce();
  migrateTicketsFeatureOnce();
  seedInitialTroubleTickets();
  seedWhatsAppTemplates();
  seedBackupDefaultsAndInitialSnapshot();
}

export function formatWibFilenameTimestamp(date: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date);
  return `${parts.replace(' ', '_').replace(/:/g, '-')}-WIB`;
}

export function formatWibReadable(date: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date);
  return `${parts} WIB`;
}

export function computeNextBackupRunIso(
  frequency: BackupFrequency,
  backupHourWib: number,
  fromDate: Date = new Date()
): string | null {
  if (frequency === 'disabled') return null;
  const safeHour = Math.max(0, Math.min(23, Math.floor(backupHourWib)));
  const wibDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(fromDate);
  const candidate = new Date(`${wibDate}T${String(safeHour).padStart(2, '0')}:00:00+07:00`);
  if (Number.isNaN(candidate.getTime())) {
    const fallbackMs = frequency === 'weekly' ? 7 * 86_400_000 : 86_400_000;
    return new Date(fromDate.getTime() + fallbackMs).toISOString();
  }
  if (frequency === 'daily') {
    if (candidate.getTime() <= fromDate.getTime()) {
      candidate.setTime(candidate.getTime() + 86_400_000);
    }
    return candidate.toISOString();
  }
  // weekly
  while (candidate.getTime() <= fromDate.getTime()) {
    candidate.setTime(candidate.getTime() + 7 * 86_400_000);
  }
  return candidate.toISOString();
}

export function getBackupSettings(): BackupSettings {
  const row = db.prepare('SELECT * FROM backup_settings WHERE id = 1').get() as BackupSettings | undefined;
  if (row) return row;
  const now = new Date();
  const nextRun = computeNextBackupRunIso('daily', 2, now);
  db.prepare(`
    INSERT INTO backup_settings (
      id, schedule_frequency, retention_count, backup_hour_wib, last_run_at, next_run_at, updated_by, updated_at
    ) VALUES (1, 'daily', 7, 2, NULL, ?, 'system', ?)
  `).run(nextRun, now.toISOString());
  return db.prepare('SELECT * FROM backup_settings WHERE id = 1').get() as BackupSettings;
}

export function listBackupSnapshotMetas(): BackupSnapshotMeta[] {
  const rows = db.prepare(`
    SELECT id, filename, backup_type, triggered_by, total_records, counts_json, size_bytes, created_at
    FROM backup_snapshots
    ORDER BY created_at DESC, id DESC
  `).all() as Array<{
    id: number;
    filename: string;
    backup_type: 'manual' | 'scheduled';
    triggered_by: string;
    total_records: number;
    counts_json: string;
    size_bytes: number;
    created_at: string;
  }>;

  return rows.map((r) => {
    let counts: BackupSnapshotCounts = {
      customers: 0,
      packages: 0,
      invoices: 0,
      network_nodes: 0,
      network_odps: 0,
      whatsapp_templates: 0,
      activity_logs: 0,
    };
    try {
      counts = JSON.parse(r.counts_json) as BackupSnapshotCounts;
    } catch {
      // fallback zeros
    }
    return {
      id: r.id,
      filename: r.filename,
      backup_type: r.backup_type,
      triggered_by: r.triggered_by,
      total_records: r.total_records,
      counts,
      size_bytes: r.size_bytes,
      created_at: r.created_at,
    };
  });
}

function pruneOldBackupSnapshots(retentionCount: number): number {
  const keep = Math.max(1, Math.min(50, Math.floor(retentionCount)));
  const info = db.prepare(`
    DELETE FROM backup_snapshots
    WHERE id NOT IN (
      SELECT id FROM backup_snapshots
      ORDER BY created_at DESC, id DESC
      LIMIT ?
    )
  `).run(keep);
  return info.changes;
}

export function createBackupSnapshot(options: {
  backupType: 'manual' | 'scheduled';
  triggeredBy: string;
  userId?: number | null;
  username?: string;
  role?: UserRole;
  skipActivityLog?: boolean;
}): { meta: BackupSnapshotMeta; snapshot: Record<string, unknown>; pruned_count: number } {
  const now = new Date();
  const nowIso = now.toISOString();
  const wibStamp = formatWibFilenameTimestamp(now);
  const wibReadable = formatWibReadable(now);

  const packages = db.prepare('SELECT * FROM packages ORDER BY id ASC').all();
  const customersRaw = db.prepare('SELECT * FROM customers ORDER BY id ASC').all() as Array<Record<string, unknown>>;
  const customers = customersRaw.map(({ portal_pin_hash: _pinHash, ...safe }) => safe);
  const invoices = db.prepare('SELECT * FROM invoices ORDER BY id ASC').all();
  const networkNodes = db.prepare('SELECT * FROM network_nodes ORDER BY id ASC').all();
  const networkOdps = db.prepare('SELECT * FROM network_odps ORDER BY id ASC').all();
  const whatsappTemplates = db.prepare('SELECT * FROM whatsapp_templates ORDER BY id ASC').all();
  const activityLogs = db.prepare('SELECT * FROM activity_logs ORDER BY id DESC').all();
  const troubleTickets = db.prepare('SELECT * FROM trouble_tickets ORDER BY id DESC').all();

  const counts: BackupSnapshotCounts = {
    customers: customers.length,
    packages: packages.length,
    invoices: invoices.length,
    network_nodes: networkNodes.length,
    network_odps: networkOdps.length,
    whatsapp_templates: whatsappTemplates.length,
    activity_logs: activityLogs.length,
    trouble_tickets: troubleTickets.length,
  };

  const totalRecords =
    counts.customers +
    counts.packages +
    counts.invoices +
    counts.network_nodes +
    counts.network_odps +
    counts.whatsapp_templates +
    counts.activity_logs +
    (counts.trouble_tickets ?? 0);

  const baseName = `jatara-iphome-backup-${wibStamp}`;
  let filename = `${baseName}.json`;
  let suffix = 1;
  while (db.prepare('SELECT 1 FROM backup_snapshots WHERE filename = ?').get(filename)) {
    suffix += 1;
    filename = `${baseName}-${suffix}.json`;
  }

  const snapshotPayload = {
    metadata: {
      app: 'Jatara IP-Home Billing & NOC',
      version: '1.0',
      backup_type: options.backupType,
      triggered_by: options.triggeredBy,
      generated_at_iso: nowIso,
      generated_at_wib: wibReadable,
      filename,
      total_records: totalRecords,
      counts,
    },
    data: {
      customers,
      packages,
      invoices,
      network_nodes: networkNodes,
      network_odps: networkOdps,
      whatsapp_templates: whatsappTemplates,
      activity_logs: activityLogs,
      trouble_tickets: troubleTickets,
    },
  };

  const snapshotJson = JSON.stringify(snapshotPayload, null, 2);
  const sizeBytes = Buffer.byteLength(snapshotJson, 'utf8');

  const info = db.prepare(`
    INSERT INTO backup_snapshots (
      filename, backup_type, triggered_by, total_records, counts_json, size_bytes, snapshot_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    filename,
    options.backupType,
    options.triggeredBy,
    totalRecords,
    JSON.stringify(counts),
    sizeBytes,
    snapshotJson,
    nowIso
  );

  const settings = getBackupSettings();
  const prunedCount = pruneOldBackupSnapshots(settings.retention_count);

  const nextRun =
    settings.schedule_frequency === 'disabled'
      ? null
      : computeNextBackupRunIso(settings.schedule_frequency, settings.backup_hour_wib, now);

  db.prepare(`
    UPDATE backup_settings
    SET last_run_at = ?, next_run_at = COALESCE(?, next_run_at)
    WHERE id = 1
  `).run(nowIso, options.backupType === 'scheduled' ? nextRun : null);

  if (!options.skipActivityLog) {
    recordActivityLog({
      userId: options.userId ?? null,
      username: options.username ?? (options.backupType === 'scheduled' ? 'system_scheduler' : 'admin'),
      role: options.role ?? 'Admin',
      category: 'auth',
      action: options.backupType === 'scheduled' ? 'Backup Otomatis Terjadwal' : 'Buat Snapshot Backup Manual',
      targetLabel: filename,
      details: `Total ${totalRecords} catatan (${counts.customers} pelanggan, ${counts.invoices} tagihan, ${counts.network_nodes} node, ${counts.network_odps} ODP, ${counts.whatsapp_templates} template WA, ${counts.activity_logs} log)${prunedCount > 0 ? ` · ${prunedCount} arsip lama dibersihkan` : ''}`,
      createdAt: nowIso,
    });
  }

  return {
    meta: {
      id: Number(info.lastInsertRowid),
      filename,
      backup_type: options.backupType,
      triggered_by: options.triggeredBy,
      total_records: totalRecords,
      counts,
      size_bytes: sizeBytes,
      created_at: nowIso,
    },
    snapshot: snapshotPayload,
    pruned_count: prunedCount,
  };
}

export function runDueScheduledBackupIfNeeded(): boolean {
  try {
    const settings = getBackupSettings();
    if (settings.schedule_frequency === 'disabled' || !settings.next_run_at) {
      return false;
    }
    const nextTime = new Date(settings.next_run_at).getTime();
    if (Number.isNaN(nextTime) || Date.now() < nextTime) {
      return false;
    }
    createBackupSnapshot({
      backupType: 'scheduled',
      triggeredBy: `Jadwal ${settings.schedule_frequency === 'weekly' ? 'Mingguan' : 'Harian'}`,
      username: 'system',
      role: 'Admin',
    });
    return true;
  } catch (err) {
    console.error('Gagal menjalankan backup otomatis terjadwal:', err);
    return false;
  }
}

function seedBackupDefaultsAndInitialSnapshot(): void {
  const settings = getBackupSettings();
  const cntRow = db.prepare('SELECT COUNT(*) as cnt FROM backup_snapshots').get() as { cnt: number };
  if (cntRow.cnt === 0) {
    createBackupSnapshot({
      backupType: 'scheduled',
      triggeredBy: `Jadwal ${settings.schedule_frequency === 'weekly' ? 'Mingguan' : 'Harian'} (Baseline)`,
      username: 'admin',
      role: 'Admin',
      skipActivityLog: true,
    });
  }
}

export interface DefaultWhatsAppTemplateSpec {
  template_key: WhatsAppTemplateKey;
  title: string;
  description: string;
  default_body: string;
}

export const DEFAULT_WHATSAPP_TEMPLATES: DefaultWhatsAppTemplateSpec[] = [
  {
    template_key: 'reminder_pre_due',
    title: 'Pengingat Sebelum Jatuh Tempo',
    description: 'Dikirim sebelum tanggal jatuh tempo untuk mengingatkan rincian tagihan bulanan pelanggan dengan kebijakan 0% denda.',
    default_body: [
      'Yth. Bapak/Ibu *{nama}* ({kode_pelanggan}),',
      '',
      'Semoga layanan internet *Jatara IP-Home* selalu lancar mendukung aktivitas keluarga Anda. Kami menginformasikan rincian tagihan untuk periode *{periode}* yang akan segera jatuh tempo:',
      '• Paket Layanan: {paket}',
      '• Nominal Tagihan: *{tagihan}*',
      '• Tanggal Jatuh Tempo: *{jatuh_tempo}*',
      '• Kebijakan Denda: *Rp 0 (0% denda keterlambatan)*',
      '',
      'Pembayaran dapat dilakukan melalui Transfer BCA / BRI, QRIS, atau petugas kolektor resmi kami. Mohon kirimkan bukti transfer pada chat ini agar segera kami verifikasi.',
      '',
      'Terima kasih atas kepercayaan Anda bersama *Jatara IP-Home*.',
    ].join('\n'),
  },
  {
    template_key: 'due_overdue',
    title: 'Tagihan Jatuh Tempo / Tunggakan',
    description: 'Dikirim saat tagihan melewati tanggal jatuh tempo agar pelanggan segera melunasi tagihan tanpa biaya denda tambahan.',
    default_body: [
      'Yth. Bapak/Ibu *{nama}* ({kode_pelanggan}),',
      '',
      'Kami menginformasikan bahwa tagihan layanan internet *Jatara IP-Home* untuk periode *{periode}* telah memasuki masa jatuh tempo:',
      '• Paket Layanan: {paket}',
      '• Total Tagihan: *{tagihan}*',
      '• Jatuh Tempo: *{jatuh_tempo}*',
      '• Kebijakan Keterlambatan: *0% denda (Rp 0 biaya tambahan)*',
      '',
      'Sesuai komitmen pelayanan kami, tidak ada denda keterlambatan yang dikenakan. Mohon segera lakukan pembayaran dan kirimkan bukti transfer agar koneksi internet tetap berjalan lancar tanpa gangguan isolir sistem.',
      '',
      'Terima kasih atas perhatian dan kerja samanya.',
      '— Tim Billing *Jatara IP-Home*',
    ].join('\n'),
  },
  {
    template_key: 'isolation_notice',
    title: 'Pemberitahuan Isolir Layanan',
    description: 'Dikirim saat koneksi perangkat diisolir sementara akibat tunggakan, disertai informasi aktivasi otomatis setelah pelunasan.',
    default_body: [
      'Yth. Bapak/Ibu *{nama}* ({kode_pelanggan}),',
      '',
      'Dengan hormat kami informasikan bahwa layanan internet *Jatara IP-Home* untuk paket *{paket}* saat ini sedang berstatus *ISOLIR SEMENTARA* dikarenakan masih terdapat tagihan periode *{periode}* yang belum terselesaikan:',
      '• Kode Pelanggan: {kode_pelanggan}',
      '• Jatuh Tempo: {jatuh_tempo}',
      '• Total Tagihan: *{tagihan}*',
      '• Denda Keterlambatan: *Rp 0 (Kebijakan 0% denda)*',
      '',
      'Setelah pembayaran kami terima dan dicatat lunas (tanpa biaya denda maupun biaya buka isolir), koneksi perangkat Anda akan diaktifkan kembali secara otomatis oleh sistem NOC kami.',
      '',
      'Silakan balas pesan ini dengan bukti transfer atau hubungi tim *Jatara IP-Home* untuk bantuan lebih lanjut. Terima kasih.',
    ].join('\n'),
  },
];

function seedWhatsAppTemplates(): void {
  const nowIso = new Date().toISOString();
  const insertStmt = db.prepare(`
    INSERT OR IGNORE INTO whatsapp_templates (
      template_key, title, description, body_template, default_body, updated_by, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'system', ?)
  `);
  for (const tpl of DEFAULT_WHATSAPP_TEMPLATES) {
    insertStmt.run(
      tpl.template_key,
      tpl.title,
      tpl.description,
      tpl.default_body,
      tpl.default_body,
      nowIso
    );
  }
}

function migrateTeknisiBillingReadOnlyOnce(): void {
  const migrationKey = 'rbac_v2_teknisi_billing_readonly';
  const applied = db.prepare('SELECT value FROM app_meta WHERE key = ?').get(migrationKey) as { value: string } | undefined;
  if (applied) return;

  const techRows = db.prepare("SELECT id, allowed_features_json FROM users WHERE role = 'Teknisi'").all() as Array<{
    id: number;
    allowed_features_json: string;
  }>;
  const updateStmt = db.prepare('UPDATE users SET allowed_features_json = ? WHERE id = ?');
  for (const row of techRows) {
    try {
      const parsed = JSON.parse(row.allowed_features_json);
      if (Array.isArray(parsed) && !parsed.includes('billing')) {
        parsed.push('billing');
        updateStmt.run(JSON.stringify(parsed), row.id);
      }
    } catch {
      updateStmt.run(JSON.stringify(ROLE_DEFAULT_FEATURES.Teknisi), row.id);
    }
  }

  db.prepare('INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, ?)').run(
    migrationKey,
    new Date().toISOString()
  );
}

function migrateTicketsFeatureOnce(): void {
  const migrationKey = 'tickets_v1_grant_teknisi';
  const applied = db.prepare('SELECT value FROM app_meta WHERE key = ?').get(migrationKey) as { value: string } | undefined;
  if (applied) return;

  const techRows = db.prepare("SELECT id, allowed_features_json FROM users WHERE role = 'Teknisi'").all() as Array<{
    id: number;
    allowed_features_json: string;
  }>;
  const updateStmt = db.prepare('UPDATE users SET allowed_features_json = ? WHERE id = ?');
  for (const row of techRows) {
    try {
      const parsed = JSON.parse(row.allowed_features_json);
      if (Array.isArray(parsed) && !parsed.includes('tickets')) {
        parsed.push('tickets');
        updateStmt.run(JSON.stringify(parsed), row.id);
      }
    } catch {
      updateStmt.run(JSON.stringify(ROLE_DEFAULT_FEATURES.Teknisi), row.id);
    }
  }

  db.prepare('INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, ?)').run(
    migrationKey,
    new Date().toISOString()
  );
}

function seedInitialTroubleTickets(): void {
  const existing = db.prepare('SELECT COUNT(*) as cnt FROM trouble_tickets').get() as { cnt: number };
  if (existing.cnt > 0) return;

  const findCust = db.prepare('SELECT id, node_id, odp_id FROM customers WHERE customer_code = ? LIMIT 1');
  const techUser = db.prepare("SELECT id, full_name FROM users WHERE username = 'teknisi' LIMIT 1").get() as
    | { id: number; full_name: string }
    | undefined;
  const adminUser = db.prepare("SELECT id, full_name FROM users WHERE username = 'admin' LIMIT 1").get() as
    | { id: number; full_name: string }
    | undefined;

  const insertTicket = db.prepare(`
    INSERT INTO trouble_tickets (
      ticket_code, customer_id, node_id, odp_id, source, category, priority, status,
      assigned_to_user_id, assigned_to_name, issue_summary, resolution_notes,
      created_by, created_at, updated_at, resolved_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const c3 = findCust.get('PLG-003') as { id: number; node_id: number | null; odp_id: number | null } | undefined;
  const c9 = findCust.get('PLG-009') as { id: number; node_id: number | null; odp_id: number | null } | undefined;
  const c2 = findCust.get('PLG-002') as { id: number; node_id: number | null; odp_id: number | null } | undefined;
  const c4 = findCust.get('PLG-004') as { id: number; node_id: number | null; odp_id: number | null } | undefined;

  if (c3) {
    insertTicket.run(
      'TKT-202611-001',
      c3.id,
      c3.node_id,
      c3.odp_id,
      'Alarm NOC / Webhook',
      'LOS / Optik Putus',
      'Kritis',
      'Open',
      techUser?.id ?? null,
      techUser?.full_name ?? 'Teknisi Lapangan NOC',
      'Alarm OLT-ZTE-01 mendeteksi ONT-ZTE-003 status Offline (LOS -34.0 dBm). Pelanggan juga melaporkan lampu LOS merah berkedip setelah penebangan pohon di depan gang.',
      'Dijadwalkan pengecekan kabel dropcore tiang ODP-MLT-02 pukul 13.00 WIB.',
      '@admin',
      '2026-11-17T01:20:00.000Z',
      '2026-11-17T06:26:00.000Z',
      null
    );
  }

  if (c9) {
    insertTicket.run(
      'TKT-202611-002',
      c9.id,
      c9.node_id,
      c9.odp_id,
      'Alarm NOC / Webhook',
      'Perangkat Mati / Adaptor',
      'Tinggi',
      'In Progress',
      techUser?.id ?? null,
      techUser?.full_name ?? 'Teknisi Lapangan NOC',
      'MikroTik Netwatch melaporkan ONT-ZTE-009 ping timeout 5x berturut-turut pada EPON 0/2:1 (indikasi adaptor DC 12V atau listrik rumah pelanggan padam).',
      'Teknisi menuju lokasi Jl. Anggrek No. 09 membawa cadangan adaptor 12V 1.5A dan patchcord SC-UPC.',
      '@teknisi',
      '2026-11-16T22:15:00.000Z',
      '2026-11-17T02:00:00.000Z',
      null
    );
  }

  if (c2) {
    insertTicket.run(
      'TKT-202611-003',
      c2.id,
      c2.node_id,
      c2.odp_id,
      'Cek Lapangan',
      'Redaman / Optik Lemah',
      'Normal',
      'Resolved',
      techUser?.id ?? null,
      techUser?.full_name ?? 'Teknisi Lapangan NOC',
      'Redaman optik pada ODP-MLT-02 Port #1 sempat terukur -26.8 dBm dan koneksi pelanggan tersendat saat sore hari.',
      'Ganti pigtail/patchcord SC-APC di box ODP-MLT-02 dan bersihkan konektor roset pelanggan. Redaman kembali normal ke -19.2 dBm.',
      '@teknisi',
      '2026-11-12T04:10:00.000Z',
      '2026-11-12T07:35:00.000Z',
      '2026-11-12T07:35:00.000Z'
    );
  }

  if (c3) {
    insertTicket.run(
      'TKT-202610-001',
      c3.id,
      c3.node_id,
      c3.odp_id,
      'WA Pelanggan',
      'Redaman / Optik Lemah',
      'Tinggi',
      'Resolved',
      techUser?.id ?? null,
      techUser?.full_name ?? 'Teknisi Lapangan NOC',
      'Pelanggan mengeluhkan koneksi putus-nyambung dan video call patah-patah setelah hujan deras.',
      'Sambung ulang core dropcore di klem tiang gang 3 ODP-MLT-02 dan rapikan tekukan kabel indoor.',
      '@admin',
      '2026-10-22T09:15:00.000Z',
      '2026-10-22T12:40:00.000Z',
      '2026-10-22T12:40:00.000Z'
    );
  }

  if (c4) {
    insertTicket.run(
      'TKT-202611-004',
      c4.id,
      c4.node_id,
      c4.odp_id,
      'WA Pelanggan',
      'Koneksi Lambat / Latency',
      'Normal',
      'Resolved',
      adminUser?.id ?? techUser?.id ?? null,
      techUser?.full_name ?? 'Teknisi Lapangan NOC',
      'Pelanggan melaporkan router RTR-MK-004 sempat disconnect saat pemadaman listrik area Griya Indah Blok D.',
      'Cek adaptor UPS mini dan verifikasi PPPoE re-established normal (latency 6 ms).',
      '@teknisi',
      '2026-11-15T06:20:00.000Z',
      '2026-11-15T07:50:00.000Z',
      '2026-11-15T07:50:00.000Z'
    );
  }
}

export interface ActivityLogInput {
  userId?: number | null;
  username: string;
  role: ActorRole;
  category: ActivityLogCategory;
  action: string;
  targetLabel?: string;
  details?: string;
  createdAt?: string;
}

export function recordActivityLog(input: ActivityLogInput): void {
  try {
    db.prepare(`
      INSERT INTO activity_logs (
        user_id, username, role, category, action, target_label, details, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.userId ?? null,
      input.username,
      input.role,
      input.category,
      input.action,
      input.targetLabel ?? '',
      input.details ?? '',
      input.createdAt ?? new Date().toISOString()
    );
  } catch (err) {
    console.error('Gagal mencatat activity_logs:', err);
  }
}

function grantActivityLogsFeatureToExistingUsers(): void {
  const rows = db.prepare('SELECT id, role, allowed_features_json FROM users').all() as Array<{
    id: number;
    role: UserRole;
    allowed_features_json: string;
  }>;
  const updateStmt = db.prepare('UPDATE users SET allowed_features_json = ? WHERE id = ?');
  for (const row of rows) {
    try {
      const parsed = JSON.parse(row.allowed_features_json);
      if (Array.isArray(parsed) && !parsed.includes('activity_logs')) {
        parsed.push('activity_logs');
        updateStmt.run(JSON.stringify(parsed), row.id);
      }
    } catch {
      updateStmt.run(JSON.stringify(ROLE_DEFAULT_FEATURES[row.role]), row.id);
    }
  }
}

function seedInitialActivityLogs(): void {
  const findUser = db.prepare('SELECT id, username, role FROM users WHERE username = ? LIMIT 1');
  const adminUser = findUser.get('admin') as { id: number; username: string; role: UserRole } | undefined;
  const techUser = findUser.get('teknisi') as { id: number; username: string; role: UserRole } | undefined;
  const finUser = findUser.get('keuangan') as { id: number; username: string; role: UserRole } | undefined;

  const entries: ActivityLogInput[] = [
    {
      userId: finUser?.id ?? null,
      username: finUser?.username ?? 'keuangan',
      role: 'Keuangan',
      category: 'billing',
      action: 'Kirim Pengingat WA',
      targetLabel: 'INV-202611-006 (Hendra Kurniawan)',
      details: 'Mengirim pengingat tagihan November sebesar Rp 135.000 (0 denda) ke 6285643306606',
      createdAt: '2026-11-17T03:25:00.000Z',
    },
    {
      userId: techUser?.id ?? null,
      username: techUser?.username ?? 'teknisi',
      role: 'Teknisi',
      category: 'network',
      action: 'Sinkronisasi Node API',
      targetLabel: 'OLT-ZTE-01 (10.10.0.2)',
      details: 'Memeriksa 8 ONT pada GPON 0/1/1-0/1/4, terdeteksi 1 ONT LOS (-34.0 dBm)',
      createdAt: '2026-11-17T02:10:00.000Z',
    },
    {
      userId: adminUser?.id ?? null,
      username: adminUser?.username ?? 'admin',
      role: 'Admin',
      category: 'auth',
      action: 'Ubah Hak Akses & Akun',
      targetLabel: '@teknisi (Teknisi)',
      details: 'Menetapkan 6 fitur pilihan: Dasbor, Monitoring, Mapping Topologi, Chat WA, Pelanggan, Log Aktivitas',
      createdAt: '2026-11-17T01:40:00.000Z',
    },
    {
      userId: finUser?.id ?? null,
      username: finUser?.username ?? 'keuangan',
      role: 'Keuangan',
      category: 'billing',
      action: 'Catat Lunas',
      targetLabel: 'INV-202611-001 (Budi Santoso)',
      details: 'Pembayaran lunas sebesar Rp 185.000 via Transfer BCA (0 denda)',
      createdAt: '2026-11-16T08:15:00.000Z',
    },
    {
      userId: techUser?.id ?? null,
      username: techUser?.username ?? 'teknisi',
      role: 'Teknisi',
      category: 'network',
      action: 'Isolir Perangkat',
      targetLabel: 'ONT-FH-006 (Hendra Kurniawan)',
      details: 'Status diubah Online → Isolir. Alasan: Isolir sementara tunggakan 2 periode (Oktober & November)',
      createdAt: '2026-11-15T16:20:00.000Z',
    },
    {
      userId: adminUser?.id ?? null,
      username: adminUser?.username ?? 'admin',
      role: 'Admin',
      category: 'customer',
      action: 'Edit Pelanggan',
      targetLabel: 'PLG-007 · Nurul Hidayah',
      details: 'Penyesuaian harga khusus paket Keluarga Fiber 30 Mbps menjadi Rp 175.000/bulan',
      createdAt: '2026-11-15T10:05:00.000Z',
    },
    {
      userId: adminUser?.id ?? null,
      username: adminUser?.username ?? 'admin',
      role: 'Admin',
      category: 'auth',
      action: 'Login Sistem',
      targetLabel: '@admin (Administrator Utama)',
      details: 'Masuk ke panel Jatara IP-Home Billing & NOC dengan peran Admin',
      createdAt: '2026-11-15T07:30:00.000Z',
    },
  ];

  for (const item of entries) {
    recordActivityLog(item);
  }
}

function seedDefaultUsers(): void {
  const insertUser = db.prepare(`
    INSERT INTO users (username, password_hash, full_name, role, allowed_features_json, is_active)
    VALUES (?, ?, ?, ?, ?, 1)
  `);

  insertUser.run(
    'admin',
    hashPassword('admin123'),
    'Administrator Utama',
    'Admin',
    JSON.stringify(ROLE_DEFAULT_FEATURES.Admin)
  );
  insertUser.run(
    'teknisi',
    hashPassword('teknisi123'),
    'Teknisi Lapangan NOC',
    'Teknisi',
    JSON.stringify(ROLE_DEFAULT_FEATURES.Teknisi)
  );
  insertUser.run(
    'keuangan',
    hashPassword('keuangan123'),
    'Staf Bagian Keuangan',
    'Keuangan',
    JSON.stringify(ROLE_DEFAULT_FEATURES.Keuangan)
  );
}

function seedWhatsAppData(): void {
  db.prepare(`
    INSERT OR IGNORE INTO whatsapp_gateway_config (
      id, provider_name, api_url, api_token_masked, api_token_raw, sender_number, is_active, updated_at
    ) VALUES (1, 'WA Gateway (Fonnte / Wablas / WAHA)', '', '', '', '6281200004000', 0, '2026-11-18T01:00:00Z')
  `).run();

  const findCust = db.prepare('SELECT id FROM customers WHERE customer_code = ?');
  const insertMsg = db.prepare(`
    INSERT INTO whatsapp_messages (
      customer_id, direction, message, template_type, delivery_channel, delivery_status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const seedThreads: Array<[string, 'outbound' | 'inbound', string, string | null, string, string, string]> = [
    [
      'PLG-003',
      'outbound',
      'Halo Bapak Rudi Hermawan, tim NOC Empat Sekawan mendeteksi perangkat ONT-ZTE-003 berstatus Offline (LOS). Apakah lampu LOS di modem berkedip merah?',
      'Info Gangguan',
      'WhatsApp Web',
      'Terkirim',
      '2026-11-17T06:15:00Z',
    ],
    [
      'PLG-003',
      'inbound',
      'Iya mas, lampu LOS merah berkedip sejak subuh tadi. Tadi pagi ada pohon ditebang di depan gang.',
      null,
      'Webhook Masuk',
      'Diterima',
      '2026-11-17T06:22:00Z',
    ],
    [
      'PLG-003',
      'outbound',
      'Baik Pak Rudi, teknisi lapangan kami jadwalkan pengecekan kabel dropcore siang ini pukul 13.00 WIB. Terima kasih konfirmasinya.',
      'Tindak Lanjut Teknisi',
      'WhatsApp Web',
      'Terkirim',
      '2026-11-17T06:25:00Z',
    ],
    [
      'PLG-001',
      'outbound',
      'Terima kasih Bapak Budi Santoso, pembayaran tagihan November sebesar Rp 185.000 via Transfer BCA sudah kami catat Lunas.',
      'Konfirmasi Lunas',
      'WhatsApp Web',
      'Terkirim',
      '2026-11-05T14:22:00Z',
    ],
    [
      'PLG-001',
      'inbound',
      'Siap sama-sama mas, internet lancar terus.',
      null,
      'Webhook Masuk',
      'Diterima',
      '2026-11-05T14:25:00Z',
    ],
    [
      'PLG-006',
      'outbound',
      'Halo Bapak Hendra Kurniawan, berikut pengingat tagihan internet Empat Sekawan sebesar Rp 135.000 (tanpa denda keterlambatan). Mohon konfirmasi jika sudah melakukan transfer agar status isolir dapat dibuka otomatis.',
      'Pengingat Tagihan',
      'WhatsApp Web',
      'Terkirim',
      '2026-11-15T16:25:00Z',
    ],
  ];

  for (const [code, dir, msg, tpl, channel, status, ts] of seedThreads) {
    const row = findCust.get(code) as { id: number } | undefined;
    if (row) {
      insertMsg.run(row.id, dir, msg, tpl, channel, status, ts);
    }
  }
}

function migrateCustomerTelemetryColumns(): void {
  const cols = db.prepare('PRAGMA table_info(customers)').all() as Array<{ name: string }>;
  const existing = new Set(cols.map((c) => c.name));

  const additions: Array<[string, string]> = [
    ['node_id', 'INTEGER REFERENCES network_nodes(id)'],
    ['pon_port', 'TEXT'],
    ['rx_power_dbm', 'REAL'],
    ['pppoe_username', 'TEXT'],
    ['latency_ms', 'INTEGER'],
    ['uptime_session', 'TEXT'],
  ];

  for (const [col, def] of additions) {
    if (!existing.has(col)) {
      db.exec(`ALTER TABLE customers ADD COLUMN ${col} ${def}`);
    }
  }
}

function migrateTopologyColumns(): void {
  const nodeCols = db.prepare('PRAGMA table_info(network_nodes)').all() as Array<{ name: string }>;
  const existingNodeCols = new Set(nodeCols.map((c) => c.name));
  const nodeAdditions: Array<[string, string]> = [
    ['parent_node_id', 'INTEGER REFERENCES network_nodes(id)'],
    ['area_zone', "TEXT DEFAULT 'NOC Pusat'"],
    ['latitude', 'REAL'],
    ['longitude', 'REAL'],
    ['map_x', 'REAL DEFAULT 50'],
    ['map_y', 'REAL DEFAULT 16'],
  ];
  for (const [col, def] of nodeAdditions) {
    if (!existingNodeCols.has(col)) {
      db.exec(`ALTER TABLE network_nodes ADD COLUMN ${col} ${def}`);
    }
  }

  const custCols = db.prepare('PRAGMA table_info(customers)').all() as Array<{ name: string }>;
  const existingCustCols = new Set(custCols.map((c) => c.name));
  const custAdditions: Array<[string, string]> = [
    ['odp_id', 'INTEGER REFERENCES network_odps(id) ON DELETE SET NULL'],
    ['odp_port', 'INTEGER'],
    ['cable_length_m', 'INTEGER'],
    ['latitude', 'REAL'],
    ['longitude', 'REAL'],
    ['map_x', 'REAL DEFAULT 50'],
    ['map_y', 'REAL DEFAULT 75'],
  ];
  for (const [col, def] of custAdditions) {
    if (!existingCustCols.has(col)) {
      db.exec(`ALTER TABLE customers ADD COLUMN ${col} ${def}`);
    }
  }
}

export const DEFAULT_CUSTOMER_PORTAL_PIN = '123456';

function migrateCustomerPortalColumns(): void {
  const cols = db.prepare('PRAGMA table_info(customers)').all() as Array<{ name: string }>;
  const existing = new Set(cols.map((c) => c.name));

  const additions: Array<[string, string]> = [
    ['portal_pin_hash', 'TEXT'],
    ['portal_pin_display', 'TEXT'],
    ['portal_pin_updated_at', 'TEXT'],
    ['portal_last_login_at', 'TEXT'],
  ];

  for (const [col, def] of additions) {
    if (!existing.has(col)) {
      db.exec(`ALTER TABLE customers ADD COLUMN ${col} ${def}`);
    }
  }
}

function seedDefaultCustomerPortalPins(): void {
  const missing = db
    .prepare("SELECT id FROM customers WHERE portal_pin_hash IS NULL OR portal_pin_hash = ''")
    .all() as Array<{ id: number }>;
  if (missing.length === 0) return;

  const nowIso = new Date().toISOString();
  const updateStmt = db.prepare(`
    UPDATE customers
    SET portal_pin_hash = ?,
        portal_pin_display = COALESCE(portal_pin_display, ?),
        portal_pin_updated_at = COALESCE(portal_pin_updated_at, ?)
    WHERE id = ?
  `);

  const runTx = db.transaction(() => {
    for (const row of missing) {
      updateStmt.run(hashPassword(DEFAULT_CUSTOMER_PORTAL_PIN), DEFAULT_CUSTOMER_PORTAL_PIN, nowIso, row.id);
    }
  });
  runTx();
}

function migrateActivityLogsCustomerRoleOnce(): void {
  const migrationKey = 'activity_logs_v2_customer_role';
  const applied = db.prepare('SELECT value FROM app_meta WHERE key = ?').get(migrationKey) as { value: string } | undefined;
  const tableRow = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'activity_logs'")
    .get() as { sql: string } | undefined;

  if (tableRow && tableRow.sql.includes("'Pelanggan'")) {
    if (!applied) {
      db.prepare('INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, ?)').run(
        migrationKey,
        new Date().toISOString()
      );
    }
    return;
  }

  const migrateTx = db.transaction(() => {
    db.exec(`
      CREATE TABLE activity_logs_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        username TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('Admin', 'Teknisi', 'Keuangan', 'Pelanggan')),
        category TEXT NOT NULL CHECK(category IN ('billing', 'network', 'customer', 'auth')),
        action TEXT NOT NULL,
        target_label TEXT NOT NULL DEFAULT '',
        details TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      );

      INSERT INTO activity_logs_new (id, user_id, username, role, category, action, target_label, details, created_at)
      SELECT id, user_id, username, role, category, action, target_label, details, created_at FROM activity_logs;

      DROP TABLE activity_logs;
      ALTER TABLE activity_logs_new RENAME TO activity_logs;

      CREATE INDEX IF NOT EXISTS idx_activity_logs_created_at ON activity_logs(created_at DESC, id DESC);
      CREATE INDEX IF NOT EXISTS idx_activity_logs_category ON activity_logs(category);
    `);
  });
  migrateTx();

  db.prepare('INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, ?)').run(
    migrationKey,
    new Date().toISOString()
  );
}

function seedTopologyMappingData(): void {
  const findNode = db.prepare('SELECT id FROM network_nodes WHERE node_code = ?');
  const mkNode = findNode.get('MK-CORE-01') as { id: number } | undefined;
  const oltZte = findNode.get('OLT-ZTE-01') as { id: number } | undefined;
  const oltHsgq = findNode.get('OLT-HSGQ-02') as { id: number } | undefined;

  if (mkNode) {
    db.prepare(`
      UPDATE network_nodes
      SET parent_node_id = NULL, area_zone = 'NOC Pusat (POP Utama)', latitude = -7.42412, longitude = 109.23920, map_x = 50, map_y = 12
      WHERE id = ?
    `).run(mkNode.id);
  }
  if (oltZte) {
    db.prepare(`
      UPDATE network_nodes
      SET parent_node_id = ?, area_zone = 'POP Pusat & Barat', latitude = -7.42340, longitude = 109.23710, map_x = 34, map_y = 31
      WHERE id = ?
    `).run(mkNode?.id ?? null, oltZte.id);
  }
  if (oltHsgq) {
    db.prepare(`
      UPDATE network_nodes
      SET parent_node_id = ?, area_zone = 'POP Kenanga Timur', latitude = -7.42560, longitude = 109.24280, map_x = 74, map_y = 31
      WHERE id = ?
    `).run(mkNode?.id ?? null, oltHsgq.id);
  }

  const insertOdp = db.prepare(`
    INSERT INTO network_odps (
      odp_code, name, node_id, pon_port, splitter_ratio, capacity_ports, area_zone, latitude, longitude, map_x, map_y, notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const odpsSeed: Array<[string, string, number | null, string, string, number, string, number, number, number, number, string]> = [
    ['ODP-GA-01', 'ODP Perum Graha Asri Blok A-B', oltZte?.id ?? null, 'GPON 0/1/1', '1:8', 8, 'Perum Graha Asri', -7.42180, 109.23480, 19, 54, 'Tiang utama depan Blok B-01'],
    ['ODP-MLT-02', 'ODP Jl. Melati & Cempaka', oltZte?.id ?? null, 'GPON 0/1/2', '1:8', 8, 'Jl. Melati - Cempaka', -7.42390, 109.23610, 35, 56, 'Splitter distribusi jalur gang 3'],
    ['ODP-GI-03', 'ODP Perum Griya Indah & Kota', mkNode?.id ?? oltZte?.id ?? null, 'GPON 0/1/3', '1:8', 8, 'Perum Griya Indah', -7.42510, 109.23890, 52, 54, 'ODP tiang sudut Blok C-D & Sudirman'],
    ['ODP-KNG-04', 'ODP Cluster Kenanga Kavling', oltHsgq?.id ?? null, 'EPON 0/1', '1:8', 8, 'Cluster Kenanga', -7.42490, 109.24350, 72, 55, 'Box ODP dekat pos satpam Kenanga'],
    ['ODP-ANG-05', 'ODP Jl. Anggrek & Mawar', oltHsgq?.id ?? null, 'EPON 0/2', '1:8', 8, 'Jl. Anggrek - Mawar', -7.42680, 109.24510, 86, 56, 'Tiang PLN ujung Jl. Anggrek'],
  ];

  const odpIdByCode = new Map<string, number>();
  for (const row of odpsSeed) {
    const info = insertOdp.run(...row);
    odpIdByCode.set(row[0], Number(info.lastInsertRowid));
  }

  const ontMappings: Array<{
    code: string;
    odpCode: string;
    odpPort: number;
    cableM: number;
    lat: number;
    lng: number;
    mx: number;
    my: number;
  }> = [
    { code: 'PLG-001', odpCode: 'ODP-GA-01', odpPort: 1, cableM: 65, lat: -7.42120, lng: 109.23410, mx: 11, my: 76 },
    { code: 'PLG-002', odpCode: 'ODP-MLT-02', odpPort: 1, cableM: 85, lat: -7.42360, lng: 109.23540, mx: 29, my: 78 },
    { code: 'PLG-003', odpCode: 'ODP-MLT-02', odpPort: 3, cableM: 140, lat: -7.42440, lng: 109.23670, mx: 40, my: 84 },
    { code: 'PLG-004', odpCode: 'ODP-GI-03', odpPort: 1, cableM: 90, lat: -7.42560, lng: 109.23820, mx: 47, my: 77 },
    { code: 'PLG-005', odpCode: 'ODP-GI-03', odpPort: 2, cableM: 55, lat: -7.42480, lng: 109.23980, mx: 56, my: 74 },
    { code: 'PLG-006', odpCode: 'ODP-MLT-02', odpPort: 4, cableM: 110, lat: -7.42460, lng: 109.23580, mx: 33, my: 89 },
    { code: 'PLG-007', odpCode: 'ODP-GA-01', odpPort: 2, cableM: 48, lat: -7.42190, lng: 109.23510, mx: 21, my: 82 },
    { code: 'PLG-008', odpCode: 'ODP-KNG-04', odpPort: 2, cableM: 75, lat: -7.42470, lng: 109.24390, mx: 68, my: 79 },
    { code: 'PLG-009', odpCode: 'ODP-ANG-05', odpPort: 1, cableM: 125, lat: -7.42710, lng: 109.24560, mx: 83, my: 83 },
    { code: 'PLG-010', odpCode: 'ODP-GI-03', odpPort: 3, cableM: 105, lat: -7.42610, lng: 109.23930, mx: 54, my: 88 },
    { code: 'PLG-011', odpCode: 'ODP-KNG-04', odpPort: 4, cableM: 60, lat: -7.42430, lng: 109.24210, mx: 76, my: 76 },
    { code: 'PLG-012', odpCode: 'ODP-ANG-05', odpPort: 3, cableM: 160, lat: -7.42740, lng: 109.24480, mx: 91, my: 80 },
  ];

  const updateOnt = db.prepare(`
    UPDATE customers
    SET odp_id = ?, odp_port = ?, cable_length_m = ?, latitude = ?, longitude = ?, map_x = ?, map_y = ?
    WHERE customer_code = ? AND odp_id IS NULL
  `);

  for (const item of ontMappings) {
    const odpId = odpIdByCode.get(item.odpCode) ?? null;
    updateOnt.run(odpId, item.odpPort, item.cableM, item.lat, item.lng, item.mx, item.my, item.code);
  }
}

function seedNetworkNodesAndTelemetry(): void {
  const insertNode = db.prepare(`
    INSERT INTO network_nodes (
      node_code, name, node_type, vendor_model, host_ip, api_protocol, api_port,
      api_base_url, api_username, api_token_masked, poll_interval_sec, status,
      cpu_load_pct, memory_used_pct, temperature_c, rx_throughput_mbps, tx_throughput_mbps,
      active_sessions, uptime_text, last_sync_at, last_sync_message
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const nowIso = '2026-11-17T05:05:00Z';

  const mkCore = insertNode.run(
    'MK-CORE-01',
    'MikroTik CCR1036 Core Gateway',
    'MikroTik',
    'MikroTik CCR1036-8G-2S+',
    '103.145.22.1',
    'RouterOS REST API',
    443,
    'https://103.145.22.1/rest',
    'api_noc',
    '****98a2',
    30,
    'Online',
    24,
    38,
    46,
    412.6,
    128.4,
    9,
    '42d 11h 18m',
    nowIso,
    'Sinkronisasi /rest/ppp/active dan /rest/system/resource berhasil (9 sesi PPPoE aktif)'
  );

  const oltZte = insertNode.run(
    'OLT-ZTE-01',
    'OLT ZTE C320 Pusat',
    'OLT',
    'ZTE ZXA10 C320 GPON',
    '10.10.0.2',
    'OLT HTTP / SNMP API',
    8080,
    'http://10.10.0.2:8080/api/v1',
    'olt_monitor',
    '****44f1',
    60,
    'Online',
    19,
    44,
    43,
    295.2,
    92.1,
    8,
    '68d 04h 52m',
    nowIso,
    '8 ONT terdaftar pada GPON 0/1/1-0/1/4, 1 ONT terdeteksi LOS (-34.0 dBm)'
  );

  const oltHsgq = insertNode.run(
    'OLT-HSGQ-02',
    'OLT HSGQ-E08 Cluster Kenanga',
    'OLT',
    'HSGQ-E08 EPON 8-Port',
    '10.10.0.3',
    'OLT HTTP / SNMP API',
    8080,
    'http://10.10.0.3:8080/api/v1',
    'admin_api',
    '****71c9',
    60,
    'Degraded',
    31,
    52,
    49,
    117.4,
    36.3,
    4,
    '19d 21h 07m',
    nowIso,
    '1 ONT offline pada PON 0/2 (ONT-ZTE-009) - indikasi adaptor mati'
  );

  const mkId = Number(mkCore.lastInsertRowid);
  const zteId = Number(oltZte.lastInsertRowid);
  const hsgqId = Number(oltHsgq.lastInsertRowid);

  const custTelemetry: Array<{
    code: string;
    nodeId: number;
    ponPort: string;
    rxPower: number | null;
    pppoe: string;
    latency: number | null;
    uptime: string | null;
  }> = [
    { code: 'PLG-001', nodeId: zteId, ponPort: 'GPON 0/1/1:1', rxPower: -18.4, pppoe: 'budi@empatsekawan', latency: 4, uptime: '14d 08:22:10' },
    { code: 'PLG-002', nodeId: zteId, ponPort: 'GPON 0/1/1:2', rxPower: -19.2, pppoe: 'siti@empatsekawan', latency: 5, uptime: '9d 19:05:41' },
    { code: 'PLG-003', nodeId: zteId, ponPort: 'GPON 0/1/2:1', rxPower: -34.0, pppoe: 'rudi@empatsekawan', latency: null, uptime: '0m (LOS)' },
    { code: 'PLG-004', nodeId: mkId, ponPort: 'ether3-pppoe', rxPower: null, pppoe: 'dewi@empatsekawan', latency: 6, uptime: '1d 21:14:00' },
    { code: 'PLG-005', nodeId: mkId, ponPort: 'sfp-sfpplus1', rxPower: null, pppoe: 'kopisenja@empatsekawan', latency: 3, uptime: '2d 10:02:18' },
    { code: 'PLG-006', nodeId: zteId, ponPort: 'GPON 0/1/2:4', rxPower: -21.1, pppoe: 'hendra@empatsekawan', latency: 18, uptime: 'Isolir Profile' },
    { code: 'PLG-007', nodeId: zteId, ponPort: 'GPON 0/1/3:1', rxPower: -17.9, pppoe: 'nurul@empatsekawan', latency: 4, uptime: '22d 03:45:12' },
    { code: 'PLG-008', nodeId: hsgqId, ponPort: 'EPON 0/1:2', rxPower: -20.6, pppoe: 'fajar@empatsekawan', latency: 7, uptime: '11d 12:30:05' },
    { code: 'PLG-009', nodeId: hsgqId, ponPort: 'EPON 0/2:1', rxPower: -35.0, pppoe: 'tri@empatsekawan', latency: null, uptime: '0m (Power Off)' },
    { code: 'PLG-010', nodeId: zteId, ponPort: 'GPON 0/1/3:3', rxPower: -22.8, pppoe: 'wahyu@empatsekawan', latency: 6, uptime: '6d 15:40:29' },
    { code: 'PLG-011', nodeId: mkId, ponPort: 'ether4-dedicated', rxPower: null, pppoe: 'kliniksehat@empatsekawan', latency: 2, uptime: '38d 07:11:54' },
    { code: 'PLG-012', nodeId: hsgqId, ponPort: 'EPON 0/1:5', rxPower: -26.4, pppoe: 'eko@empatsekawan', latency: 9, uptime: '4d 02:19:44' },
  ];

  const updateCust = db.prepare(`
    UPDATE customers
    SET node_id = ?, pon_port = ?, rx_power_dbm = ?, pppoe_username = ?, latency_ms = ?, uptime_session = ?
    WHERE customer_code = ? AND node_id IS NULL
  `);

  for (const item of custTelemetry) {
    updateCust.run(
      item.nodeId,
      item.ponPort,
      item.rxPower,
      item.pppoe,
      item.latency,
      item.uptime,
      item.code
    );
  }
}

function seedInitialData(): void {
  const insertPkg = db.prepare(`
    INSERT INTO packages (name, speed_down_mbps, speed_up_mbps, monthly_price, description)
    VALUES (?, ?, ?, ?, ?)
  `);

  const packagesSeed = [
    ['Hemat Fiber 15 Mbps', 15, 5, 135000, 'Cocok untuk rumah tangga ringan, browsing, dan streaming HD 1-3 perangkat.'],
    ['Keluarga Fiber 30 Mbps', 30, 10, 185000, 'Kecepatan stabil untuk WFH, sekolah daring, dan Smart TV 4K.'],
    ['Bisnis Pro 50 Mbps', 50, 20, 275000, 'Prioritas trafik untuk UMKM, kasir online, dan kantor kecil.'],
    ['Dedicated 100 Mbps', 100, 50, 480000, 'Bandwidth penuh tanpa FUP untuk studio, kafe, dan perkantoran.'],
  ];

  const pkgIds: number[] = [];
  for (const p of packagesSeed) {
    const info = insertPkg.run(...p);
    pkgIds.push(Number(info.lastInsertRowid));
  }

  const insertCust = db.prepare(`
    INSERT INTO customers (
      customer_code, name, address, whatsapp, package_id, custom_price,
      device_id, device_ip, device_model, due_day, device_status, customer_active, last_seen_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const customersSeed = [
    ['PLG-001', 'Budi Santoso', 'Perum Graha Asri Blok B-12', '6281228901101', pkgIds[1], null, 'ONT-ZTE-001', '10.20.1.101', 'ZTE F609 v3', 5, 'Online', 1, '2026-11-17T04:48:00Z'],
    ['PLG-002', 'Siti Aminah', 'Jl. Melati No. 45, RT 02/04', '6281327002202', pkgIds[0], null, 'ONT-HW-002', '10.20.1.102', 'Huawei HG8245H5', 5, 'Online', 1, '2026-11-17T04:49:10Z'],
    ['PLG-003', 'Rudi Hermawan', 'Cluster Kenanga Kav. 08', '6285741103303', pkgIds[2], null, 'ONT-ZTE-003', '10.20.1.103', 'ZTE F670L', 10, 'Offline', 1, '2026-11-17T01:12:40Z'],
    ['PLG-004', 'Dewi Lestari', 'Perum Griya Indah Blok D-03', '6281904404404', pkgIds[1], null, 'RTR-MK-004', '10.20.1.104', 'MikroTik hAP ac2', 10, 'Online', 1, '2026-11-17T04:50:02Z'],
    ['PLG-005', 'Agus Wijaya (Kopi Senja)', 'Jl. Sudirman Ruko No. 14', '6281126005505', pkgIds[3], null, 'RTR-MK-005', '10.20.1.105', 'MikroTik RB750Gr3', 10, 'Online', 1, '2026-11-17T04:50:30Z'],
    ['PLG-006', 'Hendra Kurniawan', 'Jl. Cempaka Gang 3 No. 19', '6285643306606', pkgIds[0], null, 'ONT-FH-006', '10.20.1.106', 'FiberHome AN5506', 12, 'Isolir', 1, '2026-11-15T16:20:00Z'],
    ['PLG-007', 'Nurul Hidayah', 'Perum Graha Asri Blok A-07', '6282138807707', pkgIds[1], 175000, 'ONT-ZTE-007', '10.20.1.107', 'ZTE F609 v3', 15, 'Online', 1, '2026-11-17T04:47:15Z'],
    ['PLG-008', 'Fajar Pratama', 'Cluster Kenanga Kav. 19', '6287731108808', pkgIds[2], null, 'ONT-HW-008', '10.20.1.108', 'Huawei EG8141A5', 15, 'Online', 1, '2026-11-17T04:49:55Z'],
    ['PLG-009', 'Tri Wahyuni', 'Jl. Anggrek No. 09, RW 01', '6285225509909', pkgIds[0], null, 'ONT-ZTE-009', '10.20.1.109', 'ZTE F609 v3', 18, 'Offline', 1, '2026-11-16T22:05:11Z'],
    ['PLG-010', 'Wahyu Nugroho', 'Perum Griya Indah Blok C-11', '6281567710010', pkgIds[1], null, 'ONT-HW-010', '10.20.1.110', 'Huawei HG8245H5', 20, 'Online', 1, '2026-11-17T04:50:18Z'],
    ['PLG-011', 'Klinik Sehat Sentosa', 'Jl. Diponegoro No. 88', '6281229911011', pkgIds[3], null, 'RTR-MK-011', '10.20.1.111', 'MikroTik hAP ax2', 20, 'Online', 1, '2026-11-17T04:50:44Z'],
    ['PLG-012', 'Eko Prasetyo', 'Jl. Mawar No. 27', '6285876612012', pkgIds[0], null, 'ONT-FH-012', '10.20.1.112', 'FiberHome HG6145F', 25, 'Online', 1, '2026-11-17T04:46:30Z'],
  ];

  const custIds: number[] = [];
  for (const c of customersSeed) {
    const info = insertCust.run(...c);
    custIds.push(Number(info.lastInsertRowid));
  }

  const pkgPrices = [135000, 185000, 275000, 480000];
  const custPkgIdx = [1, 0, 2, 1, 3, 0, 1, 2, 0, 1, 3, 0];
  const custCustomPrice = [null, null, null, null, null, null, 175000, null, null, null, null, null];
  const custDueDay = [5, 5, 10, 10, 10, 12, 15, 15, 18, 20, 20, 25];

  const insertInv = db.prepare(`
    INSERT INTO invoices (
      invoice_number, customer_id, billing_period, amount, late_fee,
      due_date, status, payment_method, paid_at, wa_reminder_sent_at, notes
    ) VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)
  `);

  const periods = ['2026-09', '2026-10', '2026-11'];
  const methods = ['Transfer BCA', 'QRIS', 'Transfer BRI', 'Tunai', 'E-Wallet Dana'];

  for (const period of periods) {
    const ymCompact = period.replace('-', '');
    custIds.forEach((custId, idx) => {
      const amount = custCustomPrice[idx] ?? pkgPrices[custPkgIdx[idx]];
      const dueDayStr = String(custDueDay[idx]).padStart(2, '0');
      const dueDate = `${period}-${dueDayStr}`;
      const invNumber = `INV-${ymCompact}-${String(idx + 1).padStart(3, '0')}`;

      let status: 'Lunas' | 'Belum Lunas' = 'Lunas';
      let paymentMethod: string | null = methods[idx % methods.length];
      let paidAt: string | null = `${period}-${String(Math.min(custDueDay[idx], 28)).padStart(2, '0')}T10:15:00Z`;
      let waSentAt: string | null = null;
      let notes: string | null = 'Tagihan reguler bulanan tanpa denda';

      if (period === '2026-10' && idx === 5) {
        status = 'Belum Lunas';
        paymentMethod = null;
        paidAt = null;
        waSentAt = '2026-10-16T08:00:00Z';
        notes = 'Belum bayar bulan Oktober (status perangkat isolir sementara)';
      }

      if (period === '2026-11') {
        if ([2, 5, 6, 8, 11].includes(idx)) {
          status = 'Belum Lunas';
          paymentMethod = null;
          paidAt = null;
          waSentAt = idx === 5 || idx === 2 ? '2026-11-14T09:30:00Z' : null;
          notes = 'Menunggu pembayaran pelanggan (0 denda keterlambatan)';
        } else {
          paidAt = `2026-11-${String(Math.min(custDueDay[idx], 16)).padStart(2, '0')}T14:20:00Z`;
        }
      }

      insertInv.run(
        invNumber,
        custId,
        period,
        amount,
        dueDate,
        status,
        paymentMethod,
        paidAt,
        waSentAt,
        notes
      );
    });
  }

  const insertLog = db.prepare(`
    INSERT INTO device_logs (
      customer_id, device_id, previous_status, new_status, event_source, reason, latency_ms, logged_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const logsSeed = [
    [custIds[2], 'ONT-ZTE-003', 'Online', 'Offline', 'Webhook API', 'LOS (Loss of Signal) - Redaman optik putus / kabel dropcore terganggu', null, '2026-11-17T01:12:40Z'],
    [custIds[8], 'ONT-ZTE-009', 'Online', 'Offline', 'Webhook API', 'Ping timeout 5x berturut-turut dari MikroTik Netwatch (kemungkinan adaptor mati)', null, '2026-11-16T22:05:11Z'],
    [custIds[5], 'ONT-FH-006', 'Online', 'Isolir', 'Manual Operator', 'Isolir sementara karena tunggakan 2 periode (Oktober & November)', 18, '2026-11-15T16:20:00Z'],
    [custIds[3], 'RTR-MK-004', 'Offline', 'Online', 'Webhook API', 'Perangkat kembali terhubung setelah restart listrik rumah pelanggan', 6, '2026-11-15T07:45:12Z'],
    [custIds[3], 'RTR-MK-004', 'Online', 'Offline', 'Webhook API', 'Pemadaman listrik area Griya Indah Blok D', null, '2026-11-15T06:10:03Z'],
    [custIds[4], 'RTR-MK-005', 'Offline', 'Online', 'Webhook API', 'Link PPPOE re-established (latency normal)', 4, '2026-11-14T19:02:20Z'],
  ];

  for (const log of logsSeed) {
    insertLog.run(...log);
  }

  const insertWebhook = db.prepare(`
    INSERT INTO webhook_events (
      received_at, source_ip, endpoint, device_id, device_ip, reported_status, http_status, processed, message, payload_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const webhooksSeed = [
    [
      '2026-11-17T01:12:40Z',
      '103.145.22.10',
      '/api/webhook/device-status',
      'ONT-ZTE-003',
      '10.20.1.103',
      'Offline',
      200,
      1,
      'Status perangkat ONT-ZTE-003 diperbarui menjadi Offline dan dicatat ke log disconnect',
      JSON.stringify({ device_id: 'ONT-ZTE-003', device_ip: '10.20.1.103', status: 'Offline', reason: 'LOS (Loss of Signal)', source: 'OLT-ZTE-C320' }),
    ],
    [
      '2026-11-16T22:05:11Z',
      '103.145.22.10',
      '/api/webhook/device-status',
      'ONT-ZTE-009',
      '10.20.1.109',
      'Offline',
      200,
      1,
      'Status perangkat ONT-ZTE-009 diperbarui menjadi Offline via MikroTik Netwatch',
      JSON.stringify({ device_id: 'ONT-ZTE-009', device_ip: '10.20.1.109', status: 'Offline', reason: 'Ping timeout 5x berturut-turut', source: 'MikroTik-Core-01' }),
    ],
    [
      '2026-11-15T07:45:12Z',
      '103.145.22.10',
      '/api/webhook/device-status',
      'RTR-MK-004',
      '10.20.1.104',
      'Online',
      200,
      1,
      'Status perangkat RTR-MK-004 pulih kembali (Online, latency 6ms)',
      JSON.stringify({ device_id: 'RTR-MK-004', device_ip: '10.20.1.104', status: 'Online', latency_ms: 6, reason: 'Perangkat kembali terhubung', source: 'MikroTik-Core-01' }),
    ],
  ];

  for (const w of webhooksSeed) {
    insertWebhook.run(...w);
  }
}
