'use server';

import { addTargetDomain, removeTargetDomain } from '@/lib/db';
import { requireUserId } from '@/lib/session';
import { revalidatePath } from 'next/cache';

export async function addDomainAction(formData: FormData) {
  const userId = await requireUserId();
  const domain = (formData.get('domain') as string)?.trim();
  if (!domain) return;
  await addTargetDomain(userId, domain);
  revalidatePath('/dashboard/serp');
}

export async function removeDomainAction(domain: string) {
  const userId = await requireUserId();
  await removeTargetDomain(userId, domain);
  revalidatePath('/dashboard/serp');
}
