// Список админских email из env ADMIN_EMAIL (через запятую): trim + lowercase, без пустых и дублей.
export function parseAdminEmails(raw?: string | null): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  for (const part of raw.split(',')) {
    const email = part.trim().toLowerCase();
    if (email) seen.add(email);
  }
  return [...seen];
}
