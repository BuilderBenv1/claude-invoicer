import { getSettings, localeOf } from '@/lib/settings';
import { t } from '@/lib/i18n';
import { updateSettings, sendMonthlyNow } from '@/lib/actions';
import { prevMonthKey } from '@/lib/time';
import { LogoUpload } from '@/components/logo-upload';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const s = await getSettings();
  const locale = localeOf(s);
  const defaultMonth = prevMonthKey(new Date(), s.timezone);

  return (
    <div className="space-y-8 max-w-2xl">
      <h1 className="text-2xl font-semibold">{t(locale, 'settings')}</h1>

      <form action={updateSettings} className="card grid gap-4 md:grid-cols-2">
        <div className="md:col-span-2 text-sm font-medium text-slate-300">{t(locale, 'firmName')}</div>
        <div className="md:col-span-2">
          <label className="label">{t(locale, 'firmName')}</label>
          <input name="firmName" className="input" defaultValue={s.firmName} />
        </div>
        <div>
          <label className="label">{t(locale, 'firmEmail')}</label>
          <input name="firmEmail" type="email" className="input" defaultValue={s.firmEmail ?? ''} />
        </div>
        <div>
          <label className="label">{t(locale, 'firmPhone')}</label>
          <input name="firmPhone" className="input" defaultValue={s.firmPhone ?? ''} />
        </div>
        <div className="md:col-span-2">
          <label className="label">{t(locale, 'firmAddress')}</label>
          <input name="firmAddress" className="input" defaultValue={s.firmAddress ?? ''} />
        </div>
        <div>
          <label className="label">{t(locale, 'taxId')}</label>
          <input name="taxId" className="input" defaultValue={s.taxId ?? ''} />
        </div>
        <div>
          <label className="label">{t(locale, 'reportEmail')}</label>
          <input name="reportEmail" type="email" className="input" defaultValue={s.reportEmail ?? ''} placeholder="reports@..." />
        </div>

        <LogoUpload locale={locale} initial={s.logoUrl} />

        <div className="md:col-span-2 border-t border-slate-800 pt-4 text-sm font-medium text-slate-300">
          {t(locale, 'defaultHourlyRate')} · {t(locale, 'currency')}
        </div>
        <div>
          <label className="label">{t(locale, 'defaultHourlyRate')}</label>
          <input name="defaultHourlyRate" type="number" step="0.01" min="0" className="input" defaultValue={s.defaultHourlyRate} />
        </div>
        <div>
          <label className="label">{t(locale, 'currency')}</label>
          <input name="defaultCurrency" className="input" defaultValue={s.defaultCurrency} />
        </div>
        <div>
          <label className="label">{t(locale, 'roundIncrement')}</label>
          <input name="roundIncrementMin" type="number" step="1" min="1" className="input" defaultValue={s.roundIncrementMin} />
        </div>
        <div>
          <label className="label">{t(locale, 'timezone')}</label>
          <input name="timezone" className="input" defaultValue={s.timezone} />
        </div>
        <div>
          <label className="label">{t(locale, 'language')}</label>
          <select name="locale" className="input" defaultValue={s.locale}>
            <option value="he">עברית</option>
            <option value="en">English</option>
          </select>
        </div>
        <div className="flex items-end">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="autoSendMonthly" value="1" defaultChecked={s.autoSendMonthly === 1} className="w-4 h-4" />
            {t(locale, 'autoSendMonthly')}
          </label>
        </div>

        <div className="md:col-span-2">
          <button className="btn-primary" type="submit">
            {t(locale, 'save')}
          </button>
        </div>
      </form>

      {/* Send a month's report now */}
      <form action={sendMonthlyNow} className="card flex items-end gap-3 flex-wrap">
        <div>
          <label className="label">{t(locale, 'month')}</label>
          <input name="monthKey" type="month" className="input" defaultValue={defaultMonth} />
        </div>
        <button className="btn-ghost" type="submit">
          {locale === 'he' ? 'שלח דוח חודשי עכשיו' : 'Send monthly report now'}
        </button>
        <p className="text-xs text-slate-500 w-full">
          {locale === 'he'
            ? 'הדוח נשלח לכתובת שהוגדרה לקבלת דוחות חודשיים, עם קובץ CSV מצורף.'
            : 'Sent to the configured report email, with a CSV attached.'}
        </p>
      </form>
    </div>
  );
}
