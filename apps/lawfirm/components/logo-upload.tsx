'use client';

import { useState } from 'react';
import type { Locale } from '@/lib/i18n';
import { t } from '@/lib/i18n';

/**
 * Logo picker that converts the chosen image to a data: URI and stores it in a
 * hidden `logoUrl` input — self-contained, no blob storage needed. Small images
 * only (capped ~180 KB) so the base64 stays comfortably within a text column.
 */
export function LogoUpload({ locale, initial }: { locale: Locale; initial: string | null }) {
  const [dataUrl, setDataUrl] = useState<string>(initial ?? '');
  const [error, setError] = useState<string>('');

  function onFile(file: File | undefined) {
    setError('');
    if (!file) return;
    if (file.size > 180_000) {
      setError(locale === 'he' ? 'הקובץ גדול מדי (עד 180KB)' : 'File too large (max 180KB)');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setDataUrl(String(reader.result ?? ''));
    reader.readAsDataURL(file);
  }

  return (
    <div className="md:col-span-2">
      <label className="label">{t(locale, 'logo')}</label>
      <input type="hidden" name="logoUrl" value={dataUrl} />
      <div className="flex items-center gap-4 flex-wrap">
        {dataUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={dataUrl} alt="logo" className="h-14 max-w-[180px] object-contain bg-white rounded p-1" />
        ) : (
          <div className="h-14 w-14 rounded bg-slate-800 grid place-items-center text-slate-500 text-xs">—</div>
        )}
        <input type="file" accept="image/*" className="text-sm text-slate-300" onChange={(e) => onFile(e.target.files?.[0])} />
        {dataUrl ? (
          <button type="button" className="btn-ghost" onClick={() => setDataUrl('')}>
            {t(locale, 'removeLogo')}
          </button>
        ) : null}
      </div>
      {error ? <p className="text-xs text-red-400 mt-1">{error}</p> : null}
      <p className="text-xs text-slate-500 mt-1">{t(locale, 'logoHelp')}</p>
    </div>
  );
}
