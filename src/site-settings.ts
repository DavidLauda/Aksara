export const SITE_SETTINGS_KEY = 'siteSettings';
export const OVERLAY_SETTINGS_KEY = 'overlaySettings';
export const MAX_DISABLED_SITES = 100;
export type SiteSettings = { disabledOrigins: string[] };
export type OverlaySettings = { highContrast: boolean };

/** Pages may use a non-default port; the preference belongs to that exact origin. */
export function siteOrigin(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return /^(https?:)$/.test(url.protocol) && !url.username && !url.password ? url.origin : null;
  } catch { return null; }
}

/** Store only canonical origins, never page paths, query strings or page content. */
export function siteSettings(value: unknown): SiteSettings {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const origins = Array.isArray(record.disabledOrigins) ? record.disabledOrigins : [];
  const disabledOrigins: string[] = [];
  for (const origin of origins) {
    if (typeof origin !== 'string' || origin.length > 2048 || origin !== siteOrigin(origin) || disabledOrigins.includes(origin)) continue;
    if (disabledOrigins.length === MAX_DISABLED_SITES) break;
    disabledOrigins.push(origin);
  }
  return { disabledOrigins };
}

export function siteAllowed(settings: SiteSettings, origin: string): boolean {
  const canonical = siteOrigin(origin);
  return canonical !== null && !settings.disabledOrigins.includes(canonical);
}

export function setSiteAllowed(settings: SiteSettings, origin: string, allowed: boolean): SiteSettings {
  const canonical = siteOrigin(origin);
  if (!canonical || canonical !== origin) throw new Error('INVALID_SITE: Open an ordinary website to change its controls.');
  const repaired = siteSettings(settings);
  if (allowed) return { disabledOrigins: repaired.disabledOrigins.filter(value => value !== canonical) };
  if (repaired.disabledOrigins.includes(canonical)) return repaired;
  if (repaired.disabledOrigins.length >= MAX_DISABLED_SITES) throw new Error('SITE_LIMIT: Aksara remembers up to 100 disabled sites. Allow controls on another saved site before adding this one.');
  return { disabledOrigins: [...repaired.disabledOrigins, canonical] };
}

export function overlaySettings(value: unknown): OverlaySettings {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return { highContrast: record.highContrast === true };
}
