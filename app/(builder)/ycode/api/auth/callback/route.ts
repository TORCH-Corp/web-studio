import { NextRequest, NextResponse } from 'next/server';

/** Sign-in happens in Business OS; the old Supabase OAuth callback just returns to the builder. */
export async function GET(request: NextRequest) {
  return NextResponse.redirect(new URL('/ycode', request.url));
}
