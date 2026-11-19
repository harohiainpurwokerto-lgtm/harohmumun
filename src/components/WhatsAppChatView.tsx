import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import {
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  Eye,
  FileText,
  MessageCircle,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Send,
  Settings,
  Ticket,
  Webhook,
} from 'lucide-react';
import type {
  AuthUser,
  TicketCategory,
  TicketPrefillPayload,
  TicketPriority,
  WhatsAppConversationSummary,
  WhatsAppGatewayConfig,
  WhatsAppMessage,
  WhatsAppTemplate,
  WhatsAppTemplateKey,
} from '../types';
import {
  SAMPLE_WHATSAPP_TEMPLATE_VARS,
  WHATSAPP_TEMPLATE_VARIABLES,
  buildConversationTemplateVars,
  buildWhatsAppUrl,
  formatDateTimeId,
  formatDateTimeWib,
  formatPeriodLabel,
  formatRupiah,
  renderWhatsAppTemplate,
} from '../utils/format';
import {
  apiFetch,
  canConfigureWaGateway,
  canEditWhatsAppTemplate,
  canManageTroubleTickets,
  canSendBillingWhatsApp,
} from '../utils/auth';
import { DeviceStatusLabel } from './StatusText';
import { ReadOnlyBadge } from './ReadOnlyIndicator';

interface WhatsAppChatViewProps {
  currentUser: AuthUser;
  templates: WhatsAppTemplate[];
  onRefreshTemplates: () => Promise<void>;
  initialCustomerId?: number | null;
  onClearInitialCustomer?: () => void;
  onCreateTicket?: (prefill: TicketPrefillPayload) => void;
  onNotify: (msg: string, type?: 'success' | 'error') => void;
}

const TEMPLATE_KEY_META: Record<
  WhatsAppTemplateKey,
  { shortLabel: string; categoryHint: string }
> = {
  reminder_pre_due: {
    shortLabel: 'Sebelum Jatuh Tempo',
    categoryHint: 'Kategori Billing · Pengingat H-3 s/d H-0',
  },
  due_overdue: {
    shortLabel: 'Jatuh Tempo / Tunggakan',
    categoryHint: 'Kategori Billing · Lewat Jatuh Tempo (0% Denda)',
  },
  isolation_notice: {
    shortLabel: 'Pemberitahuan Isolir',
    categoryHint: 'Kategori Network / Isolir · Info Aktivasi Otomatis',
  },
};

