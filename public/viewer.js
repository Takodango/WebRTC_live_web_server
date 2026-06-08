const video = document.getElementById("video");
const viewerStage = document.querySelector(".viewer-stage");
const empty = document.getElementById("empty");
const title = document.getElementById("title");
const message = document.getElementById("message");
const playButton = document.getElementById("playButton");
const statusDot = document.getElementById("statusDot");
const viewerGate = document.getElementById("viewerGate");
const viewerNameInput = document.getElementById("viewerNameInput");
const viewerPasswordInput = document.getElementById("viewerPasswordInput");
const commentsList = document.getElementById("commentsList");
const commentForm = document.getElementById("commentForm");
const commentInput = document.getElementById("commentInput");
const commentButton = document.getElementById("commentButton");
const currentViewersList = document.getElementById("currentViewersList");
const pastViewersList = document.getElementById("pastViewersList");
const viewerStatServer = document.getElementById("viewerStatServer");
const viewerStatResolution = document.getElementById("viewerStatResolution");
const viewerStatBitrate = document.getElementById("viewerStatBitrate");
const viewerStatCodec = document.getElementById("viewerStatCodec");
const viewerStatLag = document.getElementById("viewerStatLag");

let peerConnection;
let sessionUrl;
let lastStatus;
let wantsPlayback = false;
let reconnectTimer;
let startingPlayback = false;
let viewerId = "";
let viewerToken = "";
let playbackUrl = "";
let displayName = localStorage.getItem("viewerName") || "";
let heartbeatTimer;
let inboundStatsSample;
let measuredBitrate = 0;
let measuredCodec = "";
let receiveDelayMs = 0;
let receivedPacketsLost = 0;
let freezeCount = 0;
let statsTimer;
let streamHealth;
let streamOfflineSince = 0;

function disableViewerZoom() {
  const prevent = (event) => event.preventDefault();
  document.addEventListener("gesturestart", prevent, { passive: false });
  document.addEventListener("gesturechange", prevent, { passive: false });
  document.addEventListener("gestureend", prevent, { passive: false });
  document.addEventListener("touchmove", (event) => {
    if (event.touches.length > 1) event.preventDefault();
  }, { passive: false });
  document.addEventListener("dblclick", prevent, { passive: false });
}

viewerNameInput.value = displayName;

function syncViewerLayout() {
  const isPortrait = window.matchMedia("(orientation: portrait)").matches;
  const isPhoneLandscape = window.matchMedia("(orientation: landscape) and (max-height: 520px)").matches;
  const verticalReserve = isPhoneLandscape ? 40 : 54;
  const sideWidth = isPhoneLandscape ? 231 : 300;
  const maxByHeight = Math.max(320, (window.innerHeight - verticalReserve) * 16 / 9);
  const maxByWidth = Math.max(320, window.innerWidth - sideWidth - 20);
  const maxVideoWidth = Math.min(maxByHeight, maxByWidth);
  document.documentElement.style.setProperty("--viewer-main-max-width", `${Math.round(maxVideoWidth)}px`);

  if (isPortrait || !viewerStage) {
    document.documentElement.style.removeProperty("--viewer-stage-height");
    return;
  }

  const height = viewerStage.getBoundingClientRect().height;
  if (height > 0) {
    document.documentElement.style.setProperty("--viewer-stage-height", `${Math.round(height)}px`);
  }
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "content-type": "application/json", ...(options.headers || {}) },
    cache: "no-store",
    ...options
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || "Request failed");
  }

  return response.json();
}

async function waitForIceGatheringComplete(pc) {
  if (pc.iceGatheringState === "complete") return;

  await new Promise((resolve) => {
    const timeout = setTimeout(resolve, 2500);
    pc.addEventListener("icegatheringstatechange", () => {
      if (pc.iceGatheringState === "complete") {
        clearTimeout(timeout);
        resolve();
      }
    });
  });
}

function cleanName() {
  return viewerNameInput.value.replace(/\s+/g, " ").trim().slice(0, 40);
}

function cleanPassword() {
  return viewerPasswordInput.value.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 80);
}

function formatTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
}

function formatDuration(seconds) {
  if (!seconds) return "0分";
  if (seconds < 60) return `${seconds}秒`;
  return `${Math.floor(seconds / 60)}分`;
}

