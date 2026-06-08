const loginPanel = document.getElementById("loginPanel");
const controlPanel = document.getElementById("controlPanel");
const tokenInput = document.getElementById("tokenInput");
const loginButton = document.getElementById("loginButton");
const loginError = document.getElementById("loginError");
const logoutButton = document.getElementById("logoutButton");
const goPublisherButton = document.getElementById("goPublisherButton");
const goViewerButton = document.getElementById("goViewerButton");
const liveState = document.getElementById("liveState");
const titleInput = document.getElementById("titleInput");
const messageInput = document.getElementById("messageInput");
const viewerPasswordInput = document.getElementById("viewerPasswordInput");
const startButton = document.getElementById("startButton");
const stopButton = document.getElementById("stopButton");
const adminStatServer = document.getElementById("adminStatServer");
const adminStatResolution = document.getElementById("adminStatResolution");
const adminStatBitrate = document.getElementById("adminStatBitrate");
const adminStatCodec = document.getElementById("adminStatCodec");
const adminStatLag = document.getElementById("adminStatLag");
const whipUrl = document.getElementById("whipUrl");
const publisherUrl = document.getElementById("publisherUrl");
const rtmpUrl = document.getElementById("rtmpUrl");
const rtmpServer = document.getElementById("rtmpServer");
const rtmpStreamKey = document.getElementById("rtmpStreamKey");
const viewerUrl = document.getElementById("viewerUrl");
const copyWhip = document.getElementById("copyWhip");
const openPublisher = document.getElementById("openPublisher");
const copyRtmp = document.getElementById("copyRtmp");
const copyRtmpServer = document.getElementById("copyRtmpServer");
const copyRtmpStreamKey = document.getElementById("copyRtmpStreamKey");
const copyViewer = document.getElementById("copyViewer");
const liveHistorySelect = document.getElementById("liveHistorySelect");
const liveHistoryDetail = document.getElementById("liveHistoryDetail");
const adminNotice = document.getElementById("adminNotice");

let titleDirty = false;
let messageDirty = false;
let viewerPasswordDirty = false;
let selectedLiveId = "";

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "content-type": "application/json", ...(options.headers || {}) },
    ...options
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || "Request failed");
  }

  if (response.status === 204) return {};
  return response.json();
}