export function WhatsAppChatView({
  currentUser,
  templates,
  onRefreshTemplates,
  initialCustomerId,
  onClearInitialCustomer,
  onCreateTicket,
  onNotify,
}: WhatsAppChatViewProps) {
  const canEditGateway = canConfigureWaGateway(currentUser);
  const canSendBilling = canSendBillingWhatsApp(currentUser);
  const canTicket = canManageTroubleTickets(currentUser);

  function buildWaTicketPrefill(
    customer: WhatsAppConversationSummary,
    complaintText?: string
  ): TicketPrefillPayload {
    const text = (complaintText ?? customer.last_message ?? '').trim();
    const lower = text.toLowerCase();
    let category: TicketCategory = 'Lainnya';
    if (lower.includes('los') || lower.includes('merah') || lower.includes('putus') || lower.includes('pohon')) {
      category = 'LOS / Optik Putus';
    } else if (lower.includes('mati') || lower.includes('adaptor') || lower.includes('listrik')) {
      category = 'Perangkat Mati / Adaptor';
    } else if (lower.includes('redaman')) {
      category = 'Redaman / Optik Lemah';
    } else if (lower.includes('lambat') || lower.includes('lemot') || lower.includes('putus-nyambung') || lower.includes('patah')) {
      category = 'Koneksi Lambat / Latency';
    } else if (customer.device_status === 'Offline') {
      category = 'LOS / Optik Putus';
    }

    const priority: TicketPriority =
      category === 'LOS / Optik Putus' && customer.device_status === 'Offline'
        ? 'Kritis'
        : customer.device_status !== 'Online'
          ? 'Tinggi'
          : 'Normal';

    return {
      customer_id: customer.customer_id,
      source: 'WA Pelanggan',
      category,
      priority,
      issue_summary: text
        ? `Komplain WA dari ${customer.name} (${customer.device_id}): "${text}"`
        : `Keluhan layanan dari chat WA ${customer.name} (${customer.device_id}, status ${customer.device_status})`,
    };
  }
  const [subTab, setSubTab] = useState<'chat' | 'templates' | 'gateway'>('chat');
  const [conversations, setConversations] = useState<WhatsAppConversationSummary[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState<number | null>(initialCustomerId ?? null);
  const [messages, setMessages] = useState<WhatsAppMessage[]>([]);
  const [loadingConvos, setLoadingConvos] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);

  const [search, setSearch] = useState('');
  const [filterMode, setFilterMode] = useState<'all' | 'unpaid' | 'offline'>('all');
  const [draftText, setDraftText] = useState('');
  const [activeTemplate, setActiveTemplate] = useState<string | null>(null);
  const [activeTemplateKey, setActiveTemplateKey] = useState<WhatsAppTemplateKey | null>(null);
  const [sending, setSending] = useState(false);

  // Template standardization editor state
  const [selectedTplKey, setSelectedTplKey] = useState<WhatsAppTemplateKey>('reminder_pre_due');
  const [tplTitleDraft, setTplTitleDraft] = useState('');
  const [tplBodyDraft, setTplBodyDraft] = useState('');
  const [savingTpl, setSavingTpl] = useState(false);
  const [resettingTpl, setResettingTpl] = useState(false);
  const [previewSource, setPreviewSource] = useState<string>('sample');
  const [previewCopied, setPreviewCopied] = useState(false);
  const tplTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Gateway config & inbound tester state
  const [gatewayForm, setGatewayForm] = useState({
    provider_name: 'Fonnte / Wablas / WAHA',
    api_url: '',
    api_token: '',
    api_token_masked: '',
    sender_number: '6281200004000',
    is_active: false,
  });
  const [savingGateway, setSavingGateway] = useState(false);

  const [simPhone, setSimPhone] = useState('');
  const [simMessage, setSimMessage] = useState('Halo admin, saya sudah transfer tagihan bulan ini.');
  const [simulatingInbound, setSimulatingInbound] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const fetchConversations = useCallback(async () => {
    try {
      const res = await apiFetch('/api/whatsapp/conversations');
      if (res.ok) {
        const list = (await res.json()) as WhatsAppConversationSummary[];
        setConversations(list);
        setSelectedCustomerId((prev) => {
          if (initialCustomerId && list.some((c) => c.customer_id === initialCustomerId)) {
            return initialCustomerId;
          }
          if (prev && list.some((c) => c.customer_id === prev)) return prev;
          return list[0]?.customer_id ?? null;
        });
        if (!simPhone && list[0]) {
          setSimPhone(list[0].whatsapp);
        }
      }
    } catch {
      onNotify('Gagal memuat daftar percakapan WhatsApp.', 'error');
    } finally {
      setLoadingConvos(false);
    }
  }, [initialCustomerId, onNotify, simPhone]);

  const fetchMessages = useCallback(async (customerId: number) => {
    setLoadingMessages(true);
    try {
      const res = await apiFetch(`/api/whatsapp/messages/${customerId}`);
      if (res.ok) {
        setMessages((await res.json()) as WhatsAppMessage[]);
      }
    } finally {
      setLoadingMessages(false);
    }
  }, []);

  const fetchGatewayConfig = useCallback(async () => {
    try {
      const res = await apiFetch('/api/whatsapp/gateway');
      if (res.ok) {
        const cfg = (await res.json()) as WhatsAppGatewayConfig;
        setGatewayForm({
          provider_name: cfg.provider_name,
          api_url: cfg.api_url,
          api_token: '',
          api_token_masked: cfg.api_token_masked,
          sender_number: cfg.sender_number,
          is_active: cfg.is_active === 1,
        });
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    void fetchConversations();
    void fetchGatewayConfig();
    if (templates.length === 0) {
      void onRefreshTemplates();
    }
  }, [fetchConversations, fetchGatewayConfig, onRefreshTemplates, templates.length]);

  useEffect(() => {
    if (initialCustomerId) {
      setSelectedCustomerId(initialCustomerId);
      setSubTab('chat');
      onClearInitialCustomer?.();
    }
  }, [initialCustomerId, onClearInitialCustomer]);

  useEffect(() => {
    if (selectedCustomerId !== null) {
      void fetchMessages(selectedCustomerId);
    }
  }, [selectedCustomerId, fetchMessages]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, selectedCustomerId]);

  const activeTemplateObj = useMemo(
    () => templates.find((t) => t.template_key === selectedTplKey) ?? null,
    [templates, selectedTplKey]
  );

  useEffect(() => {
    if (activeTemplateObj) {
      setTplTitleDraft(activeTemplateObj.title);
      setTplBodyDraft(activeTemplateObj.body_template);
    }
  }, [activeTemplateObj]);

  const selectedCustomer = useMemo(
    () => conversations.find((c) => c.customer_id === selectedCustomerId) ?? null,
    [conversations, selectedCustomerId]
  );

  const filteredConversations = useMemo(() => {
    const q = search.trim().toLowerCase();
    return conversations.filter((c) => {
      if (filterMode === 'unpaid' && c.unpaid_count === 0) return false;
      if (filterMode === 'offline' && c.device_status !== 'Offline') return false;
      if (!q) return true;
      return (
        c.name.toLowerCase().includes(q) ||
        c.customer_code.toLowerCase().includes(q) ||
        c.whatsapp.includes(q) ||
        c.device_id.toLowerCase().includes(q)
      );
    });
  }, [conversations, search, filterMode]);

  const previewCustomer = useMemo(() => {
    if (previewSource === 'sample') return null;
    const id = Number(previewSource);
    return conversations.find((c) => c.customer_id === id) ?? null;
  }, [conversations, previewSource]);

  const previewVars = useMemo(() => {
    if (previewCustomer) {
      return buildConversationTemplateVars(previewCustomer);
    }
    return SAMPLE_WHATSAPP_TEMPLATE_VARS;
  }, [previewCustomer]);

  const renderedPreview = useMemo(
    () => renderWhatsAppTemplate(tplBodyDraft, previewVars),
    [tplBodyDraft, previewVars]
  );

  const canEditSelectedTemplate = canEditWhatsAppTemplate(currentUser, selectedTplKey);

  function applyStandardTemplateToChat(key: WhatsAppTemplateKey) {
    if (!selectedCustomer) return;
    const matched = templates.find((t) => t.template_key === key);
    const vars = buildConversationTemplateVars(selectedCustomer);
    setActiveTemplateKey(key);
    setActiveTemplate(matched?.title ?? TEMPLATE_KEY_META[key].shortLabel);

    if (matched) {
      setDraftText(renderWhatsAppTemplate(matched.body_template, vars));
      return;
    }

    if (key === 'isolation_notice') {
      setDraftText(
        `Yth. Bapak/Ibu *${vars.nama}* (${vars.kode_pelanggan}), layanan internet *Jatara IP-Home* (${vars.paket}) saat ini berstatus *ISOLIR SEMENTARA* terkait tagihan periode *${vars.periode}* sebesar *${vars.tagihan}* (jatuh tempo ${vars.jatuh_tempo}, 0% denda). Setelah pembayaran dicatat lunas, koneksi akan otomatis aktif kembali.`
      );
      return;
    }

    if (key === 'due_overdue') {
      setDraftText(
        `Yth. Bapak/Ibu *${vars.nama}* (${vars.kode_pelanggan}), tagihan internet *Jatara IP-Home* (${vars.paket}) periode *${vars.periode}* sebesar *${vars.tagihan}* telah melewati jatuh tempo (${vars.jatuh_tempo}). Sesuai kebijakan kami, denda keterlambatan tetap *Rp 0 (0% denda)*. Mohon konfirmasi bukti transfer jika sudah membayar.`
      );
      return;
    }

    setDraftText(
      `Yth. Bapak/Ibu *${vars.nama}* (${vars.kode_pelanggan}), berikut pengingat tagihan internet *Jatara IP-Home* (${vars.paket}) periode *${vars.periode}* sebesar *${vars.tagihan}* sebelum jatuh tempo *${vars.jatuh_tempo}* (0% denda keterlambatan). Terima kasih.`
    );
  }

  function applyOperationalQuickTemplate(type: 'lunas' | 'gangguan' | 'buka_isolir') {
    if (!selectedCustomer) return;
    setActiveTemplateKey(null);

    if (type === 'lunas') {
      setActiveTemplate('Konfirmasi Lunas');
      setDraftText(
        `Terima kasih Bapak/Ibu *${selectedCustomer.name}* (${selectedCustomer.customer_code}), pembayaran layanan internet *Jatara IP-Home* (${selectedCustomer.package_name}) sebesar *${formatRupiah(selectedCustomer.effective_price)}* telah kami terima dan dicatat *Lunas* (0% denda).`
      );
      return;
    }

    if (type === 'gangguan') {
      setActiveTemplate('Info Gangguan / Offline');
      setDraftText(
        `Halo Bapak/Ibu *${selectedCustomer.name}*, sistem monitoring NOC *Jatara IP-Home* mendeteksi perangkat *${selectedCustomer.device_id}* sedang berstatus *${selectedCustomer.device_status}*. Mohon bantu cek apakah lampu indikator modem menyala normal atau ada lampu merah (LOS) berkedip?`
      );
      return;
    }

    setActiveTemplate('Info Buka Isolir');
    setDraftText(
      `Halo Bapak/Ibu *${selectedCustomer.name}* (${selectedCustomer.customer_code}), koneksi perangkat *${selectedCustomer.device_id}* kini telah diaktifkan kembali (*Online*). Silakan dicoba kembali dan kabari kami jika masih terkendala. Terima kasih bersama *Jatara IP-Home*.`
    );
  }

  async function handleSendMessage(via: 'web' | 'gateway') {
    if (!selectedCustomer || !draftText.trim()) return;
    setSending(true);
    try {
      const res = await apiFetch('/api/whatsapp/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer_id: selectedCustomer.customer_id,
          message: draftText.trim(),
          template_key: activeTemplateKey ?? undefined,
          template_type: activeTemplate ?? undefined,
          invoice_number: selectedCustomer.latest_invoice_number ?? undefined,
          billing_period: selectedCustomer.latest_billing_period ?? undefined,
          via,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        onNotify(json.error || 'Gagal mengirim pesan WhatsApp.', 'error');
        return;
      }
      setDraftText('');
      setActiveTemplate(null);
      setActiveTemplateKey(null);
      await Promise.all([fetchMessages(selectedCustomer.customer_id), fetchConversations()]);
      onNotify(
        via === 'gateway'
          ? `Pesan diproses via WA Gateway (${json.delivery_status}).`
          : 'Pesan outbound tersimpan ke riwayat chat dan Log Aktivitas.',
        'success'
      );
    } catch {
      onNotify('Terjadi kesalahan saat menghubungi server.', 'error');
    } finally {
      setSending(false);
    }
  }

  function handleInsertVariable(token: string) {
    if (!canEditSelectedTemplate) return;
    const el = tplTextareaRef.current;
    if (!el) {
      setTplBodyDraft((prev) => `${prev}${prev.endsWith(' ') || prev === '' ? '' : ' '}${token}`);
      return;
    }
    const start = el.selectionStart ?? tplBodyDraft.length;
    const end = el.selectionEnd ?? tplBodyDraft.length;
    const nextValue = `${tplBodyDraft.slice(0, start)}${token}${tplBodyDraft.slice(end)}`;
    setTplBodyDraft(nextValue);
    requestAnimationFrame(() => {
      el.focus();
      const cursor = start + token.length;
      el.setSelectionRange(cursor, cursor);
    });
  }

  async function handleSaveTemplate(e: FormEvent) {
    e.preventDefault();
    if (!canEditSelectedTemplate || !tplBodyDraft.trim()) return;
    setSavingTpl(true);
    try {
      const res = await apiFetch(`/api/whatsapp/templates/${selectedTplKey}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: tplTitleDraft.trim(),
          body_template: tplBodyDraft.trim(),
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        onNotify(json.error || 'Gagal menyimpan template WhatsApp.', 'error');
        return;
      }
      await onRefreshTemplates();
      onNotify(`Template "${json.title}" berhasil disimpan dan dicatat ke Log Aktivitas.`, 'success');
    } catch {
      onNotify('Terjadi kesalahan saat menyimpan template.', 'error');
    } finally {
      setSavingTpl(false);
    }
  }

  async function handleResetTemplate() {
    if (!canEditSelectedTemplate) return;
    setResettingTpl(true);
    try {
      const res = await apiFetch(`/api/whatsapp/templates/${selectedTplKey}/reset`, {
        method: 'POST',
      });
      const json = await res.json();
      if (!res.ok) {
        onNotify(json.error || 'Gagal mereset template ke default.', 'error');
        return;
      }
      setTplTitleDraft(json.title);
      setTplBodyDraft(json.body_template);
      await onRefreshTemplates();
      onNotify(`Template "${json.title}" dikembalikan ke isi default standar.`, 'success');
    } catch {
      onNotify('Terjadi kesalahan saat mereset template.', 'error');
    } finally {
      setResettingTpl(false);
    }
  }

  function handleCopyPreview() {
    void navigator.clipboard.writeText(renderedPreview);
    setPreviewCopied(true);
    setTimeout(() => setPreviewCopied(false), 1800);
  }

  async function handleSaveGateway(e: FormEvent) {
    e.preventDefault();
    setSavingGateway(true);
    try {
      const res = await apiFetch('/api/whatsapp/gateway', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider_name: gatewayForm.provider_name,
          api_url: gatewayForm.api_url,
          api_token: gatewayForm.api_token,
          sender_number: gatewayForm.sender_number,
          is_active: gatewayForm.is_active,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        onNotify(json.error || 'Gagal menyimpan pengaturan WA Gateway.', 'error');
        return;
      }
      setGatewayForm((prev) => ({
        ...prev,
        api_token: '',
        api_token_masked: json.api_token_masked,
      }));
      onNotify('Konfigurasi WA Gateway API berhasil disimpan.', 'success');
    } catch {
      onNotify('Gagal menyimpan konfigurasi gateway.', 'error');
    } finally {
      setSavingGateway(false);
    }
  }

  async function handleSimulateInbound(e: FormEvent) {
    e.preventDefault();
    if (!simPhone.trim() || !simMessage.trim()) return;
    setSimulatingInbound(true);
    try {
      const res = await apiFetch('/api/webhook/whatsapp-inbound', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          whatsapp: simPhone.trim(),
          message: simMessage.trim(),
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        onNotify(json.error || 'Gagal memproses pesan masuk.', 'error');
        return;
      }
      await fetchConversations();
      if (json.customer_id) {
        setSelectedCustomerId(json.customer_id);
        await fetchMessages(json.customer_id);
      }
      onNotify(`Pesan masuk dari ${json.customer_name} berhasil diterima ke inbox.`, 'success');
    } catch {
      onNotify('Gagal mengirim simulasi webhook masuk.', 'error');
    } finally {
      setSimulatingInbound(false);
    }
  }

  const inboundWebhookUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/api/webhook/whatsapp-inbound`
      : '/api/webhook/whatsapp-inbound';

  return (
    <div className="space-y-5">
      {/* Sub-navigation */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="inline-flex flex-wrap items-center gap-1 p-1 bg-slate-200/70 rounded-lg">
          <button
            type="button"
            onClick={() => setSubTab('chat')}
            className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
              subTab === 'chat'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Percakapan Pelanggan ({conversations.length})
          </button>
          <button
            type="button"
            onClick={() => setSubTab('templates')}
            className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
              subTab === 'templates'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Standarisasi Template ({templates.length || 3})
          </button>
          <button
            type="button"
            onClick={() => setSubTab('gateway')}
            className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
              subTab === 'gateway'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            WA Gateway API &amp; Webhook
          </button>
        </div>

        <button
          type="button"
          onClick={() => {
            void fetchConversations();
            void onRefreshTemplates();
            if (selectedCustomerId !== null) void fetchMessages(selectedCustomerId);
          }}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-md transition-colors whitespace-nowrap shrink-0"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Segarkan Data
        </button>
      </div>

      {subTab === 'chat' && (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden grid grid-cols-1 lg:grid-cols-12 min-h-[620px]">
          {/* Left Pane: Conversations List */}
          <div className="lg:col-span-4 border-b lg:border-b-0 lg:border-r border-slate-200 flex flex-col">
            <div className="p-3.5 border-b border-slate-200 space-y-2.5">
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Cari nama, no. WA, atau ID..."
                  className="w-full pl-9 pr-3 py-1.5 text-xs border border-slate-200 rounded-md focus:outline-none focus:border-red-600"
                />
              </div>
              <div className="inline-flex w-full items-center gap-1 p-1 bg-slate-100 rounded-md">
                {(
                  [
                    { id: 'all', label: 'Semua' },
                    { id: 'unpaid', label: 'Tunggakan' },
                    { id: 'offline', label: 'Offline' },
                  ] as const
                ).map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setFilterMode(f.id)}
                    className={`flex-1 px-2 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                      filterMode === f.id
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="divide-y divide-slate-100 overflow-y-auto max-h-[540px] flex-1">
              {loadingConvos && conversations.length === 0 ? (
                <div className="p-6 text-center text-xs text-slate-500">Memuat percakapan...</div>
              ) : filteredConversations.length === 0 ? (
                <div className="p-6 text-center text-xs text-slate-500">
                  Tidak ada pelanggan sesuai filter.
                </div>
              ) : (
                filteredConversations.map((c) => {
                  const isSelected = c.customer_id === selectedCustomerId;
                  return (
                    <button
                      key={c.customer_id}
                      type="button"
                      onClick={() => setSelectedCustomerId(c.customer_id)}
                      className={`w-full text-left px-4 py-3 transition-colors ${
                        isSelected ? 'bg-red-50/70' : 'hover:bg-slate-50'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-sm text-slate-900 truncate">{c.name}</span>
                        <span className="text-[11px] font-mono text-slate-400 shrink-0 tabular-nums">
                          {c.last_message_at ? formatDateTimeId(c.last_message_at).split(',')[0] : c.customer_code}
                        </span>
                      </div>
                      <div className="mt-1 flex items-center justify-between gap-2 text-xs">
                        <span className="font-mono text-slate-500">{c.whatsapp}</span>
                        <DeviceStatusLabel status={c.device_status} />
                      </div>
                      {c.unpaid_count > 0 && (
                        <div className="mt-1 text-[11px] font-mono text-rose-700 tabular-nums">
                          Tunggakan: {formatRupiah(c.unpaid_total)} ({c.unpaid_count} bln)
                        </div>
                      )}
                      {c.last_message && (
                        <p className="mt-1.5 text-xs text-slate-500 line-clamp-1">
                          {c.last_direction === 'outbound' ? 'Anda: ' : ''}
                          {c.last_message}
                        </p>
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* Right Pane: Active Chat Thread & Composer */}
          <div className="lg:col-span-8 flex flex-col">
            {!selectedCustomer ? (
              <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-slate-500">
                <MessageCircle className="w-8 h-8 text-slate-300 mb-2" />
                <p className="text-sm font-medium text-slate-700">Pilih pelanggan untuk memulai chat</p>
                <p className="text-xs text-slate-500 mt-1">
                  Anda dapat mengirim pengingat tagihan, pemberitahuan isolir, atau info teknis perangkat.
                </p>
              </div>
            ) : (
              <>
                {/* Customer Chat Header */}
                <div className="px-5 py-3.5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-sm font-semibold text-slate-900">{selectedCustomer.name}</h2>
                      <span className="text-slate-300" aria-hidden="true">·</span>
                      <span className="font-mono text-xs text-slate-600">{selectedCustomer.whatsapp}</span>
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                      <span className="font-mono">{selectedCustomer.customer_code}</span>
                      <span aria-hidden="true">·</span>
                      <span>{selectedCustomer.package_name}</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono">{selectedCustomer.device_id}</span>
                      <span aria-hidden="true">·</span>
                      <DeviceStatusLabel status={selectedCustomer.device_status} />
                      {selectedCustomer.unpaid_total > 0 && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono text-rose-700 font-medium tabular-nums">
                            Belum lunas {formatRupiah(selectedCustomer.unpaid_total)}
                          </span>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    {onCreateTicket && canTicket && (
                      <button
                        type="button"
                        onClick={() => {
                          const lastInbound = [...messages]
                            .reverse()
                            .find((m) => m.direction === 'inbound');
                          onCreateTicket(
                            buildWaTicketPrefill(selectedCustomer, lastInbound?.message)
                          );
                        }}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-700 bg-red-50 border border-red-200 hover:bg-red-100 rounded-md transition-colors whitespace-nowrap shrink-0"
                      >
                        <Ticket className="w-3.5 h-3.5" />
                        Buat Tiket Gangguan
                      </button>
                    )}
                    <a
                      href={buildWhatsAppUrl(
                        selectedCustomer.whatsapp,
                        draftText.trim() || `Halo Bapak/Ibu ${selectedCustomer.name},`
                      )}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 rounded-md transition-colors whitespace-nowrap shrink-0"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      Buka WhatsApp Web
                    </a>
                  </div>
                </div>

                {/* Chat Message Thread */}
                <div className="flex-1 bg-slate-50 p-4 sm:p-5 space-y-3 overflow-y-auto max-h-[380px]">
                  {loadingMessages && messages.length === 0 ? (
                    <div className="py-12 text-center text-xs text-slate-500">Memuat riwayat pesan...</div>
                  ) : messages.length === 0 ? (
                    <div className="py-12 text-center text-xs text-slate-500">
                      Belum ada riwayat chat dengan {selectedCustomer.name}. Pilih template standar atau ketik pesan di bawah.
                    </div>
                  ) : (
                    messages.map((msg) => {
                      const isOut = msg.direction === 'outbound';
                      return (
                        <div
                          key={msg.id}
                          className={`flex flex-col ${isOut ? 'items-end' : 'items-start'}`}
                        >
                          <div
                            className={`max-w-[82%] rounded-lg px-3.5 py-2.5 text-xs leading-relaxed whitespace-pre-line ${
                              isOut
                                ? 'bg-red-700 text-white'
                                : 'bg-white border border-slate-200 text-slate-800'
                            }`}
                          >
                            {msg.message}
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] font-mono text-slate-400 tabular-nums">
                            {msg.template_type && (
                              <>
                                <span className="text-slate-500">{msg.template_type}</span>
                                <span aria-hidden="true">·</span>
                              </>
                            )}
                            <span>{formatDateTimeId(msg.created_at)}</span>
                            <span aria-hidden="true">·</span>
                            <span>{msg.delivery_channel}</span>
                            <span aria-hidden="true">·</span>
                            <span>{msg.delivery_status}</span>
                            {!isOut && onCreateTicket && canTicket && (
                              <>
                                <span aria-hidden="true">·</span>
                                <button
                                  type="button"
                                  onClick={() =>
                                    onCreateTicket(
                                      buildWaTicketPrefill(selectedCustomer, msg.message)
                                    )
                                  }
                                  className="font-sans font-medium text-red-700 hover:underline"
                                >
                                  Jadikan Tiket
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                  <div ref={messagesEndRef} />
                </div>

                {/* Quick Templates + Composer */}
                <div className="p-4 border-t border-slate-200 bg-white space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[11px] font-medium text-slate-500">Template Standar:</span>
                      {canSendBilling && (
                        <>
                          <button
                            type="button"
                            onClick={() => applyStandardTemplateToChat('reminder_pre_due')}
                            className={`px-2.5 py-1 text-xs font-medium rounded border transition-colors whitespace-nowrap shrink-0 ${
                              activeTemplateKey === 'reminder_pre_due'
                                ? 'bg-red-50 text-red-700 border-red-200'
                                : 'text-slate-700 bg-slate-100 border-transparent hover:bg-slate-200'
                            }`}
                          >
                            Sebelum Jatuh Tempo
                          </button>
                          <button
                            type="button"
                            onClick={() => applyStandardTemplateToChat('due_overdue')}
                            className={`px-2.5 py-1 text-xs font-medium rounded border transition-colors whitespace-nowrap shrink-0 ${
                              activeTemplateKey === 'due_overdue'
                                ? 'bg-red-50 text-red-700 border-red-200'
                                : 'text-slate-700 bg-slate-100 border-transparent hover:bg-slate-200'
                            }`}
                          >
                            Jatuh Tempo / Tunggakan
                          </button>
                        </>
                      )}
                      <button
                        type="button"
                        onClick={() => applyStandardTemplateToChat('isolation_notice')}
                        className={`px-2.5 py-1 text-xs font-medium rounded border transition-colors whitespace-nowrap shrink-0 ${
                          activeTemplateKey === 'isolation_notice'
                            ? 'bg-red-50 text-red-700 border-red-200'
                            : 'text-slate-700 bg-slate-100 border-transparent hover:bg-slate-200'
                        }`}
                      >
                        Pemberitahuan Isolir
                      </button>
                      {canSendBilling && (
                        <button
                          type="button"
                          onClick={() => applyOperationalQuickTemplate('lunas')}
                          className={`px-2.5 py-1 text-xs font-medium rounded border transition-colors whitespace-nowrap shrink-0 ${
                            activeTemplate === 'Konfirmasi Lunas'
                              ? 'bg-red-50 text-red-700 border-red-200'
                              : 'text-slate-700 bg-slate-100 border-transparent hover:bg-slate-200'
                          }`}
                        >
                          Konfirmasi Lunas
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => applyOperationalQuickTemplate('gangguan')}
                        className={`px-2.5 py-1 text-xs font-medium rounded border transition-colors whitespace-nowrap shrink-0 ${
                          activeTemplate === 'Info Gangguan / Offline'
                            ? 'bg-red-50 text-red-700 border-red-200'
                            : 'text-slate-700 bg-slate-100 border-transparent hover:bg-slate-200'
                        }`}
                      >
                        Info Gangguan
                      </button>
                      {!canSendBilling && (
                        <button
                          type="button"
                          onClick={() => applyOperationalQuickTemplate('buka_isolir')}
                          className={`px-2.5 py-1 text-xs font-medium rounded border transition-colors whitespace-nowrap shrink-0 ${
                            activeTemplate === 'Info Buka Isolir'
                              ? 'bg-red-50 text-red-700 border-red-200'
                              : 'text-slate-700 bg-slate-100 border-transparent hover:bg-slate-200'
                          }`}
                        >
                          Info Buka Isolir
                        </button>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() => setSubTab('templates')}
                      className="text-[11px] font-medium text-red-700 hover:underline whitespace-nowrap shrink-0"
                    >
                      Kelola Template Pesan
                    </button>
                  </div>

                  <textarea
                    rows={4}
                    value={draftText}
                    onChange={(e) => setDraftText(e.target.value)}
                    placeholder={`Tulis pesan WhatsApp ke ${selectedCustomer.name}...`}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-md focus:outline-none focus:border-red-600"
                  />

                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="text-xs text-slate-500">
                      {activeTemplate ? `Template aktif: ${activeTemplate}` : gatewayForm.is_active ? `Gateway API aktif (${gatewayForm.provider_name})` : 'Mode WhatsApp Web / Catat Log Chat'}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        disabled={sending || !draftText.trim()}
                        onClick={() => void handleSendMessage('gateway')}
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-50 rounded-md transition-colors whitespace-nowrap shrink-0"
                      >
                        <Send className="w-3.5 h-3.5" />
                        Kirim via WA Gateway
                      </button>
                      <a
                        href={buildWhatsAppUrl(selectedCustomer.whatsapp, draftText.trim())}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => {
                          if (!draftText.trim()) {
                            e.preventDefault();
                            return;
                          }
                          void handleSendMessage('web');
                        }}
                        className={`inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white rounded-md transition-colors whitespace-nowrap shrink-0 ${
                          draftText.trim()
                            ? 'bg-emerald-700 hover:bg-emerald-800'
                            : 'bg-emerald-700/50 pointer-events-none'
                        }`}
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        Simpan &amp; Buka WhatsApp
                      </a>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {subTab === 'templates' && (
        <div className="space-y-5">
          {/* Template Selector & Policy Header */}
          <div className="bg-white border border-slate-200 rounded-lg p-4 flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-1">
              <h2 className="text-sm font-semibold text-slate-900">
                Standarisasi Template Pesan WhatsApp Jatara IP-Home
              </h2>
              <p className="text-xs text-slate-500">
                Atur redaksi standar pengingat tagihan &amp; isolir dengan kebijakan 0% denda keterlambatan dan substitusi variabel otomatis.
              </p>
            </div>

            <div className="inline-flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-md">
              {(['reminder_pre_due', 'due_overdue', 'isolation_notice'] as WhatsAppTemplateKey[]).map((key) => {
                const active = selectedTplKey === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setSelectedTplKey(key)}
                    className={`px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                      active
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {TEMPLATE_KEY_META[key].shortLabel}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Editor Form */}
            <form
              onSubmit={handleSaveTemplate}
              className="lg:col-span-7 bg-white border border-slate-200 rounded-lg p-5 space-y-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3 pb-3 border-b border-slate-100">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <FileText className="w-4 h-4 text-red-700 shrink-0" />
                    <h3 className="text-base font-semibold text-slate-900">
                      {activeTemplateObj?.title || TEMPLATE_KEY_META[selectedTplKey].shortLabel}
                    </h3>
                  </div>
                  <div className="text-xs text-slate-500">
                    {TEMPLATE_KEY_META[selectedTplKey].categoryHint}
                  </div>
                </div>

                {!canEditSelectedTemplate && (
                  <ReadOnlyBadge
                    label={
                      currentUser.role === 'Keuangan'
                        ? 'Khusus Admin (Read-Only)'
                        : 'Lihat Saja (Read-Only)'
                    }
                  />
                )}
              </div>

              {activeTemplateObj?.description && (
                <p className="text-xs text-slate-600 leading-relaxed">
                  {activeTemplateObj.description}
                </p>
              )}

              <div>
                <label
                  htmlFor="wa-tpl-title"
                  className="block text-xs font-medium text-slate-700 mb-1"
                >
                  Nama / Label Template
                </label>
                <input
                  id="wa-tpl-title"
                  type="text"
                  disabled={!canEditSelectedTemplate}
                  value={tplTitleDraft}
                  onChange={(e) => setTplTitleDraft(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-md focus:outline-none focus:border-red-600 disabled:bg-slate-50 disabled:text-slate-500"
                />
              </div>

              <div className="space-y-1.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-medium text-slate-700">
                    Variabel Dinamis (klik untuk menyisipkan):
                  </span>
                  <span className="text-[11px] text-slate-400">
                    Terisi otomatis saat dikirim
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {WHATSAPP_TEMPLATE_VARIABLES.map((v) => (
                    <button
                      key={v.token}
                      type="button"
                      disabled={!canEditSelectedTemplate}
                      onClick={() => handleInsertVariable(v.token)}
                      title={`${v.label} (Contoh: ${v.example})`}
                      className="px-2.5 py-1 text-xs font-mono text-slate-700 bg-slate-100 hover:bg-red-50 hover:text-red-700 border border-slate-200 rounded transition-colors disabled:opacity-60 disabled:cursor-not-allowed whitespace-nowrap shrink-0"
                    >
                      {v.token}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label
                  htmlFor="wa-tpl-body"
                  className="block text-xs font-medium text-slate-700 mb-1"
                >
                  Isi Template Pesan WhatsApp
                </label>
                <textarea
                  ref={tplTextareaRef}
                  id="wa-tpl-body"
                  rows={12}
                  disabled={!canEditSelectedTemplate}
                  value={tplBodyDraft}
                  onChange={(e) => setTplBodyDraft(e.target.value)}
                  className="w-full px-3 py-2.5 text-xs font-sans leading-relaxed border border-slate-200 rounded-md focus:outline-none focus:border-red-600 disabled:bg-slate-50 disabled:text-slate-600"
                />
              </div>

              <div className="pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3">
                <div className="text-[11px] font-mono text-slate-500 tabular-nums">
                  {activeTemplateObj
                    ? `Terakhir diubah: @${activeTemplateObj.updated_by} · ${formatDateTimeWib(activeTemplateObj.updated_at)}`
                    : 'Memuat riwayat template...'}
                </div>

                {canEditSelectedTemplate && (
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={resettingTpl || savingTpl}
                      onClick={() => void handleResetTemplate()}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-50 rounded-md transition-colors whitespace-nowrap shrink-0"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      {resettingTpl ? 'Mereset...' : 'Reset Default'}
                    </button>
                    <button
                      type="submit"
                      disabled={savingTpl || resettingTpl || !tplBodyDraft.trim()}
                      className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-red-700 hover:bg-red-800 disabled:opacity-50 rounded-md transition-colors whitespace-nowrap shrink-0"
                    >
                      <Save className="w-3.5 h-3.5" />
                      {savingTpl ? 'Menyimpan...' : 'Simpan Template'}
                    </button>
                  </div>
                )}
              </div>
            </form>

            {/* Live Preview Panel */}
            <div className="lg:col-span-5 bg-white border border-slate-200 rounded-lg p-5 space-y-4">
              <div className="flex items-center justify-between gap-2 pb-3 border-b border-slate-100">
                <div className="flex items-center gap-2">
                  <Eye className="w-4 h-4 text-emerald-700 shrink-0" />
                  <h3 className="text-base font-semibold text-slate-900">Pratinjau Pesan</h3>
                </div>
                <button
                  type="button"
                  onClick={handleCopyPreview}
                  className="inline-flex items-center gap-1 text-xs font-medium text-red-700 hover:underline whitespace-nowrap shrink-0"
                >
                  {previewCopied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  {previewCopied ? 'Tersalin' : 'Salin Pratinjau'}
                </button>
              </div>

              <div>
                <label
                  htmlFor="wa-preview-source"
                  className="block text-xs font-medium text-slate-700 mb-1"
                >
                  Pilih Data Pelanggan untuk Pratinjau
                </label>
                <select
                  id="wa-preview-source"
                  value={previewSource}
                  onChange={(e) => setPreviewSource(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-md bg-white focus:outline-none focus:border-red-600"
                >
                  <option value="sample">Data Sampel Default (Hendra Kurniawan · PLG-006)</option>
                  {conversations.map((c) => (
                    <option key={c.customer_id} value={String(c.customer_id)}>
                      {c.name} ({c.customer_code}) · {c.device_status}
                      {c.latest_billing_period ? ` · ${formatPeriodLabel(c.latest_billing_period)}` : ''}
                    </option>
                  ))}
                </select>
              </div>

              {/* Active Variable Values Readout */}
              <div className="bg-slate-50 border border-slate-200 rounded-md p-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px]">
                <div>
                  <span className="font-mono text-slate-400">{'{nama}'}</span>
                  <div className="font-medium text-slate-800 truncate">{previewVars.nama}</div>
                </div>
                <div>
                  <span className="font-mono text-slate-400">{'{kode_pelanggan}'}</span>
                  <div className="font-mono font-medium text-slate-800 tabular-nums">{previewVars.kode_pelanggan}</div>
                </div>
                <div>
                  <span className="font-mono text-slate-400">{'{paket}'}</span>
                  <div className="font-medium text-slate-800 truncate">{previewVars.paket}</div>
                </div>
                <div>
                  <span className="font-mono text-slate-400">{'{tagihan}'}</span>
                  <div className="font-mono font-semibold text-slate-900 tabular-nums">{previewVars.tagihan}</div>
                </div>
                <div>
                  <span className="font-mono text-slate-400">{'{jatuh_tempo}'}</span>
                  <div className="font-mono text-slate-800 tabular-nums">{previewVars.jatuh_tempo}</div>
                </div>
                <div>
                  <span className="font-mono text-slate-400">{'{periode}'}</span>
                  <div className="text-slate-800">{previewVars.periode}</div>
                </div>
              </div>

              {/* Rendered WhatsApp Bubble */}
              <div className="space-y-1.5">
                <div className="text-[11px] font-medium text-slate-500">
                  Hasil Pesan Terformat (WhatsApp):
                </div>
                <div className="bg-emerald-50/60 border border-emerald-200 rounded-lg p-4 text-xs text-slate-800 leading-relaxed whitespace-pre-line">
                  {renderedPreview || 'Template pesan kosong.'}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {subTab === 'gateway' && (
        /* Tab 3: WA Gateway API & Webhook Masuk */
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Gateway Config Form */}
          <div className="lg:col-span-6 bg-white border border-slate-200 rounded-lg p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Settings className="w-4 h-4 text-red-700" />
                <h2 className="text-base font-semibold text-slate-900">
                  Konfigurasi WhatsApp Gateway API (Opsional)
                </h2>
              </div>
              {!canEditGateway && <ReadOnlyBadge label="Khusus Admin (Read-Only)" />}
            </div>
            <p className="text-xs text-slate-500">
              Hubungkan layanan WhatsApp Gateway (Fonnte, Wablas, WAHA, atau server mandiri) agar pesan dapat dikirim otomatis langsung dari tombol <strong>Kirim via WA Gateway</strong>.
            </p>

            <form onSubmit={handleSaveGateway} className="space-y-3.5">
              <fieldset disabled={!canEditGateway} className="space-y-3.5 disabled:opacity-70">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Provider Gateway</label>
                    <input
                      type="text"
                      value={gatewayForm.provider_name}
                      onChange={(e) => setGatewayForm({ ...gatewayForm, provider_name: e.target.value })}
                      placeholder="Fonnte / Wablas / WAHA"
                      className="w-full px-3 py-2 text-xs border border-slate-200 rounded-md"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Nomor Pengirim (CS/NOC)</label>
                    <input
                      type="text"
                      value={gatewayForm.sender_number}
                      onChange={(e) => setGatewayForm({ ...gatewayForm, sender_number: e.target.value })}
                      className="w-full px-3 py-2 text-xs font-mono border border-slate-200 rounded-md"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">URL Endpoint Kirim Pesan (POST)</label>
                  <input
                    type="url"
                    value={gatewayForm.api_url}
                    onChange={(e) => setGatewayForm({ ...gatewayForm, api_url: e.target.value })}
                    placeholder="https://api.fonnte.com/send"
                    className="w-full px-3 py-2 text-xs font-mono border border-slate-200 rounded-md"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    API Key / Token {gatewayForm.api_token_masked ? `(Saat ini: ${gatewayForm.api_token_masked})` : ''}
                  </label>
                  <input
                    type="password"
                    value={gatewayForm.api_token}
                    onChange={(e) => setGatewayForm({ ...gatewayForm, api_token: e.target.value })}
                    placeholder="Masukkan token baru atau biarkan kosong"
                    className="w-full px-3 py-2 text-xs font-mono border border-slate-200 rounded-md"
                  />
                </div>

                <label className="inline-flex items-center gap-2 text-xs text-slate-700 cursor-pointer pt-1">
                  <input
                    type="checkbox"
                    checked={gatewayForm.is_active}
                    onChange={(e) => setGatewayForm({ ...gatewayForm, is_active: e.target.checked })}
                    className="rounded border-slate-300 text-red-700"
                  />
                  Aktifkan pengiriman langsung via WA Gateway API
                </label>
              </fieldset>

              {canEditGateway && (
                <div className="pt-2 flex justify-end">
                  <button
                    type="submit"
                    disabled={savingGateway}
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-red-700 hover:bg-red-800 disabled:opacity-50 rounded-md transition-colors"
                  >
                    <Save className="w-3.5 h-3.5" />
                    {savingGateway ? 'Menyimpan...' : 'Simpan Pengaturan'}
                  </button>
                </div>
              )}
            </form>
          </div>

          {/* Inbound Webhook Receiver & Simulator */}
          <div className="lg:col-span-6 bg-white border border-slate-200 rounded-lg p-5 space-y-4">
            <div className="flex items-center gap-2">
              <Webhook className="w-4 h-4 text-emerald-700" />
              <h2 className="text-base font-semibold text-slate-900">
                Webhook Penerima Balasan WhatsApp Pelanggan
              </h2>
            </div>
            <p className="text-xs text-slate-500">
              Arahkan webhook pesan masuk dari WA Gateway Anda ke endpoint berikut agar balasan pelanggan muncul otomatis di Inbox Chat:
            </p>
            <div className="font-mono text-xs text-slate-900 bg-slate-50 border border-slate-200 rounded px-3 py-2 break-all">
              POST {inboundWebhookUrl}
            </div>

            <form onSubmit={handleSimulateInbound} className="pt-2 border-t border-slate-100 space-y-3">
              <div className="text-xs font-semibold text-slate-800">
                Uji Simulasi Pesan Masuk dari Pelanggan
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Pilih Pelanggan Pengirim</label>
                <select
                  value={simPhone}
                  onChange={(e) => setSimPhone(e.target.value)}
                  className="w-full px-3 py-2 text-xs font-mono border border-slate-200 rounded-md"
                >
                  {conversations.map((c) => (
                    <option key={c.customer_id} value={c.whatsapp}>
                      {c.name} ({c.whatsapp})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Isi Balasan Pelanggan</label>
                <textarea
                  rows={2}
                  value={simMessage}
                  onChange={(e) => setSimMessage(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-md"
                />
              </div>
              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={simulatingInbound}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 rounded-md transition-colors"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  {simulatingInbound ? 'Memproses...' : 'Simulasikan Pesan Masuk'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
