import { NextRequest, NextResponse } from 'next/server';
import { malFetch, transformEpisodeList, MAL_DETAIL_FIELDS, parseSlug, getCached, setCache } from '@/lib/mal';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: { ...corsHeaders, 'Access-Control-Max-Age': '86400' } });
}

function resolveId(searchParams: URLSearchParams): { malId: number; cacheKey: string } | null {
  const raw = searchParams.get('id') || searchParams.get('malId') || searchParams.get('anilistId') || '';
  if (!raw) return null;

  if (searchParams.has('malId')) {
    const n = parseInt(raw, 10);
    return (!isNaN(n) && n > 0) ? { malId: n, cacheKey: `eps:mal:${n}` } : null;
  }
  if (searchParams.has('anilistId')) {
    const n = parseInt(raw, 10);
    return (!isNaN(n) && n > 0) ? { malId: n, cacheKey: `eps:al:${n}` } : null;
  }

  const parsed = parseSlug(raw);
  if (parsed) return { malId: parsed.malId, cacheKey: `eps:slug:${raw}` };

  const n = parseInt(raw, 10);
  return (!isNaN(n) && n > 0) ? { malId: n, cacheKey: `eps:num:${n}` } : null;
}

// GET /api/episodes?id=attack-on-titan-16498
// GET /api/episodes?malId=16498
//
// MAL API v2: GET /anime/{id}?fields=num_episodes,...
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const resolved = resolveId(searchParams);

  if (!resolved) {
    return NextResponse.json({ success: false, error: 'Missing or invalid id parameter' }, { status: 400, headers: corsHeaders });
  }

  const cached = await getCached(resolved.cacheKey);
  if (cached) return NextResponse.json(cached);

  try {
    // We only need num_episodes + title fields, but the detail endpoint
    // accepts the same fields param — we use the smaller subset to save bandwidth.
    const media = await malFetch<any>(`/anime/${resolved.malId}`, {
      fields: 'id,title,alternative_titles,num_episodes',
    });

    if (!media || !media.id) {
      return NextResponse.json({ success: false, error: 'Anime not found' }, { status: 404, headers: corsHeaders });
    }

    const episodes = transformEpisodeList(media);
    const body = { success: true, results: { episodes } };

    await setCache(resolved.cacheKey, [], body, 43200); // 12 hours

    return NextResponse.json(body, {
      headers: { 'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=1200', ...corsHeaders },
    });
  } catch (err) {
    console.error('Episodes error:', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500, headers: { 'Cache-Control': 'no-store', ...corsHeaders } }
    );
  }
}
