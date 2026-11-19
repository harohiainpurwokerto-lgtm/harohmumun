import { Eye, Lock } from 'lucide-react';

export function ReadOnlyBadge({
  label = 'Akses Lihat Saja (Read-Only)',
}: {
  label?: string;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded border bg-amber-50 text-amber-800 border-amber-200 whitespace-nowrap shrink-0">
      <Eye className="w-3.5 h-3.5 text-amber-700 shrink-0" aria-hidden="true" />
      <span>{label}</span>
    </span>
  );
}

export function ReadOnlyBanner({
  title = 'Mode Akses Lihat Saja (Read-Only)',
  description,
}: {
  title?: string;
  description: string;
}) {
  return (
    <div
      role="status"
      className="bg-amber-50/70 border border-amber-200 rounded-lg px-4 py-3 flex flex-wrap items-start sm:items-center justify-between gap-3"
    >
      <div className="flex items-start sm:items-center gap-2.5 text-xs text-amber-900">
        <Lock className="w-4 h-4 text-amber-700 shrink-0 mt-0.5 sm:mt-0" aria-hidden="true" />
        <div>
          <span className="font-semibold text-amber-950">{title}:</span>{' '}
          <span className="text-amber-900">{description}</span>
        </div>
      </div>
      <ReadOnlyBadge />
    </div>
  );
}
