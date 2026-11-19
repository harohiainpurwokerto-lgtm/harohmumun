import * as XLSX from 'xlsx';
import type {
  ActivityLog,
  Customer,
  DeviceStatus,
  FinancialReportData,
  InternetPackage,
  Invoice,
  WhatsAppConversationSummary,
  WhatsAppTemplate,
  WhatsAppTemplateKey,
} from '../types';

export function formatRupiah(value: number): string {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(value);
}

const MONTH_NAMES_ID = [
  'Januari',
  'Februari',
  'Maret',
  'April',
  'Mei',
  'Juni',
  'Juli',
  'Agustus',
  'September',
  'Oktober',
  'November',
  'Desember',
];

export function formatPeriodLabel(period: string): string {
  const [year, month] = period.split('-').map(Number);
  if (!year || !month || month < 1 || month > 12) return period;
  return `${MONTH_NAMES_ID[month - 1]} ${year}`;
}

export function formatDateId(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  const parsed = new Date(dateStr.length === 10 ? `${dateStr}T00:00:00` : dateStr);
  if (Number.isNaN(parsed.getTime())) return dateStr;
  return new Intl.DateTimeFormat('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(parsed);
}

export function formatDateTimeId(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  const parsed = new Date(dateStr);
  if (Number.isNaN(parsed.getTime())) return dateStr;
  return new Intl.DateTimeFormat('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(parsed);
}

export function formatDateTimeWib(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  const parsed = new Date(dateStr);
  if (Number.isNaN(parsed.getTime())) return dateStr;
  const formatted = new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(parsed);
  return `${formatted} WIB`;
}

export function formatWibFilenameStamp(date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);

  const map: Record<string, string> = {};
  for (const p of parts) {
    if (p.type !== 'literal') map[p.type] = p.value;
  }
  return `${map.year}-${map.month}-${map.day}_${map.hour}-${map.minute}-${map.second}-WIB`;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(2)} MB`;
}

export function downloadBlobFile(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export interface WhatsAppTemplateVars {
  nama: string;
  kode_pelanggan: string;
  paket: string;
  tagihan: string;
  jatuh_tempo: string;
  periode: string;
}

export const WHATSAPP_TEMPLATE_VARIABLES: Array<{
  token: string;
  label: string;
  example: string;
}> = [
  { token: '{nama}', label: 'Nama Pelanggan', example: 'Hendra Kurniawan' },
  { token: '{kode_pelanggan}', label: 'Kode Pelanggan', example: 'PLG-006' },
  { token: '{paket}', label: 'Paket Internet', example: 'Hemat Fiber 15 Mbps' },
  { token: '{tagihan}', label: 'Nominal Tagihan', example: 'Rp 135.000' },
  { token: '{jatuh_tempo}', label: 'Tanggal Jatuh Tempo', example: '12 Nov 2026' },
  { token: '{periode}', label: 'Periode Tagihan', example: 'November 2026' },
];

export const SAMPLE_WHATSAPP_TEMPLATE_VARS: WhatsAppTemplateVars = {
  nama: 'Hendra Kurniawan',
  kode_pelanggan: 'PLG-006',
  paket: 'Hemat Fiber 15 Mbps',
  tagihan: formatRupiah(135000),
  jatuh_tempo: '12 Nov 2026',
  periode: 'November 2026',
};

export function renderWhatsAppTemplate(
  bodyTemplate: string,
  vars: WhatsAppTemplateVars
): string {
  return bodyTemplate
    .replace(/\{nama\}/gi, vars.nama)
    .replace(/\{kode_pelanggan\}/gi, vars.kode_pelanggan)
    .replace(/\{paket\}/gi, vars.paket)
    .replace(/\{tagihan\}/gi, vars.tagihan)
    .replace(/\{jatuh_tempo\}/gi, vars.jatuh_tempo)
    .replace(/\{periode\}/gi, vars.periode);
}

export function buildInvoiceTemplateVars(invoice: Invoice): WhatsAppTemplateVars {
  return {
    nama: invoice.customer_name || 'Pelanggan',
    kode_pelanggan: invoice.customer_code || `PLG-${String(invoice.customer_id).padStart(3, '0')}`,
    paket: invoice.package_name || 'Internet Bulanan',
    tagihan: formatRupiah(invoice.amount),
    jatuh_tempo: formatDateId(invoice.due_date),
    periode: formatPeriodLabel(invoice.billing_period),
  };
}

export function buildConversationTemplateVars(
  customer: WhatsAppConversationSummary
): WhatsAppTemplateVars {
  const amount =
    customer.unpaid_total > 0
      ? customer.unpaid_total
      : customer.latest_invoice_amount ?? customer.effective_price;
  const period = customer.latest_billing_period || '2026-11';
  const dueDate = customer.latest_due_date || `${period}-10`;

  return {
    nama: customer.name,
    kode_pelanggan: customer.customer_code,
    paket: customer.package_name || 'Internet Bulanan',
    tagihan: formatRupiah(amount),
    jatuh_tempo: formatDateId(dueDate),
    periode: formatPeriodLabel(period),
  };
}

export function getTodayWibIsoDate(): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

export function chooseInvoiceTemplateKey(invoice: Invoice): WhatsAppTemplateKey {
  if (invoice.device_status === 'Isolir') {
    return 'isolation_notice';
  }
  const todayWib = getTodayWibIsoDate();
  if (invoice.due_date && invoice.due_date < todayWib) {
    return 'due_overdue';
  }
  return 'reminder_pre_due';
}

export function buildWhatsAppReminderText(
  invoice: Invoice,
  templates?: WhatsAppTemplate[],
  forcedKey?: WhatsAppTemplateKey
): string {
  const key = forcedKey ?? chooseInvoiceTemplateKey(invoice);
  const vars = buildInvoiceTemplateVars(invoice);
  const matched = templates?.find((t) => t.template_key === key);

  if (matched) {
    return renderWhatsAppTemplate(matched.body_template, vars);
  }

  if (key === 'isolation_notice') {
    return [
      `Yth. Bapak/Ibu *${vars.nama}* (${vars.kode_pelanggan}),`,
      ``,
      `Dengan hormat kami informasikan bahwa layanan internet *Jatara IP-Home* untuk paket *${vars.paket}* saat ini sedang berstatus *ISOLIR SEMENTARA* dikarenakan masih terdapat tagihan periode *${vars.periode}* yang belum terselesaikan:`,
      `• Kode Pelanggan: ${vars.kode_pelanggan}`,
      `• Jatuh Tempo: ${vars.jatuh_tempo}`,
      `• Total Tagihan: *${vars.tagihan}*`,
      `• Denda Keterlambatan: *Rp 0 (Kebijakan 0% denda)*`,
      ``,
      `Setelah pembayaran kami terima dan dicatat lunas (tanpa biaya denda maupun biaya buka isolir), koneksi perangkat Anda akan diaktifkan kembali secara otomatis oleh sistem NOC kami.`,
      ``,
      `Silakan balas pesan ini dengan bukti transfer atau hubungi tim *Jatara IP-Home* untuk bantuan lebih lanjut. Terima kasih.`,
    ].join('\n');
  }

  if (key === 'due_overdue') {
    return [
      `Yth. Bapak/Ibu *${vars.nama}* (${vars.kode_pelanggan}),`,
      ``,
      `Kami menginformasikan bahwa tagihan layanan internet *Jatara IP-Home* untuk periode *${vars.periode}* telah memasuki masa jatuh tempo:`,
      `• Paket Layanan: ${vars.paket}`,
      `• Total Tagihan: *${vars.tagihan}*`,
      `• Jatuh Tempo: *${vars.jatuh_tempo}*`,
      `• Kebijakan Keterlambatan: *0% denda (Rp 0 biaya tambahan)*`,
      ``,
      `Sesuai komitmen pelayanan kami, tidak ada denda keterlambatan yang dikenakan. Mohon segera lakukan pembayaran dan kirimkan bukti transfer agar koneksi internet tetap berjalan lancar tanpa gangguan isolir sistem.`,
      ``,
      `Terima kasih atas perhatian dan kerja samanya.`,
      `— Tim Billing *Jatara IP-Home*`,
    ].join('\n');
  }

  return [
    `Yth. Bapak/Ibu *${vars.nama}* (${vars.kode_pelanggan}),`,
    ``,
    `Semoga layanan internet *Jatara IP-Home* selalu lancar mendukung aktivitas keluarga Anda. Kami menginformasikan rincian tagihan untuk periode *${vars.periode}* yang akan segera jatuh tempo:`,
    `• Paket Layanan: ${vars.paket}`,
    `• Nominal Tagihan: *${vars.tagihan}*`,
    `• Tanggal Jatuh Tempo: *${vars.jatuh_tempo}*`,
    `• Kebijakan Denda: *Rp 0 (0% denda keterlambatan)*`,
    ``,
    `Pembayaran dapat dilakukan melalui Transfer BCA / BRI, QRIS, atau petugas kolektor resmi kami. Mohon kirimkan bukti transfer pada chat ini agar segera kami verifikasi.`,
    ``,
    `Terima kasih atas kepercayaan Anda bersama *Jatara IP-Home*.`,
  ].join('\n');
}

export function buildWhatsAppUrl(whatsapp: string, message: string): string {
  const digits = whatsapp.replace(/\D/g, '');
  const normalized = digits.startsWith('0') ? `62${digits.slice(1)}` : digits.startsWith('62') ? digits : `62${digits}`;
  return `https://wa.me/${normalized}?text=${encodeURIComponent(message)}`;
}

