const http = require("http");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { URL } = require("url");

const PORT = process.env.PORT || 3000;
const uploadDir = path.join(__dirname, "uploads");
const imageDir = path.join(uploadDir, "images");
const videoDir = path.join(uploadDir, "videos");
const metaFile = path.join(uploadDir, "materials.json");
const publicDir = path.join(__dirname, "public");

if (!fs.existsSync(imageDir)) fs.mkdirSync(imageDir, { recursive: true });
if (!fs.existsSync(videoDir)) fs.mkdirSync(videoDir, { recursive: true });
if (!fs.existsSync(metaFile)) fs.writeFileSync(metaFile, JSON.stringify([], null, 2), "utf-8");

const ALLOWED_MIME = new Map([
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
  ["image/gif", ".gif"],
  ["image/webp", ".webp"],
  ["video/mp4", ".mp4"],
  ["video/webm", ".webm"],
  ["video/ogg", ".ogv"]
]);

const MIME_BY_EXT = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "application/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".png", "image/png"],
  [".gif", "image/gif"],
  [".webp", "image/webp"],
  [".mp4", "video/mp4"],
  [".webm", "video/webm"],
  [".ogv", "video/ogg"]
]);

function readMaterials() {
  const content = fs.readFileSync(metaFile, "utf-8").trim();
  return content ? JSON.parse(content) : [];
}

function writeMaterials(list) {
  fs.writeFileSync(metaFile, JSON.stringify(list, null, 2), "utf-8");
}

let deviceState = {
  poweredOn: true,
  paused: false
};

const sseClients = new Set();

function sendJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function notify(type, data = {}) {
  const msg = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) res.write(msg);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (c) => {
      raw += c;
      if (raw.length > 260 * 1024 * 1024) reject(new Error("Payload too large"));
    });
    req.on("end", () => resolve(raw));
    req.on("error", reject);
  });
}

function serveFile(filePath, res) {
  if (!fs.existsSync(filePath)) {
    res.writeHead(404);
    res.end("Not Found");
    return;
  }
  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, { "Content-Type": MIME_BY_EXT.get(ext) || "application/octet-stream" });
  fs.createReadStream(filePath).pipe(res);
}

function parseId(pathname) {
  const m = pathname.match(/^\/api\/materials\/([^/]+)$/);
  return m ? m[1] : "";
}

const server = http.createServer(async (req, res) => {
  const reqUrl = new URL(req.url, `http://${req.headers.host}`);
  const { pathname } = reqUrl;

  if (req.method === "GET" && pathname === "/events") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive"
    });
    res.write(`event: device_state\ndata: ${JSON.stringify(deviceState)}\n\n`);
    sseClients.add(res);
    req.on("close", () => sseClients.delete(res));
    return;
  }

  if (req.method === "GET" && pathname === "/api/materials") return sendJson(res, 200, readMaterials());

  if (req.method === "POST" && pathname === "/api/materials") {
    try {
      const body = JSON.parse((await readBody(req)) || "{}");
      const { name, mimeType, dataUrl } = body;
      if (!name || !mimeType || !dataUrl) return sendJson(res, 400, { error: "Invalid payload" });
      if (!ALLOWED_MIME.has(mimeType)) return sendJson(res, 400, { error: "Unsupported file format" });
      const payload = dataUrl.split(",")[1] || "";
      const ext = ALLOWED_MIME.get(mimeType);
      const kind = mimeType.startsWith("video/") ? "video" : "image";
      const urlKind = mimeType.startsWith("video/") ? "videos" : "images";
      const filename = `${Date.now()}_${crypto.randomBytes(4).toString("hex")}${ext}`;
      const targetDir = kind === "video" ? videoDir : imageDir;
      fs.writeFileSync(path.join(targetDir, filename), Buffer.from(payload, "base64"));

      const list = readMaterials();
      const item = {
        id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        name,
        filename,
        mimeType,
        kind,
        url: `/uploads/${urlKind}/${filename}`,
        durationMs: kind === "video" ? 0 : 6000,
        createdAt: new Date().toISOString()
      };
      list.push(item);
      writeMaterials(list);
      notify("materials_updated", {});
      return sendJson(res, 201, item);
    } catch (e) {
      return sendJson(res, 400, { error: e.message || "Upload failed" });
    }
  }

  if (req.method === "PUT" && /^\/api\/materials\/[^/]+$/.test(pathname)) {
    const id = parseId(pathname);
    const list = readMaterials();
    const idx = list.findIndex((i) => i.id === id);
    if (idx < 0) return sendJson(res, 404, { error: "Material not found" });
    const body = JSON.parse((await readBody(req)) || "{}");
    const durationMs = Number(body.durationMs);
    if (!Number.isFinite(durationMs) || durationMs < 1000 || durationMs > 600000) {
      return sendJson(res, 400, { error: "durationMs must be between 1000 and 600000" });
    }
    list[idx].durationMs = durationMs;
    writeMaterials(list);
    notify("materials_updated", {});
    return sendJson(res, 200, list[idx]);
  }

  if (req.method === "DELETE" && /^\/api\/materials\/[^/]+$/.test(pathname)) {
    const id = parseId(pathname);
    const list = readMaterials();
    const idx = list.findIndex((i) => i.id === id);
    if (idx < 0) return sendJson(res, 404, { error: "Material not found" });
    const [removed] = list.splice(idx, 1);
    const targetDir = removed.kind === "video" ? videoDir : imageDir;
    const fp = path.join(targetDir, removed.filename);
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
    writeMaterials(list);
    notify("materials_updated", {});
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === "GET" && pathname === "/api/device-state") return sendJson(res, 200, deviceState);

  if (req.method === "POST" && pathname.startsWith("/api/remote/")) {
    const cmd = pathname.replace("/api/remote/", "");
    if (cmd === "power-on") deviceState.poweredOn = true;
    if (cmd === "power-off") deviceState.poweredOn = false;
    if (cmd === "pause") deviceState.paused = true;
    if (cmd === "resume") deviceState.paused = false;
    if (!["power-on", "power-off", "pause", "resume"].includes(cmd)) {
      return sendJson(res, 404, { error: "Unknown command" });
    }
    notify("remote_command", { command: cmd });
    notify("device_state", deviceState);
    return sendJson(res, 200, { ok: true, state: deviceState });
  }

  if (pathname.startsWith("/uploads/images/")) {
    const filename = pathname.replace("/uploads/images/", "");
    return serveFile(path.join(imageDir, filename), res);
  }
  if (pathname.startsWith("/uploads/videos/")) {
    const filename = pathname.replace("/uploads/videos/", "");
    return serveFile(path.join(videoDir, filename), res);
  }
  if (pathname === "/admin" || pathname === "/admin.html") return serveFile(path.join(publicDir, "admin.html"), res);
  if (pathname === "/" || pathname === "/index.html") return serveFile(path.join(publicDir, "index.html"), res);
  return serveFile(path.join(publicDir, pathname.replace(/^\//, "")), res);
});

server.listen(PORT, () => {
  console.log(`Ad player running: http://localhost:${PORT}`);
});
