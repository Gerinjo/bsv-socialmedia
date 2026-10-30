// Used only by resources-api-imports.json: keep the actual API router and its
// dependencies while supplying an authenticated context without real accounts.
let context: any;
export function setResourceApiContext(value: any) { context = value; }
export function withSupabase(_options: unknown, handler: any) {
  return (request: Request) => handler(request, context);
}