function formatMbps(bitsPerSecond) {
  return `${(bitsPerSecond / 1000000).toFixed(1)} Mbps`;
}

function formatCodecName(mimeType) {
  return mimeType.replace("video/", "").toUpperCase();
}

function streamHealthLabel(health) {
  if (!health) return "-";
  if (!health.apiReachable) return "確認不可";
  return health.online ? "到達中" : "未到達";
}

function publisherLagLabel(metrics) {
  if (!metrics || metrics.stale) return "";
  const ratioText = metrics.bitrateRatio ? `${Math.round(metrics.bitrateRatio * 100)}%` : "-";
  const values = `送信 ${Math.round(metrics.sendDelayMs || 0)}ms / RTT ${Math.round(metrics.rttMs || 0)}ms / ${ratioText}`;
  if (metrics.qualityLimitationReason === "bandwidth") return `送信帯域 ${values}`;
  if (metrics.qualityLimitationReason === "cpu") return `送信端末処理 ${values}`;
  if (metrics.lagRisk) return `送信不足 ${values}`;
  return values;
}

function viewerLagLabel() {
  const publisherLag = publisherLagLabel(streamHealth?.publisher);
  if (streamHealth?.publisher?.lagRisk && publisherLag) return `注意 ${publisherLag}`;
  if (["disconnected", "failed"].includes(peerConnection?.connectionState)) return `注意 接続揺れ`;
  if (["disconnected", "failed"].includes(peerConnection?.iceConnectionState)) return `注意 通信揺れ`;
  if (receiveDelayMs > 250) return `注意 受信バッファ ${Math.round(receiveDelayMs)}ms`;
  if (receivedPacketsLost > 0) return `注意 パケット損失 ${receivedPacketsLost}`;
  if (freezeCount > 0) return `注意 フリーズ ${freezeCount}`;
  if (!peerConnection) return "-";
  return `受信 ${Math.round(receiveDelayMs)}ms${publisherLag ? ` / ${publisherLag}` : ""}`;
}

function viewerLagRisk() {
  return viewerLagLabel().startsWith("注意");
}

function updateViewerStats() {
  const width = video.videoWidth;
  const height = video.videoHeight;

  viewerStatServer.textContent = `サーバー: ${streamHealthLabel(streamHealth)}`;
  viewerStatServer.classList.toggle("online", Boolean(streamHealth?.online));
  viewerStatServer.classList.toggle("warning", Boolean(streamHealth?.apiReachable && !streamHealth?.online));
  viewerStatResolution.textContent = width && height ? `画質: ${width} x ${height}` : "画質: -";
  viewerStatBitrate.textContent = `通信量: ${measuredBitrate ? formatMbps(measuredBitrate) : "-"}`;
  viewerStatCodec.textContent = `Codec: ${measuredCodec || "-"}`;
  viewerStatLag.textContent = `ラグ: ${viewerLagLabel()}`;
  viewerStatLag.classList.toggle("warning", viewerLagRisk());
}

function resetViewerStats() {
  measuredBitrate = 0;
  measuredCodec = "";
  receiveDelayMs = 0;
  receivedPacketsLost = 0;
  freezeCount = 0;
  inboundStatsSample = undefined;
  updateViewerStats();
}

async function updateInboundStats() {
  if (!peerConnection?.getStats) {
    updateViewerStats();
    return;
  }

  const stats = await peerConnection.getStats();
  let codecId = "";

  stats.forEach((report) => {
    if (report.type !== "inbound-rtp" || report.kind !== "video") return;

    const bytesReceived = report.bytesReceived || 0;
    const timestamp = report.timestamp || performance.now();
    codecId = report.codecId || codecId;
    const jitterBufferDelay = report.jitterBufferDelay || 0;
    const jitterBufferEmittedCount = report.jitterBufferEmittedCount || 0;

    if (inboundStatsSample && timestamp > inboundStatsSample.timestamp) {
      measuredBitrate =
        ((bytesReceived - inboundStatsSample.bytesReceived) * 8 * 1000) /
        (timestamp - inboundStatsSample.timestamp);
      const bufferDelayDelta = jitterBufferDelay - inboundStatsSample.jitterBufferDelay;
      const emittedDelta = jitterBufferEmittedCount - inboundStatsSample.jitterBufferEmittedCount;
      receiveDelayMs = emittedDelta > 0 && bufferDelayDelta >= 0 ? (bufferDelayDelta * 1000) / emittedDelta : receiveDelayMs;
    }
    receivedPacketsLost = report.packetsLost || 0;
    freezeCount = report.freezeCount || 0;
    inboundStatsSample = { bytesReceived, timestamp, jitterBufferDelay, jitterBufferEmittedCount };
  });

  if (codecId) {
    const codecReport = stats.get(codecId);
    measuredCodec = codecReport?.mimeType ? formatCodecName(codecReport.mimeType) : measuredCodec;
  }

  updateViewerStats();
}

