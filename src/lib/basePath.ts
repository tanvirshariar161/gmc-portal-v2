/**
 * The app can be served from a sub-path (GitHub Pages serves it at /<repo>/). Routes inside the
 * app stay root-relative ("/company"); these helpers add or remove the sub-path at the browser edge.
 */
const BASE = import.meta.env.BASE_URL.replace(/\/+$/, "");

/** "/company" → "/gmc-portal-v2/company" when served from a sub-path. Other URLs are left alone. */
export function appHref(path: string) {
  return BASE && path.startsWith("/") && !path.startsWith("//") ? BASE + path : path;
}

/** The browser's pathname with the sub-path removed, so routes can match it. */
export function appPath(pathname: string) {
  return BASE && (pathname === BASE || pathname.startsWith(BASE + "/")) ? pathname.slice(BASE.length) || "/" : pathname;
}
