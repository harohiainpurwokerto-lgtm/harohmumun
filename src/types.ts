export type DeviceStatus = 'Online' | 'Offline' | 'Isolir';
export type InvoiceStatus = 'Lunas' | 'Belum Lunas';
export type NetworkNodeType = 'MikroTik' | 'OLT';
export type NetworkNodeStatus = 'Online' | 'Degraded' | 'Offline';

export interface NetworkNode {
  id: number;
  node_code: string;
  name: string;
  node_type: NetworkNodeType;
  vendor_model: string;
  host_ip: string;
  api_protocol: string;
  api_port: number;
  api_base_url: string;
  api_username: string;
  api_token_masked: string;
  poll_interval_sec: number;
  status: NetworkNodeStatus;
  cpu_load_pct: number;
  memory_used_pct: number;
  temperature_c: number;
  rx_throughput_mbps: number;
  tx_throughput_mbps: number;
  active_sessions: number;
  uptime_text: string;
  last_sync_at: string;
  last_sync_message: string | null;
  parent_node_id?: number | null;
  parent_node_code?: string | null;
  area_zone?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  map_x?: number | null;
  map_y?: number | null;
  created_at: string;
}

export interface NetworkOdp {
  id: number;
  odp_code: string;
  name: string;
  node_id: number | null;
  node_code?: string | null;
  node_name?: string | null;
  node_type?: NetworkNodeType | null;
  pon_port: string;
  splitter_ratio: string;
  capacity_ports: number;
  used_ports?: number;
  area_zone: string;
  latitude: number | null;
  longitude: number | null;
  map_x: number;
  map_y: number;
  notes: string;
  created_at: string;
}

export interface InternetPackage {
  id: number;
  name: string;
  speed_down_mbps: number;
  speed_up_mbps: number;
  monthly_price: number;
  description: string;
  customer_count?: number;
  created_at: string;
}

export interface Customer {
  id: number;
  customer_code: string;
  name: string;
  address: string;
  whatsapp: string;
  package_id: number;
  package_name?: string;
  speed_down_mbps?: number;
  speed_up_mbps?: number;
  package_price?: number;
  custom_price: number | null;
  effective_price: number;
  device_id: string;
  device_ip: string;
  device_model: string;
  due_day: number;
  device_status: DeviceStatus;
  customer_active: number;
  last_seen_at: string;
  node_id: number | null;
  node_code?: string | null;
  node_name?: string | null;
  node_type?: NetworkNodeType | null;
  pon_port: string | null;
  rx_power_dbm: number | null;
  pppoe_username: string | null;
  latency_ms: number | null;
  uptime_session: string | null;
  odp_id?: number | null;
  odp_code?: string | null;
  odp_name?: string | null;
  odp_port?: number | null;
  cable_length_m?: number | null;
  latitude?: number | null;
  longitude?: number | null;
  map_x?: number | null;
  map_y?: number | null;
  portal_pin_display?: string | null;
  portal_pin_updated_at?: string | null;
  portal_last_login_at?: string | null;
  created_at: string;
}

export interface Invoice {
  id: number;
  invoice_number: string;
  customer_id: number;
  customer_code?: string;
  customer_name?: string;
  customer_whatsapp?: string;
  customer_address?: string;
  package_name?: string;
  device_id?: string;
  device_status?: DeviceStatus;
  billing_period: string;
  amount: number;
  late_fee: number;
  due_date: string;
  status: InvoiceStatus;
  payment_method: string | null;
  paid_at: string | null;
  wa_reminder_sent_at: string | null;
  notes: string | null;
  created_at: string;
}

export interface DeviceLog {
  id: number;
  customer_id: number;
  customer_name?: string;
  customer_code?: string;
  device_id: string;
  device_ip?: string;
  previous_status: string;
  new_status: DeviceStatus;
  event_source: string;
  reason: string | null;
  latency_ms: number | null;
  logged_at: string;
}

export interface WebhookEvent {
  id: number;
  received_at: string;
  source_ip: string | null;
  endpoint: string;
  device_id: string | null;
  device_ip: string | null;
  reported_status: string | null;
  http_status: number;
  processed: number;
  message: string;
  payload_json: string;
}

export interface MonthlyTrendPoint {
  period: string;
  label: string;
  paid_total: number;
  unpaid_total: number;
  paid_count: number;
  unpaid_count: number;
}

export type ActivityLogCategory = 'billing' | 'network' | 'customer' | 'auth';
export type ActorRole = UserRole | 'Pelanggan';

