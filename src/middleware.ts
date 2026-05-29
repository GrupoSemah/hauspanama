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

function getClientIp(request: Request): string {
  // Primero: leer el header (seguro en cualquier contexto, incluyendo rutas prerenderizadas)
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return 'unknown';
}

export const onRequest = defineMiddleware((context, next) => {
  const { request } = context;

  // Guard: cualquier ruta que NO sea el endpoint de leads pasa sin tocar clientAddress
  const url = new URL(request.url);
  if (request.method !== 'POST' || url.pathname !== '/api/pipedrive-lead') {
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
