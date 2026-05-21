const $ = (id) => document.getElementById(id);
const refList = $("ref-list");
const refSection = $("reference-section");
const frameSection = $("frame-section");
const viewport = $("viewport");
const queueList = $("queue-list");
const queueEmpty = $("queue-empty");

const STORAGE_KEY = "seedance.jobs.v1";
const MAX_JOBS = 50;
const POLL_INTERVAL_MS = 4000;

/** @type {Map<string, {timeout:number}>} */
const pollers = new Map();
/** @type {Array<Job>} */
let jobs = loadJobs();
let selectedJobId = null;
let queueTab = "all";

// ---------- Storage ----------

function loadJobs() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}
function saveJobs() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(jobs.slice(0, MAX_JOBS)));
  } catch (e) {
    console.warn("localStorage write failed", e);
  }
}

// ---------- Helpers ----------

function uploadMode() {
  return document.querySelector('input[name="upload_mode"]:checked').value;
}
function mode() {
  return document.querySelector('input[name="mode"]:checked').value;
}
function isTerminal(s) {
  return s === "succeeded" || s === "failed" || s === "cancelled" || s === "expired";
}
function isVideo(ct) { return ct && ct.startsWith("video/"); }
function previewMedia(url, ct) {
  return isVideo(ct) ? `<video src="${url}" muted></video>` : `<img src="${url}" alt="" />`;
}
function formatAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}초`;
  if (s < 3600) return `${Math.floor(s/60)}분`;
  if (s < 86400) return `${Math.floor(s/3600)}시간`;
  return `${Math.floor(s/86400)}일`;
}
function truncateTaskId(id) {
  return id && id.length > 12 ? id.slice(0, 8) + "…" + id.slice(-4) : id;
}

async function uploadFile(file) {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("mode", uploadMode());
  const r = await fetch("/api/upload", { method: "POST", body: fd });
  if (!r.ok) throw new Error("업로드 실패: " + (await r.text()));
  return await r.json();
}

function pickFile(accept) {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.click();
  });
}

// ---------- Reference items ----------

function addRefItem(kind) {
  const wrap = document.createElement("div");
  wrap.className = "ref-item";
  wrap.dataset.kind = kind;
  const index = refList.querySelectorAll(`[data-kind="${kind}"]`).length + 1;
  wrap.innerHTML = `
    <div class="thumb">@${kind}${index}</div>
    <div class="meta">
      <div><strong>${kind}</strong> · reference_${kind}</div>
      <div class="filename">파일 미선택</div>
    </div>
    <div class="actions">
      <button class="upload">파일 선택</button>
      <button class="remove">×</button>
    </div>
  `;
  refList.appendChild(wrap);

  wrap.querySelector(".upload").addEventListener("click", async () => {
    const accept = kind === "image" ? "image/*" : "video/*";
    const file = await pickFile(accept);
    if (!file) return;
    try {
      const res = await uploadFile(file);
      wrap.dataset.url = res.url;
      wrap.dataset.contentType = res.content_type;
      wrap.querySelector(".thumb").innerHTML = previewMedia(res.url, res.content_type);
      wrap.querySelector(".filename").textContent = `${file.name} · ${(res.size/1024).toFixed(1)} KB`;
    } catch (e) {
      alert(e.message);
    }
  });
  wrap.querySelector(".remove").addEventListener("click", () => wrap.remove());
}

$("add-ref-image").addEventListener("click", () => addRefItem("image"));
$("add-ref-video").addEventListener("click", () => addRefItem("video"));

// ---------- Frame slots ----------

document.querySelectorAll(".slot-body").forEach((slot) => {
  slot.classList.add("empty");
  slot.addEventListener("click", async (ev) => {
    if (ev.target.closest(".uploaded")) return;
    const file = await pickFile("image/*");
    if (!file) return;
    try {
      const res = await uploadFile(file);
      slot.dataset.url = res.url;
      slot.dataset.contentType = res.content_type;
      slot.classList.remove("empty");
      slot.innerHTML = `
        <div class="uploaded">
          ${previewMedia(res.url, res.content_type)}
          <div class="meta">${file.name} · ${(res.size/1024).toFixed(1)} KB</div>
          <button class="clear">제거</button>
        </div>`;
      slot.querySelector(".clear").addEventListener("click", (e) => {
        e.stopPropagation();
        slot.innerHTML = "";
        slot.classList.add("empty");
        delete slot.dataset.url;
      });
    } catch (e) {
      alert(e.message);
    }
  });
});

// ---------- Mode switch ----------

document.querySelectorAll('input[name="mode"]').forEach((el) =>
  el.addEventListener("change", () => {
    if (mode() === "reference") {
      refSection.classList.remove("hidden");
      frameSection.classList.add("hidden");
    } else {
      refSection.classList.add("hidden");
      frameSection.classList.remove("hidden");
    }
  })
);

// ---------- Queue tabs ----------

document.querySelectorAll('input[name="qtab"]').forEach((el) =>
  el.addEventListener("change", () => {
    queueTab = document.querySelector('input[name="qtab"]:checked').value;
    renderQueue();
  })
);

// ---------- Job model ----------
/**
 * @typedef Job
 * @property {string} id
 * @property {string} taskId
 * @property {number} createdAt
 * @property {number} lastUpdate
 * @property {string} status
 * @property {string} prompt
 * @property {string|null} videoUrl
 * @property {string|null} thumbnailUrl
 * @property {object} payload
 * @property {object|null} raw
 * @property {Array<{ts:number, text:string, level:string}>} events
 */

function makeJobId() { return Math.random().toString(36).slice(2, 10); }

function gatherReferences() {
  if (mode() === "reference") {
    return Array.from(refList.querySelectorAll(".ref-item"))
      .filter((el) => el.dataset.url)
      .map((el) => ({
        kind: el.dataset.kind,
        url: el.dataset.url,
        role: `reference_${el.dataset.kind}`,
      }));
  }
  const refs = [];
  document.querySelectorAll(".slot-body").forEach((slot) => {
    if (!slot.dataset.url) return;
    refs.push({ kind: "image", url: slot.dataset.url, role: slot.dataset.role });
  });
  return refs;
}

function buildPayloadFromForm() {
  return {
    model: $("model").value,
    prompt: $("prompt").value,
    references: gatherReferences(),
    ratio: $("ratio").value,
    resolution: $("resolution").value,
    duration: parseInt($("duration").value, 10),
    seed: $("seed").value ? parseInt($("seed").value, 10) : null,
    generate_audio: $("generate_audio").checked,
    return_last_frame: $("return_last_frame").checked,
    watermark: $("watermark").checked,
    negative_prompt: $("negative_prompt").value || null,
  };
}

function jobLog(job, text, level = "") {
  job.events.unshift({ ts: Date.now(), text, level });
  if (job.events.length > 40) job.events.length = 40;
  job.lastUpdate = Date.now();
  saveJobs();
  if (selectedJobId === job.id) renderStatus(job);
  renderQueue();
}

// ---------- Submit ----------

$("submit").addEventListener("click", async () => {
  const payload = buildPayloadFromForm();
  const job = {
    id: makeJobId(),
    taskId: "",
    createdAt: Date.now(),
    lastUpdate: Date.now(),
    status: "submitting",
    prompt: payload.prompt || "(no prompt)",
    videoUrl: null,
    thumbnailUrl: null,
    payload,
    raw: null,
    events: [{ ts: Date.now(), text: "요청 전송 중", level: "status-running" }],
  };
  jobs.unshift(job);
  if (jobs.length > MAX_JOBS) jobs.length = MAX_JOBS;
  saveJobs();
  selectJob(job.id);
  renderQueue();

  try {
    const r = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const resp = await r.json();
    job.raw = resp;
    if (!r.ok) {
      job.status = "failed";
      jobLog(job, "요청 실패: " + (resp.detail || JSON.stringify(resp)), "status-failed");
      return;
    }
    job.taskId = resp.task_id || "";
    if (!job.taskId) {
      job.status = "failed";
      jobLog(job, "task_id 누락. Raw 응답 확인.", "status-failed");
      return;
    }
    job.status = "queued";
    jobLog(job, `작업 생성됨 · ${job.taskId}`, "status-running");
    startPolling(job);
  } catch (e) {
    job.status = "failed";
    jobLog(job, "네트워크 에러: " + e.message, "status-failed");
  }
});

// ---------- Polling ----------

function startPolling(job) {
  if (!job.taskId || pollers.has(job.id) || isTerminal(job.status)) return;
  let attempts = 0;
  const tick = async () => {
    attempts += 1;
    try {
      const r = await fetch(`/api/task/${job.taskId}`);
      const data = await r.json();
      job.raw = data;
      const status = data.status || data.state || data.data?.status || "running";
      const videoUrl =
        data?.content?.video_url ||
        data?.output?.video_url ||
        data?.data?.video_url ||
        data?.result?.video_url || null;

      job.status = status;
      if (videoUrl) {
        job.videoUrl = videoUrl;
        job.thumbnailUrl = videoUrl;
      }
      jobLog(job, `#${attempts} ${status}`, isTerminal(status) ? (status === "succeeded" ? "status-succeeded" : "status-failed") : "status-running");

      if (isTerminal(status) || videoUrl) {
        if (videoUrl && selectedJobId === job.id) loadJobIntoViewport(job);
        pollers.delete(job.id);
        return;
      }
    } catch (e) {
      jobLog(job, "폴링 에러: " + e.message, "status-failed");
    }
    const t = setTimeout(tick, POLL_INTERVAL_MS);
    pollers.set(job.id, { timeout: t });
  };
  pollers.set(job.id, { timeout: 0 });
  tick();
}

