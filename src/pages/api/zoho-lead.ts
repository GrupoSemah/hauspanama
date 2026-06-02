import type { APIRoute } from 'astro';
import { z } from 'zod';
import projectsData from '../../data/projects.json';

export const prerender = false;

// --- Tipos ---

// Subconjunto de las propiedades de proyecto que este endpoint necesita
interface ZohoProject {
  id: string;
  crm: string;
  zohoFormAction: string;
}

// Respuesta del siteverify de Turnstile
interface TurnstileVerifyResponse {
  success: boolean;
  'error-codes'?: string[];
}

// --- Schema Zod ---

const INCOME_VALUES = [
  'Menos de $800',
  '$801 a $1,000',
  '$1,001 a $1,500',
  '$1,501 a $2,000',
  '$2,001 a $2,500',
  '$2,501 a $3,000',
  'Mayor a $3,000',
] as const;

const zohoLeadSchema = z.object({
  projectId: z.string().min(1),
  name: z.string().trim().min(3).max(120),
  // No normalizamos — Zoho espera el número tal como el usuario lo ingresó.
  // Validamos formato: solo dígitos, espacios, +, -, paréntesis; entre 6 y 30 chars.
  phone: z.string().trim().min(6).max(30).refine(
    (val) => /^[\d\s+\-()]{6,30}$/.test(val),
    { message: 'Formato de teléfono inválido' },
  ),
  email: z.string().email(),
  income: z.enum(INCOME_VALUES),
  honeypot: z.string().optional().default(''),
  turnstileToken: z.string().optional().default(''),
  utm: z
    .object({
      utm_source: z.string().optional().default(''),
      utm_medium: z.string().optional().default(''),
      utm_campaign: z.string().optional().default(''),
      utm_term: z.string().optional().default(''),
      utm_content: z.string().optional().default(''),
    })
    .optional()
    .default({}),
  referrer: z.string().optional().default(''),
});

type ZohoLeadInput = z.infer<typeof zohoLeadSchema>;

// --- Helpers ---

// Limpia un valor de IP crudo para evitar log injection.
// Toma solo el primer segmento (ante proxies encadenados) y permite
// únicamente caracteres válidos de IPv4/IPv6.
function sanitizeIp(raw: string | null): string {
  if (!raw) return 'unknown';
  const first = raw.split(',')[0].trim();
  // Permitir solo dígitos, puntos, dos puntos y hex (IPv4 e IPv6); recortar a 45 chars
  const cleaned = first.replace(/[^0-9a-fA-F:.]/g, '').slice(0, 45);
  return cleaned || 'unknown';
}

// Resuelve el proyecto Zoho a partir del projectId recibido.
// Retorna null si no existe, no usa crm=zoho, o le falta zohoFormAction.
function resolveZohoProject(projectId: string): ZohoProject | null {
  const projects = projectsData as Record<string, Record<string, unknown>>;
  const project = projects[projectId];

  if (!project) return null;
  if (project['crm'] !== 'zoho') return null;

  const action = project['zohoFormAction'];
  if (typeof action !== 'string' || action.trim() === '') return null;

  return {
    id: projectId,
    crm: 'zoho',
    zohoFormAction: action,
  };
}

// Verifica que el host del zohoFormAction sea exactamente forms.zohopublic.com
// para prevenir SSRF — nunca enviar datos a un host arbitrario del JSON.
function isAllowedZohoHost(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.hostname === 'forms.zohopublic.com';
  } catch {
    return false;
  }
}

// Verifica el token de Turnstile contra la API de Cloudflare.
// Retorna true si es válido, false si no.
// Lanza error si hay fallo de red (para que el caller pueda distinguirlo).
async function verifyTurnstile(
  secretKey: string,
  token: string,
  remoteIp?: string,
): Promise<boolean> {
  const params = new URLSearchParams({
    secret: secretKey,
    response: token,
  });

  if (remoteIp) {
    params.set('remoteip', remoteIp);
  }

  const res = await fetch(
    'https://challenges.cloudflare.com/turnstile/v0/siteverify',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
      signal: AbortSignal.timeout(5000),
    },
  );

  const data = (await res.json()) as unknown;

  // Narrowing seguro antes de acceder a .success
  if (typeof data !== 'object' || data === null || !('success' in data)) {
    throw new Error('Respuesta inesperada de Turnstile siteverify');
  }

  const typed = data as TurnstileVerifyResponse;
  return typed.success === true;
}

// --- Handler ---

