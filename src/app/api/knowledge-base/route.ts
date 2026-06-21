import { NextRequest, NextResponse } from 'next/server';
import { getAll, sortByDateField, getEmployeeMap } from '@/lib/db';
import { requireAuth } from '@/lib/verify-permission';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const department = searchParams.get('department');
    const status = searchParams.get('status');
    const search = searchParams.get('search');

    let records = await getAll('knowledgeBase');

    if (department) {
      records = records.filter((r: any) => r.department === department);
    }
    if (status) {
      records = records.filter((r: any) => r.status === status);
    }

    // Search across title, problem, rootCause, solution, preventionMethod
    if (search) {
      const query = search.toLowerCase();
      records = records.filter((r: any) =>
        (r.title && r.title.toLowerCase().includes(query)) ||
        (r.problem && r.problem.toLowerCase().includes(query)) ||
        (r.rootCause && r.rootCause.toLowerCase().includes(query)) ||
        (r.solution && r.solution.toLowerCase().includes(query)) ||
        (r.preventionMethod && r.preventionMethod.toLowerCase().includes(query))
      );
    }

    records = sortByDateField(records, 'updatedAt', 'desc');

    // Enrich author with employee name
    const empMap = await getEmployeeMap();
    const recordsWithNames = records.map((r: any) => {
      const emp = empMap.get(r.author);
      return { ...r, authorName: emp?.name || null };
    });

    return NextResponse.json(recordsWithNames);
  } catch (error) {
    console.error('Fetch knowledge base articles error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { verifyPermission } = await import('@/lib/verify-permission');
    const permCheck = await verifyPermission(request, 'knowledgeBase', 'create');
    if (!permCheck.allowed) {
      return NextResponse.json({ error: permCheck.error }, { status: 403 });
    }

    const body = await request.json();
    const {
      title,
      problem,
      rootCause,
      solution,
      preventionMethod,
      department,
      category,
      tags,
      author,
      status,
    } = body;

    if (!title || !problem || !department) {
      return NextResponse.json(
        { error: 'Title, problem, and department are required' },
        { status: 400 }
      );
    }

    const { createRecord } = await import('@/lib/db');
    const article = await createRecord('knowledgeBase', {
      title,
      problem,
      rootCause: rootCause || '',
      solution: solution || '',
      preventionMethod: preventionMethod || '',
      department,
      category: category || '',
      tags: tags || [],
      author: author || '',
      status: status || 'draft',
    });

    return NextResponse.json(article, { status: 201 });
  } catch (error) {
    console.error('Create knowledge base article error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
