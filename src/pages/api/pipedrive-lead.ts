import type { APIRoute } from 'astro';
import { z } from 'zod';

export const prerender = false;

// --- Interfaces Pipedrive ---

interface PipedrivePersonResponse {
  success: boolean;
  data?: { id: number };
}

interface PipedriveDealResponse {
  success: boolean;
  data?: { id: number };
}

// --- Normalización de teléfono ---

function normalizePhone(raw: string): string | null {
  // Quitar espacios, guiones y paréntesis
  const cleaned = raw.replace(/[\s\-()]/g, '');

  // Formato internacional explícito: "+" seguido de 7 a 15 dígitos
  if (/^\+\d{7,15}$/.test(cleaned)) {
    return cleaned;
  }

  // Celular Panamá sin código: exactamente 8 dígitos
  if (/^\d{8}$/.test(cleaned)) {
    return `+507${cleaned}`;
  }

  // 11 dígitos que arrancan con 507 (código Panamá sin +)
  if (/^507\d{8}$/.test(cleaned)) {
    return `+${cleaned}`;
  }

  return null;
}

// --- Schema zod ---

const leadSchema = z.object({
  area: z.preprocess(
    (val) => (typeof val === 'string' ? val.toLowerCase() : val),
    z.enum(['centro', 'este', 'oeste']),
  ),
  name: z.string().trim().min(3).max(120),
  phone: z.string().transform((val, ctx) => {
    const normalized = normalizePhone(val);
    if (normalized === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Número de teléfono inválido',
      });
      return z.NEVER;
    }
    return normalized;
  }),
});

type LeadInput = z.infer<typeof leadSchema>;

// --- Handler ---

export const POST: APIRoute = async ({ request }) => {
  const apiToken = import.meta.env.PIPEDRIVE_API_TOKEN as string | undefined;

  if (!apiToken) {
    console.error('[pipedrive-lead] PIPEDRIVE_API_TOKEN no configurado');
    return new Response(
      JSON.stringify({ error: 'Error de configuración del servidor' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }

  // Parsear y validar body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response(
      JSON.stringify({ error: 'Body JSON inválido' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const parsed = leadSchema.safeParse(body);
  if (!parsed.success) {
    return new Response(
      JSON.stringify({ error: 'Datos de formulario inválidos' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const { area, name, phone }: LeadInput = parsed.data;

  // Mapa de pipelines por área
  const pipelineMap: Record<string, string | undefined> = {
    centro: import.meta.env.PIPEDRIVE_PIPELINE_CENTRO as string | undefined,
    este: import.meta.env.PIPEDRIVE_PIPELINE_ESTE as string | undefined,
    oeste: import.meta.env.PIPEDRIVE_PIPELINE_OESTE as string | undefined,
  };

  const pipelineId = pipelineMap[area];
  if (!pipelineId) {
    console.error(`[pipedrive-lead] Pipeline no configurado para área: ${area}`);
    return new Response(
      JSON.stringify({ error: 'Error de configuración del servidor' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const areaLabel = area.charAt(0).toUpperCase() + area.slice(1);

  // Paso 1: Crear persona en Pipedrive
  let personId: number;
  try {
    const personRes = await fetch(
      `https://api.pipedrive.com/v1/persons?api_token=${apiToken}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          phone: [{ value: phone, primary: true, label: 'mobile' }],
        }),
      },
    );

    const personData = (await personRes.json()) as unknown;

    // Narrowing seguro
    if (
      typeof personData !== 'object' ||
      personData === null ||
      !('success' in personData)
    ) {
      throw new Error('Respuesta inesperada de Pipedrive /persons');
    }

    const typedPerson = personData as PipedrivePersonResponse;

    if (!typedPerson.success || !typedPerson.data?.id) {
      console.error('[pipedrive-lead] Error al crear persona:', personData);
      return new Response(
        JSON.stringify({ error: 'Error al procesar la solicitud' }),
        { status: 502, headers: { 'Content-Type': 'application/json' } },
      );
    }

    personId = typedPerson.data.id;
  } catch (err) {
    console.error('[pipedrive-lead] Error en fetch /persons:', err);
    return new Response(
      JSON.stringify({ error: 'Error al procesar la solicitud' }),
      { status: 502, headers: { 'Content-Type': 'application/json' } },
    );
  }

  // Paso 2: Crear deal en Pipedrive
  try {
    const dealRes = await fetch(
      `https://api.pipedrive.com/v1/deals?api_token=${apiToken}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: `Lead Página Web - ${areaLabel} - ${name}`,
          person_id: personId,
          pipeline_id: Number(pipelineId),
          a42a181ae0fcd598129d1ad67295a24a6f8cf46c: 104, // Medio Publicitario = Webpage
        }),
      },
    );

    const dealData = (await dealRes.json()) as unknown;

    if (
      typeof dealData !== 'object' ||
      dealData === null ||
      !('success' in dealData)
    ) {
      throw new Error('Respuesta inesperada de Pipedrive /deals');
    }

    const typedDeal = dealData as PipedriveDealResponse;

    if (!typedDeal.success || !typedDeal.data?.id) {
      console.error('[pipedrive-lead] Error al crear deal:', dealData);

      // Rollback best-effort: eliminar persona recién creada
      try {
        await fetch(
          `https://api.pipedrive.com/v1/persons/${personId}?api_token=${apiToken}`,
          { method: 'DELETE', signal: AbortSignal.timeout(5000) },
        );
      } catch (rollbackErr) {
        console.error('[pipedrive-lead] Rollback persona fallido:', rollbackErr);
      }

      return new Response(
        JSON.stringify({ error: 'Error al procesar la solicitud' }),
        { status: 502, headers: { 'Content-Type': 'application/json' } },
      );
    }

    return new Response(
      JSON.stringify({ success: true, dealId: typedDeal.data.id, personId }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    console.error('[pipedrive-lead] Error en fetch /deals:', err);

    // Rollback best-effort
    try {
      await fetch(
        `https://api.pipedrive.com/v1/persons/${personId}?api_token=${apiToken}`,
        { method: 'DELETE', signal: AbortSignal.timeout(5000) },
      );
    } catch (rollbackErr) {
      console.error('[pipedrive-lead] Rollback persona fallido:', rollbackErr);
    }

    return new Response(
      JSON.stringify({ error: 'Error al procesar la solicitud' }),
      { status: 502, headers: { 'Content-Type': 'application/json' } },
    );
  }
};
