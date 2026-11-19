import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import {
  Activity,
  BarChart3,
  Check,
  CheckCircle2,
  ClipboardList,
  Copy,
  Database,
  ExternalLink,
  GitBranch,
  HardDriveDownload,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageCircle,
  Receipt,
  ShieldCheck,
  Ticket,
  Users,
  X,
} from 'lucide-react';
import type {
  AuthUser,
  Customer,
  CustomerPortalData,
  DashboardData,
  DeviceLog,
  FeatureKey,
  FinancialReportData,
  InternetPackage,
  Invoice,
  NetworkNode,
  TableSchemaInfo,
  TicketPrefillPayload,
  WebhookEvent,
  WhatsAppTemplate,
  WhatsAppTemplateKey,
} from './types';
import {
  buildWhatsAppReminderText,
  buildWhatsAppUrl,
  chooseInvoiceTemplateKey,
  formatPeriodLabel,
  formatRupiah,
} from './utils/format';
import {
  apiFetch,
  canCollectBilling,
  getStoredToken,
  setStoredToken,
  setUnauthorizedHandler,
} from './utils/auth';
import { DashboardView } from './components/DashboardView';
import { CustomersPackagesView } from './components/CustomersPackagesView';
import { BillingView } from './components/BillingView';
import { MonitoringWebhookView } from './components/MonitoringWebhookView';
import { ReportsView } from './components/ReportsView';
import { SchemaView } from './components/SchemaView';
import { WhatsAppChatView } from './components/WhatsAppChatView';
import { NetworkMappingView } from './components/NetworkMappingView';
import { LoginView } from './components/LoginView';
import { UsersAccessView } from './components/UsersAccessView';
import { ActivityLogsView } from './components/ActivityLogsView';
import { BackupExportView } from './components/BackupExportView';
import { TicketsView } from './components/TicketsView';
import { CustomerPortalView } from './components/CustomerPortalView';

type NavTab = FeatureKey;

const NAV_ITEMS: Array<{ id: NavTab; label: string; icon: typeof LayoutDashboard }> = [
  { id: 'dashboard', label: 'Dasbor Utama', icon: LayoutDashboard },
  { id: 'customers', label: 'Pelanggan & Paket', icon: Users },
  { id: 'billing', label: 'Billing & Tagihan', icon: Receipt },
  { id: 'whatsapp', label: 'Chat WhatsApp', icon: MessageCircle },
  { id: 'monitoring', label: 'Monitoring & Webhook', icon: Activity },
  { id: 'mapping', label: 'Mapping & Topologi', icon: GitBranch },
  { id: 'tickets', label: 'Tiket Gangguan', icon: Ticket },
  { id: 'reports', label: 'Laporan Keuangan', icon: BarChart3 },
  { id: 'activity_logs', label: 'Log Aktivitas', icon: ClipboardList },
  { id: 'backup', label: 'Backup & Ekspor', icon: HardDriveDownload },
  { id: 'schema', label: 'Struktur Database', icon: Database },
  { id: 'users', label: 'Manajemen Akun', icon: ShieldCheck },
];

const TAB_TITLES: Record<NavTab, string> = {
  dashboard: 'Dasbor Utama',
  customers: 'Manajemen Pelanggan & Paket',
  billing: 'Sistem Billing & Tagihan',
  whatsapp: 'Chat WhatsApp Pelanggan & Gateway',
  monitoring: 'Monitoring MikroTik, OLT & Webhook API',
  mapping: 'Mapping Jaringan ONT & Topologi FTTH',
  tickets: 'Tiket Gangguan & Penugasan Lapangan',
  reports: 'Laporan Keuangan',
  activity_logs: 'Log Aktivitas & Jejak Audit',
  backup: 'Backup & Ekspor Data Berkala',
  schema: 'Rancangan & Struktur Database',
  users: 'Manajemen Akun & Hak Akses',
};

