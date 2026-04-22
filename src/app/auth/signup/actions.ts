'use server';

import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function signupAction(formData: FormData) {
  const email = formData.get('email') as string;
  const password = formData.get('password') as string;
  const confirm = formData.get('confirm') as string;

  if (!email || !password) {
    redirect('/auth/signup?error=required');
  }
  if (password.length < 8) {
    redirect('/auth/signup?error=password_too_short');
  }
  if (password !== confirm) {
    redirect('/auth/signup?error=password_mismatch');
  }

  try {
    const result = await auth.api.signUpEmail({
      body: { email, password, name: email.split('@')[0] },
    });
    if (result && 'error' in result && result.error) {
      console.error('[signup] error:', result.error);
      redirect('/auth/signup?error=signup_failed');
    }

    // Promote the account matching ADMIN_EMAIL to role=admin on first signup.
    const adminEmail = process.env.ADMIN_EMAIL?.toLowerCase().trim();
    if (adminEmail && email.toLowerCase().trim() === adminEmail) {
      await prisma.user.updateMany({ where: { email }, data: { role: 'admin' } });
    }
  } catch (err) {
    // next/navigation's `redirect()` throws a special NEXT_REDIRECT error that
    // must not be swallowed — let it propagate so the browser gets the 3xx.
    if (err instanceof Error && err.message === 'NEXT_REDIRECT') throw err;

    const msg = String(err instanceof Error ? err.message : err);
    console.error('[signup] unexpected error:', msg);
    const isDbError =
      msg.toLowerCase().includes('database') ||
      msg.toLowerCase().includes('prisma') ||
      msg.toLowerCase().includes('relation');
    if (isDbError) {
      redirect('/auth/signup?error=service_unavailable');
    }
    redirect('/auth/signup?error=signup_failed');
  }

  redirect('/auth/signin?registered=1');
}
