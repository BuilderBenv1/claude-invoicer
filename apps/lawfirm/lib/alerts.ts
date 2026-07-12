import { eq } from 'drizzle-orm';
import { getDb } from './db';
import { clients, projects } from './db/schema';
import { caseHours } from './queries';
import { getSettings, localeOf } from './settings';
import { sendThresholdAlert } from './email';

/**
 * After work is logged on a case, check whether it has crossed its hours-alert
 * threshold and, if so, email the client — once. `alertNotifiedHours` records
 * the threshold we already fired on, so raising the threshold re-arms the alert
 * but the same threshold never fires twice. Never throws: a failed email must
 * not break stopping a timer.
 */
export async function checkThreshold(projectId: string): Promise<void> {
  try {
    const db = getDb();
    const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
    if (!project || project.alertThresholdHours == null || project.alertThresholdHours <= 0) return;

    const threshold = project.alertThresholdHours;
    // Already alerted at this (or a higher) threshold? Nothing to do.
    if (project.alertNotifiedHours != null && project.alertNotifiedHours >= threshold) return;

    const hours = await caseHours(projectId);
    if (hours < threshold) return;

    const [client] = await db.select().from(clients).where(eq(clients.id, project.clientId));
    if (!client) return;
    const s = await getSettings();

    // Mark first (best-effort dedupe even if two stops race), then send.
    await db.update(projects).set({ alertNotifiedHours: threshold, alertNotifiedAt: new Date() }).where(eq(projects.id, projectId));
    await sendThresholdAlert(client, project, hours, threshold, s, localeOf(s));
  } catch (e) {
    console.error('threshold alert failed', e);
  }
}