function stopPolling(jobId) {
  const p = pollers.get(jobId);
  if (p && p.timeout) clearTimeout(p.timeout);
  pollers.delete(jobId);
}

// ---------- Selection / viewport / status ----------

function selectJob(id) {
  selectedJobId = id;
  const job = jobs.find((j) => j.id === id);
  if (!job) {
    viewport.classList.remove("has-result");
    $("status").innerHTML = "";
    $("raw").textContent = "";
    $("task-id").textContent = "";
    $("selected-info").textContent = "";
    renderQueue();
    return;
  }
  loadJobIntoViewport(job);
  renderStatus(job);
  renderQueue();
}

function loadJobIntoViewport(job) {
  $("task-id").textContent = job.taskId ? `task ${truncateTaskId(job.taskId)}` : "";
  const info = [
    job.payload.model,
    job.payload.resolution,
    job.payload.ratio,
    `${job.payload.duration}s`,
  ].join(" · ");
  $("selected-info").textContent = info;
  if (job.videoUrl) {
    viewport.classList.add("has-result");
    $("result-video").src = job.videoUrl;
    $("result-link").href = job.videoUrl;
    $("result-link").textContent = "원본 URL 열기";
    $("result-download").href = job.videoUrl;
    $("result-download").setAttribute("download", `seedance_${job.taskId || job.id}.mp4`);
  } else {
    viewport.classList.remove("has-result");
    $("result-video").removeAttribute("src");
  }
}

