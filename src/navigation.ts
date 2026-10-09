import { portalUrl } from './config.js';

// Export only stable navigation parameters. Session tokens and record/account
// identifiers must never become reusable routes or source-code fixtures.
const routeParameters = new Set(['actionflag', 'viewname', 'screen', 'module', 'menu', 'lang', 'locale', 'modulecode', 'modulename', 'menuname', 'doctype', 'elementid', 'applicanttype', 'applicationmstid', 'applicationtypeid', 'screenmode', 'selectoption', 'ispopup', 'recordsperpage', 'appendtolastwhere', 'opensearch', 'arrangeparams', 'flag', 'isreregisterfromlogin', 'isbranchreregister', 'forbranch', 'isviewmyprofile', 'hideactionbtns', 'schemetype', 'subjectid', 'screentype', 'srytypemstpk']);
export function safeNavigationUrl(value: string, base = portalUrl): string | undefined {
  if (!value || /^javascript:|^data:|^mailto:|^tel:/i.test(value)) return undefined;
  try {
    const url = new URL(value, base);
    if (url.origin !== new URL(base).origin) return undefined;
    url.username = ''; url.password = '';
    url.pathname = url.pathname.replace(/;jsessionid=[^/;]*/ig, '');
    for (const key of [...url.searchParams.keys()]) if (!routeParameters.has(key.toLowerCase())) url.searchParams.delete(key);
    return url.href;
  } catch { return undefined; }
}

export function redactNavigationText(value: string): string {
  return value.replace(/;jsessionid=[^/;?'"\s)]+/ig, '').replace(/([?&](?:token|password|passwd|session|sessionid|jsessionid|ticket|authorization|access_token|refresh_token|csrf|code)=)[^&'"\s)]+/ig, '$1[REDACTED]');
}

export interface MenuEntry { label: string; path: string[]; url?: string }
export function selectSection(entries: MenuEntry[], name: string): MenuEntry {
  const normalized = name.trim().toLowerCase();
  const matches = entries.filter(entry => entry.url && (entry.label.toLowerCase() === normalized || entry.path.join(' / ').toLowerCase() === normalized));
  if (matches.length !== 1) throw new Error(matches.length ? 'Section name is ambiguous. Use its full path from etric_sections.' : 'Section not found. Use a name or full path returned by etric_sections.');
  return matches[0];
}
