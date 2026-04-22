import { getCredentials } from '@/lib/db';
import { getOptionalUserId } from '@/lib/session';
import { NextResponse } from 'next/server';

interface DFUserResponse {
  tasks?: Array<{ result?: Array<{ money?: { balance?: number } }> }>;
}

// Per-user cache: one balance per userId. Different users have different
// DataForSEO accounts, so we cannot share a single cached value.
const balanceCache = new Map<string, { balance: string; expiresAt: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export async function GET() {
  const userId = await getOptionalUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const now = Date.now();
  const cached = balanceCache.get(userId);
  if (cached && now < cached.expiresAt) {
    return NextResponse.json({ balance: cached.balance });
  }

  const creds = await getCredentials(userId);
  if (!creds) return NextResponse.json({ balance: null });

  try {
    const auth = btoa(`${creds.login}:${creds.pass}`);
    const res = await fetch('https://api.dataforseo.com/v3/appendix/user_data', {
      headers: { Authorization: `Basic ${auth}` },
    });
    if (res.ok) {
      const data = await res.json() as DFUserResponse;
      const balance = (data.tasks?.[0]?.result?.[0]?.money?.balance ?? 0).toFixed(2);
      balanceCache.set(userId, { balance, expiresAt: now + CACHE_TTL });
      return NextResponse.json({ balance });
    }
  } catch {
    // fall through
  }

  return NextResponse.json({ balance: '0.00' });
}
