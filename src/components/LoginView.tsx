import { useState } from 'react';
import type { FormEvent } from 'react';
import {
  AlertCircle,
  Eye,
  EyeOff,
  Home,
  KeyRound,
  Lock,
  LogIn,
  ShieldCheck,
  User,
  Wallet,
  Wrench,
} from 'lucide-react';
import type { AuthUser, CustomerPortalData, UserRole } from '../types';

interface LoginViewProps {
  onLoginSuccess: (token: string, user: AuthUser) => void;
  onCustomerLoginSuccess: (token: string, portal: CustomerPortalData) => void;
}

interface QuickAccountOption {
  role: UserRole;
  title: string;
  username: string;
  password: string;
  scopeSummary: string;
  icon: typeof ShieldCheck;
}

interface QuickCustomerOption {
  customerCode: string;
  pin: string;
  name: string;
  statusNote: string;
}

const QUICK_ACCOUNTS: QuickAccountOption[] = [
  {
    role: 'Admin',
    title: 'Admin Utama',
    username: 'admin',
    password: 'admin123',
    scopeSummary: 'Akses penuh seluruh modul, Batal Lunas & atur PIN portal pelanggan',
    icon: ShieldCheck,
  },
  {
    role: 'Teknisi',
    title: 'Teknisi NOC',
    username: 'teknisi',
    password: 'teknisi123',
    scopeSummary: 'Monitoring NOC, ODP/ONT, Isolir & cek pelanggan/tagihan (Read-Only)',
    icon: Wrench,
  },
  {
    role: 'Keuangan',
    title: 'Bagian Keuangan',
    username: 'keuangan',
    password: 'keuangan123',
    scopeSummary: 'Billing & Catat Lunas, Laporan Excel, WA & pelanggan (Read-Only)',
    icon: Wallet,
  },
];

const QUICK_CUSTOMERS: QuickCustomerOption[] = [
  {
    customerCode: 'PLG-001',
    pin: '123456',
    name: 'Budi Santoso',
    statusNote: 'Layanan Online · Tagihan Lunas Semua',
  },
  {
    customerCode: 'PLG-006',
    pin: '123456',
    name: 'Hendra Kurniawan',
    statusNote: 'Status Isolir · 2 Tagihan Belum Lunas',
  },
  {
    customerCode: 'PLG-003',
    pin: '123456',
    name: 'Rudi Hermawan',
    statusNote: 'Modem Offline · 1 Tagihan Aktif',
  },
];