function renderStatus(job) {
  $("status").innerHTML = job.events
    .map((e) => {
      const t = new Date(e.ts).toLocaleTimeString();
      return `<div class="status-line ${e.level}">[${t}] ${escapeHtml(e.text)}</div>`;
    })
    .join("");
  $("raw").textContent = job.raw ? JSON.stringify(job.raw, null, 2) : "";
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;",
  })[c]);
}

// ---------- Queue render ----------

function statusPill(status) {
  const map = {
    submitting: ["queued", "전송 중"],
    queued: ["queued", "대기"],
    running: ["running spin", "진행"],
    succeeded: ["succeeded", "완료"],
    failed: ["failed", "실패"],
    expired: ["failed", "만료"],
    cancelled: ["failed", "취소"],
  };
  const [cls, label] = map[status] || ["queued spin", status || "..."];
  return `<span class="pill ${cls}">${label}</span>`;
}

function jobMatchesTab(job) {
  if (queueTab === "all") return true;
  if (queueTab === "active") return !isTerminal(job.status);
  if (queueTab === "done") return isTerminal(job.status);
  return true;
}

function renderQueue() {
  $("queue-count").textContent = jobs.length;
  const filtered = jobs.filter(jobMatchesTab);
  queueEmpty.style.display = filtered.length ? "none" : "block";
  queueList.innerHTML = filtered
    .map((job) => {
      const thumb = job.videoUrl
        ? `<video src="${job.videoUrl}" muted></video>`
        : (isTerminal(job.status) && job.status !== "succeeded" ? "✕" : "▣");
      const title = (job.prompt || "(no prompt)").trim() || "(no prompt)";
      return `
        <div class="q-item ${job.id === selectedJobId ? "selected" : ""}" data-id="${job.id}">
          <div class="q-thumb">${thumb}</div>
          <div class="q-body">
            <div class="q-title">${escapeHtml(title)}</div>
            <div class="q-meta">
              ${statusPill(job.status)}
              <span>${formatAgo(job.createdAt)} 전</span>
              <span class="mono">${truncateTaskId(job.taskId) || ""}</span>
            </div>
          </div>
          <button class="q-remove" data-id="${job.id}" title="삭제">×</button>
        </div>`;
    })
    .join("");

  queueList.querySelectorAll(".q-item").forEach((el) => {
    el.addEventListener("click", (e) => {
      if (e.target.classList.contains("q-remove")) return;
      selectJob(el.dataset.id);
    });
  });
  queueList.querySelectorAll(".q-remove").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      removeJob(btn.dataset.id);
    });
  });
}