export function exportReportToExcel(report: FinancialReportData): void {
  const wb = XLSX.utils.book_new();

  const summaryRows = [
    ['LAPORAN KEUANGAN JATARA IP-HOME BILLING & NOC'],
    ['Periode Laporan', formatPeriodLabel(report.period)],
    ['Kebijakan Denda', 'Tanpa Denda Keterlambatan (Rp 0)'],
    [],
    ['RINGKASAN KEUANGAN', 'Nilai'],
    ['Total Tagihan Periode Ini', report.summary.total_billed],
    ['Total Pemasukan (Lunas)', report.summary.total_paid],
    ['Total Tunggakan Periode Ini', report.summary.total_unpaid_period],
    ['Total Tunggakan Akumulatif (Semua Periode)', report.summary.total_unpaid_all_time],
    ['Jumlah Invoice Lunas', report.summary.paid_count],
    ['Jumlah Invoice Belum Lunas (Periode Ini)', report.summary.unpaid_period_count],
    ['Rasio Penagihan (%)', `${report.summary.collection_rate_pct}%`],
    [],
    ['REKAP PER METODE PEMBAYARAN', 'Jumlah Transaksi', 'Total Nominal'],
    ...report.by_payment_method.map((m) => [m.payment_method, m.count, m.total_amount]),
  ];
  const wsSummary = XLSX.utils.aoa_to_sheet(summaryRows);
  wsSummary['!cols'] = [{ wch: 42 }, { wch: 24 }, { wch: 22 }];
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Ringkasan');

  const paidRows = report.paid_invoices.map((inv, idx) => ({
    No: idx + 1,
    'No. Invoice': inv.invoice_number,
    'Kode Pelanggan': inv.customer_code ?? '',
    'Nama Pelanggan': inv.customer_name ?? '',
    Paket: inv.package_name ?? '',
    Periode: inv.billing_period,
    'Jatuh Tempo': inv.due_date,
    'Nominal (Rp)': inv.amount,
    'Denda (Rp)': 0,
    Status: inv.status,
    'Metode Bayar': inv.payment_method ?? '',
    'Tanggal Lunas': inv.paid_at ? formatDateTimeId(inv.paid_at) : '',
  }));
  const wsPaid = XLSX.utils.json_to_sheet(
    paidRows.length > 0
      ? paidRows
      : [{ Keterangan: `Belum ada transaksi lunas untuk periode ${report.period}` }]
  );
  wsPaid['!cols'] = [
    { wch: 5 },
    { wch: 18 },
    { wch: 14 },
    { wch: 26 },
    { wch: 22 },
    { wch: 10 },
    { wch: 14 },
    { wch: 15 },
    { wch: 12 },
    { wch: 12 },
    { wch: 16 },
    { wch: 20 },
  ];
  XLSX.utils.book_append_sheet(wb, wsPaid, 'Pemasukan Lunas');

  const unpaidRows = report.unpaid_invoices.map((inv, idx) => ({
    No: idx + 1,
    'No. Invoice': inv.invoice_number,
    'Kode Pelanggan': inv.customer_code ?? '',
    'Nama Pelanggan': inv.customer_name ?? '',
    WhatsApp: inv.customer_whatsapp ?? '',
    Alamat: inv.customer_address ?? '',
    Paket: inv.package_name ?? '',
    Periode: inv.billing_period,
    'Jatuh Tempo': inv.due_date,
    'Nominal Tunggakan (Rp)': inv.amount,
    'Denda (Rp)': 0,
    'Status Perangkat': inv.device_status ?? '',
  }));
  const wsUnpaid = XLSX.utils.json_to_sheet(
    unpaidRows.length > 0 ? unpaidRows : [{ Keterangan: 'Tidak ada tunggakan aktif.' }]
  );
  wsUnpaid['!cols'] = [
    { wch: 5 },
    { wch: 18 },
    { wch: 14 },
    { wch: 26 },
    { wch: 16 },
    { wch: 30 },
    { wch: 22 },
    { wch: 10 },
    { wch: 14 },
    { wch: 20 },
    { wch: 12 },
    { wch: 16 },
  ];
  XLSX.utils.book_append_sheet(wb, wsUnpaid, 'Daftar Tunggakan');

  XLSX.writeFile(wb, `Laporan_Keuangan_Jatara_IPHome_${report.period}_${formatWibFilenameStamp()}.xlsx`);
}

