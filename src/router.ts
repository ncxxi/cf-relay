import { contentTypeEssence, isJsonType } from "./body";

export type Route = "health" | "help" | "envelope" | "compat" | "transparent" | "not-found";

export function route(request: Request, url: URL): Route {
  if (url.pathname === "/_health" && request.method === "GET") return "health";
  if (url.pathname.startsWith("/t/")) return "transparent";
  if (url.pathname !== "/") return "not-found";

  const method = request.method;
  if (method === "GET" || method === "HEAD") {
    return url.searchParams.has("url") ? "compat" : "help";
  }

  const json = isJsonType(contentTypeEssence(request.headers.get("content-type")));
  if (method === "POST" && (json || !url.searchParams.has("url"))) return "envelope";
  if (url.searchParams.has("url")) return "compat";
  if (method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE") return "envelope";
  return "not-found";
}
