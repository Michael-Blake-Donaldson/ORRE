import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";

const MIME_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml; charset=utf-8",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

type AppServerHandle = {
  origin: string;
  stop: () => Promise<void>;
};

let activeServer: AppServerHandle | null = null;

function getFilePathFromRequest(appDir: string, request: IncomingMessage) {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  const rawPath = decodeURIComponent(url.pathname === "/" ? "/auth.html" : url.pathname);
  const normalizedPath = path.normalize(rawPath).replace(/^([.][.][/\\])+/, "");
  const filePath = path.resolve(appDir, `.${normalizedPath}`);
  const resolvedAppDir = path.resolve(appDir);

  if (!filePath.startsWith(resolvedAppDir)) {
    return null;
  }

  return filePath;
}

async function serveFile(appDir: string, request: IncomingMessage, response: ServerResponse) {
  const filePath = getFilePathFromRequest(appDir, request);
  if (!filePath) {
    response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Forbidden");
    return;
  }

  try {
    const stats = await fs.stat(filePath);
    if (!stats.isFile()) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not found");
      return;
    }

    const extension = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[extension] ?? "application/octet-stream";
    const content = await fs.readFile(filePath);

    response.writeHead(200, {
      "Cache-Control": "no-cache",
      "Content-Type": contentType,
    });
    response.end(content);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
}

export async function ensureAppServer(appDir: string): Promise<AppServerHandle> {
  if (activeServer) {
    return activeServer;
  }

  const server = createServer((request, response) => {
    void serveFile(appDir, request, response);
  });

  const listenResult = await new Promise<{ port: number; server: Server }>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Could not determine local app server address."));
        return;
      }

      resolve({ port: address.port, server });
    });
  });

  activeServer = {
    origin: `http://localhost:${listenResult.port}`,
    stop: async () => {
      await new Promise<void>((resolve, reject) => {
        listenResult.server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });

      activeServer = null;
    },
  };

  return activeServer;
}

export async function stopAppServer() {
  if (!activeServer) {
    return;
  }

  await activeServer.stop();
}