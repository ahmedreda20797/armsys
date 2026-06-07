import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function POST() {
  try {
    const existingAdmin = await db.user.findUnique({
      where: { email: 'admin@erp.com' },
    });

    if (existingAdmin) {
      return NextResponse.json({
        message: 'Admin user already exists',
        user: {
          id: existingAdmin.id,
          email: existingAdmin.email,
          name: existingAdmin.name,
          role: existingAdmin.role,
        },
      });
    }

    const defaultPermissions = JSON.stringify({
      employees: 'edit',
      biometric: 'edit',
      attendance: 'edit',
      requests: 'edit',
      rules: 'edit',
      quality: 'edit',
      travel: 'edit',
      users: 'edit',
      reports: 'edit',
    });

    const admin = await db.user.create({
      data: {
        email: 'admin@erp.com',
        password: 'admin123',
        name: 'System Admin',
        role: 'admin',
        permissions: defaultPermissions,
        rank: 'Admin',
      },
    });

    return NextResponse.json({
      message: 'Admin user created successfully',
      user: {
        id: admin.id,
        email: admin.email,
        name: admin.name,
        role: admin.role,
      },
    });
  } catch (error) {
    console.error('Seed error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
