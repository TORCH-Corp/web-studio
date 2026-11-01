import { NextResponse } from 'next/server';
import { SESSION_COOKIE } from '@/lib/platform/session';

/** POST /ycode/api/auth/logout — ends the Business OS session in this browser. */
export async function POST() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set({ name: SESSION_COOKIE, value: '', path: '/', maxAge: 0 });
  return response;
}