function showLoggedIn(show) {
  loginPanel.classList.toggle("hidden", show);
  controlPanel.classList.toggle("hidden", !show);
}

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "日時不明";
  return date.toLocaleString("ja-JP", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatDuration(seconds) {
  if (!seconds) return "0分";
  if (seconds < 60) return `${seconds}秒`;
  return `${Math.floor(seconds / 60)}分`;
}

function formatMbps(bitsPerSecond) {
  return `${(bitsPerSecond / 1000000).toFixed(1)} Mbps`;
}

function streamHealthLabel(health) {
  if (!health) return "-";
  if (!health.apiReachable) return "確認不可";
  return health.online ? "到達中" : "未到達";
}

function publisherLagLabel(metrics) {
  if (!metrics || metrics.stale) return "-";
  const ratioText = metrics.bitrateRatio ? `${Math.round(metrics.bitrateRatio * 100)}%` : "-";
  const values = `送信 ${Math.round(metrics.sendDelayMs || 0)}ms / RTT ${Math.round(metrics.rttMs || 0)}ms / ${ratioText}`;
  if (metrics.qualityLimitationReason === "bandwidth") return `注意 送信帯域 ${values}`;
  if (metrics.qualityLimitationReason === "cpu") return `注意 送信端末処理 ${values}`;
  if (metrics.lagRisk && metrics.bitrateRatio) return `注意 送信不足 ${values}`;
  if (metrics.sendDelayMs > 250 || metrics.rttMs > 500) return `注意 ${values}`;
  return values;
}

function renderStreamHealth(health) {
  adminStatServer.textContent = `サーバー: ${streamHealthLabel(health)}`;
  adminStatServer.classList.toggle("online", Boolean(health?.online));
  adminStatServer.classList.toggle("warning", Boolean(health?.apiReachable && !health?.online));
  adminStatResolution.textContent = health?.width && health?.height ? `画質: ${health.width} x ${health.height}` : "画質: -";
  adminStatBitrate.textContent = `通信量: ${health?.inboundBitrate ? formatMbps(health.inboundBitrate) : "-"}`;
  adminStatCodec.textContent = `Codec: ${health?.videoCodec || "-"}`;
  adminStatLag.textContent = `ラグ: ${publisherLagLabel(health?.publisher)}`;
  adminStatLag.classList.toggle("warning", Boolean(health?.publisher?.lagRisk));
}

function renderStatus(status, options = {}) {
  liveState.textContent = status.liveEnabled ? "配信中" : "停止中";
  liveState.classList.toggle("online", Boolean(status.liveEnabled));
  renderStreamHealth(status.streamHealth);

  if (options.forceInputs || !titleDirty) {
    titleInput.value = status.title || "Live";
    titleDirty = false;
  }
  if (options.forceInputs || !messageDirty) {
    messageInput.value = status.message || "";
    messageDirty = false;
  }
  if (options.forceInputs || !viewerPasswordDirty) {
    viewerPasswordInput.value = status.viewerPassword || "";
    viewerPasswordDirty = false;
  }

  whipUrl.value = status.whipUrl;
  publisherUrl.value = status.publisherUrl;
  rtmpUrl.value = status.rtmpUrl;
  rtmpServer.value = status.rtmpServer;
  rtmpStreamKey.value = status.rtmpStreamKey;
  viewerUrl.value = window.location.origin + "/";
  if (Array.isArray(status.archivedLives)) {
    renderLiveHistoryOptions(status.archivedLives);
  }
}

function renderLiveHistoryOptions(lives) {
  const previous = selectedLiveId || liveHistorySelect.value;
  liveHistorySelect.textContent = "";

  const emptyOption = document.createElement("option");
  emptyOption.value = "";
  emptyOption.textContent = lives.length ? "過去のライブを選択" : "過去のライブはありません";
  liveHistorySelect.append(emptyOption);

  for (const live of lives) {
    const option = document.createElement("option");
    option.value = live.id;
    option.textContent = `${formatDateTime(live.startedAt)} / ${live.title || "Live"} / 視聴 ${live.viewerCount} / コメント ${live.commentCount}`;
    liveHistorySelect.append(option);
  }

  if (previous && lives.some((live) => live.id === previous)) {
    liveHistorySelect.value = previous;
  } else {
    selectedLiveId = "";
    liveHistoryDetail.innerHTML = '<p class="notice">過去のライブを選択してください。</p>';
  }
}

function renderHistoryList(items, emptyText, renderer) {
  const list = document.createElement("div");
  list.className = "history-list";

  if (!items.length) {
    const empty = document.createElement("p");
    empty.className = "notice";
    empty.textContent = emptyText;
    list.append(empty);
    return list;
  }

  for (const item of items) {
    const row = document.createElement("div");
    row.className = "history-item";
    row.textContent = renderer(item);
    list.append(row);
  }
  return list;
}

function renderLiveDetail(live) {
  liveHistoryDetail.textContent = "";

  const header = document.createElement("div");
  header.className = "history-summary";
  const liveTitle = document.createElement("strong");
  liveTitle.textContent = live.title || "Live";
  const liveTime = document.createElement("span");
  liveTime.textContent = `${formatDateTime(live.startedAt)} - ${formatDateTime(live.endedAt)}`;
  header.append(liveTitle, liveTime);

  const viewersTitle = document.createElement("h3");
  viewersTitle.textContent = "視聴者";
  const viewers = renderHistoryList(live.viewers || [], "視聴者履歴はありません。", (viewer) => {
    return `${viewer.name} / ${formatDateTime(viewer.joinedAt)} - ${formatDateTime(viewer.leftAt)} / ${formatDuration(viewer.durationSeconds)}`;
  });

  const commentsTitle = document.createElement("h3");
  commentsTitle.textContent = "コメント";
  const comments = renderHistoryList(live.comments || [], "コメントはありません。", (comment) => {
    return `${comment.name} / ${formatDateTime(comment.createdAt)} / ${comment.text}`;
  });

  liveHistoryDetail.append(header, viewersTitle, viewers, commentsTitle, comments);
}

async function loadLiveDetail(liveId) {
  if (!liveId) {
    liveHistoryDetail.innerHTML = '<p class="notice">過去のライブを選択してください。</p>';
    return;
  }

  const live = await api(`/api/admin/lives/${encodeURIComponent(liveId)}`);
  renderLiveDetail(live);
}

async function refresh() {
  try {
    const status = await api("/api/admin/status");
    showLoggedIn(true);
    renderStatus(status);
  } catch {
    showLoggedIn(false);
  }
}

loginButton.addEventListener("click", async () => {
  loginError.textContent = "";
  try {
    await api("/api/admin/login", {
      method: "POST",
      body: JSON.stringify({ token: tokenInput.value })
    });
    tokenInput.value = "";
    await refresh();
  } catch (error) {
    loginError.textContent = error.message;
  }
});

titleInput.addEventListener("input", () => {
  titleDirty = true;
});

messageInput.addEventListener("input", () => {
  messageDirty = true;
});

viewerPasswordInput.addEventListener("input", () => {
  viewerPasswordDirty = true;
});

logoutButton.addEventListener("click", async () => {
  await api("/api/admin/logout", { method: "POST" }).catch(() => undefined);
  showLoggedIn(false);
});

startButton.addEventListener("click", async () => {
  try {
    const status = await api("/api/admin/start", {
      method: "POST",
      body: JSON.stringify({
        title: titleInput.value,
        message: messageInput.value,
        viewerPassword: viewerPasswordInput.value
      })
    });
    renderStatus(status, { forceInputs: true });
    adminNotice.textContent = "配信を開始しました。ブラウザ配信ページ、WHIP、RTMP から送信できます。";
  } catch (error) {
    adminNotice.textContent = error.message;
  }
});

stopButton.addEventListener("click", async () => {
  await api("/api/admin/stop", { method: "POST" });
  await refresh();
  adminNotice.textContent = "配信を停止しました。接続中の送信セッションも停止します。";
});

liveHistorySelect.addEventListener("change", () => {
  selectedLiveId = liveHistorySelect.value;
  loadLiveDetail(selectedLiveId).catch((error) => {
    liveHistoryDetail.textContent = error.message;
  });
});

copyWhip.addEventListener("click", () => navigator.clipboard.writeText(whipUrl.value));
openPublisher.addEventListener("click", () => window.open(publisherUrl.value, "_blank", "noopener"));
goPublisherButton.addEventListener("click", () => {
  window.location.href = publisherUrl.value || "/publish.html";
});
goViewerButton.addEventListener("click", () => {
  window.location.href = viewerUrl.value || "/";
});
copyRtmp.addEventListener("click", () => navigator.clipboard.writeText(rtmpUrl.value));
copyRtmpServer.addEventListener("click", () => navigator.clipboard.writeText(rtmpServer.value));
copyRtmpStreamKey.addEventListener("click", () => navigator.clipboard.writeText(rtmpStreamKey.value));
copyViewer.addEventListener("click", () => navigator.clipboard.writeText(viewerUrl.value));

refresh();
setInterval(refresh, 5000);