export interface ActivityLog {
  id: number;
  user_id: number | null;
  username: string;
  role: ActorRole;
  category: ActivityLogCategory;
  action: string;
  target_label: string;
  details: string;
  created_at: string;
}

export interface ActivityLogsResponse {
  logs: ActivityLog[];
  total: number;
  page: number;
  limit: number;
  total_pages: number;
  allowed_categories: ActivityLogCategory[];
}

export interface DashboardData {
  period: string;
  kpis: {
    active_customers: number;
    inactive_customers: number;
    current_month_revenue: number;
    current_month_target: number;
    paid_invoices_count: number;
    total_invoices_count: number;
    total_arrears_all_time: number;
    arrears_invoices_count: number;
    devices_online: number;
    devices_offline: number;
    devices_isolir: number;
    mikrotik_online: number;
    mikrotik_total: number;
    olt_online: number;
    olt_total: number;
  };
  monthly_trend: MonthlyTrendPoint[];
  priority_unpaid: Invoice[];
  recent_device_logs: DeviceLog[];
  network_nodes: NetworkNode[];
  recent_activity_logs?: ActivityLog[];
}

export interface FinancialReportData {
  period: string;
  summary: {
    total_billed: number;
    total_paid: number;
    total_unpaid_period: number;
    total_unpaid_all_time: number;
    paid_count: number;
    unpaid_period_count: number;
    unpaid_all_time_count: number;
    collection_rate_pct: number;
  };
  by_payment_method: Array<{
    payment_method: string;
    count: number;
    total_amount: number;
  }>;
  by_package: Array<{
    package_name: string;
    paid_count: number;
    paid_amount: number;
    unpaid_count: number;
    unpaid_amount: number;
  }>;
  paid_invoices: Invoice[];
  unpaid_invoices: Invoice[];
}

export interface TableSchemaInfo {
  name: string;
  row_count: number;
  sql: string;
  columns: Array<{
    cid: number;
    name: string;
    type: string;
    notnull: number;
    dflt_value: string | null;
    pk: number;
  }>;
}

export interface WhatsAppMessage {
  id: number;
  customer_id: number;
  direction: 'outbound' | 'inbound';
  message: string;
  template_type: string | null;
  delivery_channel: string;
  delivery_status: string;
  created_at: string;
}

export interface WhatsAppConversationSummary {
  customer_id: number;
  customer_code: string;
  name: string;
  whatsapp: string;
  address: string;
  package_name: string;
  effective_price: number;
  device_id: string;
  device_status: DeviceStatus;
  unpaid_count: number;
  unpaid_total: number;
  last_message: string | null;
  last_direction: 'outbound' | 'inbound' | null;
  last_message_at: string | null;
  message_count: number;
  latest_invoice_number?: string | null;
  latest_billing_period?: string | null;
  latest_due_date?: string | null;
  latest_invoice_amount?: number | null;
}

export type WhatsAppTemplateKey = 'reminder_pre_due' | 'due_overdue' | 'isolation_notice';

export interface WhatsAppTemplate {
  id: number;
  template_key: WhatsAppTemplateKey;
  title: string;
  description: string;
  body_template: string;
  default_body: string;
  updated_by: string;
  updated_at: string;
}

export interface WhatsAppGatewayConfig {
  id: number;
  provider_name: string;
  api_url: string;
  api_token_masked: string;
  sender_number: string;
  is_active: number;
  updated_at: string;
}

export type UserRole = 'Admin' | 'Teknisi' | 'Keuangan';

export type FeatureKey =
  | 'dashboard'
  | 'customers'
  | 'billing'
  | 'whatsapp'
  | 'monitoring'
  | 'mapping'
  | 'tickets'
  | 'reports'
  | 'activity_logs'
  | 'schema'
  | 'users'
  | 'backup';

export type TicketSource =
  | 'WA Pelanggan'
  | 'Alarm NOC / Webhook'
  | 'Cek Lapangan'
  | 'Manual Admin';

export type TicketCategory =
  | 'LOS / Optik Putus'
  | 'Redaman / Optik Lemah'
  | 'Perangkat Mati / Adaptor'
  | 'Koneksi Lambat / Latency'
  | 'Lainnya';

export type TicketPriority = 'Kritis' | 'Tinggi' | 'Normal';

export type TicketStatus =
  | 'Open'
  | 'In Progress'
  | 'Menunggu Konfirmasi'
  | 'Resolved';