export function LoginView({ onLoginSuccess, onCustomerLoginSuccess }: LoginViewProps) {
  const [loginMode, setLoginMode] = useState<'staff' | 'customer'>('staff');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [customerCode, setCustomerCode] = useState('');
  const [customerPin, setCustomerPin] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showPin, setShowPin] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [logoError, setLogoError] = useState(false);

  async function submitCredentials(userVal: string, passVal: string) {
    setErrorMsg(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: userVal.trim(),
          password: passVal,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setErrorMsg(json.error || 'Gagal masuk. Periksa username dan password Anda.');
        return;
      }
      onLoginSuccess(json.token, json.user);
    } catch {
      setErrorMsg('Tidak dapat terhubung ke server autentikasi.');
    } finally {
      setSubmitting(false);
    }
  }

  async function submitCustomerCredentials(codeVal: string, pinVal: string) {
    setErrorMsg(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/auth/customer-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer_code: codeVal.trim().toUpperCase(),
          pin: pinVal.trim(),
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setErrorMsg(json.error || 'Gagal masuk portal. Periksa Kode Pelanggan dan PIN Anda.');
        return;
      }
      onCustomerLoginSuccess(json.token, json.portal);
    } catch {
      setErrorMsg('Tidak dapat terhubung ke server autentikasi.');
    } finally {
      setSubmitting(false);
    }
  }

  function handleStaffSubmit(e: FormEvent) {
    e.preventDefault();
    void submitCredentials(username, password);
  }

  function handleCustomerSubmit(e: FormEvent) {
    e.preventDefault();
    void submitCustomerCredentials(customerCode, customerPin);
  }

  function handleQuickLogin(acc: QuickAccountOption) {
    setLoginMode('staff');
    setUsername(acc.username);
    setPassword(acc.password);
    void submitCredentials(acc.username, acc.password);
  }

  function handleQuickCustomerLogin(cust: QuickCustomerOption) {
    setLoginMode('customer');
    setCustomerCode(cust.customerCode);
    setCustomerPin(cust.pin);
    void submitCustomerCredentials(cust.customerCode, cust.pin);
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4 sm:p-6">
      <div className="max-w-5xl w-full bg-white border border-slate-200 rounded-xl overflow-hidden grid grid-cols-1 lg:grid-cols-12 items-stretch">
        {/* Left Brand & Access Overview Panel */}
        <section className="lg:col-span-5 bg-red-700 text-white p-6 sm:p-8 flex flex-col justify-between gap-8">
          <div className="space-y-6">
            <div className="bg-white rounded-lg px-3.5 py-2.5 inline-flex items-center gap-2.5 shadow-xs">
              {!logoError ? (
                <img
                  src="/assets/jatara_logo_full.png"
                  alt="Logo Jatara"
                  referrerPolicy="no-referrer"
                  onError={() => setLogoError(true)}
                  className="h-7 w-auto object-contain shrink-0"
                />
              ) : (
                <span className="font-display text-base font-bold text-red-700 whitespace-nowrap shrink-0">
                  Jatara
                </span>
              )}
              <span className="h-5 w-px bg-red-200 shrink-0" aria-hidden="true" />
              <div className="flex items-center gap-1.5">
                <span className="font-display text-base font-bold tracking-tight text-red-700 whitespace-nowrap shrink-0">
                  IP-Home
                </span>
                <svg
                  viewBox="0 0 36 32"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                  className="w-7 h-6 text-red-600 shrink-0"
                  aria-label="Sketsa Rumah IP-Home"
                >
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
                  <path
                    d="M24.5 9.2V5.5H27.8V11.8"
                    stroke="currentColor"
                    strokeWidth="1.35"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
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

            <div className="space-y-2">
              <h1 className="font-display text-2xl font-bold tracking-tight text-white text-balance">
                {loginMode === 'customer'
                  ? 'Portal Pelanggan Jatara IP-Home'
                  : 'Sistem Billing & Monitoring Jaringan'}
              </h1>
              <p className="text-sm text-red-100 leading-relaxed">
                {loginMode === 'customer'
                  ? 'Cek status koneksi internet, rincian paket, tagihan aktif dengan kebijakan 0% denda, dan konfirmasi pembayaran langsung via WhatsApp.'
                  : 'Kontrol akses terpisah antara Administrator, Teknisi NOC, Bagian Keuangan, dan Portal Pelanggan yang terisolasi.'}
              </p>
            </div>
          </div>

          <div className="space-y-3 pt-4 border-t border-red-600/80 text-xs">
            <div className="font-semibold text-white">Pembagian Akses Sistem</div>
            <div className="space-y-2.5 text-red-100">
              <div>
                <span className="font-semibold text-white">Admin</span>
                <span aria-hidden="true"> · </span>
                <span>Akses penuh seluruh modul, Batal Lunas &amp; kelola PIN pelanggan.</span>
              </div>
              <div>
                <span className="font-semibold text-white">Teknisi</span>
                <span aria-hidden="true"> · </span>
                <span>Fokus monitoring OLT/MikroTik, topologi peta ONT &amp; tiket gangguan.</span>
              </div>
              <div>
                <span className="font-semibold text-white">Keuangan</span>
                <span aria-hidden="true"> · </span>
                <span>Fokus tagihan bulanan, pelunasan invoice, pengingat WA &amp; laporan kas.</span>
              </div>
              <div>
                <span className="font-semibold text-white">Pelanggan</span>
                <span aria-hidden="true"> · </span>
                <span>Portal khusus untuk melihat paket, status layanan &amp; tagihan akun sendiri.</span>
              </div>
            </div>
          </div>
        </section>

        {/* Right Login Form Panel */}
        <section className="lg:col-span-7 p-6 sm:p-8 flex flex-col justify-between gap-6">
          <div>
            {/* Mode Switcher: Staff Internal vs Customer Portal */}
            <div className="grid grid-cols-2 gap-1.5 p-1 bg-slate-100 rounded-lg mb-5">
              <button
                type="button"
                onClick={() => {
                  setLoginMode('staff');
                  setErrorMsg(null);
                }}
                className={`inline-flex items-center justify-center gap-2 px-3 py-2 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
                  loginMode === 'staff'
                    ? 'bg-white text-red-700 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <ShieldCheck className="w-4 h-4 shrink-0" />
                Login Staf Internal
              </button>
              <button
                type="button"
                onClick={() => {
                  setLoginMode('customer');
                  setErrorMsg(null);
                }}
                className={`inline-flex items-center justify-center gap-2 px-3 py-2 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
                  loginMode === 'customer'
                    ? 'bg-white text-red-700 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Home className="w-4 h-4 shrink-0" />
                Portal Pelanggan
              </button>
            </div>

            {loginMode === 'staff' ? (
              <>
                <h2 className="font-display text-xl font-bold text-slate-900">
                  Masuk ke Akun Staf
                </h2>
                <p className="text-xs text-slate-500 mt-1">
                  Masukkan username dan password akun staf Anda untuk membuka ruang kerja sesuai izin akses.
                </p>
              </>
            ) : (
              <>
                <h2 className="font-display text-xl font-bold text-slate-900">
                  Masuk ke Portal Pelanggan
                </h2>
                <p className="text-xs text-slate-500 mt-1">
                  Gunakan Kode Pelanggan (contoh: <span className="font-mono">PLG-001</span>) dan PIN Portal dari Admin Jatara IP-Home.
                </p>
              </>
            )}

            {errorMsg && (
              <div
                role="alert"
                className="mt-4 px-3.5 py-2.5 bg-rose-50 border border-rose-200 rounded-md flex items-start gap-2 text-xs text-rose-800"
              >
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                <span>{errorMsg}</span>
              </div>
            )}

            {loginMode === 'staff' ? (
              <form onSubmit={handleStaffSubmit} className="mt-5 space-y-4">
                <div>
                  <label htmlFor="login-username" className="block text-xs font-medium text-slate-700 mb-1.5">
                    Username
                  </label>
                  <div className="relative">
                    <User className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      id="login-username"
                      type="text"
                      required
                      autoComplete="username"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      placeholder="Contoh: admin, teknisi, atau keuangan"
                      className="w-full pl-9 pr-3 py-2.5 text-sm border border-slate-200 rounded-md focus:outline-none focus:border-red-600"
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="login-password" className="block text-xs font-medium text-slate-700 mb-1.5">
                    Password
                  </label>
                  <div className="relative">
                    <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      id="login-password"
                      type={showPassword ? 'text' : 'password'}
                      required
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Masukkan password akun"
                      className="w-full pl-9 pr-10 py-2.5 text-sm border border-slate-200 rounded-md focus:outline-none focus:border-red-600"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((prev) => !prev)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-700"
                      aria-label={showPassword ? 'Sembunyikan password' : 'Tampilkan password'}
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-red-600 hover:bg-red-700 disabled:opacity-60 rounded-md transition-colors whitespace-nowrap"
                >
                  <LogIn className="w-4 h-4 shrink-0" />
                  {submitting ? 'Memverifikasi Akun...' : 'Masuk ke Dasbor Staf'}
                </button>
              </form>
            ) : (
              <form onSubmit={handleCustomerSubmit} className="mt-5 space-y-4">
                <div>
                  <label htmlFor="login-customer-code" className="block text-xs font-medium text-slate-700 mb-1.5">
                    Kode Pelanggan
                  </label>
                  <div className="relative">
                    <User className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      id="login-customer-code"
                      type="text"
                      required
                      value={customerCode}
                      onChange={(e) => setCustomerCode(e.target.value.toUpperCase())}
                      placeholder="Contoh: PLG-001"
                      className="w-full pl-9 pr-3 py-2.5 text-sm font-mono uppercase border border-slate-200 rounded-md focus:outline-none focus:border-red-600"
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="login-customer-pin" className="block text-xs font-medium text-slate-700 mb-1.5">
                    PIN / Password Portal
                  </label>
                  <div className="relative">
                    <KeyRound className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      id="login-customer-pin"
                      type={showPin ? 'text' : 'password'}
                      required
                      value={customerPin}
                      onChange={(e) => setCustomerPin(e.target.value)}
                      placeholder="Masukkan PIN portal pelanggan"
                      className="w-full pl-9 pr-10 py-2.5 text-sm font-mono border border-slate-200 rounded-md focus:outline-none focus:border-red-600"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPin((prev) => !prev)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-700"
                      aria-label={showPin ? 'Sembunyikan PIN' : 'Tampilkan PIN'}
                    >
                      {showPin ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-red-600 hover:bg-red-700 disabled:opacity-60 rounded-md transition-colors whitespace-nowrap"
                >
                  <Home className="w-4 h-4 shrink-0" />
                  {submitting ? 'Memverifikasi Pelanggan...' : 'Masuk ke Portal Pelanggan'}
                </button>
              </form>
            )}
          </div>

          {/* Quick Demo Access */}
          <div className="pt-5 border-t border-slate-200 space-y-3">
            {loginMode === 'staff' ? (
              <>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-slate-700">
                    Uji Cepat Akun Bawaan per Peran
                  </span>
                  <span className="text-[11px] text-slate-400">
                    Klik untuk langsung masuk
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  {QUICK_ACCOUNTS.map((acc) => {
                    const Icon = acc.icon;
                    return (
                      <button
                        key={acc.role}
                        type="button"
                        disabled={submitting}
                        onClick={() => handleQuickLogin(acc)}
                        className="text-left p-3 border border-slate-200 hover:border-red-300 hover:bg-red-50/40 rounded-lg transition-colors flex flex-col justify-between gap-2 disabled:opacity-60"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-semibold text-slate-900">{acc.title}</span>
                          <Icon className="w-4 h-4 text-red-600 shrink-0" aria-hidden="true" />
                        </div>
                        <p className="text-[11px] text-slate-500 leading-snug">
                          {acc.scopeSummary}
                        </p>
                        <div className="font-mono text-[11px] text-red-700 pt-1 border-t border-slate-100 tabular-nums">
                          {acc.username} / {acc.password}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-slate-700">
                    Uji Cepat Akun Portal Pelanggan
                  </span>
                  <span className="text-[11px] text-slate-400">
                    PIN bawaan: 123456
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  {QUICK_CUSTOMERS.map((cust) => (
                    <button
                      key={cust.customerCode}
                      type="button"
                      disabled={submitting}
                      onClick={() => handleQuickCustomerLogin(cust)}
                      className="text-left p-3 border border-slate-200 hover:border-red-300 hover:bg-red-50/40 rounded-lg transition-colors flex flex-col justify-between gap-2 disabled:opacity-60"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-slate-900 truncate">{cust.name}</span>
                        <Home className="w-4 h-4 text-red-600 shrink-0" aria-hidden="true" />
                      </div>
                      <p className="text-[11px] text-slate-500 leading-snug">
                        {cust.statusNote}
                      </p>
                      <div className="font-mono text-[11px] text-red-700 pt-1 border-t border-slate-100 tabular-nums">
                        {cust.customerCode} / PIN {cust.pin}
                      </div>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
