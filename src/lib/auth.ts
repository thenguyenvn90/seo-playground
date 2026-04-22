import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { prisma } from '@/lib/prisma';

export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: 'postgresql' }),
  secret: process.env.BETTER_AUTH_SECRET!,
  baseURL: process.env.BETTER_AUTH_URL!,
  emailAndPassword: {
    enabled: true,
    // Keep disabled until a mail sender (e.g. Resend) is wired up;
    // flipping this on without a transport locks every new signup out.
    requireEmailVerification: false,
  },
  rateLimit: {
    enabled: true,
    window: 60,
    max: 300,
    customRules: {
      '/get-session': { window: 60, max: 1000 },
      '/sign-in/email': { window: 60, max: 5 },
      '/sign-up/email': { window: 600, max: 5 },
      '/forget-password': { window: 600, max: 3 },
      '/reset-password': { window: 600, max: 5 },
    },
  },
});