function startStatsPolling() {
  clearInterval(statsTimer);
  updateViewerStats();
  updateInboundStats().catch(() => undefined);
  statsTimer = setInterval(() => {
    updateInboundStats().catch(() => undefined);
  }, 1000);
}

function stopStatsPolling() {
  clearInterval(statsTimer);
  statsTimer = undefined;
}

function renderEmptyList(parent, text) {
  parent.textContent = "";
  const item = document.createElement("p");
  item.className = "viewer-list-empty";
  item.textContent = text;
  parent.append(item);
}

function renderAudience(audience) {
  currentViewersList.textContent = "";
  if (!audience.currentViewers?.length) {
    renderEmptyList(currentViewersList, "まだいません。");
  } else {
    for (const viewer of audience.currentViewers) {
      const item = document.createElement("div");
      item.className = "viewer-person";
      item.textContent = `${viewer.name} / ${formatTime(viewer.joinedAt)}から`;
      currentViewersList.append(item);
    }
  }

  pastViewersList.textContent = "";
  if (!audience.pastViewers?.length) {
    renderEmptyList(pastViewersList, "履歴はまだありません。");
  } else {
    for (const viewer of audience.pastViewers.slice(0, 30)) {
      const item = document.createElement("div");
      item.className = "viewer-person";
      item.textContent = `${viewer.name} / ${formatTime(viewer.joinedAt)} - ${formatTime(viewer.leftAt)} / ${formatDuration(
        viewer.durationSeconds
      )}`;
      pastViewersList.append(item);
    }
  }

  commentsList.textContent = "";
  if (!audience.comments?.length) {
    renderEmptyList(commentsList, "コメントはまだありません。");
  } else {
    for (const comment of audience.comments) {
      const item = document.createElement("article");
      item.className = "comment-item";

      const meta = document.createElement("div");
      meta.className = "comment-meta";
      meta.textContent = `${comment.name} / ${formatTime(comment.createdAt)}`;

      const text = document.createElement("p");
      text.textContent = comment.text;

      item.append(meta, text);
      commentsList.append(item);
    }
    commentsList.scrollTop = commentsList.scrollHeight;
  }
}

function setCommentEnabled(enabled) {
  commentInput.disabled = !enabled;
  commentButton.disabled = !enabled;
}

function viewerAuthQuery() {
  if (!playbackUrl) return "";
  const url = new URL(playbackUrl, window.location.origin);
  return `${url.searchParams.get("viewerId") || ""}:${url.searchParams.get("viewerToken") || ""}`;
}

async function fetchAudience() {
  if (!viewerId || !playbackUrl) return;
  const url = new URL(playbackUrl, window.location.origin);
  renderAudience(await api(`/api/audience?${url.searchParams.toString()}`));
}

async function joinViewer() {
  if (viewerId) return;

  const name = cleanName();
  const password = cleanPassword();
  if (!name) {
    message.textContent = "名前を入力してください。";
    viewerNameInput.focus();
    throw new Error("Name is required");
  }
  if (!password) {
    message.textContent = "パスワードを入力してください。";
    viewerPasswordInput.focus();
    throw new Error("Password is required");
  }

  displayName = name;
  localStorage.setItem("viewerName", displayName);

  const audience = await api("/api/viewer/join", {
    method: "POST",
    body: JSON.stringify({ name: displayName, password })
  });
  viewerId = audience.viewerId;
  viewerToken = audience.viewerToken || "";
  playbackUrl = audience.whepUrl || lastStatus?.whepUrl || "/whep";
  setCommentEnabled(true);
  renderAudience(audience);
  startHeartbeat();
}

