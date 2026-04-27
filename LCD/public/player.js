const imgView = document.getElementById("imgView");
const videoView = document.getElementById("videoView");
const emptyTip = document.getElementById("emptyTip");
const powerOffMask = document.getElementById("powerOffMask");
const pausedMask = document.getElementById("pausedMask");

let materials = [];
let index = 0;
let timer = null;
let poweredOn = true;
let paused = false;

function hideAllMedia() {
  imgView.style.display = "none";
  videoView.style.display = "none";
  videoView.pause();
  videoView.removeAttribute("src");
  videoView.load();
}

function updateMasks() {
  powerOffMask.classList.toggle("hidden", poweredOn);
  pausedMask.classList.toggle("hidden", !paused || !poweredOn);
  emptyTip.classList.toggle("hidden", materials.length > 0 || !poweredOn);
}

function scheduleNext(ms) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(playCurrentAndContinue, ms);
}

function playCurrentAndContinue() {
  if (!poweredOn || paused) return;
  if (!materials.length) {
    hideAllMedia();
    updateMasks();
    return;
  }

  const item = materials[index % materials.length];
  index = (index + 1) % materials.length;
  hideAllMedia();

  if (item.kind === "video") {
    videoView.src = item.url;
    videoView.style.display = "block";
    videoView.onended = () => scheduleNext(100);
    videoView.onerror = () => scheduleNext(100);
    videoView.play().catch(() => scheduleNext(100));
  } else {
    imgView.src = item.url;
    imgView.style.display = "block";
    scheduleNext(item.durationMs || 6000);
  }
}

async function loadMaterials() {
  const res = await fetch("/api/materials");
  materials = await res.json();
  if (index >= materials.length) index = 0;
  updateMasks();
}

async function loadDeviceState() {
  const res = await fetch("/api/device-state");
  const state = await res.json();
  poweredOn = state.poweredOn;
  paused = state.paused;
  updateMasks();
}

function applyRemoteCommand(command) {
  if (command === "power-on") poweredOn = true;
  if (command === "power-off") poweredOn = false;
  if (command === "pause") paused = true;
  if (command === "resume") paused = false;

  updateMasks();
  if (!poweredOn || paused) {
    hideAllMedia();
    if (timer) clearTimeout(timer);
    return;
  }
  playCurrentAndContinue();
}

async function bootstrap() {
  await Promise.all([loadMaterials(), loadDeviceState()]);
  if (materials.length && poweredOn && !paused) playCurrentAndContinue();
  const events = new EventSource("/events");
  events.addEventListener("materials_updated", async () => {
    await loadMaterials();
    if (poweredOn && !paused) playCurrentAndContinue();
  });
  events.addEventListener("remote_command", (event) => {
    const data = JSON.parse(event.data);
    applyRemoteCommand(data.command);
  });
  events.addEventListener("device_state", (event) => {
    const s = JSON.parse(event.data);
    poweredOn = s.poweredOn;
    paused = s.paused;
    updateMasks();
  });
}

bootstrap();
