/// <reference types="vite/client" />
export function navigationUrl(path: string, base = import.meta.env.BASE_URL) {
  return base === "/" ? path : `${base}#${path}`;
}
export function currentRoute(url: URL, base = import.meta.env.BASE_URL) {
  if (
    base !== "/" &&
    [base + "admin", base + "admin/", base + "admin/index.html"].includes(
      url.pathname,
    )
  )
    return "admin";
  if (
    base === "/" &&
    url.pathname === "/" &&
    /^#\/admin(?:\/|\.html)?$/.test(url.hash)
  )
    return "admin";
  const route =
    base === "/" ? url : new URL(url.hash.slice(1) || "/", url.origin);
  if (route.pathname.startsWith("/admin")) return "admin";
  if (
    route.pathname.startsWith("/passage") ||
    route.searchParams.get("go") === "passage"
  )
    return "passage";
  if (route.pathname.startsWith("/vocab")) return "vocab";
  return "scores";
}
