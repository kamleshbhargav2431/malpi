import { NextRequest, NextResponse } from 'next/server';
import { malFetch, transformDetail, MAL_DETAIL_FIELDS, parseSlug, getCached, setCache } from '@/lib/mal';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: { ...corsHeaders, 'Access-Control-Max-Age': '86400' } });
}

// Resolve ID from various input formats:
//   ?id=16498 (numeric)          → MAL ID
//   ?malId=16498                 → MAL ID
//   ?anilistId=16498             → legacy: treated as MAL ID with a different cache key
//   ?id=attack-on-titan-16498    → parse MAL ID from slug
function resolveId(searchParams: URLSearchParams): { malId: number; cacheKey: string } | null {
  const raw = searchParams.get('id') || searchParams.get('malId') || searchParams.get('anilistId') || '';
  if (!raw) return null;

  if (searchParams.has('anilistId')) {
    const n = parseInt(raw, 10);
    if (!isNaN(n) && n > 0) return { malId: n, cacheKey: `detail:al:${n}` };
    return null;
  }

  if (searchParams.has('malId')) {
    const n = parseInt(raw, 10);
    if (!isNaN(n) && n > 0) return { malId: n, cacheKey: `detail:mal:${n}` };
    return null;
  }

  // id param — could be slug or number
  const parsed = parseSlug(raw);
  if (parsed) return { malId: parsed.malId, cacheKey: `detail:slug:${raw}` };

  const n = parseInt(raw, 10);
  if (!isNaN(n) && n > 0) return { malId: n, cacheKey: `detail:num:${n}` };

  return null;
}

// GET /api/details?id=attack-on-titan-16498
// GET /api/details?malId=16498
// GET /api/details?id=16498
//
// MAL API v2: GET /anime/{id}?fields={detail_fields}
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const resolved = resolveId(searchParams);

  if (!resolved) {
    return NextResponse.json({ success: false, error: 'Missing or invalid id parameter' }, { status: 400, headers: corsHeaders });
  }

  const cached = await getCached(resolved.cacheKey);
  if (cached) return NextResponse.json(cached);

  try {
    const media = await malFetch<any>(`/anime/${resolved.malId}`, {
      fields: MAL_DETAIL_FIELDS,
    });

    if (!media || !media.id) {
      return NextResponse.json({ success: false, error: 'Anime not found' }, { status: 404, headers: corsHeaders });
    }

    const anime = transformDetail(media);
    const body = { success: true, anime };

    await setCache(resolved.cacheKey, [], body, 172800); // 48 hours

    return NextResponse.json(body, {
      headers: { 'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=1200', ...corsHeaders },
    });
  } catch (err) {
    console.error('Details error:', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500, headers: { 'Cache-Control': 'no-store', ...corsHeaders } }
    );
  }
}
