import { NextRequest, NextResponse } from 'next/server';

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8000';
const path = '/api/' + 'REPLACE_ME';

export async function GET(request: NextRequest) {
  return proxyRequest('GET', request);
}

export async function POST(request: NextRequest) {
  return proxyRequest('POST', request);
}

async function proxyRequest(method: string, request: NextRequest) {
  try {
    const url = new URL(request.url);
    const apiPath = url.pathname.replace('/api', '') + url.search;
    const opts: RequestInit = { method, headers: { 'Content-Type': 'application/json' } };
    if (method === 'POST') {
      opts.body = JSON.stringify(await request.json());
    }
    const res = await fetch(`${BACKEND_URL}${apiPath}`, opts);
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
