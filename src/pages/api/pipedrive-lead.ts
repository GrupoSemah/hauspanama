import type { APIRoute } from 'astro';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  const apiToken = import.meta.env.PIPEDRIVE_API_TOKEN;

  if (!apiToken) {
    return new Response(JSON.stringify({ error: 'API token not configured' }), { status: 500 });
  }

  let area: string;
  try {
    const body = await request.json();
    area = (body.area as string)?.toLowerCase();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid body' }), { status: 400 });
  }

  const pipelineMap: Record<string, string | undefined> = {
    centro: import.meta.env.PIPEDRIVE_PIPELINE_CENTRO,
    este: import.meta.env.PIPEDRIVE_PIPELINE_ESTE,
    oeste: import.meta.env.PIPEDRIVE_PIPELINE_OESTE,
  };

  const pipelineId = pipelineMap[area];
  if (!pipelineId) {
    return new Response(JSON.stringify({ error: 'Invalid area or pipeline not configured' }), { status: 400 });
  }

  const areaLabel = area.charAt(0).toUpperCase() + area.slice(1);

  const dealPayload = {
    title: `Lead Página Web - ${areaLabel}`,
    pipeline_id: Number(pipelineId),
    channel: 597,
    channel_id: 'hauspanama.com',
  };

  const response = await fetch(
    `https://api.pipedrive.com/v1/deals?api_token=${apiToken}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(dealPayload),
    }
  );

  const result = await response.json() as { success: boolean; data?: { id: number }; error?: string };

  if (!result.success) {
    return new Response(JSON.stringify({ error: 'Pipedrive error', detail: result.error }), { status: 502 });
  }

  return new Response(JSON.stringify({ success: true, dealId: result.data?.id }), { status: 200 });
};