export default function App() {
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [portalData, setPortalData] = useState<CustomerPortalData | null>(null);
  const [portalRefreshing, setPortalRefreshing] = useState(false);
  const [authChecking, setAuthChecking] = useState(true);
  const [activeTab, setActiveTab] = useState<NavTab>('dashboard');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [logoError, setLogoError] = useState(false);
  const [chatCustomerId, setChatCustomerId] = useState<number | null>(null);
  const [mappingOntId, setMappingOntId] = useState<number | null>(null);
  const [ticketPrefill, setTicketPrefill] = useState<TicketPrefillPayload | null>(null);
  const [mapsQuotaExceeded, setMapsQuotaExceeded] = useState(false);

  useEffect(() => {
    const handleQuotaExceeded = () => setMapsQuotaExceeded(true);
    window.addEventListener('gmp-quota-exceeded', handleQuotaExceeded);
    return () => window.removeEventListener('gmp-quota-exceeded', handleQuotaExceeded);
  }, []);

  // Active billing period filter (default current month 2026-11)
  const [selectedPeriod, setSelectedPeriod] = useState<string>('2026-11');
  const [reportPeriod, setReportPeriod] = useState<string>('2026-11');

  // Shared Domain State
  const [dashboardData, setDashboardData] = useState<DashboardData | null>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [packages, setPackages] = useState<InternetPackage[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [availablePeriods, setAvailablePeriods] = useState<string[]>(['2026-11', '2026-10', '2026-09']);
  const [devices, setDevices] = useState<Customer[]>([]);
  const [networkNodes, setNetworkNodes] = useState<NetworkNode[]>([]);
  const [deviceLogs, setDeviceLogs] = useState<DeviceLog[]>([]);
  const [webhookEvents, setWebhookEvents] = useState<WebhookEvent[]>([]);
  const [reportData, setReportData] = useState<FinancialReportData | null>(null);
  const [schemaTables, setSchemaTables] = useState<TableSchemaInfo[]>([]);
  const [waTemplates, setWaTemplates] = useState<WhatsAppTemplate[]>([]);
  const [loading, setLoading] = useState(true);

  // Toast Notification
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const notify = useCallback((message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  const clearDomainState = useCallback(() => {
    setDashboardData(null);
    setCustomers([]);
    setPackages([]);
    setInvoices([]);
    setDevices([]);
    setNetworkNodes([]);
    setDeviceLogs([]);
    setWebhookEvents([]);
    setReportData(null);
    setSchemaTables([]);
    setWaTemplates([]);
    setChatCustomerId(null);
    setMappingOntId(null);
    setTicketPrefill(null);
  }, []);

  const handleUnauthorized = useCallback(() => {
    setStoredToken(null);
    setCurrentUser(null);
    setPortalData(null);
    clearDomainState();
  }, [clearDomainState]);

  const refreshCurrentUser = useCallback(async () => {
    const token = getStoredToken();
    if (!token) {
      setCurrentUser(null);
      setPortalData(null);
      setAuthChecking(false);
      return;
    }
    try {
      const res = await apiFetch('/api/auth/me');
      if (res.ok) {
        const json = await res.json();
        if (json.account_type === 'customer' && json.portal) {
          setCurrentUser(null);
          setPortalData(json.portal as CustomerPortalData);
          clearDomainState();
        } else {
          setPortalData(null);
          setCurrentUser((json.user as AuthUser) ?? null);
        }
      } else {
        setStoredToken(null);
        setCurrentUser(null);
        setPortalData(null);
      }
    } catch {
      setStoredToken(null);
      setCurrentUser(null);
      setPortalData(null);
    } finally {
      setAuthChecking(false);
    }
  }, [clearDomainState]);

  useEffect(() => {
    setUnauthorizedHandler(handleUnauthorized);
    void refreshCurrentUser();
    return () => setUnauthorizedHandler(null);
  }, [handleUnauthorized, refreshCurrentUser]);

  const hasFeature = useCallback(
    (feature: FeatureKey): boolean => {
      if (!currentUser) return false;
      if (currentUser.role === 'Admin') return true;
      if (feature === 'users' || feature === 'backup') return false;
      return currentUser.allowed_features.includes(feature);
    },
    [currentUser]
  );

  const visibleNavItems = useMemo(() => {
    if (!currentUser) return [];
    return NAV_ITEMS.filter((item) => hasFeature(item.id));
  }, [currentUser, hasFeature]);

  useEffect(() => {
    if (!currentUser) return;
    if (!hasFeature(activeTab)) {
      const firstAllowed = visibleNavItems[0]?.id;
      if (firstAllowed) {
        setActiveTab(firstAllowed);
      }
    }
  }, [currentUser, activeTab, hasFeature, visibleNavItems]);

  function handleLoginSuccess(token: string, user: AuthUser) {
    setStoredToken(token);
    setPortalData(null);
    setCurrentUser(user);
    const defaultTab =
      user.role === 'Admin' || user.allowed_features.includes('dashboard')
        ? 'dashboard'
        : user.allowed_features[0] ?? 'dashboard';
    setActiveTab(defaultTab);
    setLoading(true);
    notify(`Selamat datang, ${user.full_name} (${user.role}).`, 'success');
  }

  function handleCustomerLoginSuccess(token: string, portal: CustomerPortalData) {
    setStoredToken(token);
    setCurrentUser(null);
    clearDomainState();
    setPortalData(portal);
    notify(`Selamat datang di Portal Pelanggan, ${portal.customer.name}.`, 'success');
  }

  const refreshCustomerPortal = useCallback(async () => {
    setPortalRefreshing(true);
    try {
      const res = await apiFetch('/api/portal/me');
      if (res.ok) {
        const json = (await res.json()) as CustomerPortalData;
        setPortalData(json);
      }
    } catch {
      notify('Gagal memperbarui status portal pelanggan.', 'error');
    } finally {
      setPortalRefreshing(false);
    }
  }, [notify]);

  async function handleLogout() {
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // ignore network errors on logout
    }
    setStoredToken(null);
    setCurrentUser(null);
    setPortalData(null);
    clearDomainState();
    setMobileMenuOpen(false);
  }

  // Payment Modal State
  const [payModalInvoice, setPayModalInvoice] = useState<Invoice | null>(null);
  const [paymentMethod, setPaymentMethod] = useState('Transfer BCA');
  const [paymentNotes, setPaymentNotes] = useState('');
  const [paying, setPaying] = useState(false);

  // WhatsApp Reminder Modal State
  const [waModalInvoice, setWaModalInvoice] = useState<Invoice | null>(null);
  const [waSelectedTemplateKey, setWaSelectedTemplateKey] = useState<WhatsAppTemplateKey>('reminder_pre_due');
  const [waMessage, setWaMessage] = useState('');
  const [waCopied, setWaCopied] = useState(false);

  const refreshWaTemplates = useCallback(async () => {
    if (!currentUser) return;
    if (!hasFeature('whatsapp') && !hasFeature('billing') && !hasFeature('reports')) return;
    try {
      const res = await apiFetch('/api/whatsapp/templates');
      if (res.ok) {
        setWaTemplates((await res.json()) as WhatsAppTemplate[]);
      }
    } catch {
      // silent refresh error
    }
  }, [currentUser, hasFeature]);

  const fetchAllData = useCallback(
    async (billingPeriod = selectedPeriod, repPeriod = reportPeriod) => {
      if (!currentUser) return;
      try {
        const dashPeriod = billingPeriod === 'all' ? '2026-11' : billingPeriod;
        const canDash = hasFeature('dashboard');
        const canCust = hasFeature('customers');
        const canPkg = hasFeature('customers') || hasFeature('billing') || hasFeature('reports');
        const canInv = hasFeature('billing') || hasFeature('reports');
        const canMon = hasFeature('monitoring');
        const canRep = hasFeature('reports');
        const canSchema = hasFeature('schema');
        const canWaTpl = hasFeature('whatsapp') || hasFeature('billing') || hasFeature('reports');

        const [dashRes, custRes, pkgRes, invRes, monRes, repRes, schemaRes, tplRes] = await Promise.all([
          canDash ? apiFetch(`/api/dashboard?period=${encodeURIComponent(dashPeriod)}`) : Promise.resolve(null),
          canCust ? apiFetch('/api/customers') : Promise.resolve(null),
          canPkg ? apiFetch('/api/packages') : Promise.resolve(null),
          canInv ? apiFetch(`/api/invoices?period=${encodeURIComponent(billingPeriod)}`) : Promise.resolve(null),
          canMon ? apiFetch('/api/monitoring') : Promise.resolve(null),
          canRep ? apiFetch(`/api/reports?period=${encodeURIComponent(repPeriod)}`) : Promise.resolve(null),
          canSchema ? apiFetch('/api/schema') : Promise.resolve(null),
          canWaTpl ? apiFetch('/api/whatsapp/templates') : Promise.resolve(null),
        ]);

        if (dashRes?.ok) setDashboardData(await dashRes.json());
        if (custRes?.ok) setCustomers(await custRes.json());
        if (pkgRes?.ok) setPackages(await pkgRes.json());
        if (invRes?.ok) {
          const invJson = await invRes.json();
          setInvoices(invJson.invoices);
          setAvailablePeriods(invJson.available_periods);
        }
        if (monRes?.ok) {
          const monJson = await monRes.json();
          setNetworkNodes(monJson.network_nodes ?? []);
          setDevices(monJson.devices);
          setDeviceLogs(monJson.device_logs);
          setWebhookEvents(monJson.webhook_events);
        }
        if (repRes?.ok) setReportData(await repRes.json());
        if (schemaRes?.ok) setSchemaTables(await schemaRes.json());
        if (tplRes?.ok) setWaTemplates((await tplRes.json()) as WhatsAppTemplate[]);
      } catch {
        notify('Gagal memuat data dari server.', 'error');
      } finally {
        setLoading(false);
      }
    },
    [currentUser, hasFeature, selectedPeriod, reportPeriod, notify]
  );

  useEffect(() => {
    if (!currentUser) return;
    void fetchAllData(selectedPeriod, reportPeriod);
  }, [currentUser, fetchAllData, selectedPeriod, reportPeriod]);

  const refreshMonitoringOnly = useCallback(async () => {
    if (!currentUser) return;
    try {
      const canMon = hasFeature('monitoring');
      const canDash = hasFeature('dashboard');
      const [monRes, dashRes] = await Promise.all([
        canMon ? apiFetch('/api/monitoring') : Promise.resolve(null),
        canDash
          ? apiFetch(`/api/dashboard?period=${encodeURIComponent(selectedPeriod === 'all' ? '2026-11' : selectedPeriod)}`)
          : Promise.resolve(null),
      ]);
      if (monRes?.ok) {
        const monJson = await monRes.json();
        setNetworkNodes(monJson.network_nodes ?? []);
        setDevices(monJson.devices);
        setDeviceLogs(monJson.device_logs);
        setWebhookEvents(monJson.webhook_events);
      }
      if (dashRes?.ok) setDashboardData(await dashRes.json());
    } catch {
      // silent background refresh
    }
  }, [currentUser, hasFeature, selectedPeriod]);

  async function handleGenerateInvoices(period: string) {
    try {
      const res = await apiFetch('/api/invoices/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ billing_period: period }),
      });
      const json = await res.json();
      if (!res.ok) {
        notify(json.error || 'Gagal membuat tagihan otomatis.', 'error');
        return;
      }
      setSelectedPeriod(period);
      await fetchAllData(period, reportPeriod);
      notify(json.message, 'success');
    } catch {
      notify('Terjadi kesalahan saat membuat tagihan otomatis.', 'error');
    }
  }

  function openPayModal(invoice: Invoice) {
    setPayModalInvoice(invoice);
    setPaymentMethod('Transfer BCA');
    setPaymentNotes('');
  }

  async function handleConfirmPayment(e: FormEvent) {
    e.preventDefault();
    if (!payModalInvoice) return;
    setPaying(true);
    try {
      const res = await apiFetch(`/api/invoices/${payModalInvoice.id}/pay`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          payment_method: paymentMethod,
          notes: paymentNotes || `Pembayaran lunas via ${paymentMethod}`,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        notify(json.error || 'Gagal mencatat pembayaran.', 'error');
        return;
      }
      const invNo = payModalInvoice.invoice_number;
      setPayModalInvoice(null);
      await fetchAllData(selectedPeriod, reportPeriod);
      notify(`Tagihan ${invNo} berhasil dicatat Lunas.`, 'success');
    } catch {
      notify('Gagal menghubungi server untuk mencatat pembayaran.', 'error');
    } finally {
      setPaying(false);
    }
  }

  async function handleRevertPaid(invoice: Invoice) {
    try {
      const res = await apiFetch(`/api/invoices/${invoice.id}/unpay`, { method: 'PATCH' });
      if (!res.ok) {
        notify('Gagal membatalkan status lunas.', 'error');
        return;
      }
      await fetchAllData(selectedPeriod, reportPeriod);
      notify(`Status tagihan ${invoice.invoice_number} dikembalikan ke Belum Lunas.`, 'success');
    } catch {
      notify('Gagal menghubungi server.', 'error');
    }
  }

  function openWhatsAppModal(invoice: Invoice) {
    const autoKey = chooseInvoiceTemplateKey(invoice);
    setWaModalInvoice(invoice);
    setWaSelectedTemplateKey(autoKey);
    setWaMessage(buildWhatsAppReminderText(invoice, waTemplates, autoKey));
    setWaCopied(false);
  }

  function handleSelectWaModalTemplate(key: WhatsAppTemplateKey) {
    if (!waModalInvoice) return;
    setWaSelectedTemplateKey(key);
    setWaMessage(buildWhatsAppReminderText(waModalInvoice, waTemplates, key));
  }

  function openCustomerChat(customerId: number) {
    setChatCustomerId(customerId);
    setActiveTab('whatsapp');
    setMobileMenuOpen(false);
  }

  function openOntMapping(customerId: number) {
    setMappingOntId(customerId);
    setActiveTab('mapping');
    setMobileMenuOpen(false);
  }

  function openCreateTicket(prefill: TicketPrefillPayload) {
    setTicketPrefill(prefill);
    setActiveTab('tickets');
    setMobileMenuOpen(false);
  }

  async function handleRecordWhatsAppSent(invoice: Invoice) {
    try {
      const selectedTpl = waTemplates.find((t) => t.template_key === waSelectedTemplateKey);
      const fallbackTitles: Record<WhatsAppTemplateKey, string> = {
        reminder_pre_due: 'Pengingat Sebelum Jatuh Tempo',
        due_overdue: 'Tagihan Jatuh Tempo / Tunggakan',
        isolation_notice: 'Pemberitahuan Isolir Layanan',
      };
      const templateTypeLabel = selectedTpl?.title ?? fallbackTitles[waSelectedTemplateKey];

      await Promise.all([
        apiFetch(`/api/invoices/${invoice.id}/wa-reminder`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            template_key: waSelectedTemplateKey,
            template_type: templateTypeLabel,
          }),
        }),
        apiFetch('/api/whatsapp/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            customer_id: invoice.customer_id,
            message: waMessage,
            template_key: waSelectedTemplateKey,
            template_type: templateTypeLabel,
            invoice_number: invoice.invoice_number,
            billing_period: invoice.billing_period,
            via: 'web',
            from_wa_reminder_modal: true,
          }),
        }),
      ]);
      await fetchAllData(selectedPeriod, reportPeriod);
      notify(`Pesan WA (${templateTypeLabel}) untuk ${invoice.customer_name} dicatat.`, 'success');
    } catch {
      // non-fatal
    }
  }

  function handleCopyWaMessage() {
    void navigator.clipboard.writeText(waMessage);
    setWaCopied(true);
    setTimeout(() => setWaCopied(false), 1800);
  }

  if (authChecking) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="bg-white border border-slate-200 rounded-lg px-6 py-5 text-center space-y-2">
          <div className="font-display text-base font-bold text-red-700">
            Jatara IP-Home
          </div>
          <div className="text-xs text-slate-500">Memeriksa sesi masuk...</div>
        </div>
      </div>
    );
  }

  if (portalData && !currentUser) {
    return (
      <>
        <CustomerPortalView
          portal={portalData}
          refreshing={portalRefreshing}
          onRefresh={refreshCustomerPortal}
          onLogout={handleLogout}
        />
        {toast && (
          <div
            role="status"
            className={`fixed bottom-5 right-5 z-50 px-4 py-3 rounded-lg border shadow-lg text-xs font-medium flex items-center gap-2.5 max-w-sm ${
              toast.type === 'error'
                ? 'bg-rose-50 border-rose-200 text-rose-800'
                : 'bg-slate-900 border-slate-800 text-white'
            }`}
          >
            <span>{toast.message}</span>
            <button
              type="button"
              onClick={() => setToast(null)}
              className="opacity-70 hover:opacity-100 shrink-0"
              aria-label="Tutup notifikasi"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </>
    );
  }

  if (!currentUser) {
    return (
      <LoginView
        onLoginSuccess={handleLoginSuccess}
        onCustomerLoginSuccess={handleCustomerLoginSuccess}
      />
    );
  }

  const primaryCta: { label: string; target: NavTab } | null =
    currentUser.role === 'Teknisi'
      ? hasFeature('mapping')
        ? { label: 'Mapping Topologi', target: 'mapping' }
        : hasFeature('monitoring')
          ? { label: 'Monitoring NOC', target: 'monitoring' }
          : visibleNavItems[0]
            ? { label: visibleNavItems[0].label, target: visibleNavItems[0].id }
            : null
      : hasFeature('billing')
        ? { label: 'Kelola Tagihan', target: 'billing' }
        : hasFeature('mapping')
          ? { label: 'Mapping Topologi', target: 'mapping' }
          : hasFeature('monitoring')
            ? { label: 'Monitoring NOC', target: 'monitoring' }
            : visibleNavItems[0]
              ? { label: visibleNavItems[0].label, target: visibleNavItems[0].id }
              : null;

  const sidebarContent = (
    <div className="flex flex-col h-full bg-white text-slate-700">
      <div className="px-3.5 py-3 bg-red-700 border-b border-red-800 flex items-center justify-between gap-2 text-white">
        <div className="bg-white rounded-md px-2.5 py-1.5 shadow-xs flex items-center gap-2 min-w-0 flex-1">
          {!logoError ? (
            <img
              src="/assets/jatara_logo_full.png"
              alt="Logo Jatara"
              referrerPolicy="no-referrer"
              onError={() => setLogoError(true)}
              className="h-6 w-auto object-contain shrink-0"
            />
          ) : (
            <span className="font-display text-sm font-bold text-red-700 whitespace-nowrap shrink-0">
              Jatara
            </span>
          )}
          <span className="h-5 w-px bg-red-200 shrink-0" aria-hidden="true" />
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="font-display text-sm font-bold tracking-tight text-red-700 whitespace-nowrap shrink-0">
              IP-Home
            </span>
            {/* House sketch illustration */}
            <svg
              viewBox="0 0 36 32"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              className="w-7 h-6 text-red-600 shrink-0"
              aria-label="Sketsa Rumah IP-Home"
            >
              {/* Sketched overhanging roof lines */}
              <path
                d="M2.5 16.5L18 4.2L33.5 16.5"
                stroke="currentColor"
                strokeWidth="1.65"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M5 14.5L18 2.8L31 14.5"
                stroke="currentColor"
                strokeWidth="0.9"
                strokeLinecap="round"
                strokeDasharray="2 1.8"
                opacity="0.65"
              />
              {/* Chimney sketch */}
              <path
                d="M24.5 9.2V5.5H27.8V11.8"
                stroke="currentColor"
                strokeWidth="1.35"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              {/* House walls & ground sketch */}
              <path
                d="M7 13.5V27.5H29V13.5"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M3.5 27.5H32.5"
                stroke="currentColor"
                strokeWidth="1.1"
                strokeLinecap="round"
                opacity="0.7"
              />
              {/* Door & Wi-Fi sketch detail inside */}
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
              <path
                d="M16.2 16.2C17.2 15.3 18.8 15.3 19.8 16.2"
                stroke="currentColor"
                strokeWidth="1.25"
                strokeLinecap="round"
              />
            </svg>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setMobileMenuOpen(false)}
          className="lg:hidden p-1 text-red-100 hover:text-white shrink-0"
          aria-label="Tutup navigasi"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto" aria-label="Menu Utama">
        {visibleNavItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                setActiveTab(item.id);
                setMobileMenuOpen(false);
              }}
              className={`w-full flex items-center gap-3 px-3 py-2.5 text-sm font-medium rounded-md transition-colors whitespace-nowrap ${
                isActive
                  ? 'bg-red-600 text-white shadow-xs'
                  : 'text-slate-600 hover:bg-red-50 hover:text-red-700'
              }`}
            >
              <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span className="truncate">{item.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="px-4 py-4 border-t border-slate-200 bg-slate-50/70 text-xs space-y-3">
        <div className="space-y-0.5">
          <div className="font-semibold text-slate-900 truncate">{currentUser.full_name}</div>
          <div className="text-[11px] text-slate-500 flex items-center gap-1.5">
            <span className="font-semibold text-red-700">{currentUser.role}</span>
            <span aria-hidden="true">·</span>
            <span>
              {currentUser.role === 'Admin'
                ? 'Akses Penuh'
                : `${currentUser.allowed_features.length} Fitur Pilihan`}
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={() => void handleLogout()}
          className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-red-50 hover:text-red-700 hover:border-red-200 rounded-md transition-colors whitespace-nowrap"
        >
          <LogOut className="w-3.5 h-3.5 shrink-0" />
          Keluar Akun
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen flex bg-slate-50 text-slate-900">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:block w-64 shrink-0 border-r border-slate-200">
        <div className="sticky top-0 h-screen">{sidebarContent}</div>
      </aside>

      {/* Mobile Sidebar Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-slate-900/50"
            onClick={() => setMobileMenuOpen(false)}
            aria-hidden="true"
          />
          <aside className="relative w-64 max-w-[80vw] h-full z-10">{sidebarContent}</aside>
        </div>
      )}

      {/* Main Content Shell */}
      <div className="flex-1 min-w-0 flex flex-col">
        {mapsQuotaExceeded && (
          <div className="bg-amber-50 border-b border-amber-200 text-amber-900 px-4 py-2.5 text-xs md:text-sm text-center sticky top-0 z-50 shadow-sm">
            <span>
              Google Maps Platform quota reached. If you are the app owner, visit{' '}
              <a
                href="https://developers.google.com/maps/ai/ai-studio?utm_campaign=gmp_mcp_codeassist_v1_aistudio#quota_exceeded_errors"
                target="_blank"
                rel="noopener noreferrer"
                className="underline font-semibold text-amber-950 hover:text-amber-800"
              >
                maps developer site
              </a>{' '}
              for instructions to update your account.
            </span>
          </div>
        )}
        {/* Top Bar Contract: Breadcrumb on left + 1 Primary Action on right */}
        <header className="sticky top-0 z-30 bg-white border-b border-slate-200 px-4 sm:px-6 py-3.5 flex items-center justify-between gap-8">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden p-1.5 text-slate-600 hover:text-slate-900 border border-slate-200 rounded-md"
              aria-label="Buka menu"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2 text-sm min-w-0">
              <span className="text-red-700 font-medium hidden sm:inline whitespace-nowrap shrink-0">
                Jatara IP-Home Billing &amp; NOC
              </span>
              <span className="text-slate-300 hidden sm:inline" aria-hidden="true">
                /
              </span>
              <h1 className="font-display font-semibold text-slate-900 truncate">
                {TAB_TITLES[activeTab]}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            {primaryCta && (
              <button
                type="button"
                onClick={() => setActiveTab(primaryCta.target)}
                className="px-4 py-2 text-xs font-medium text-white bg-red-600 hover:bg-red-700 rounded-md transition-colors whitespace-nowrap shrink-0"
              >
                {primaryCta.label}
              </button>
            )}
          </div>
        </header>

        {/* Viewport Body */}
        <main className="flex-1 p-4 sm:p-6 max-w-[1440px] w-full mx-auto">
          {activeTab === 'dashboard' && hasFeature('dashboard') && (
            <DashboardView
              currentUser={currentUser}
              data={dashboardData}
              loading={loading}
              canAccess={hasFeature}
              onNavigate={(tab) => setActiveTab(tab)}
              onQuickPay={openPayModal}
              onQuickWhatsApp={openWhatsAppModal}
            />
          )}

          {activeTab === 'customers' && hasFeature('customers') && (
            <CustomersPackagesView
              currentUser={currentUser}
              customers={customers}
              packages={packages}
              onRefresh={() => fetchAllData(selectedPeriod, reportPeriod)}
              onOpenChat={hasFeature('whatsapp') ? openCustomerChat : undefined}
              onOpenMapping={hasFeature('mapping') ? openOntMapping : undefined}
              onNotify={notify}
            />
          )}

          {activeTab === 'billing' && hasFeature('billing') && (
            <BillingView
              currentUser={currentUser}
              invoices={invoices}
              availablePeriods={availablePeriods}
              selectedPeriod={selectedPeriod}
              onChangePeriod={(p) => setSelectedPeriod(p)}
              onGenerateInvoices={handleGenerateInvoices}
              onOpenPayModal={openPayModal}
              onRevertPaid={handleRevertPaid}
              onOpenWhatsAppModal={openWhatsAppModal}
            />
          )}

          {activeTab === 'whatsapp' && hasFeature('whatsapp') && (
            <WhatsAppChatView
              currentUser={currentUser}
              templates={waTemplates}
              onRefreshTemplates={refreshWaTemplates}
              initialCustomerId={chatCustomerId}
              onClearInitialCustomer={() => setChatCustomerId(null)}
              onCreateTicket={hasFeature('tickets') ? openCreateTicket : undefined}
              onNotify={notify}
            />
          )}

          {activeTab === 'monitoring' && hasFeature('monitoring') && (
            <MonitoringWebhookView
              currentUser={currentUser}
              networkNodes={networkNodes}
              devices={devices}
              deviceLogs={deviceLogs}
              webhookEvents={webhookEvents}
              onRefresh={refreshMonitoringOnly}
              onOpenMapping={hasFeature('mapping') ? openOntMapping : undefined}
              onCreateTicket={hasFeature('tickets') ? openCreateTicket : undefined}
              onNotify={notify}
            />
          )}

          {activeTab === 'mapping' && hasFeature('mapping') && (
            <NetworkMappingView
              currentUser={currentUser}
              initialOntId={mappingOntId}
              onClearInitialOnt={() => setMappingOntId(null)}
              onOpenChat={hasFeature('whatsapp') ? openCustomerChat : undefined}
              onCreateTicket={hasFeature('tickets') ? openCreateTicket : undefined}
              onRefreshGlobal={() => fetchAllData(selectedPeriod, reportPeriod)}
              onNotify={notify}
            />
          )}

          {activeTab === 'tickets' && hasFeature('tickets') && (
            <TicketsView
              currentUser={currentUser}
              prefillRequest={ticketPrefill}
              onClearPrefill={() => setTicketPrefill(null)}
              onOpenChat={hasFeature('whatsapp') ? openCustomerChat : undefined}
              onOpenMapping={hasFeature('mapping') ? openOntMapping : undefined}
              onNotify={notify}
            />
          )}

          {activeTab === 'reports' && hasFeature('reports') && (
            <ReportsView
              report={reportData}
              loading={loading}
              selectedPeriod={reportPeriod}
              availablePeriods={availablePeriods}
              onChangePeriod={(p) => setReportPeriod(p)}
              onOpenWhatsAppModal={openWhatsAppModal}
            />
          )}

          {activeTab === 'activity_logs' && hasFeature('activity_logs') && (
            <ActivityLogsView currentUser={currentUser} onNotify={notify} />
          )}

          {activeTab === 'backup' && currentUser.role === 'Admin' && (
            <BackupExportView
              currentUser={currentUser}
              customers={customers}
              packages={packages}
              onNotify={notify}
            />
          )}

          {activeTab === 'schema' && hasFeature('schema') && (
            <SchemaView tables={schemaTables} />
          )}

          {activeTab === 'users' && currentUser.role === 'Admin' && (
            <UsersAccessView
              currentUser={currentUser}
              onRefreshCurrentUser={refreshCurrentUser}
              onNotify={notify}
            />
          )}
        </main>
      </div>

      {/* Modal Catat Pembayaran Lunas */}
      {payModalInvoice && canCollectBilling(currentUser) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="bg-white border border-slate-200 rounded-lg w-full max-w-md shadow-xl">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-900">Catat Pembayaran Tagihan</h3>
              <button
                type="button"
                onClick={() => setPayModalInvoice(null)}
                className="p-1 text-slate-400 hover:text-slate-700 rounded"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleConfirmPayment} className="p-5 space-y-4">
              <div className="bg-slate-50 border border-slate-200 rounded-md p-3.5 space-y-1.5 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">No. Invoice</span>
                  <span className="font-mono font-semibold text-slate-900">
                    {payModalInvoice.invoice_number}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Pelanggan</span>
                  <span className="font-medium text-slate-900">{payModalInvoice.customer_name}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Periode</span>
                  <span className="text-slate-800">{formatPeriodLabel(payModalInvoice.billing_period)}</span>
                </div>
                <div className="flex items-center justify-between pt-1.5 border-t border-slate-200">
                  <span className="font-medium text-slate-700">Total Bayar (0 Denda)</span>
                  <span className="font-mono text-sm font-bold text-slate-900 tabular-nums">
                    {formatRupiah(payModalInvoice.amount)}
                  </span>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Metode Pembayaran
                </label>
                <select
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-md focus:outline-none focus:border-red-600"
                >
                  <option value="Transfer BCA">Transfer BCA</option>
                  <option value="Transfer BRI">Transfer BRI</option>
                  <option value="Transfer Mandiri">Transfer Mandiri</option>
                  <option value="QRIS">QRIS</option>
                  <option value="Tunai">Tunai / Kolektor</option>
                  <option value="E-Wallet Dana">E-Wallet (Dana / GoPay / OVO)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Catatan Tambahan (Opsional)
                </label>
                <input
                  type="text"
                  value={paymentNotes}
                  onChange={(e) => setPaymentNotes(e.target.value)}
                  placeholder="Contoh: Diterima via transfer a.n Budi"
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-md focus:outline-none focus:border-red-600"
                />
              </div>

              <div className="pt-3 border-t border-slate-200 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setPayModalInvoice(null)}
                  className="px-4 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={paying}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-red-600 hover:bg-red-700 disabled:opacity-50 rounded-md transition-colors"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  {paying ? 'Menyimpan...' : 'Konfirmasi Lunas'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Kirim Pengingat WhatsApp */}
      {waModalInvoice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="bg-white border border-slate-200 rounded-lg w-full max-w-lg shadow-xl">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <MessageCircle className="w-4 h-4 text-emerald-700" />
                <h3 className="text-base font-semibold text-slate-900">
                  Kirim Pesan WhatsApp Standar
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setWaModalInvoice(null)}
                className="p-1 text-slate-400 hover:text-slate-700 rounded"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs bg-slate-50 border border-slate-200 rounded-md px-3.5 py-2.5">
                <div>
                  <span className="text-slate-500">Tujuan:</span>{' '}
                  <span className="font-medium text-slate-900">{waModalInvoice.customer_name}</span>
                  <span className="text-slate-300 mx-1.5" aria-hidden="true">·</span>
                  <span className="font-mono text-slate-600">{waModalInvoice.invoice_number}</span>
                </div>
                <span className="font-mono text-slate-700">{waModalInvoice.customer_whatsapp}</span>
              </div>

              <div className="space-y-1.5">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="font-medium text-slate-700">Pilih Template Standar:</span>
                  <span className="text-[11px] text-slate-500">
                    {waModalInvoice.device_status === 'Isolir'
                      ? 'Saran otomatis: Perangkat berstatus Isolir'
                      : chooseInvoiceTemplateKey(waModalInvoice) === 'due_overdue'
                        ? 'Saran otomatis: Melewati jatuh tempo'
                        : 'Saran otomatis: Sebelum jatuh tempo'}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-1.5 p-1 bg-slate-100 rounded-md">
                  {(
                    [
                      { key: 'reminder_pre_due', label: 'Sebelum Tempo' },
                      { key: 'due_overdue', label: 'Jatuh Tempo' },
                      { key: 'isolation_notice', label: 'Info Isolir' },
                    ] as const
                  ).map((opt) => (
                    <button
                      key={opt.key}
                      type="button"
                      onClick={() => handleSelectWaModalTemplate(opt.key)}
                      className={`px-2 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                        waSelectedTemplateKey === opt.key
                          ? 'bg-white text-red-700 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-medium text-slate-700">
                    Isi Pesan (Variabel Terisi Otomatis · Dapat Diedit)
                  </label>
                  <button
                    type="button"
                    onClick={handleCopyWaMessage}
                    className="inline-flex items-center gap-1 text-xs text-red-700 hover:underline"
                  >
                    {waCopied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    {waCopied ? 'Teks Tersalin' : 'Salin Teks'}
                  </button>
                </div>
                <textarea
                  rows={10}
                  value={waMessage}
                  onChange={(e) => setWaMessage(e.target.value)}
                  className="w-full px-3 py-2 text-xs font-sans leading-relaxed border border-slate-200 rounded-md focus:outline-none focus:border-red-600"
                />
              </div>

              <div className="pt-3 border-t border-slate-200 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setWaModalInvoice(null)}
                  className="px-4 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors"
                >
                  Tutup
                </button>
                <a
                  href={buildWhatsAppUrl(waModalInvoice.customer_whatsapp ?? '', waMessage)}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => void handleRecordWhatsAppSent(waModalInvoice)}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-emerald-700 hover:bg-emerald-800 rounded-md transition-colors whitespace-nowrap shrink-0"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  Buka WhatsApp &amp; Kirim
                </a>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Toast Notification */}
      {toast && (
        <div
          role="status"
          className={`fixed bottom-5 right-5 z-50 px-4 py-3 rounded-lg border shadow-lg text-xs font-medium flex items-center gap-2.5 max-w-sm ${
            toast.type === 'error'
              ? 'bg-rose-50 border-rose-200 text-rose-800'
              : 'bg-slate-900 border-slate-800 text-white'
          }`}
        >
          <span>{toast.message}</span>
          <button
            type="button"
            onClick={() => setToast(null)}
            className="opacity-70 hover:opacity-100 shrink-0"
            aria-label="Tutup notifikasi"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}
