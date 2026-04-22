import { NextRequest, NextResponse } from 'next/server';
import { betterFetch } from '@better-fetch/fetch';

interface Session {
  user: { id: string; email: string };
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const internalBase = `http://localhost:${process.env.PORT ?? 3000}`;
  let session: Session | null = null;
  let fetchFailed = false;
  try {
    const { data, error } = await betterFetch<Session>('/api/auth/get-session', {
      baseURL: internalBase,
      headers: { cookie: request.headers.get('cookie') ?? '' },
    });
    if (error) {
      fetchFailed = true;
    } else {
      session = data ?? null;
    }
  } catch {
    fetchFailed = true;
  }

  const isAuthed = !!session?.user;
  const isDashboard = pathname.startsWith('/dashboard');
  const isAuthPage = pathname.startsWith('/auth');
  const isApi = pathname.startsWith('/api');

  // If the session fetch itself failed (network/rate limit/etc), do NOT bounce
  // authenticated-looking users to /auth/signin — that creates redirect loops.
  if (fetchFailed) {
    return NextResponse.next();
  }

  if (isApi && !isAuthed) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (isDashboard && !isAuthed) {
    return NextResponse.redirect(new URL('/auth/signin', request.url));
  }

  if (isAuthPage && isAuthed) {
    return NextResponse.redirect(new URL('/dashboard', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/dashboard/:path*', '/auth/:path*', '/api/((?!auth).*)'],
};
