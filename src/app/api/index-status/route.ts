import { NextRequest, NextResponse } from 'next/server';

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8000';

export async function GET(request: NextRequest) {
  try {
    const repoId = request.nextUrl.searchParams.get('repo_id') || request.nextUrl.searchParams.get('id');
    const res = await fetch(`${BACKEND_URL}/api/index-status?repo_id=${repoId}`, {
      headers: { 'Content-Type': 'application/json' },
    });
    if (!res.ok) {
      const err = await res.text();
      return NextResponse.json({ error: err }, { status: res.status });
    }
    const data = await res.json();
    return NextResponse.json(data);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Proxy error';
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}