import { NextResponse } from 'next/server';
import { getAll } from '@/lib/db';

export async function GET() {
  try {
    // Test 1: Firebase connection
    const dbStart = Date.now();
    const users = await getAll('users');
    const dbTime = Date.now() - dbStart;

    // Test 2: Check if data exists
    const hasUsers = users.length > 0;

    return NextResponse.json({
      status: 'ok',
      firebase: { connected: true, responseTimeMs: dbTime },
      database: {
        usersCount: users.length,
        firstUser: hasUsers ? { email: users[0].email, role: users[0].role } : null,
      },
    });
  } catch (error: any) {
    return NextResponse.json({
      status: 'error',
      firebase: { connected: false, error: error.message },
      hint: error.message?.includes('FIREBASE')
        ? 'Firebase env vars are missing or invalid'
        : 'Database connection failed',
    }, { status: 500 });
  }
}
