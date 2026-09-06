import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { connect } from "node:net";

const MAX_BYTES = 10 * 1024 * 1024;
const SCANNER_HOST = process.env.BASEER_CLAMAV_HOST?.trim() || "clamav";
const SCANNER_PORT = positivePort(process.env.BASEER_CLAMAV_PORT, 3310);
const PORT = positivePort(process.env.BASEER_DOCUMENT_SCANNER_PORT, 5300);

async function main() {
  const server = createServer((request, response) => void handle(request, response));
  server.requestTimeout = 15_000;
  server.headersTimeout = 15_000;
  server.listen(PORT, "0.0.0.0");
}

async function handle(request: IncomingMessage, response: ServerResponse) {
  try {
    if (request.method === "GET" && request.url === "/health") {
      const healthy = await ping();
      reply(response, healthy ? 200 : 503, healthy ? { status: "READY" } : { status: "UNAVAILABLE" });
      return;
    }
    if (request.method !== "POST" || request.url !== "/scan" || request.headers["content-type"] !== "application/octet-stream") {
      reply(response, 404, { status: "QUARANTINED" });
      return;
    }
    const bytes = await readBody(request);
    const verdict = await scan(bytes);
    reply(response, verdict === "OK" ? 200 : 200, { status: verdict === "OK" ? "READY" : "QUARANTINED" });
  } catch {
    // Do not disclose scanner topology or file details. The caller has an
    // explicit fail-closed path for an unavailable/invalid response.
    reply(response, 503, { status: "UNAVAILABLE" });
  }
}

function reply(response: ServerResponse, status: number, body: Readonly<{ status: string }>) {
  response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store", "x-content-type-options": "nosniff" });
  response.end(JSON.stringify(body));
}

async function readBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const value of request) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
    size += chunk.byteLength;
    if (size === 0 || size > MAX_BYTES) throw new Error("body-size");
    chunks.push(chunk);
  }
  if (size === 0) throw new Error("empty-body");
  return Buffer.concat(chunks, size);
}

async function ping(): Promise<boolean> {
  try {
    return (await command(Buffer.from("zPING\0", "utf8"))) === "PONG";
  } catch {
    return false;
  }
}

async function scan(bytes: Buffer): Promise<"OK" | "FOUND"> {
  const chunks: Buffer[] = [Buffer.from("zINSTREAM\0", "utf8")];
  for (let offset = 0; offset < bytes.byteLength; offset += 64 * 1024) {
    const part = bytes.subarray(offset, Math.min(offset + 64 * 1024, bytes.byteLength));
    const length = Buffer.allocUnsafe(4);
    length.writeUInt32BE(part.byteLength);
    chunks.push(length, part);
  }
  chunks.push(Buffer.alloc(4));
  const result = await command(Buffer.concat(chunks));
  if (/\bOK$/.test(result)) return "OK";
  if (/\bFOUND$/.test(result)) return "FOUND";
  throw new Error("unexpected-clamd-result");
}

function command(payload: Buffer): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host: SCANNER_HOST, port: SCANNER_PORT });
    const chunks: Buffer[] = [];
    const timeout = setTimeout(() => socket.destroy(new Error("clamd-timeout")), 10_000);
    socket.once("error", reject);
    socket.on("data", (chunk: Buffer) => chunks.push(chunk));
    socket.once("connect", () => socket.end(payload));
    socket.once("close", () => {
      clearTimeout(timeout);
      const result = Buffer.concat(chunks).toString("utf8").replace(/\0/g, "").trim();
      if (!result) reject(new Error("clamd-empty-response"));
      else resolve(result);
    });
  });
}

function positivePort(value: string | undefined, fallback: number) {
  const port = value ? Number.parseInt(value, 10) : fallback;
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) throw new Error("invalid-port");
  return port;
}

void main();
