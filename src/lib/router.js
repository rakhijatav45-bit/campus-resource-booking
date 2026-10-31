export class Router {
  constructor() {
    this.routes = [];
  }

  add(method, pattern, ...handlers) {
    const keys = [];
    const source = pattern.replace(/:([a-z_]+)/gi, (_, key) => {
      keys.push(key);
      return '([^/]+)';
    });
    this.routes.push({ method, keys, handlers, regex: new RegExp(`^${source}/?$`) });
  }

  // Returns { route, params }, { methodNotAllowed: true } or null.
  match(method, pathname) {
    let pathMatched = false;
    for (const route of this.routes) {
      const found = route.regex.exec(pathname);
      if (!found) continue;
      pathMatched = true;
      if (route.method !== method) continue;
      const params = {};
      route.keys.forEach((key, i) => {
        params[key] = found[i + 1];
      });
      return { route, params };
    }
    return pathMatched ? { methodNotAllowed: true } : null;
  }
}
