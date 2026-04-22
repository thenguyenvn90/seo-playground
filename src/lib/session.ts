import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';

/**
 * Resolve the current user id from the session cookie. Throws / redirects
 * when called without an authenticated session — middleware normally catches
 * this, but RSC pages and server actions still call it defensively in case
 * a request bypasses middleware (e.g. direct Server Action invocation).
 */
export async function requireUserId(): Promise<string> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id) {
    redirect('/auth/signin');
  }
  return session.user.id;
}

export async function getOptionalUserId(): Promise<string | null> {
  const session = await auth.api.getSession({ headers: await headers() });
  return session?.user?.id ?? null;
}