function startHeartbeat() {
  clearInterval(heartbeatTimer);
  heartbeatTimer = setInterval(async () => {
    if (!viewerId) return;
    try {
      const audience = await api("/api/viewer/heartbeat", {
        method: "POST",
        body: JSON.stringify({ viewerId, viewerToken })
      });
      renderAudience(audience);
    } catch {
      // The normal audience polling will repair the UI if this momentary update fails.
    }
  }, 5000);
}

async function leaveViewer({ beacon = false } = {}) {
  if (!viewerId) return;

  const payload = JSON.stringify({ viewerId, viewerToken });
  const leavingViewerId = viewerId;
  const leavingViewerToken = viewerToken;
  viewerId = "";
  viewerToken = "";
  playbackUrl = "";
  setCommentEnabled(false);
  clearInterval(heartbeatTimer);
  heartbeatTimer = undefined;

  if (beacon && navigator.sendBeacon) {
    navigator.sendBeacon("/api/viewer/leave", new Blob([payload], { type: "application/json" }));
    return;
  }

  await api("/api/viewer/leave", {
    method: "POST",
    body: JSON.stringify({ viewerId: leavingViewerId, viewerToken: leavingViewerToken })
  }).then(renderAudience);
}

async function fetchStatus() {
  const response = await fetch("/api/status", { cache: "no-store" });
  const wasLive = Boolean(lastStatus?.liveEnabled);
  lastStatus = await response.json();

  title.textContent = lastStatus.title || "Live";
  if (!lastStatus.liveEnabled) {
    message.textContent = "";
  } else if (!viewerId && !peerConnection && !startingPlayback) {
    message.textContent = lastStatus.message || "配信中です。";
  }
  playButton.disabled = !lastStatus.liveEnabled;
  viewerNameInput.disabled = !lastStatus.liveEnabled;
  viewerPasswordInput.disabled = !lastStatus.liveEnabled;
  viewerGate.classList.toggle("disabled", !lastStatus.liveEnabled);
  statusDot.classList.toggle("online", Boolean(lastStatus.liveEnabled));

  if (!lastStatus.liveEnabled && (peerConnection || viewerId)) {
    await stopPlayback({ leave: true });
  }

  if (wantsPlayback && lastStatus.liveEnabled && !wasLive && !peerConnection) {
    scheduleReconnect(300);
  }
}

async function fetchStreamHealth() {
  streamHealth = await api("/api/stream-health");
  const now = Date.now();
  const streamIsOffline = Boolean(lastStatus?.liveEnabled && streamHealth.apiReachable && !streamHealth.online);

  if (!streamIsOffline) {
    streamOfflineSince = 0;
  } else if (!streamOfflineSince) {
    streamOfflineSince = now;
  }

  updateViewerStats();

  if (streamOfflineSince && now - streamOfflineSince >= 10000 && peerConnection) {
    streamOfflineSince = 0;
    message.textContent = "映像が10秒以上届いていないため、再接続します。";
    await stopPlayback({ keepIntent: true, leave: false });
    scheduleReconnect(1000);
  }
}

function scheduleReconnect(delay = 2500) {
  if (!wantsPlayback || !lastStatus?.liveEnabled || reconnectTimer || peerConnection || startingPlayback) return;

  reconnectTimer = setTimeout(() => {
    reconnectTimer = undefined;
    startPlayback().catch(() => {
      message.textContent = "再接続を試しています。";
      scheduleReconnect();
    });
  }, delay);
}