function removeJob(id) {
  stopPolling(id);
  jobs = jobs.filter((j) => j.id !== id);
  saveJobs();
  if (selectedJobId === id) selectJob(jobs[0]?.id || null);
  renderQueue();
}

$("clear-completed").addEventListener("click", () => {
  const before = jobs.length;
  jobs.forEach((j) => { if (isTerminal(j.status)) stopPolling(j.id); });
  jobs = jobs.filter((j) => !isTerminal(j.status));
  if (jobs.length !== before) {
    saveJobs();
    if (!jobs.find((j) => j.id === selectedJobId)) selectJob(jobs[0]?.id || null);
    renderQueue();
  }
});

$("clear-all").addEventListener("click", () => {
  if (!confirm("모든 작업 기록을 삭제할까요?")) return;
  jobs.forEach((j) => stopPolling(j.id));
  jobs = [];
  saveJobs();
  selectJob(null);
  renderQueue();
});

// ---------- Periodic "n초 전" refresh ----------

setInterval(() => { if (jobs.length) renderQueue(); }, 15000);

// ---------- Init ----------

(async () => {
  try {
    const r = await fetch("/api/health");
    const j = await r.json();
    $("health").textContent = j.api_key_configured
      ? `● 연결됨 · ${new URL(j.base_url).host}`
      : "⚠ ARK_API_KEY 미설정";
  } catch {
    $("health").textContent = "백엔드 응답 없음";
  }

  // Resume polling for non-terminal jobs from previous session
  jobs.forEach((j) => {
    if (!isTerminal(j.status) && j.taskId) {
      jobLog(j, "이전 세션에서 폴링 재개", "status-running");
      startPolling(j);
    }
  });
  renderQueue();
  if (jobs[0]) selectJob(jobs[0].id);
})();
