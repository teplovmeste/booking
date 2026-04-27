export const STATIC_FILES = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/index.html", ["index.html", "text/html; charset=utf-8"]],
  ["/admin", ["admin.html", "text/html; charset=utf-8"]],
  ["/admin.html", ["admin.html", "text/html; charset=utf-8"]],
  ["/styles.css", ["styles.css", "text/css; charset=utf-8"]],
  ["/app.js", ["app.js", "application/javascript; charset=utf-8"]],
  ["/admin.js", ["admin.js", "application/javascript; charset=utf-8"]]
]);

export function normalizePathname(pathname) {
  if (!pathname || pathname === "/") {
    return "/";
  }

  return pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
}

export function stripBasePath(pathname, basePath) {
  const normalizedPath = normalizePathname(pathname);
  const normalizedBasePath = normalizePathname(basePath || "/");

  if (normalizedBasePath === "/") {
    return normalizedPath;
  }

  if (normalizedPath === normalizedBasePath) {
    return "/";
  }

  if (normalizedPath.startsWith(`${normalizedBasePath}/`)) {
    return normalizedPath.slice(normalizedBasePath.length);
  }

  return null;
}

export function getStaticFile(pathname) {
  return STATIC_FILES.get(normalizePathname(pathname)) || null;
}

export function isStaticMethod(method) {
  return method === "GET" || method === "HEAD";
}
