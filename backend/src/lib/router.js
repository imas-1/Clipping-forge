"use strict";
/**
 * Minimal dependency-free router.
 * Deliberately has zero npm dependencies so the API can run with nothing
 * but `node server.js` — no install step required to boot it.
 */

function pathToRegex(path) {
  const paramNames = [];
  const pattern = path
    .replace(/\/+$/, "")
    .split("/")
    .map((segment) => {
      if (segment.startsWith(":")) {
        paramNames.push(segment.slice(1));
        return "([^/]+)";
      }
      return segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    })
    .join("/");
  return { regex: new RegExp(`^${pattern}/?$`), paramNames };
}

class Router {
  constructor() {
    this.routes = [];
  }

  add(method, path, handler) {
    const { regex, paramNames } = pathToRegex(path);
    this.routes.push({ method, regex, paramNames, handler });
  }

  get(path, handler) {
    this.add("GET", path, handler);
  }
  post(path, handler) {
    this.add("POST", path, handler);
  }
  patch(path, handler) {
    this.add("PATCH", path, handler);
  }
  delete(path, handler) {
    this.add("DELETE", path, handler);
  }

  match(method, pathname) {
    for (const route of this.routes) {
      if (route.method !== method) continue;
      const m = route.regex.exec(pathname);
      if (!m) continue;
      const params = {};
      route.paramNames.forEach((name, i) => (params[name] = decodeURIComponent(m[i + 1])));
      return { handler: route.handler, params };
    }
    return null;
  }
}

module.exports = { Router };
