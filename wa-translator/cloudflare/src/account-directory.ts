import { UserDirectory as WorkerUserDirectory } from "./worker";

// Keep the existing Durable Object class name/migration while retiring the
// zero-only credits preview from the active product. The base object still owns
// profile/usage retention and deletion; this wrapper removes the legacy field
// on the next successful account read/write and never returns it to clients.
export class UserDirectory extends WorkerUserDirectory {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const accountRoot = url.pathname === "/";
    const response = await super.fetch(request);

    // Root profile reads/writes and /usage writes are all account activity. An
    // old zero-only balance should disappear on whichever successful operation
    // happens first rather than waiting specifically for the next /api/me read.
    if (response.ok && (request.method === "GET" || request.method === "POST")) {
      await this.ctx.storage.delete("credits");
    }
    if (!(accountRoot && request.method === "GET" && response.ok)) return response;

    const body = await response.json<Record<string, unknown>>();
    delete body.credits;
    const headers = new Headers(response.headers);
    headers.delete("Content-Length");
    return Response.json(body, {status: response.status, headers});
  }
}
