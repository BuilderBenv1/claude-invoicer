import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getClientDetail } from '@/lib/queries';
import { getSettings, localeOf } from '@/lib/settings';
import { t } from '@/lib/i18n';
import { money } from '@/lib/format';
import { updateClient, archiveClient, createProject } from '@/lib/actions';

export const dynamic = 'force-dynamic';

export default async function ClientPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await getSettings();
  const locale = localeOf(s);
  const detail = await getClientDetail(id);
  if (!detail) notFound();
  const { client, cases } = detail;

  return (
    <div className="space-y-8">
      <header>
        <Link href="/clients" className="text-xs text-slate-500 hover:underline">
          ← {t(locale, 'clients')}
        </Link>
        <h1 className="text-2xl font-semibold">{client.name}</h1>
        <div className="text-xs text-slate-500">
          {money(client.hourlyRate, client.currency, locale)} {t(locale, 'perHour')}
          {client.email ? ` · ${client.email}` : ''}
          {client.phone ? ` · ${client.phone}` : ''}
        </div>
      </header>

      {/* Cases */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">{t(locale, 'cases')}</h2>
        </div>

        <details className="card">
          <summary className="cursor-pointer font-medium">＋ {t(locale, 'addCase')}</summary>
          <form action={createProject} className="grid gap-3 md:grid-cols-2 mt-4">
            <input type="hidden" name="clientId" value={client.id} />
            <div>
              <label className="label">{t(locale, 'name')}</label>
              <input name="name" className="input" required placeholder="שם התיק / Case name" />
            </div>
            <div>
              <label className="label">{t(locale, 'caseNumber')}</label>
              <input name="caseNumber" className="input" placeholder="2026-0143" />
            </div>
            <div className="md:col-span-2">
              <label className="label">{t(locale, 'description')}</label>
              <input name="description" className="input" />
            </div>
            <div>
              <label className="label">
                {t(locale, 'hourlyRate')} ({client.currency})
              </label>
              <input name="hourlyRate" type="number" step="0.01" min="0" className="input" placeholder={String(client.hourlyRate || '')} />
            </div>
            <div>
              <label className="label">{t(locale, 'alertThreshold')} ({t(locale, 'hours')})</label>
              <input name="alertThresholdHours" type="number" step="0.5" min="0" className="input" placeholder={t(locale, 'noAlert')} />
              <div className="text-xs text-slate-500 mt-1">{t(locale, 'alertThresholdHelp')}</div>
            </div>
            <div className="md:col-span-2">
              <button className="btn-primary" type="submit">
                {t(locale, 'save')}
              </button>
            </div>
          </form>
        </details>

        {cases.length === 0 ? (
          <p className="text-slate-500 text-sm">{t(locale, 'noCases')}</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {cases.map((c) => {
              const thr = c.project.alertThresholdHours;
              const over = thr != null && thr > 0 && c.hours >= thr;
              return (
                <Link key={c.project.id} href={`/cases/${c.project.id}`} className="card hover:border-slate-600 transition block">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">
                      {c.project.caseNumber ? <span className="text-slate-500">{c.project.caseNumber} · </span> : null}
                      {c.project.name}
                    </span>
                    <span className={`pill ${c.project.status === 'open' ? 'bg-sky-950 text-sky-300' : 'bg-slate-800 text-slate-400'}`}>
                      {t(locale, c.project.status === 'open' ? 'open' : 'closed')}
                    </span>
                  </div>
                  <div className="mt-2 flex items-center justify-between text-sm">
                    <span className="text-slate-400">
                      {c.taskCount} {t(locale, 'tasks')}
                    </span>
                    <span className={`num ${over ? 'text-amber-400' : 'text-slate-300'}`}>
                      {c.hours.toFixed(2)} {t(locale, 'hours')}
                      {thr ? <span className="text-slate-500"> / {thr.toFixed(0)}</span> : null}
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>

      {/* Edit client */}
      <details className="card">
        <summary className="cursor-pointer font-medium text-slate-300">{t(locale, 'edit')} · {t(locale, 'client')}</summary>
        <form action={updateClient} className="grid gap-3 md:grid-cols-2 mt-4">
          <input type="hidden" name="id" value={client.id} />
          <div>
            <label className="label">{t(locale, 'name')}</label>
            <input name="name" className="input" defaultValue={client.name} required />
          </div>
          <div>
            <label className="label">{t(locale, 'email')}</label>
            <input name="email" type="email" className="input" defaultValue={client.email ?? ''} />
          </div>
          <div>
            <label className="label">{t(locale, 'phone')}</label>
            <input name="phone" className="input" defaultValue={client.phone ?? ''} />
          </div>
          <div>
            <label className="label">{t(locale, 'hourlyRate')}</label>
            <input name="hourlyRate" type="number" step="0.01" min="0" className="input" defaultValue={client.hourlyRate} />
          </div>
          <div>
            <label className="label">{t(locale, 'currency')}</label>
            <input name="currency" className="input" defaultValue={client.currency} />
          </div>
          <div className="md:col-span-2">
            <label className="label">{t(locale, 'address')}</label>
            <input name="address" className="input" defaultValue={client.address ?? ''} />
          </div>
          <div className="md:col-span-2">
            <label className="label">{t(locale, 'notes')}</label>
            <textarea name="notes" className="input" rows={2} defaultValue={client.notes ?? ''} />
          </div>
          <div className="md:col-span-2 flex justify-between">
            <button className="btn-primary" type="submit">
              {t(locale, 'save')}
            </button>
          </div>
        </form>
        <form action={archiveClient} className="mt-3">
          <input type="hidden" name="id" value={client.id} />
          <button className="btn-danger" type="submit">
            {t(locale, 'archive')}
          </button>
        </form>
      </details>
    </div>
  );
}
