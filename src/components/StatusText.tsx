import { CheckCircle2, Clock, ShieldAlert, Wifi, WifiOff } from 'lucide-react';
import type { DeviceStatus, InvoiceStatus } from '../types';

export function DeviceStatusLabel({ status }: { status: DeviceStatus }) {
  if (status === 'Online') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 whitespace-nowrap shrink-0">
        <Wifi className="w-3.5 h-3.5 text-emerald-600 shrink-0" aria-hidden="true" />
        <span>Online</span>
      </span>
    );
  }
  if (status === 'Isolir') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700 whitespace-nowrap shrink-0">
        <ShieldAlert className="w-3.5 h-3.5 text-amber-600 shrink-0" aria-hidden="true" />
        <span>Isolir</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-rose-700 whitespace-nowrap shrink-0">
      <WifiOff className="w-3.5 h-3.5 text-rose-600 shrink-0" aria-hidden="true" />
      <span>Offline</span>
    </span>
  );
}

export function InvoiceStatusLabel({ status }: { status: InvoiceStatus }) {
  if (status === 'Lunas') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 whitespace-nowrap shrink-0">
        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" aria-hidden="true" />
        <span>Lunas</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-rose-700 whitespace-nowrap shrink-0">
      <Clock className="w-3.5 h-3.5 text-rose-600 shrink-0" aria-hidden="true" />
      <span>Belum Lunas</span>
    </span>
  );
}