async function startPlayback() {
  if (startingPlayback) return;
  clearTimeout(reconnectTimer);
  reconnectTimer = undefined;

  await joinViewer();
  wantsPlayback = true;
  await stopPlayback({ keepIntent: true, leave: false });
  startingPlayback = true;

  try {
    peerConnection = new RTCPeerConnection();
    peerConnection.addTransceiver("video", { direction: "recvonly" });
    peerConnection.addTransceiver("audio", { direction: "recvonly" });

    peerConnection.addEventListener("track", (event) => {
      video.srcObject = event.streams[0];
      empty.classList.add("hidden");
      startStatsPolling();
      event.track.addEventListener("ended", () => stopPlayback({ reconnecting: true }).then(() => scheduleReconnect()));
      event.track.addEventListener("mute", () => {
        setTimeout(() => {
          if (event.track.muted) stopPlayback({ reconnecting: true }).then(() => scheduleReconnect());
        }, 2500);
      });
    });

    peerConnection.addEventListener("connectionstatechange", () => {
      if (!peerConnection) return;
      if (["failed", "disconnected", "closed"].includes(peerConnection.connectionState)) {
        stopPlayback({ reconnecting: true }).then(() => scheduleReconnect());
      }
    });

    peerConnection.addEventListener("iceconnectionstatechange", () => {
      if (!peerConnection) return;
      if (["failed", "disconnected", "closed"].includes(peerConnection.iceConnectionState)) {
        stopPlayback({ reconnecting: true }).then(() => scheduleReconnect());
      }
    });

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    await waitForIceGatheringComplete(peerConnection);

    const response = await fetch(playbackUrl || lastStatus.whepUrl, {
      method: "POST",
      headers: { "content-type": "application/sdp" },
      body: peerConnection.localDescription.sdp
    });

    if (!response.ok) {
      await stopPlayback({ leave: false, reconnecting: true });
      scheduleReconnect();
      return;
    }

    sessionUrl = response.headers.get("location");
    const answer = await response.text();
    await peerConnection.setRemoteDescription({ type: "answer", sdp: answer });
  } catch (error) {
    await stopPlayback({ leave: false, reconnecting: true });
    scheduleReconnect();
  } finally {
    startingPlayback = false;
  }
}

async function stopPlayback({ keepIntent = true, leave = false, reconnecting = false } = {}) {
  if (!keepIntent) wantsPlayback = false;

  clearTimeout(reconnectTimer);
  reconnectTimer = undefined;
  startingPlayback = false;

  if (sessionUrl) {
    fetch(sessionUrl, { method: "DELETE" }).catch(() => undefined);
    sessionUrl = undefined;
  }

  if (peerConnection) {
    peerConnection.close();
    peerConnection = undefined;
  }

  stopStatsPolling();
  video.srcObject = null;
  empty.classList.remove("hidden");
  if (reconnecting) {
    title.textContent = "ライブ映像が不安定です";
    message.textContent = "再接続中です。";
  }
  resetViewerStats();

  if (leave) {
    await leaveViewer().catch(() => undefined);
  }
}

playButton.addEventListener("click", () => {
  startPlayback().catch((error) => {
    if (["Name is required", "Password is required"].includes(error.message)) {
      wantsPlayback = false;
    } else {
      message.textContent = error.message;
    }
  });
});

viewerNameInput.addEventListener("input", () => {
  displayName = cleanName();
  if (displayName) localStorage.setItem("viewerName", displayName);
});

video.addEventListener("loadedmetadata", updateViewerStats);
video.addEventListener("resize", updateViewerStats);
window.addEventListener("resize", syncViewerLayout);
window.addEventListener("orientationchange", () => {
  syncViewerLayout();
});
if (window.ResizeObserver && viewerStage) {
  new ResizeObserver(syncViewerLayout).observe(viewerStage);
}

commentForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = commentInput.value.trim();
  if (!viewerId || !text) return;

  commentButton.disabled = true;
  try {
    const audience = await api("/api/comments", {
      method: "POST",
      body: JSON.stringify({ viewerId, viewerToken, text })
    });
    commentInput.value = "";
    renderAudience(audience);
  } catch (error) {
    message.textContent = error.message;
  } finally {
    commentButton.disabled = false;
  }
});

window.addEventListener("pagehide", () => {
  leaveViewer({ beacon: true });
});

disableViewerZoom();
fetchStatus();
fetchStreamHealth().catch(() => undefined);
renderAudience({ currentViewers: [], pastViewers: [], comments: [] });
syncViewerLayout();
setInterval(fetchStatus, 3000);
setInterval(() => fetchStreamHealth().catch(() => undefined), 2000);
setInterval(() => {
  if (!viewerAuthQuery()) return;
  fetchAudience().catch(() => undefined);
}, 3000);
