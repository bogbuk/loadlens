// Набор валидных API-ключей для Premium-чтения. Источник — ENV API_KEYS (через запятую).
export function parseApiKeys(): Set<string> {
  return new Set(
    String(process.env.API_KEYS || '')
      .split(',')
      .map((k) => k.trim())
      .filter((k) => k.length > 0),
  );
}

export function isValidApiKey(key: string | undefined | null): boolean {
  return !!key && parseApiKeys().has(key);
}