export interface TroubleTicket {
  id: number;
  ticket_code: string;
  customer_id: number;
  customer_code: string;
  customer_name: string;
  customer_whatsapp: string;
  customer_address: string;
  package_name: string;
  device_id: string;
  device_ip: string;
  device_model: string;
  device_status: DeviceStatus;
  rx_power_dbm: number | null;
  node_id: number | null;
  node_code: string | null;
  node_name: string | null;
  odp_id: number | null;
  odp_code: string | null;
  odp_name: string | null;
  pon_port: string | null;
  source: TicketSource;
  category: TicketCategory;
  priority: TicketPriority;
  status: TicketStatus;
  assigned_to_user_id: number | null;
  assigned_to_name: string | null;
  assigned_to_username?: string | null;
  issue_summary: string;
  resolution_notes: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
}

export interface TicketAssigneeOption {
  id: number;
  username: string;
  full_name: string;
  role: UserRole;
}

export interface TicketCustomerRecurrence {
  customer_id: number;
  customer_code: string;
  customer_name: string;
  device_id: string;
  device_status: DeviceStatus;
  odp_code: string | null;
  total_tickets: number;
  open_tickets: number;
  resolved_tickets: number;
  last_ticket_at: string;
  last_category: TicketCategory;
  last_ticket_code: string;
}

export interface TicketOdpRecurrence {
  odp_id: number;
  odp_code: string;
  odp_name: string;
  area_zone: string;
  node_code: string | null;
  total_tickets: number;
  open_tickets: number;
  resolved_tickets: number;
  affected_customers: number;
  last_ticket_at: string;
  last_category: TicketCategory;
}

export interface TicketCustomerOption {
  id: number;
  customer_code: string;
  name: string;
  device_id: string;
  device_ip: string;
  device_status: DeviceStatus;
  rx_power_dbm: number | null;
  package_name: string;
  node_code: string | null;
  odp_code: string | null;
  pon_port: string | null;
}

export interface TicketsListResponse {
  tickets: TroubleTicket[];
  assignees: TicketAssigneeOption[];
  customer_options: TicketCustomerOption[];
  summary: {
    total_count: number;
    open_count: number;
    in_progress_count: number;
    waiting_count: number;
    resolved_count: number;
    critical_open_count: number;
    recurring_customers_count: number;
    recurring_odps_count: number;
  };
  customer_recurrence: TicketCustomerRecurrence[];
  odp_recurrence: TicketOdpRecurrence[];
}

export interface TicketPrefillPayload {
  customer_id: number;
  source: TicketSource;
  category?: TicketCategory;
  priority?: TicketPriority;
  issue_summary?: string;
}

export type BackupFrequency = 'disabled' | 'daily' | 'weekly';

export interface BackupSettings {
  id: number;
  schedule_frequency: BackupFrequency;
  retention_count: number;
  backup_hour_wib: number;
  last_run_at: string | null;
  next_run_at: string | null;
  updated_by: string;
  updated_at: string;
}

export interface BackupSnapshotCounts {
  customers: number;
  packages: number;
  invoices: number;
  network_nodes: number;
  network_odps: number;
  whatsapp_templates: number;
  activity_logs: number;
  trouble_tickets?: number;
}

export interface BackupSnapshotMeta {
  id: number;
  filename: string;
  backup_type: 'manual' | 'scheduled';
  triggered_by: string;
  total_records: number;
  counts: BackupSnapshotCounts;
  size_bytes: number;
  created_at: string;
}

export interface AuthUser {
  id: number;
  username: string;
  full_name: string;
  role: UserRole;
  allowed_features: FeatureKey[];
  is_active: number;
  last_login_at: string | null;
  created_at: string;
}

export interface CustomerPortalProfile {
  id: number;
  customer_code: string;
  name: string;
  address: string;
  whatsapp: string;
  package_id: number;
  package_name: string;
  speed_down_mbps: number;
  speed_up_mbps: number;
  effective_price: number;
  device_id: string;
  device_model: string;
  device_status: DeviceStatus;
  due_day: number;
  customer_active: number;
  last_seen_at: string;
  latency_ms: number | null;
  uptime_session: string | null;
  odp_code: string | null;
  odp_name: string | null;
  node_name: string | null;
  portal_last_login_at: string | null;
}

export interface CustomerPortalData {
  customer: CustomerPortalProfile;
  summary: {
    unpaid_count: number;
    unpaid_total: number;
    paid_count: number;
    paid_total: number;
    late_fee_policy: string;
  };
  unpaid_invoices: Invoice[];
  paid_invoices: Invoice[];
  support_whatsapp: string;
}

