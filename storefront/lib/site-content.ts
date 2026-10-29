export type SiteContent = {
  content: Record<string, Record<string, string | boolean>>;
  revision: number;
};
export function siteText(
  site: SiteContent | null,
  section: string,
  field: string,
  fallback: string,
) {
  const value = site?.content[section]?.[field];
  return typeof value === 'string' ? value : fallback;
}