export const POST: APIRoute = async ({ request }) => {
  // Paso 1: Parsear JSON
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response(
      JSON.stringify({ error: 'Datos de formulario inválidos' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }

  // Paso 2: Validar con Zod
  const parsed = zohoLeadSchema.safeParse(body);
  if (!parsed.success) {
    return new Response(
      JSON.stringify({ error: 'Datos de formulario inválidos' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const input: ZohoLeadInput = parsed.data;

  // Paso 3: Honeypot — si viene relleno, es bot
  if (input.honeypot.trim() !== '') {
    console.warn('[zoho-lead] Bot detectado por honeypot — descartando solicitud');
    return new Response(
      JSON.stringify({ error: 'Verificación fallida' }),
      { status: 403, headers: { 'Content-Type': 'application/json' } },
    );
  }

  // Paso 4: Turnstile — verificación server-side
  const turnstileSecret = import.meta.env.TURNSTILE_SECRET_KEY as string | undefined;

  if (!turnstileSecret) {
    // Sin clave configurada: degradación controlada, no bloqueamos leads.
    // Se loggea por cada request para que sea visible en producción cuántos leads
    // entran sin verificación de captcha.
    console.warn('[zoho-lead] Turnstile no configurado — lead aceptado sin verificación de captcha');
  } else {
    // Prioridad 1: CF-Connecting-IP — lo setea Cloudflare, no spoofeable por el cliente
    // Prioridad 2: primer valor de X-Forwarded-For como fallback
    const rawIp = request.headers.get('cf-connecting-ip') ?? request.headers.get('x-forwarded-for');
    const remoteIp = sanitizeIp(rawIp);

    let turnstileValid: boolean;
    try {
      // remoteIp puede ser 'unknown'; verifyTurnstile lo omite si es falsy
      turnstileValid = await verifyTurnstile(
        turnstileSecret,
        input.turnstileToken,
        remoteIp !== 'unknown' ? remoteIp : undefined,
      );
    } catch (err) {
      console.error('[zoho-lead] Error al contactar Turnstile siteverify:', err);
      return new Response(
        JSON.stringify({ error: 'Verificación fallida' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } },
      );
    }

    if (!turnstileValid) {
      console.warn('[zoho-lead] Token Turnstile inválido — solicitud rechazada');
      return new Response(
        JSON.stringify({ error: 'Verificación fallida' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } },
      );
    }
  }

  // Paso 5: Resolver destino — proyecto válido, crm=zoho, zohoFormAction presente
  const project = resolveZohoProject(input.projectId);
  if (!project) {
    return new Response(
      JSON.stringify({ error: 'Datos de formulario inválidos' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }

  // Validación anti-SSRF: el host debe ser exactamente forms.zohopublic.com
  if (!isAllowedZohoHost(project.zohoFormAction)) {
    console.error('[zoho-lead] zohoFormAction con host no permitido:', project.zohoFormAction);
    return new Response(
      JSON.stringify({ error: 'Datos de formulario inválidos' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }

  // Paso 6: Reenviar a Zoho Forms via FormData
  // Nombres de campo según lo que Zoho Forms espera en el form de Provenza
  const utm = input.utm ?? {};

  const formData = new FormData();
  formData.append('SingleLine', input.name);
  formData.append('SingleLine1', input.phone);
  formData.append('Email', input.email);
  formData.append('Dropdown', input.income);
  formData.append('zf_referrer_name', input.referrer);
  formData.append('zf_redirect_url', 'https://hauspanama.com/gracias');
  formData.append('zc_gad', '');
  formData.append('utm_source', utm.utm_source ?? '');
  formData.append('utm_medium', utm.utm_medium ?? '');
  formData.append('utm_campaign', utm.utm_campaign ?? '');
  formData.append('utm_term', utm.utm_term ?? '');
  formData.append('utm_content', utm.utm_content ?? '');

  try {
    const zohoRes = await fetch(project.zohoFormAction, {
      method: 'POST',
      body: formData,
      // redirect:manual para no seguir redirects — Zoho devuelve 302 en éxito
      redirect: 'manual',
      signal: AbortSignal.timeout(10000),
    });

    // Zoho Forms responde con 200 o un redirect (301/302/303) en caso de éxito
    const isSuccess = zohoRes.ok || [301, 302, 303].includes(zohoRes.status);

    if (!isSuccess) {
      // Leer solo los primeros 300 chars para el log, sin exponer al cliente
      let zohoBody = '';
      try {
        const raw = await zohoRes.text();
        zohoBody = raw.slice(0, 300);
      } catch {
        // ignorar si falla la lectura del body
      }
      console.error(
        `[zoho-lead] Zoho rechazó el lead — status: ${zohoRes.status}, body: ${zohoBody}`,
      );
      return new Response(
        JSON.stringify({ error: 'Error al procesar la solicitud' }),
        { status: 502, headers: { 'Content-Type': 'application/json' } },
      );
    }

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    console.error('[zoho-lead] Error en fetch a Zoho Forms:', err);
    return new Response(
      JSON.stringify({ error: 'Error al procesar la solicitud' }),
      { status: 502, headers: { 'Content-Type': 'application/json' } },
    );
  }
};
