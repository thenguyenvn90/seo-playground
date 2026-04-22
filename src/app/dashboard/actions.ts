'use server';

import { saveCredentials } from '@/lib/db';
import { requireUserId } from '@/lib/session';
import { revalidatePath } from 'next/cache';

export async function saveCredentialsAction(formData: FormData) {
  const userId = await requireUserId();
  const login = formData.get('login');
  const password = formData.get('password');
  if (!login || !password || typeof login !== 'string' || typeof password !== 'string') return;
  await saveCredentials(userId, login, password);
  revalidatePath('/dashboard');
}
