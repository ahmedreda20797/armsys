import { NextRequest, NextResponse } from 'next/server';

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { verifyPermission } = await import('@/lib/verify-permission');
    const permCheck = await verifyPermission(request, 'knowledgeBase', 'update');
    if (!permCheck.allowed) {
      return NextResponse.json({ error: permCheck.error }, { status: 403 });
    }

    const { id } = await params;
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
      status,
    } = body;
    // §12: the page sends authorId; legacy records used `author`.
    const authorId = typeof body.authorId === 'string' && body.authorId.length > 0
      ? body.authorId
      : typeof body.author === 'string'
        ? body.author
        : undefined;

    const { updateRecord } = await import('@/lib/db');
    const article = await updateRecord('knowledgeBase', id, {
      ...(title !== undefined && { title }),
      ...(problem !== undefined && { problem }),
      ...(rootCause !== undefined && { rootCause }),
      ...(solution !== undefined && { solution }),
      ...(preventionMethod !== undefined && { preventionMethod }),
      ...(department !== undefined && { department }),
      ...(category !== undefined && { category }),
      ...(tags !== undefined && { tags }),
      ...(authorId !== undefined && { authorId }),
      ...(status !== undefined && { status }),
    });

    return NextResponse.json(article);
  } catch (error) {
    console.error('Update knowledge base article error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { verifyPermission } = await import('@/lib/verify-permission');
    const permCheck = await verifyPermission(request, 'knowledgeBase', 'delete');
    if (!permCheck.allowed) {
      return NextResponse.json({ error: permCheck.error }, { status: 403 });
    }

    const { id } = await params;
    const { deleteRecord } = await import('@/lib/db');
    await deleteRecord('knowledgeBase', id);
    return NextResponse.json({ message: 'Knowledge base article deleted successfully' });
  } catch (error) {
    console.error('Delete knowledge base article error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