function escapeCsvCell(val: string | number): string {
  const str = String(val ?? '');
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function exportReportToCsv(report: FinancialReportData): void {
  const headers = [
    'Kategori',
    'No. Invoice',
    'Kode Pelanggan',
    'Nama Pelanggan',
    'WhatsApp',
    'Paket',
    'Periode',
    'Jatuh Tempo',
    'Nominal (Rp)',
    'Denda (Rp)',
    'Status',
    'Metode Bayar',
    'Tanggal Bayar',
  ];

  const allRows = [
    ...report.paid_invoices.map((inv) => [
      'Pemasukan Lunas',
      inv.invoice_number,
      inv.customer_code ?? '',
      inv.customer_name ?? '',
      inv.customer_whatsapp ?? '',
      inv.package_name ?? '',
      inv.billing_period,
      inv.due_date,
      inv.amount,
      0,
      inv.status,
      inv.payment_method ?? '',
      inv.paid_at ? formatDateTimeId(inv.paid_at) : '',
    ]),
    ...report.unpaid_invoices.map((inv) => [
      'Tunggakan',
      inv.invoice_number,
      inv.customer_code ?? '',
      inv.customer_name ?? '',
      inv.customer_whatsapp ?? '',
      inv.package_name ?? '',
      inv.billing_period,
      inv.due_date,
      inv.amount,
      0,
      inv.status,
      '-',
      '-',
    ]),
  ];

  const csvLines = [headers.map(escapeCsvCell).join(','), ...allRows.map((row) => row.map(escapeCsvCell).join(','))];
  const csvContent = `\uFEFF${csvLines.join('\r\n')}`;
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  downloadBlobFile(blob, `Laporan_Keuangan_Jatara_IPHome_${report.period}_${formatWibFilenameStamp()}.csv`);
}

export function exportCustomersToExcel(customers: Customer[], packages: InternetPackage[]): void {
  const wb = XLSX.utils.book_new();

  const custRows = customers.map((c) => ({
    'Kode Pelanggan': c.customer_code,
    'Nama Lengkap': c.name,
    Alamat: c.address,
    'Nomor WhatsApp': c.whatsapp,
    'Nama Paket': c.package_name ?? '',
    'Harga Khusus (Rp)': c.custom_price ?? '',
    'Harga Efektif (Rp)': c.effective_price,
    'ID Perangkat': c.device_id,
    'IP Perangkat': c.device_ip,
    'Model Perangkat': c.device_model,
    'Tgl Jatuh Tempo': c.due_day,
    'Status Perangkat': c.device_status,
    'Status Aktif': c.customer_active === 1 ? 'Aktif' : 'Nonaktif',
    'PPPoE Username': c.pppoe_username ?? '',
    'Port PON': c.pon_port ?? '',
  }));

  const wsCustomers = XLSX.utils.json_to_sheet(
    custRows.length > 0 ? custRows : [{ Keterangan: 'Belum ada data pelanggan.' }]
  );
  wsCustomers['!cols'] = [
    { wch: 15 },
    { wch: 24 },
    { wch: 30 },
    { wch: 16 },
    { wch: 22 },
    { wch: 16 },
    { wch: 16 },
    { wch: 16 },
    { wch: 15 },
    { wch: 18 },
    { wch: 15 },
    { wch: 16 },
    { wch: 12 },
    { wch: 22 },
    { wch: 16 },
  ];
  XLSX.utils.book_append_sheet(wb, wsCustomers, 'Data Pelanggan');

  const pkgRows = packages.map((p) => ({
    'ID Paket': p.id,
    'Nama Paket': p.name,
    'Download (Mbps)': p.speed_down_mbps,
    'Upload (Mbps)': p.speed_up_mbps,
    'Harga Bulanan (Rp)': p.monthly_price,
  }));
  const wsPackages = XLSX.utils.json_to_sheet(pkgRows);
  wsPackages['!cols'] = [{ wch: 10 }, { wch: 24 }, { wch: 16 }, { wch: 14 }, { wch: 18 }];
  XLSX.utils.book_append_sheet(wb, wsPackages, 'Referensi Paket');

  XLSX.writeFile(wb, `Data_Pelanggan_Jatara_IPHome_${formatWibFilenameStamp()}.xlsx`);
}

export function exportCustomersToCsv(customers: Customer[]): void {
  const headers = [
    'Kode Pelanggan',
    'Nama Lengkap',
    'Alamat',
    'Nomor WhatsApp',
    'Nama Paket',
    'Harga Khusus (Rp)',
    'Harga Efektif (Rp)',
    'ID Perangkat',
    'IP Perangkat',
    'Model Perangkat',
    'Tgl Jatuh Tempo',
    'Status Perangkat',
    'Status Aktif',
    'PPPoE Username',
    'Port PON',
  ];

  const rows = customers.map((c) => [
    c.customer_code,
    c.name,
    c.address,
    c.whatsapp,
    c.package_name ?? '',
    c.custom_price ?? '',
    c.effective_price,
    c.device_id,
    c.device_ip,
    c.device_model,
    c.due_day,
    c.device_status,
    c.customer_active === 1 ? 'Aktif' : 'Nonaktif',
    c.pppoe_username ?? '',
    c.pon_port ?? '',
  ]);

  const csvLines = [
    headers.map(escapeCsvCell).join(','),
    ...rows.map((r) => r.map(escapeCsvCell).join(',')),
  ];
  const blob = new Blob([`\uFEFF${csvLines.join('\r\n')}`], { type: 'text/csv;charset=utf-8;' });
  downloadBlobFile(blob, `Data_Pelanggan_Jatara_IPHome_${formatWibFilenameStamp()}.csv`);
}

export function exportInvoicesToExcel(invoices: Invoice[], periodLabel: string): void {
  const wb = XLSX.utils.book_new();

  const rows = invoices.map((inv, idx) => ({
    No: idx + 1,
    'No. Invoice': inv.invoice_number,
    'Kode Pelanggan': inv.customer_code ?? '',
    'Nama Pelanggan': inv.customer_name ?? '',
    WhatsApp: inv.customer_whatsapp ?? '',
    Paket: inv.package_name ?? '',
    Periode: inv.billing_period,
    'Jatuh Tempo': inv.due_date,
    'Nominal (Rp)': inv.amount,
    'Denda (Rp)': inv.late_fee ?? 0,
    Status: inv.status,
    'Metode Bayar': inv.payment_method ?? '',
    'Waktu Lunas (WIB)': inv.paid_at ? formatDateTimeWib(inv.paid_at) : '',
    'Pengingat WA': inv.wa_reminder_sent_at ? formatDateTimeWib(inv.wa_reminder_sent_at) : '',
    Catatan: inv.notes ?? '',
  }));

  const ws = XLSX.utils.json_to_sheet(
    rows.length > 0 ? rows : [{ Keterangan: `Belum ada tagihan untuk filter ${periodLabel}.` }]
  );
  ws['!cols'] = [
    { wch: 5 },
    { wch: 18 },
    { wch: 14 },
    { wch: 24 },
    { wch: 15 },
    { wch: 22 },
    { wch: 10 },
    { wch: 13 },
    { wch: 15 },
    { wch: 11 },
    { wch: 13 },
    { wch: 16 },
    { wch: 24 },
    { wch: 24 },
    { wch: 30 },
  ];
  XLSX.utils.book_append_sheet(wb, ws, 'Tagihan & Pembayaran');

  const safeSlug = periodLabel.replace(/[^a-zA-Z0-9_-]+/g, '_');
  XLSX.writeFile(wb, `Tagihan_Pembayaran_Jatara_IPHome_${safeSlug}_${formatWibFilenameStamp()}.xlsx`);
}

export function exportInvoicesToCsv(invoices: Invoice[], periodLabel: string): void {
  const headers = [
    'No. Invoice',
    'Kode Pelanggan',
    'Nama Pelanggan',
    'WhatsApp',
    'Paket',
    'Periode',
    'Jatuh Tempo',
    'Nominal (Rp)',
    'Denda (Rp)',
    'Status',
    'Metode Bayar',
    'Waktu Lunas (WIB)',
    'Pengingat WA',
    'Catatan',
  ];

  const rows = invoices.map((inv) => [
    inv.invoice_number,
    inv.customer_code ?? '',
    inv.customer_name ?? '',
    inv.customer_whatsapp ?? '',
    inv.package_name ?? '',
    inv.billing_period,
    inv.due_date,
    inv.amount,
    inv.late_fee ?? 0,
    inv.status,
    inv.payment_method ?? '',
    inv.paid_at ? formatDateTimeWib(inv.paid_at) : '',
    inv.wa_reminder_sent_at ? formatDateTimeWib(inv.wa_reminder_sent_at) : '',
    inv.notes ?? '',
  ]);

  const csvLines = [
    headers.map(escapeCsvCell).join(','),
    ...rows.map((r) => r.map(escapeCsvCell).join(',')),
  ];
  const safeSlug = periodLabel.replace(/[^a-zA-Z0-9_-]+/g, '_');
  const blob = new Blob([`\uFEFF${csvLines.join('\r\n')}`], { type: 'text/csv;charset=utf-8;' });
  downloadBlobFile(blob, `Tagihan_Pembayaran_Jatara_IPHome_${safeSlug}_${formatWibFilenameStamp()}.csv`);
}

export function exportActivityLogsToExcel(logs: ActivityLog[], scopeLabel = 'Semua'): void {
  const wb = XLSX.utils.book_new();
  const rows = logs.map((log, idx) => ({
    No: idx + 1,
    'Waktu (WIB)': formatDateTimeWib(log.created_at),
    Operator: `@${log.username}`,
    Peran: log.role,
    Kategori: log.category,
    Aksi: log.action,
    Target: log.target_label,
    'Detail Aktivitas': log.details,
  }));

  const ws = XLSX.utils.json_to_sheet(
    rows.length > 0 ? rows : [{ Keterangan: `Tidak ada catatan log untuk filter ${scopeLabel}.` }]
  );
  ws['!cols'] = [
    { wch: 5 },
    { wch: 24 },
    { wch: 16 },
    { wch: 12 },
    { wch: 12 },
    { wch: 26 },
    { wch: 28 },
    { wch: 52 },
  ];
  XLSX.utils.book_append_sheet(wb, ws, 'Log Aktivitas');
  XLSX.writeFile(wb, `Log_Aktivitas_Jatara_IPHome_${formatWibFilenameStamp()}.xlsx`);
}

export function exportActivityLogsToCsv(logs: ActivityLog[]): void {
  const headers = [
    'ID',
    'Waktu (WIB)',
    'Operator',
    'Peran',
    'Kategori',
    'Aksi',
    'Target',
    'Detail Aktivitas',
  ];

  const rows = logs.map((log) => [
    log.id,
    formatDateTimeWib(log.created_at),
    `@${log.username}`,
    log.role,
    log.category,
    log.action,
    log.target_label,
    log.details,
  ]);

  const csvLines = [
    headers.map(escapeCsvCell).join(','),
    ...rows.map((r) => r.map(escapeCsvCell).join(',')),
  ];
  const blob = new Blob([`\uFEFF${csvLines.join('\r\n')}`], { type: 'text/csv;charset=utf-8;' });
  downloadBlobFile(blob, `Log_Aktivitas_Jatara_IPHome_${formatWibFilenameStamp()}.csv`);
}

export function downloadCustomerTemplateExcel(packages: InternetPackage[]): void {
  const wb = XLSX.utils.book_new();
  const samplePkg1 = packages[0]?.name ?? 'Hemat Fiber 15 Mbps';
  const samplePkg2 = packages[1]?.name ?? samplePkg1;

  const templateRows = [
    {
      'Kode Pelanggan': '',
      'Nama Lengkap': 'Andi Saputra',
      Alamat: 'Perum Graha Asri Blok E-04',
      'Nomor WhatsApp': '081234567801',
      'Nama Paket': samplePkg1,
      'Harga Khusus (Rp)': '',
      'ID Perangkat': 'ONT-ZTE-099',
      'IP Perangkat': '10.20.1.199',
      'Model Perangkat': 'ZTE F609 v3',
      'Tgl Jatuh Tempo': 10,
      'Status Perangkat': 'Online',
      'Status Aktif': 'Aktif',
      'PPPoE Username': 'andi@empatsekawan',
      'Port PON': 'GPON 0/1/4:1',
    },
    {
      'Kode Pelanggan': '',
      'Nama Lengkap': 'Rina Kartika',
      Alamat: 'Jl. Melati No. 88',
      'Nomor WhatsApp': '6285712345602',
      'Nama Paket': samplePkg2,
      'Harga Khusus (Rp)': 175000,
      'ID Perangkat': 'ONT-HW-100',
      'IP Perangkat': '10.20.1.200',
      'Model Perangkat': 'Huawei HG8245H5',
      'Tgl Jatuh Tempo': 15,
      'Status Perangkat': 'Online',
      'Status Aktif': 'Aktif',
      'PPPoE Username': 'rina@empatsekawan',
      'Port PON': 'GPON 0/1/4:2',
    },
  ];

  const wsTemplate = XLSX.utils.json_to_sheet(templateRows);
  wsTemplate['!cols'] = [
    { wch: 15 },
    { wch: 24 },
    { wch: 30 },
    { wch: 16 },
    { wch: 22 },
    { wch: 16 },
    { wch: 16 },
    { wch: 15 },
    { wch: 18 },
    { wch: 15 },
    { wch: 16 },
    { wch: 12 },
    { wch: 22 },
    { wch: 16 },
  ];
  XLSX.utils.book_append_sheet(wb, wsTemplate, 'Template Pelanggan');

  const pkgRows = packages.map((p) => ({
    'ID Paket': p.id,
    'Nama Paket': p.name,
    'Harga Bulanan (Rp)': p.monthly_price,
  }));
  const wsPackages = XLSX.utils.json_to_sheet(pkgRows);
  wsPackages['!cols'] = [{ wch: 10 }, { wch: 26 }, { wch: 18 }];
  XLSX.utils.book_append_sheet(wb, wsPackages, 'Referensi Paket');

  XLSX.writeFile(wb, 'Template_Import_Pelanggan_Jatara_IPHome.xlsx');
}

export interface ParsedCustomerImportRow {
  customer_code: string;
  name: string;
  address: string;
  whatsapp: string;
  package_name: string;
  custom_price: string;
  device_id: string;
  device_ip: string;
  device_model: string;
  due_day: number;
  device_status: DeviceStatus;
  customer_active: string;
  pppoe_username: string;
  pon_port: string;
  valid: boolean;
}

function pickField(normalizedMap: Record<string, unknown>, candidates: string[]): string {
  for (const key of candidates) {
    const val = normalizedMap[key];
    if (val !== undefined && val !== null && String(val).trim() !== '') {
      return String(val).trim();
    }
  }
  return '';
}

export async function parseCustomerExcelFile(file: File): Promise<ParsedCustomerImportRow[]> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) return [];

  const worksheet = workbook.Sheets[firstSheetName];
  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, { defval: '' });

  return rawRows
    .map((raw) => {
      const normalizedMap: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(raw)) {
        normalizedMap[k.trim().toLowerCase()] = v;
      }

      const name = pickField(normalizedMap, ['nama lengkap', 'nama', 'nama pelanggan', 'name']);
      const address = pickField(normalizedMap, ['alamat', 'alamat pemasangan', 'address']);
      const whatsapp = pickField(normalizedMap, ['nomor whatsapp', 'whatsapp', 'no wa', 'no. wa', 'no hp', 'telepon']);
      const package_name = pickField(normalizedMap, ['nama paket', 'paket', 'paket internet', 'package_name', 'id paket', 'package_id']);
      const custom_price = pickField(normalizedMap, ['harga khusus (rp)', 'harga khusus', 'custom_price']);
      const device_id = pickField(normalizedMap, ['id perangkat', 'id perangkat (ont/router)', 'device_id', 'ont id']);
      const device_ip = pickField(normalizedMap, ['ip perangkat', 'ip address', 'ip', 'device_ip']);
      const device_model = pickField(normalizedMap, ['model perangkat', 'model', 'tipe perangkat', 'device_model']) || 'ONT Fiber';
      const dueRaw = Number(pickField(normalizedMap, ['tgl jatuh tempo', 'jatuh tempo', 'tanggal jatuh tempo', 'due_day']));
      const due_day = Number.isFinite(dueRaw) && dueRaw >= 1 && dueRaw <= 28 ? Math.round(dueRaw) : 10;
      const statusRaw = pickField(normalizedMap, ['status perangkat', 'status', 'device_status']).toLowerCase();
      const device_status: DeviceStatus =
        statusRaw === 'offline' ? 'Offline' : statusRaw === 'isolir' ? 'Isolir' : 'Online';
      const customer_active = pickField(normalizedMap, ['status aktif', 'aktif', 'customer_active']) || 'Aktif';
      const customer_code = pickField(normalizedMap, ['kode pelanggan', 'kode', 'customer_code']);
      const pppoe_username = pickField(normalizedMap, ['pppoe username', 'pppoe', 'pppoe_username']);
      const pon_port = pickField(normalizedMap, ['port pon', 'pon port', 'pon_port']);

      const valid = Boolean(name && address && whatsapp && device_id && device_ip);

      return {
        customer_code,
        name,
        address,
        whatsapp,
        package_name,
        custom_price,
        device_id,
        device_ip,
        device_model,
        due_day,
        device_status,
        customer_active,
        pppoe_username,
        pon_port,
        valid,
      };
    })
    .filter((r) => r.name || r.device_id || r.whatsapp);
}

