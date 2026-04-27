const uploadForm = document.getElementById("uploadForm");
const fileInput = document.getElementById("fileInput");
const materialList = document.getElementById("materialList");
const stateText = document.getElementById("stateText");

async function fetchMaterials() {
  const res = await fetch("/api/materials");
  return res.json();
}

function renderMaterials(items) {
  materialList.innerHTML = "";
  if (!items.length) {
    materialList.innerHTML = "<p>暂无素材</p>";
    return;
  }

  items.forEach((item) => {
    const row = document.createElement("div");
    row.className = "material-item";
    row.innerHTML = `
      <div>
        <div>${item.name}</div>
        <small>${item.mimeType}</small>
      </div>
      <input type="number" min="1000" step="1000" value="${item.durationMs || 6000}" title="图片/动图展示时长(ms)" />
      <button>删除</button>
    `;

    const durationInput = row.querySelector("input");
    durationInput.onchange = async () => {
      await fetch(`/api/materials/${item.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ durationMs: Number(durationInput.value) })
      });
    };

    const delBtn = row.querySelector("button");
    delBtn.onclick = async () => {
      await fetch(`/api/materials/${item.id}`, { method: "DELETE" });
      refresh();
    };

    materialList.appendChild(row);
  });
}

async function refreshState() {
  const res = await fetch("/api/device-state");
  const s = await res.json();
  stateText.textContent = `设备状态：${s.poweredOn ? "开机" : "关机"} / ${s.paused ? "暂停" : "播放中"}`;
}

async function refresh() {
  const items = await fetchMaterials();
  renderMaterials(items);
  await refreshState();
}

uploadForm.onsubmit = async (e) => {
  e.preventDefault();
  const file = fileInput.files[0];
  if (!file) return;
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
  const res = await fetch("/api/materials", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: file.name,
      mimeType: file.type,
      dataUrl
    })
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: "Upload failed" }));
    alert(data.error || "上传失败");
  }
  fileInput.value = "";
  refresh();
};

document.querySelectorAll("[data-cmd]").forEach((btn) => {
  btn.addEventListener("click", async () => {
    const cmd = btn.getAttribute("data-cmd");
    await fetch(`/api/remote/${cmd}`, { method: "POST" });
    refreshState();
  });
});

const events = new EventSource("/events");
events.addEventListener("materials_updated", refresh);
events.addEventListener("remote_command", refresh);
events.addEventListener("device_state", (event) => {
  const s = JSON.parse(event.data);
  stateText.textContent = `设备状态：${s.poweredOn ? "开机" : "关机"} / ${s.paused ? "暂停" : "播放中"}`;
});

refresh();
