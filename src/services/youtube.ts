/**
 * Adaptado de IdealFlow/src/lib/youtube.ts: llamada a Data API v3 y
 * decodificación de títulos. Aquí se buscan vídeos musicales; no se aplica
 * el filtrado de expertos ni se consultan estadísticas de sus canales.
 */
export function decodeEntities(s: string): string {
  return s.replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

export async function youtubeCall<T>(
  key: string,
  endpoint: 'search',
  params: Record<string, string | undefined>,
  pedir: typeof fetch = fetch,
): Promise<T> {
  if (!key) throw Error('Configura la clave de YouTube para buscar. También puedes pegar directamente un enlace de vídeo.');
  const qs = new URLSearchParams({ key });
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') qs.set(k, v);
  let res: Response;
  try {
    res = await pedir(`https://www.googleapis.com/youtube/v3/${endpoint}?${qs}`, { signal: AbortSignal.timeout(15_000) });
  } catch {
    // Los errores de red pueden incluir la URL con la clave: no propagarlos.
    throw Error('No se pudo conectar con YouTube. Inténtalo de nuevo.');
  }
  const body = await res.json().catch(() => null);
  if (res.ok) {
    if (!body) throw Error('YouTube devolvió una respuesta ilegible. Inténtalo de nuevo.');
    return body as T;
  }
  const fallo = body as { error?: { errors?: Array<{ reason?: string }>; details?: Array<{ reason?: string }> } } | null;
  const reason = fallo?.error?.errors?.[0]?.reason;
  if (reason === 'quotaExceeded' || reason === 'dailyLimitExceeded') {
    throw Error('Cuota diaria de YouTube agotada. Se renueva a medianoche, hora del Pacífico. Puedes seguir pegando enlaces de vídeos.');
  }
  if (reason === 'keyInvalid' || (Array.isArray(fallo?.error?.details) && fallo.error.details.some(d => d.reason === 'API_KEY_INVALID'))) {
    throw Error('La clave de YouTube no es válida. Revísala en Conectar servicios de música.');
  }
  if (reason === 'accessNotConfigured' || reason === 'ipRefererBlocked' || res.status === 403) {
    throw Error('YouTube ha rechazado el acceso. Comprueba que YouTube Data API v3 esté activada y que las restricciones de la clave permitan usarla desde este PC.');
  }
  if (res.status === 429) throw Error('YouTube ha limitado las peticiones. Espera un momento antes de reintentar.');
  // No mostrar mensajes remotos que puedan reflejar credenciales o parámetros.
  throw Error(`YouTube no pudo completar la búsqueda (${res.status}).`);
}
