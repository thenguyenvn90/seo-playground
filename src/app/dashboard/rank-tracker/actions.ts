'use server';

import {
  getCredentials, getTrackedKeywords, addTrackedKeyword,
  removeTrackedKeyword, saveRankCheck, getSetting, setSetting,
} from '@/lib/db';
import { requireUserId } from '@/lib/session';
import { revalidatePath } from 'next/cache';

interface SerpItem {
  type: string;
  rank_absolute: number;
  url?: string;
  title?: string;
  domain?: string;
}

interface SerpResponse {
  tasks?: Array<{
    status_code?: number;
    cost?: number;
    result?: Array<{ items?: SerpItem[] }>;
  }>;
}

function cleanDomain(d: string) {
  return d.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '');
}

/**
 * Sends all keywords in one batch request to DataForSEO instead of N sequential
 * requests. Reduces "Check All" from N×3s to ~3s regardless of keyword count.
 */
async function checkKeywordsBatch(
  userId: string,
  keywords: Array<{ id: string; keyword: string; domain: string; location: string; language: string }>,
) {
  const creds = await getCredentials(userId);
  if (!creds || keywords.length === 0) return;

  const depth = parseInt((await getSetting(userId, 'rank_tracker_depth')) ?? '100', 10);
  const auth = btoa(`${creds.login}:${creds.pass}`);
  const BATCH = 100; // DataForSEO max tasks per request

  for (let offset = 0; offset < keywords.length; offset += BATCH) {
    const batch = keywords.slice(offset, offset + BATCH);

    const res = await fetch('https://api.dataforseo.com/v3/serp/google/organic/live/regular', {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(
        batch.map((kw) => ({
          keyword: kw.keyword,
          location_name: kw.location,
          language_name: kw.language,
          depth,
        })),
      ),
    });
    if (!res.ok) continue;

    const data = await res.json() as SerpResponse;

    for (let i = 0; i < batch.length; i++) {
      const kw = batch[i];
      const task = data.tasks?.[i];

      // Skip saving if the task itself returned an API-level error (preserves existing data)
      if (task?.status_code !== 20000) continue;

      const items = task?.result?.[0]?.items ?? [];
      const cost = task?.cost ?? null;

      // Split by '/' so a tracked domain like "example.com/page" still matches
      const domain = cleanDomain(kw.domain).split('/')[0];
      const hit = items.find((item) => {
        if (item.type !== 'organic') return false;
        const d = cleanDomain(item.domain ?? item.url ?? '').split('/')[0];
        return d === domain || d.endsWith('.' + domain);
      });

      await saveRankCheck(userId, kw.id, hit?.rank_absolute ?? null, hit?.url ?? null, hit?.title ?? null, cost);
    }
  }
}

export async function saveDepthAction(formData: FormData) {
  const userId = await requireUserId();
  const depth = formData.get('rank_tracker_depth') as string;
  const valid = ['10', '20', '50', '100'];
  if (valid.includes(depth)) await setSetting(userId, 'rank_tracker_depth', depth);
  revalidatePath('/dashboard/rank-tracker');
}

export async function addKeywordAction(formData: FormData) {
  const userId = await requireUserId();
  const raw = (formData.get('keywords') as string) ?? '';
  const domain = (formData.get('domain') as string)?.trim();
  const location = (formData.get('location') as string)?.trim() || 'France';
  const language = (formData.get('language') as string)?.trim() || 'French';

  if (!domain) return;

  const kwList = raw.split('\n').map((k) => k.trim()).filter(Boolean).slice(0, 50);
  if (kwList.length === 0) return;

  const toCheck: Array<{ id: string; keyword: string; domain: string; location: string; language: string }> = [];
  for (const keyword of kwList) {
    const id = await addTrackedKeyword(userId, keyword, domain, location, language);
    toCheck.push({ id, keyword, domain, location, language });
  }

  await checkKeywordsBatch(userId, toCheck);
  revalidatePath('/dashboard/rank-tracker');
}

export async function removeKeywordAction(formData: FormData) {
  const userId = await requireUserId();
  const id = (formData.get('id') as string)?.trim();
  if (!id) return;
  await removeTrackedKeyword(userId, id);
  revalidatePath('/dashboard/rank-tracker');
}

export async function checkOneAction(formData: FormData) {
  const userId = await requireUserId();
  const id = (formData.get('id') as string)?.trim();
  const keyword = formData.get('keyword') as string;
  const domain = formData.get('domain') as string;
  const location = formData.get('location') as string;
  const language = formData.get('language') as string;
  if (!id || !keyword || !domain) return;
  await checkKeywordsBatch(userId, [{ id, keyword, domain, location, language }]);
  revalidatePath('/dashboard/rank-tracker');
}

export async function checkAllAction() {
  const userId = await requireUserId();
  const keywords = await getTrackedKeywords(userId);
  await checkKeywordsBatch(userId, keywords);
  revalidatePath('/dashboard/rank-tracker');
}
