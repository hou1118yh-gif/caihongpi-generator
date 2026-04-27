const http = require("http");
const { spawn } = require("child_process");
const path = require("path");

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function request(method, route, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: 3000,
        path: route,
        method,
        headers: data
          ? {
              "Content-Type": "application/json",
              "Content-Length": Buffer.byteLength(data)
            }
          : undefined
      },
      (res) => {
        let raw = "";
        res.on("data", (c) => (raw += c));
        res.on("end", () => resolve({ status: res.statusCode, body: raw }));
      }
    );
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

async function run() {
  const child = spawn("node", ["server.js"], {
    cwd: path.resolve(__dirname, ".."),
    stdio: "ignore"
  });

  try {
    await wait(1200);
    const list = await request("GET", "/api/materials");
    if (list.status !== 200) throw new Error("GET /api/materials failed");

    const pause = await request("POST", "/api/remote/pause");
    if (pause.status !== 200) throw new Error("POST /api/remote/pause failed");

    const resume = await request("POST", "/api/remote/resume");
    if (resume.status !== 200) throw new Error("POST /api/remote/resume failed");

    const powerOff = await request("POST", "/api/remote/power-off");
    if (powerOff.status !== 200) throw new Error("POST /api/remote/power-off failed");

    const powerOn = await request("POST", "/api/remote/power-on");
    if (powerOn.status !== 200) throw new Error("POST /api/remote/power-on failed");

    console.log("Smoke tests passed");
  } finally {
    child.kill();
  }
}

run().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
