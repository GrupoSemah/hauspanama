import { defineMiddleware } from 'astro:middleware';

// Rate limiting en memoria para una sola instancia Docker.
// Si se escala a múltiples instancias, migrar este Map a Redis
// para que el conteo sea compartido entre procesos.
interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 60_000; // 60 segundos

const rateLimitStore = new Map<string, RateLimitEntry>();

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

function getClientIp(request: Request): string {
  // Prioridad 1: CF-Connecting-IP — lo setea Cloudflare, no spoofeable por el cliente
  const cfIp = request.headers.get('cf-connecting-ip');
  if (cfIp) return sanitizeIp(cfIp);

  // Prioridad 2: primer valor de X-Forwarded-For (detrás de proxies encadenados)
  const forwarded = request.headers.get('x-forwarded-for');
  return sanitizeIp(forwarded);
}

export const onRequest = defineMiddleware((context, next) => {
  const { request } = context;

  // Guard: solo aplica rate-limit a los endpoints de leads (Pipedrive y Zoho)
  const RATE_LIMITED_PATHS = new Set(['/api/pipedrive-lead', '/api/zoho-lead']);
  const url = new URL(request.url);
  if (request.method !== 'POST' || !RATE_LIMITED_PATHS.has(url.pathname)) {
    return next();
  }

  // A partir de aquí sabemos que es una ruta SSR — acceso a clientAddress es seguro
  // Preferimos x-forwarded-for (ya extraído en getClientIp); clientAddress como fallback
  let ip = getClientIp(request);
  if (ip === 'unknown') {
    try {
      ip = context.clientAddress ?? 'unknown';
    } catch {
      ip = 'unknown';
    }
  }
  const now = Date.now();

  const entry = rateLimitStore.get(ip);

  if (!entry || now > entry.resetAt) {
    // Primera solicitud o ventana expirada: reiniciar contador
    rateLimitStore.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return next();
  }

  if (entry.count >= RATE_LIMIT_MAX) {
    // Límite excedido
    return new Response(
      JSON.stringify({ error: 'Demasiadas solicitudes, intenta en un momento.' }),
      {
        status: 429,
        headers: {
          'Content-Type': 'application/json',
          'Retry-After': '60',
        },
      },
    );
  }

  // Incrementar contador dentro de la ventana activa
  entry.count += 1;
  return next();
});
