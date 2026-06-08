const loginPanel = document.getElementById("loginPanel");
const publisherPanel = document.getElementById("publisherPanel");
const tokenInput = document.getElementById("tokenInput");
const loginButton = document.getElementById("loginButton");
const loginError = document.getElementById("loginError");
const logoutButton = document.getElementById("logoutButton");
const liveState = document.getElementById("liveState");
const preview = document.getElementById("preview");
const cameraEmpty = document.getElementById("cameraEmpty");
const notice = document.getElementById("notice");
const statServer = document.getElementById("statServer");
const statResolution = document.getElementById("statResolution");
const statFrameRate = document.getElementById("statFrameRate");
const statBitrate = document.getElementById("statBitrate");
const statCodec = document.getElementById("statCodec");
const statServerBitrate = document.getElementById("statServerBitrate");
const statLag = document.getElementById("statLag");
const sourceCameraChoice = document.getElementById("sourceCameraChoice");
const sourceCaptureChoice = document.getElementById("sourceCaptureChoice");
const micSourcePanel = document.getElementById("micSourcePanel");
const cameraSourcePanel = document.getElementById("cameraSourcePanel");
const captureSourcePanel = document.getElementById("captureSourcePanel");
const iosCaptureNotice = document.getElementById("iosCaptureNotice");
const streamSettingsPanel = document.getElementById("streamSettingsPanel");
const recordingSettingsPanel = document.getElementById("recordingSettingsPanel");
const commonActionPanel = document.getElementById("commonActionPanel");
const cameraButton = document.getElementById("cameraButton");
const screenButton = document.getElementById("screenButton");
const muteButton = document.getElementById("muteButton");
const pauseVideoButton = document.getElementById("pauseVideoButton");
const recordButton = document.getElementById("recordButton");
const publishButton = document.getElementById("publishButton");
const stopButton = document.getElementById("stopButton");
const cameraSelect = document.getElementById("cameraSelect");
const audioSelect = document.getElementById("audioSelect");
const micEnabledCheckbox = document.getElementById("micEnabledCheckbox");
const resolutionSelect = document.getElementById("resolutionSelect");
const frameRateSelect = document.getElementById("frameRateSelect");
const bitrateSelect = document.getElementById("bitrateSelect");
const codecSelect = document.getElementById("codecSelect");
const recordingModeSelect = document.getElementById("recordingModeSelect");
const recordingResolutionSelect = document.getElementById("recordingResolutionSelect");
const recordingFrameRateSelect = document.getElementById("recordingFrameRateSelect");
const recordingBitrateSelect = document.getElementById("recordingBitrateSelect");
const recordingStatus = document.getElementById("recordingStatus");
const recordingListButton = document.getElementById("recordingListButton");
const recordingList = document.getElementById("recordingList");
const shareRecordingButton = document.getElementById("shareRecordingButton");
const downloadRecordingLink = document.getElementById("downloadRecordingLink");
const zoomRange = document.getElementById("zoomRange");
const zoomValue = document.getElementById("zoomValue");
const focusRange = document.getElementById("focusRange");
const focusValue = document.getElementById("focusValue");

let status;
let streamHealth;
let mediaStream;
let peerConnection;
let sessionUrl;
let selectedSourceChoice = "";
let sourceMode = "camera";
let cameraDevices = [];
let audioDevices = [];
let selectedDeviceId = "";
let selectedAudioDeviceId = "";
let preferredFacingMode = "environment";
let preferredZoom = 1;
let preferredFocusRatio = 0;
let focusDistanceRange;
let focusControlReady = false;
let audioMuted = false;
let micEnabled = true;
let videoPaused = false;
let measuredFrameRate = 0;
let frameSample = { frames: 0, startedAt: 0 };
let frameCallbackHandle;
let outboundStatsSample;
let measuredBitrate = 0;
let measuredCodec = "";
let sendDelayMs = 0;
let rttMs = 0;
let qualityLimitationReason = "";
let lastMetricsPostAt = 0;
let mediaRecorder;
let recordingCanvas;
let recordingContext;
let recordingDrawTimer;
let recordingStream;
let recordingAudioTrack;
let recordingVideoTrack;
let recordedChunks = [];
let recordingUrl = "";
let recordingStartedAt = 0;
let recordedBlob;
let recordedFileName = "";
let recordedMimeType = "";
let recordingSessionId = "";
let recordingChunkIndex = 0;
let recordingChunkWrites = [];
let loadedRecordingSessionId = "";
let screenAudioContext;
let screenAudioSourceTracks = [];
let screenDisplayAudioTrack;

const RECORDING_DB = "live-recorder";
const RECORDING_STORE = "chunks";
const RECORDING_META_KEY = "live-recorder-meta";
const isIOSDevice = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

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
  publisherPanel.classList.toggle("hidden", !show);
}

function setNotice(text) {
  notice.textContent = text;
}

function selectInputSource(choice) {
  selectedSourceChoice = choice;
  const isCamera = choice === "camera";
  const isCapture = choice === "capture";

  sourceCameraChoice.classList.toggle("active", isCamera);
  sourceCaptureChoice.classList.toggle("active", isCapture);
  micSourcePanel.classList.toggle("hidden", !isCamera && !isCapture);
  cameraSourcePanel.classList.toggle("hidden", !isCamera);
  captureSourcePanel.classList.toggle("hidden", !isCapture);
  screenButton.classList.toggle("hidden", isCapture && isIOSDevice);
  iosCaptureNotice.classList.toggle("hidden", !isCapture || !isIOSDevice);
  streamSettingsPanel.classList.remove("hidden");
  recordingSettingsPanel.classList.remove("hidden");
  commonActionPanel.classList.remove("hidden");

  if (!mediaStream) {
    const messages = {
      camera: "カメラを開始してください。",
      capture: isIOSDevice ? "iOSではWebページから画面収録映像を直接取り込めません。" : "画面キャプチャを開始してください。"
    };
    setNotice(messages[choice] || "入力ソースを選択してください。");
  }
}

function renderStatus(nextStatus) {
  status = nextStatus;
  liveState.textContent = status.liveEnabled ? "配信受付中" : "停止中";
  liveState.classList.toggle("online", Boolean(status.liveEnabled));
  publishButton.disabled = !mediaStream || !status.liveEnabled || Boolean(peerConnection);
  muteButton.disabled = !audioTrack();
  pauseVideoButton.disabled = !mediaStream;
  recordButton.disabled = !mediaStream && !mediaRecorder;
  muteButton.textContent = audioMuted ? "ミュート解除" : "ミュート";
  muteButton.classList.toggle("danger", audioMuted);
  muteButton.classList.toggle("secondary", !audioMuted);
  pauseVideoButton.textContent = videoPaused ? "映像再開" : "映像停止";
  pauseVideoButton.classList.toggle("danger", videoPaused);
  pauseVideoButton.classList.toggle("secondary", !videoPaused);
  recordButton.textContent = mediaRecorder ? "録画停止" : "録画開始";
  recordButton.classList.toggle("danger", Boolean(mediaRecorder));
  recordButton.classList.toggle("secondary", !mediaRecorder);
}

async function refresh() {
  try {
    renderStatus(await api("/api/admin/status"));
    showLoggedIn(true);
  } catch {
    showLoggedIn(false);
  }
}

async function waitForIceGatheringComplete(pc) {
  if (pc.iceGatheringState === "complete") return;

  await new Promise((resolve) => {
    const timeout = setTimeout(resolve, 3000);
    pc.addEventListener("icegatheringstatechange", () => {
      if (pc.iceGatheringState === "complete") {
        clearTimeout(timeout);
        resolve();
      }
    });
  });
}

function selectedResolution() {
  const [width, height] = resolutionSelect.value.split("x").map(Number);
  return { width, height };
}

function selectedFrameRate() {
  return Number(frameRateSelect.value);
}

function selectedBitrate() {
  return Number(bitrateSelect.value);
}

function effectiveBitrate() {
  return selectedBitrate();
}

function selectedRecordingResolution() {
  const [width, height] = recordingResolutionSelect.value.split("x").map(Number);
  return { width, height };
}

function selectedRecordingMode() {
  return recordingModeSelect.value;
}

function selectedRecordingFrameRate() {
  return Number(recordingFrameRateSelect.value);
}

function selectedRecordingBitrate() {
  return Number(recordingBitrateSelect.value);
}

function selectedCodec() {
  return codecSelect.value;
}

function codecLabel(value = selectedCodec()) {
  return value === "auto" ? "自動" : value.replace("video/", "");
}

function formatCodecName(mimeType) {
  return mimeType.replace("video/", "").toUpperCase();
}

function formatMbps(bitsPerSecond) {
  return `${(bitsPerSecond / 1000000).toFixed(1)} Mbps`;
}

function formatMs(ms) {
  return `${Math.round(ms)} ms`;
}

function formatMegabytes(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatVideoSize(bytes) {
  if (!bytes) return "";
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function openRecordingDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(RECORDING_DB, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(RECORDING_STORE, { keyPath: "key" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function putRecordingChunk(record) {
  const db = await openRecordingDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(RECORDING_STORE, "readwrite");
    tx.objectStore(RECORDING_STORE).put(record);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function getRecordingRecords(sessionId) {
  const db = await openRecordingDb();
  const records = await new Promise((resolve, reject) => {
    const tx = db.transaction(RECORDING_STORE, "readonly");
    const request = tx.objectStore(RECORDING_STORE).getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return records
    .filter((record) => record.sessionId === sessionId)
    .sort((a, b) => a.index - b.index);
}

async function getRecordingChunks(sessionId) {
  const records = await getRecordingRecords(sessionId);
  return records
    .map((record) => record.blob);
}

async function clearRecordingChunks(sessionId) {
  const db = await openRecordingDb();
  const records = await new Promise((resolve, reject) => {
    const tx = db.transaction(RECORDING_STORE, "readonly");
    const request = tx.objectStore(RECORDING_STORE).getAllKeys();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });

  await new Promise((resolve, reject) => {
    const tx = db.transaction(RECORDING_STORE, "readwrite");
    const store = tx.objectStore(RECORDING_STORE);
    records.filter((key) => String(key).startsWith(`${sessionId}:`)).forEach((key) => store.delete(key));
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

function loadRecordingMetas() {
  try {
    const value = JSON.parse(localStorage.getItem(RECORDING_META_KEY) || "[]");
    if (Array.isArray(value)) return value.filter((item) => item?.sessionId);
    if (value?.sessionId) return [value];
  } catch {
    return [];
  }
  return [];
}

function saveRecordingMetas(metas) {
  localStorage.setItem(RECORDING_META_KEY, JSON.stringify(metas.filter((item) => item?.sessionId)));
}

function upsertRecordingMeta(meta) {
  const metas = loadRecordingMetas();
  const index = metas.findIndex((item) => item.sessionId === meta.sessionId);
  const nextMeta = index >= 0 ? { ...metas[index], ...meta } : meta;
  if (index >= 0) {
    metas[index] = nextMeta;
  } else {
    metas.push(nextMeta);
  }
  saveRecordingMetas(metas);
}

function removeRecordingMeta(sessionId) {
  saveRecordingMetas(loadRecordingMetas().filter((item) => item.sessionId !== sessionId));
}

function sortedRecordingMetas() {
  return loadRecordingMetas().sort((a, b) => String(b.startedAt || "").localeCompare(String(a.startedAt || "")));
}

function updateRecordingListButton() {
  const count = loadRecordingMetas().length;
  recordingListButton.textContent = count ? `保存済み録画一覧 (${count})` : "保存済み録画一覧";
}

function makeRecordingFileName(meta) {
  const stamp = String(meta.startedAt || new Date().toISOString()).replace(/[:.]/g, "-");
  return meta.fileName || `live-recording-${stamp}.${meta.extension || recordingExtension(meta.mimeType || "video/webm")}`;
}

function formatRecordingDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "日時不明";
  return date.toLocaleString("ja-JP", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function recordingMetaDetails(meta) {
  const parts = [];
  parts.push(meta.status === "recording" ? "途中保存" : "保存済み");
  if (meta.size) parts.push(formatMegabytes(meta.size));
  if (meta.width && meta.height) parts.push(`${meta.width} x ${meta.height}`);
  if (meta.frameRate) parts.push(`${meta.frameRate} fps`);
  if (meta.mode) parts.push(meta.mode === "direct" ? "カメラ直接" : "配信映像");
  return parts.join(" / ");
}

async function renderRecordingList() {
  updateRecordingListButton();
  if (recordingList.classList.contains("hidden")) return;

  const metas = sortedRecordingMetas();
  recordingList.textContent = "";

  if (!metas.length) {
    const empty = document.createElement("p");
    empty.className = "recording-list-empty";
    empty.textContent = "保存済み録画はありません。";
    recordingList.append(empty);
    return;
  }

  for (const meta of metas) {
    const item = document.createElement("div");
    item.className = "recording-item";

    const info = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = formatRecordingDate(meta.startedAt);
    const details = document.createElement("span");
    details.textContent = recordingMetaDetails(meta);
    info.append(title, details);

    const actions = document.createElement("div");
    actions.className = "recording-item-actions";

    const isActiveRecording = Boolean(mediaRecorder && meta.sessionId === recordingSessionId);

    const loadButton = document.createElement("button");
    loadButton.type = "button";
    loadButton.className = "secondary";
    loadButton.textContent = "読み込み";
    loadButton.disabled = isActiveRecording;
    loadButton.addEventListener("click", () => {
      loadRecording(meta.sessionId).catch((error) => setNotice(error.message));
    });

    const saveButton = document.createElement("button");
    saveButton.type = "button";
    saveButton.className = "secondary";
    saveButton.textContent = "保存/共有";
    saveButton.disabled = isActiveRecording;
    saveButton.addEventListener("click", async () => {
      try {
        const loaded = await loadRecording(meta.sessionId, { showNotice: false });
        if (loaded) await shareRecording();
      } catch (error) {
        setNotice(error.message);
      }
    });

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "danger";
    deleteButton.textContent = "削除";
    deleteButton.disabled = isActiveRecording;
    deleteButton.addEventListener("click", () => {
      deleteRecording(meta.sessionId).catch((error) => setNotice(error.message));
    });

    actions.append(loadButton, saveButton, deleteButton);
    item.append(info, actions);
    recordingList.append(item);
  }
}

function stopMediaStream(stream) {
  if (!stream) return;
  for (const track of stream.getTracks()) {
    track.stop();
  }
}

function stopVideoTracks(stream) {
  if (!stream) return;
  for (const track of stream.getVideoTracks()) {
    track.stop();
  }
}

function cleanupScreenAudioMix({ preserveDisplayAudio = false } = {}) {
  for (const track of screenAudioSourceTracks) {
    if (preserveDisplayAudio && track === screenDisplayAudioTrack) continue;
    track.stop();
  }
  screenAudioSourceTracks = preserveDisplayAudio && screenDisplayAudioTrack ? [screenDisplayAudioTrack] : [];
  if (!preserveDisplayAudio) screenDisplayAudioTrack = undefined;
  if (screenAudioContext) {
    screenAudioContext.close().catch(() => undefined);
    screenAudioContext = undefined;
  }
}

function videoTrack() {
  return mediaStream?.getVideoTracks()[0];
}

function audioTrack() {
  return mediaStream?.getAudioTracks()[0];
}

function activeCodecLabel() {
  if (measuredCodec) return measuredCodec;
  return peerConnection ? "判定中" : codecLabel();
}

function streamHealthLabel(health) {
  if (!health) return "-";
  if (!health.apiReachable) return "確認不可";
  return health.online ? "到達中" : "未到達";
}

function currentLagRisk() {
  const target = selectedBitrate();
  const ratio = target && measuredBitrate ? measuredBitrate / target : 1;
  return Boolean(
    peerConnection &&
    ((target && measuredBitrate && ratio < 0.8) ||
      sendDelayMs > 250 ||
      rttMs > 500 ||
      ["bandwidth", "cpu"].includes(qualityLimitationReason))
  );
}

function lagLabel() {
  if (!peerConnection) return "-";
  const target = selectedBitrate();
  const ratio = target && measuredBitrate ? measuredBitrate / target : 0;
  const ratioText = target && measuredBitrate ? `${Math.round(ratio * 100)}%` : "-";
  const values = `詰まり ${formatMs(sendDelayMs)} / RTT ${formatMs(rttMs)} / ${ratioText}`;
  if (qualityLimitationReason === "bandwidth") return `注意 帯域制限 ${values}`;
  if (qualityLimitationReason === "cpu") return `注意 端末処理 ${values}`;
  if (target && measuredBitrate && ratio < 0.8) return `注意 送信不足 ${values}`;
  if (sendDelayMs > 250) return `注意 ${values}`;
  if (rttMs > 500) return `注意 ${values}`;
  return values;
}

function updateStats() {
  const settings = videoTrack()?.getSettings?.() || {};
  const width = settings.width || preview.videoWidth;
  const height = settings.height || preview.videoHeight;
  const configuredFps = settings.frameRate || selectedFrameRate();

  statServer.textContent = `サーバー: ${streamHealthLabel(streamHealth)}`;
  statServer.classList.toggle("online", Boolean(streamHealth?.online));
  statServer.classList.toggle("warning", Boolean(streamHealth?.apiReachable && !streamHealth?.online));
  statResolution.textContent = width && height ? `解像度: ${width} x ${height}` : "解像度: -";
  statFrameRate.textContent = `FPS: ${measuredFrameRate ? measuredFrameRate.toFixed(1) : configuredFps || "-"}`;
  statBitrate.textContent = `通信量: ${measuredBitrate ? formatMbps(measuredBitrate) : "-"}`;
  statCodec.textContent = `Codec: ${activeCodecLabel()}`;
  statServerBitrate.textContent = `サーバー受信: ${streamHealth?.inboundBitrate ? formatMbps(streamHealth.inboundBitrate) : "-"}`;
  statLag.textContent = `ラグ: ${lagLabel()}`;
  statLag.classList.toggle("warning", currentLagRisk());
  statLag.title = peerConnection ? `固定送信上限: ${formatMbps(selectedBitrate())}` : "";
}

async function fetchStreamHealth() {
  streamHealth = await api("/api/stream-health");
  updateStats();
}

async function postPublisherMetrics() {
  if (!peerConnection || Date.now() - lastMetricsPostAt < 2000) return;
  lastMetricsPostAt = Date.now();
  await api("/api/publisher/metrics", {
    method: "POST",
    body: JSON.stringify({
      targetBitrate: selectedBitrate(),
      measuredBitrate,
      sendDelayMs,
      rttMs,
      qualityLimitationReason,
      adaptiveBitrate: 0,
      autoLimited: false,
      lagRisk: currentLagRisk()
    })
  });
}

async function updateOutboundStats() {
  const sender = peerConnection?.getSenders().find((item) => item.track?.kind === "video");
  if (!sender || !peerConnection?.getStats) {
    measuredBitrate = 0;
    updateStats();
    return;
  }

  const stats = await peerConnection.getStats();
  let codecId = "";
  let nextSample;

  stats.forEach((report) => {
    if (report.type === "outbound-rtp" && report.kind === "video") {
      const bytesSent = report.bytesSent || 0;
      const timestamp = report.timestamp || performance.now();
      const totalPacketSendDelay = report.totalPacketSendDelay || 0;
      const packetsSent = report.packetsSent || 0;
      codecId = report.codecId || "";
      qualityLimitationReason = report.qualityLimitationReason || "";

      if (outboundStatsSample && timestamp > outboundStatsSample.timestamp) {
        measuredBitrate = ((bytesSent - outboundStatsSample.bytesSent) * 8 * 1000) / (timestamp - outboundStatsSample.timestamp);
        const delayDelta = totalPacketSendDelay - outboundStatsSample.totalPacketSendDelay;
        const packetDelta = packetsSent - outboundStatsSample.packetsSent;
        sendDelayMs = packetDelta > 0 && delayDelta >= 0 ? (delayDelta * 1000) / packetDelta : 0;
      }

      nextSample = { bytesSent, timestamp, totalPacketSendDelay, packetsSent };
    }

    if (report.type === "candidate-pair" && report.state === "succeeded" && report.nominated) {
      rttMs = report.currentRoundTripTime ? report.currentRoundTripTime * 1000 : rttMs;
    }
  });

  if (nextSample) outboundStatsSample = nextSample;
  if (codecId) {
    const codecReport = stats.get(codecId);
    const mimeType = codecReport?.mimeType || "";
    measuredCodec = mimeType ? formatCodecName(mimeType) : measuredCodec;
  }

  await postPublisherMetrics().catch(() => undefined);
  updateStats();
}

function startFrameRateMeter() {
  frameSample = { frames: 0, startedAt: performance.now() };

  const tick = (now) => {
    frameSample.frames += 1;
    const elapsed = now - frameSample.startedAt;
    if (elapsed >= 1000) {
      measuredFrameRate = (frameSample.frames * 1000) / elapsed;
      frameSample = { frames: 0, startedAt: now };
      updateStats();
    }

    if (preview.requestVideoFrameCallback && mediaStream) {
      frameCallbackHandle = preview.requestVideoFrameCallback(tick);
    }
  };

  if (preview.requestVideoFrameCallback) {
    frameCallbackHandle = preview.requestVideoFrameCallback(tick);
  }
}

function formatCameraLabel(device, index) {
  return device.label || `Camera ${index + 1}`;
}

async function loadCameraDevices() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  cameraDevices = devices.filter((device) => device.kind === "videoinput");

  cameraSelect.innerHTML = "";
  for (const [index, device] of cameraDevices.entries()) {
    const option = document.createElement("option");
    option.value = device.deviceId;
    option.textContent = formatCameraLabel(device, index);
    cameraSelect.append(option);
  }

  if (selectedDeviceId) {
    cameraSelect.value = selectedDeviceId;
  } else if (cameraDevices.length) {
    selectedDeviceId = cameraDevices[0].deviceId;
    cameraSelect.value = selectedDeviceId;
  }
}

async function loadAudioDevices() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  audioDevices = devices.filter((device) => device.kind === "audioinput");

  audioSelect.innerHTML = "";
  const defaultOption = document.createElement("option");
  defaultOption.value = "";
  defaultOption.textContent = "自動";
  audioSelect.append(defaultOption);

  for (const [index, device] of audioDevices.entries()) {
    const option = document.createElement("option");
    option.value = device.deviceId;
    option.textContent = device.label || `Microphone ${index + 1}`;
    audioSelect.append(option);
  }

  if (selectedAudioDeviceId) {
    audioSelect.value = selectedAudioDeviceId;
  }
}

function buildVideoConstraints() {
  const { width, height } = selectedResolution();
  const frameRate = selectedFrameRate();
  const constraints = {
    width: { min: width, ideal: width, max: width },
    height: { min: height, ideal: height, max: height },
    frameRate: { min: frameRate, ideal: frameRate, max: frameRate }
  };

  if (selectedDeviceId) {
    constraints.deviceId = { exact: selectedDeviceId };
  } else {
    constraints.facingMode = { ideal: preferredFacingMode };
  }

  return constraints;
}

function buildAudioConstraints() {
  if (!micEnabled) return false;
  if (selectedAudioDeviceId) {
    return { deviceId: { exact: selectedAudioDeviceId } };
  }
  return true;
}

function buildRecordingVideoConstraints() {
  const { width, height } = selectedRecordingResolution();
  const frameRate = selectedRecordingFrameRate();
  const constraints = {
    width: { min: width, ideal: width, max: width },
    height: { min: height, ideal: height, max: height },
    frameRate: { min: frameRate, ideal: frameRate, max: frameRate }
  };

  if (selectedDeviceId) {
    constraints.deviceId = { exact: selectedDeviceId };
  } else {
    constraints.facingMode = { ideal: preferredFacingMode };
  }

  return constraints;
}

async function buildScreenAudioTrack() {
  cleanupScreenAudioMix({ preserveDisplayAudio: true });
  const tracks = [];
  if (screenDisplayAudioTrack && screenDisplayAudioTrack.readyState !== "ended") {
    tracks.push(screenDisplayAudioTrack);
    if (!screenAudioSourceTracks.includes(screenDisplayAudioTrack)) {
      screenAudioSourceTracks.push(screenDisplayAudioTrack);
    }
  }

  if (micEnabled) {
    try {
      const audioStream = await navigator.mediaDevices.getUserMedia({ audio: buildAudioConstraints(), video: false });
      const micTrack = audioStream.getAudioTracks()[0];
      if (micTrack) {
        tracks.push(micTrack);
        screenAudioSourceTracks.push(micTrack);
      }
    } catch {
      // Screen capture can continue even when the microphone is unavailable.
    }
  }

  if (!tracks.length) {
    return undefined;
  }

  if (tracks.length === 1) {
    return tracks[0];
  }

  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) {
    return tracks[0];
  }

  screenAudioContext = new AudioContextClass();
  const destination = screenAudioContext.createMediaStreamDestination();
  for (const track of tracks) {
    const sourceStream = new MediaStream([track]);
    const source = screenAudioContext.createMediaStreamSource(sourceStream);
    source.connect(destination);
  }
  return destination.stream.getAudioTracks()[0];
}

async function refreshScreenCaptureAudio() {
  if (!mediaStream || sourceMode !== "screen") return;

  const previousAudioTrack = audioTrack();
  if (previousAudioTrack) mediaStream.removeTrack(previousAudioTrack);
  if (previousAudioTrack && previousAudioTrack !== screenDisplayAudioTrack) previousAudioTrack.stop();

  const nextAudioTrack = await buildScreenAudioTrack();
  if (nextAudioTrack) mediaStream.addTrack(nextAudioTrack);

  applyMuteState();
  await replacePublishedTracks();
  renderStatus(status);
  updateStats();
}

async function setSenderBitrate() {
  if (!peerConnection) return;

  const videoSender = peerConnection.getSenders().find((sender) => sender.track?.kind === "video");
  if (!videoSender) return;

  const parameters = videoSender.getParameters();
  parameters.encodings = parameters.encodings?.length ? parameters.encodings : [{}];
  parameters.degradationPreference = "maintain-resolution";
  parameters.encodings[0].maxBitrate = effectiveBitrate();
  parameters.encodings[0].maxFramerate = selectedFrameRate();
  parameters.encodings[0].scaleResolutionDownBy = 1;
  try {
    await videoSender.setParameters(parameters);
  } catch {
    try {
      delete parameters.degradationPreference;
      await videoSender.setParameters(parameters);
    } catch {
      // Some mobile browsers reject bitrate changes before negotiation completes.
    }
  }
}

function setCodecPreference(pc) {
  const codec = selectedCodec();
  if (codec === "auto" || !window.RTCRtpSender?.getCapabilities) return;

  const transceiver = pc.getTransceivers().find((item) => item.sender.track?.kind === "video");
  if (!transceiver?.setCodecPreferences) return;

  const codecs = RTCRtpSender.getCapabilities("video")?.codecs || [];
  const preferred = codecs.filter((item) => item.mimeType.toLowerCase() === codec.toLowerCase());
  if (!preferred.length) return;

  const rest = codecs.filter((item) => item.mimeType.toLowerCase() !== codec.toLowerCase());
  transceiver.setCodecPreferences([...preferred, ...rest]);
}

async function replacePublishedTracks() {
  if (!peerConnection || !mediaStream) return;

  await Promise.all(
    peerConnection.getTransceivers().map((transceiver) => {
      const kind = transceiver.sender.track?.kind || transceiver.receiver.track?.kind;
      const replacement = mediaStream.getTracks().find((track) => track.kind === kind);
      return transceiver.sender.replaceTrack(replacement || null);
    })
  );
  await setSenderBitrate();
}

function updateZoomControl() {
  const track = videoTrack();
  const capabilities = track?.getCapabilities?.();

  if (!capabilities?.zoom) {
    zoomRange.disabled = true;
    zoomRange.min = "1";
    zoomRange.max = "1";
    zoomRange.step = "0.1";
    zoomRange.value = "1";
    zoomValue.textContent = "非対応";
    return;
  }

  const min = capabilities.zoom.min ?? 1;
  const max = capabilities.zoom.max ?? min;
  const step = capabilities.zoom.step ?? 0.1;
  const nextZoom = Math.min(Math.max(preferredZoom, min), max);

  zoomRange.disabled = false;
  zoomRange.min = String(min);
  zoomRange.max = String(max);
  zoomRange.step = String(step);
  zoomRange.value = String(nextZoom);
  zoomValue.textContent = `${Number(nextZoom).toFixed(1)}x`;
  applyZoom(nextZoom).catch(() => undefined);
}

async function applyZoom(value) {
  const track = videoTrack();
  if (!track?.applyConstraints) return;

  preferredZoom = Number(value);
  zoomValue.textContent = `${preferredZoom.toFixed(1)}x`;
  await track.applyConstraints({ advanced: [{ zoom: preferredZoom }] });
}

function setFocusUnavailable(text = "非対応") {
  focusRange.disabled = true;
  focusRange.value = "0";
  focusRange.title = "";
  focusValue.textContent = text;
  focusDistanceRange = undefined;
  focusControlReady = false;
}

async function updateFocusControl() {
  const track = videoTrack();
  const capabilities = track?.getCapabilities?.();

  if (!capabilities?.focusDistance) {
    setFocusUnavailable();
    return;
  }

  const min = capabilities.focusDistance.min ?? 0;
  const max = capabilities.focusDistance.max ?? min;
  if (max <= min) {
    setFocusUnavailable();
    return;
  }

  focusDistanceRange = { min, max };
  focusControlReady = true;
  focusRange.disabled = false;
  focusRange.min = "0";
  focusRange.max = "1";
  focusRange.step = "0.01";
  focusRange.value = String(preferredFocusRatio);
  focusRange.title = `actual focusDistance: ${min} - ${max}`;

  try {
    await applyFocus(preferredFocusRatio);
  } catch {
    setFocusUnavailable("拒否");
  }
}

async function applyFocus(value) {
  const track = videoTrack();
  if (!track?.applyConstraints || !focusDistanceRange) return;

  preferredFocusRatio = Number(value);
  const focusDistance =
    focusDistanceRange.min + (focusDistanceRange.max - focusDistanceRange.min) * preferredFocusRatio;
  focusValue.textContent = preferredFocusRatio.toFixed(2);

  const capabilities = track.getCapabilities?.() || {};
  const focusModes = Array.isArray(capabilities.focusMode) ? capabilities.focusMode : [];
  const attempts = focusModes.includes("manual")
    ? [{ focusMode: "manual", focusDistance }, { focusDistance }]
    : [{ focusDistance }];

  let lastError;
  for (const constraints of attempts) {
    try {
      await track.applyConstraints({ advanced: [constraints] });
      focusValue.textContent = `${preferredFocusRatio.toFixed(2)}`;
      focusControlReady = true;
      return;
    } catch (error) {
      lastError = error;
    }
  }

  focusControlReady = false;
  throw lastError;
}

function applyMuteState() {
  const track = audioTrack();
  if (track) track.enabled = !audioMuted;
  if (recordingAudioTrack) recordingAudioTrack.enabled = !audioMuted;
  renderStatus(status);
}

function toggleMute() {
  audioMuted = !audioMuted;
  applyMuteState();
}

function applyVideoPauseState() {
  const track = videoTrack();
  if (track) track.enabled = !videoPaused;
  if (recordingVideoTrack) recordingVideoTrack.enabled = !videoPaused;
  preview.classList.toggle("paused", videoPaused);
  renderStatus(status);
}

function toggleVideoPause() {
  videoPaused = !videoPaused;
  applyVideoPauseState();
}

function recordingMimeType() {
  if (!window.MediaRecorder?.isTypeSupported) return "";

  const candidates = [
    "video/mp4;codecs=h264,aac",
    "video/mp4",
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm"
  ];

  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || "";
}

function recordingExtension(mimeType) {
  return mimeType.includes("mp4") ? "mp4" : "webm";
}

function createRecordingSessionId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function updateRecordingStatus() {
  if (!mediaRecorder) return;

  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - recordingStartedAt) / 1000));
  const minutes = String(Math.floor(elapsedSeconds / 60)).padStart(2, "0");
  const seconds = String(elapsedSeconds % 60).padStart(2, "0");
  const { width, height } = selectedRecordingResolution();
  recordingStatus.textContent = `録画中 ${minutes}:${seconds} / ${width} x ${height} / ${selectedRecordingFrameRate()} fps`;
}

function drawRecordingFrame() {
  if (!recordingContext || !recordingCanvas) return;

  if (videoPaused || !preview.videoWidth || !preview.videoHeight) {
    recordingContext.fillStyle = "#000";
    recordingContext.fillRect(0, 0, recordingCanvas.width, recordingCanvas.height);
    return;
  }

  recordingContext.drawImage(preview, 0, 0, recordingCanvas.width, recordingCanvas.height);
}

async function startRecording() {
  if (!mediaStream) return;
  if (!window.MediaRecorder) {
    setNotice("このブラウザは録画に対応していません。");
    return;
  }

  const mimeType = recordingMimeType();
  if (!mimeType) {
    setNotice("このブラウザで使える録画形式が見つかりません。");
    return;
  }

  if (recordingUrl) {
    URL.revokeObjectURL(recordingUrl);
    recordingUrl = "";
  }
  recordedBlob = undefined;
  recordedFileName = "";
  recordedMimeType = "";
  recordingSessionId = createRecordingSessionId();
  const activeSessionId = recordingSessionId;
  recordingChunkIndex = 0;
  recordingChunkWrites = [];
  const startedAt = new Date().toISOString();
  const frameRate = selectedRecordingFrameRate();
  const mode = selectedRecordingMode();
  const { width, height } = selectedRecordingResolution();
  const extension = recordingExtension(mimeType);
  const fileName = makeRecordingFileName({ startedAt, extension, mimeType });

  if (mode === "direct") {
    recordingStream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: buildRecordingVideoConstraints()
    });
    recordingAudioTrack = recordingStream.getAudioTracks()[0];
    recordingVideoTrack = recordingStream.getVideoTracks()[0];
    if (recordingAudioTrack) recordingAudioTrack.enabled = !audioMuted;
    if (recordingVideoTrack) recordingVideoTrack.enabled = !videoPaused;
  } else {
    recordingCanvas = document.createElement("canvas");
    recordingCanvas.width = width;
    recordingCanvas.height = height;
    recordingContext = recordingCanvas.getContext("2d", { alpha: false });

    recordingStream = recordingCanvas.captureStream(frameRate);
    recordingAudioTrack = audioTrack()?.clone();
    if (recordingAudioTrack) {
      recordingAudioTrack.enabled = !audioMuted;
      recordingStream.addTrack(recordingAudioTrack);
    }
  }

  upsertRecordingMeta({
    sessionId: recordingSessionId,
    mimeType,
    startedAt,
    extension,
    fileName,
    mode,
    width,
    height,
    frameRate,
    bitrate: selectedRecordingBitrate(),
    status: "recording"
  });
  renderRecordingList().catch(() => undefined);

  recordedChunks = [];
  mediaRecorder = new MediaRecorder(recordingStream, {
    mimeType,
    videoBitsPerSecond: selectedRecordingBitrate()
  });

  mediaRecorder.addEventListener("dataavailable", (event) => {
    if (!event.data?.size) return;

    const chunk = event.data;
    const index = recordingChunkIndex;
    recordingChunkIndex += 1;
    recordedChunks.push(chunk);
    const write = putRecordingChunk({
      key: `${activeSessionId}:${String(index).padStart(8, "0")}`,
      sessionId: activeSessionId,
      index,
      blob: chunk,
      mimeType
    }).catch(() => undefined);
    recordingChunkWrites.push(write);
  });

  mediaRecorder.addEventListener("stop", async () => {
    const stoppedSessionId = activeSessionId;
    clearInterval(recordingDrawTimer);
    recordingDrawTimer = undefined;
    recordingStream?.getTracks().forEach((track) => track.stop());
    recordingStream = undefined;
    recordingAudioTrack = undefined;
    recordingVideoTrack = undefined;
    recordingCanvas = undefined;
    recordingContext = undefined;

    await Promise.allSettled(recordingChunkWrites);
    const storedChunks = await getRecordingChunks(stoppedSessionId).catch(() => recordedChunks);
    recordedMimeType = mimeType;
    recordedBlob = new Blob(storedChunks.length ? storedChunks : recordedChunks, { type: mimeType });
    loadedRecordingSessionId = stoppedSessionId;
    recordingUrl = URL.createObjectURL(recordedBlob);
    recordedFileName = fileName;
    downloadRecordingLink.href = recordingUrl;
    downloadRecordingLink.download = recordedFileName;
    shareRecordingButton.classList.remove("hidden");
    downloadRecordingLink.classList.remove("hidden");
    recordingStatus.textContent = `録画完了 ${formatMegabytes(recordedBlob.size)}`;
    upsertRecordingMeta({
      sessionId: stoppedSessionId,
      endedAt: new Date().toISOString(),
      size: recordedBlob.size,
      status: "saved"
    });
    recordingSessionId = "";
    recordingChunkWrites = [];
    await renderRecordingList();
    mediaRecorder = undefined;
    renderStatus(status);
  });

  downloadRecordingLink.classList.add("hidden");
  shareRecordingButton.classList.add("hidden");
  recordingStartedAt = Date.now();
  if (mode === "canvas") {
    drawRecordingFrame();
    recordingDrawTimer = setInterval(() => {
      drawRecordingFrame();
      updateRecordingStatus();
    }, Math.max(16, 1000 / frameRate));
  } else {
    recordingDrawTimer = setInterval(updateRecordingStatus, 1000);
  }
  mediaRecorder.start(1000);
  updateRecordingStatus();
  renderStatus(status);
  renderRecordingList().catch(() => undefined);
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== "inactive") {
    mediaRecorder.stop();
  }
}

function toggleRecording() {
  if (mediaRecorder) {
    stopRecording();
  } else {
    startRecording().catch((error) => setNotice(error.message));
  }
}

async function shareRecording() {
  if (!recordedBlob || !recordedFileName) return;

  const file = new File([recordedBlob], recordedFileName, { type: recordedMimeType || recordedBlob.type });
  const shareData = { files: [file] };

  if (navigator.canShare?.(shareData) && navigator.share) {
    await navigator.share(shareData);
    return;
  }

  downloadRecordingLink.click();
}

async function loadRecording(sessionId, options = {}) {
  const meta = loadRecordingMetas().find((item) => item.sessionId === sessionId);
  if (!meta?.sessionId) return;

  const chunks = await getRecordingChunks(meta.sessionId);
  if (!chunks.length) {
    removeRecordingMeta(meta.sessionId);
    await renderRecordingList();
    setNotice("読み込める録画データがありません。");
    return false;
  }

  recordedMimeType = meta.mimeType || chunks[0].type || "video/webm";
  recordedBlob = new Blob(chunks, { type: recordedMimeType });
  recordedFileName = makeRecordingFileName(meta);
  loadedRecordingSessionId = meta.sessionId;

  if (recordingUrl) URL.revokeObjectURL(recordingUrl);
  recordingUrl = URL.createObjectURL(recordedBlob);
  downloadRecordingLink.href = recordingUrl;
  downloadRecordingLink.download = recordedFileName;
  shareRecordingButton.classList.remove("hidden");
  downloadRecordingLink.classList.remove("hidden");
  recordingStatus.textContent = `録画を読み込み ${formatMegabytes(recordedBlob.size)}`;
  upsertRecordingMeta({ sessionId: meta.sessionId, size: recordedBlob.size });
  await renderRecordingList();
  if (options.showNotice !== false) setNotice("録画を読み込みました。端末に保存/共有できます。");
  return true;
}

async function deleteRecording(sessionId) {
  if (mediaRecorder && sessionId === recordingSessionId) {
    setNotice("録画中のデータは停止してから削除できます。");
    return;
  }

  if (!window.confirm("この録画データを削除しますか？")) return;

  await clearRecordingChunks(sessionId);
  removeRecordingMeta(sessionId);

  if (loadedRecordingSessionId === sessionId) {
    if (recordingUrl) URL.revokeObjectURL(recordingUrl);
    recordingUrl = "";
    recordedBlob = undefined;
    recordedFileName = "";
    recordedMimeType = "";
    loadedRecordingSessionId = "";
    shareRecordingButton.classList.add("hidden");
    downloadRecordingLink.classList.add("hidden");
    recordingStatus.textContent = "録画停止中";
  }

  await renderRecordingList();
  setNotice("録画データを削除しました。");
}

async function startCamera() {
  selectInputSource("camera");
  cleanupScreenAudioMix();
  const nextStream = await navigator.mediaDevices.getUserMedia({
    audio: buildAudioConstraints(),
    video: buildVideoConstraints()
  });

  stopMediaStream(mediaStream);
  mediaStream = nextStream;
  sourceMode = "camera";
  selectedDeviceId = videoTrack()?.getSettings?.().deviceId || selectedDeviceId;
  preview.srcObject = mediaStream;
  cameraEmpty.classList.remove("hidden");
  await loadCameraDevices();
  await loadAudioDevices();
  updateZoomControl();
  await updateFocusControl();
  applyMuteState();
  applyVideoPauseState();
  await loadAudioDevices();
  await replacePublishedTracks();
  renderStatus(status);
  updateStats();
  startFrameRateMeter();
  setNotice(peerConnection ? "配信中のカメラ設定を変更しました。" : "カメラを開始しました。");
}

async function startScreenCapture() {
  selectInputSource("capture");
  if (!navigator.mediaDevices?.getDisplayMedia) {
    setNotice("この端末/ブラウザは画面キャプチャに対応していません。");
    return;
  }

  const displayStream = await navigator.mediaDevices.getDisplayMedia({
    video: {
      frameRate: { ideal: selectedFrameRate(), max: selectedFrameRate() }
    },
    audio: true
  });

  const screenVideoTrack = displayStream.getVideoTracks()[0];
  if (!screenVideoTrack) {
    stopMediaStream(displayStream);
    setNotice("画面キャプチャの映像を取得できませんでした。");
    return;
  }

  const nextStream = new MediaStream([screenVideoTrack]);
  cleanupScreenAudioMix();
  screenDisplayAudioTrack = displayStream.getAudioTracks()[0];
  if (screenDisplayAudioTrack) screenAudioSourceTracks.push(screenDisplayAudioTrack);
  const screenAudioTrack = await buildScreenAudioTrack();
  if (screenAudioTrack) nextStream.addTrack(screenAudioTrack);

  stopVideoTracks(mediaStream);
  const previousAudioTrack = audioTrack();
  if (previousAudioTrack && previousAudioTrack !== screenAudioTrack) previousAudioTrack.stop();

  mediaStream = nextStream;
  sourceMode = "screen";
  selectedDeviceId = "";
  preview.srcObject = mediaStream;
  cameraEmpty.classList.remove("hidden");
  setFocusUnavailable("画面");
  zoomRange.disabled = true;
  zoomValue.textContent = "画面";
  screenVideoTrack.addEventListener("ended", () => {
    cleanupScreenAudioMix();
    setNotice("画面キャプチャが終了しました。");
    if (!peerConnection) {
      stopMediaStream(mediaStream);
      mediaStream = undefined;
      preview.srcObject = null;
      cameraEmpty.classList.remove("hidden");
      renderStatus(status);
    }
  });
  applyMuteState();
  applyVideoPauseState();
  await replacePublishedTracks();
  renderStatus(status);
  updateStats();
  startFrameRateMeter();
  setNotice(peerConnection ? "配信中の映像を画面キャプチャに変更しました。" : "画面キャプチャを開始しました。");
}

async function startPublishing() {
  if (!mediaStream || !status?.whipUrl) return;

  peerConnection = new RTCPeerConnection();
  outboundStatsSample = undefined;
  measuredBitrate = 0;
  measuredCodec = "";
  sendDelayMs = 0;
  rttMs = 0;
  qualityLimitationReason = "";
  for (const track of mediaStream.getTracks()) {
    peerConnection.addTrack(track, mediaStream);
  }
  if (!mediaStream.getAudioTracks().length) {
    peerConnection.addTransceiver("audio", { direction: "sendonly" });
  }
  setCodecPreference(peerConnection);
  await setSenderBitrate();

  const offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);
  await waitForIceGatheringComplete(peerConnection);

  const response = await fetch(status.whipUrl, {
    method: "POST",
    headers: { "content-type": "application/sdp" },
    body: peerConnection.localDescription.sdp
  });

  if (!response.ok) {
    const body = await response.text();
    peerConnection.close();
    peerConnection = undefined;
    throw new Error(body || "Publish failed");
  }

  sessionUrl = response.headers.get("location");
  const answer = await response.text();
  await peerConnection.setRemoteDescription({ type: "answer", sdp: answer });
  await setSenderBitrate();
  updateStats();

  stopButton.disabled = false;
  publishButton.disabled = true;
  setNotice("配信中です。");
}

async function stopPublishing() {
  if (sessionUrl) {
    fetch(sessionUrl, { method: "DELETE" }).catch(() => undefined);
    sessionUrl = undefined;
  }

  if (peerConnection) {
    peerConnection.close();
    peerConnection = undefined;
  }
  outboundStatsSample = undefined;
  measuredBitrate = 0;
  measuredCodec = "";
  sendDelayMs = 0;
  rttMs = 0;
  qualityLimitationReason = "";

  stopButton.disabled = true;
  renderStatus(status);
  setNotice("配信を停止しました。");
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

logoutButton.addEventListener("click", async () => {
  await stopPublishing();
  await api("/api/admin/logout", { method: "POST" }).catch(() => undefined);
  showLoggedIn(false);
});

sourceCameraChoice.addEventListener("click", () => selectInputSource("camera"));
sourceCaptureChoice.addEventListener("click", () => selectInputSource("capture"));

cameraButton.addEventListener("click", () => {
  startCamera().catch((error) => setNotice(error.message));
});

screenButton.addEventListener("click", () => {
  startScreenCapture().catch((error) => setNotice(error.message));
});

muteButton.addEventListener("click", toggleMute);
pauseVideoButton.addEventListener("click", toggleVideoPause);
recordButton.addEventListener("click", toggleRecording);
shareRecordingButton.addEventListener("click", () => {
  shareRecording().catch((error) => setNotice(error.message));
});
recordingListButton.addEventListener("click", () => {
  recordingList.classList.toggle("hidden");
  renderRecordingList().catch((error) => setNotice(error.message));
});

cameraSelect.addEventListener("change", () => {
  selectedDeviceId = cameraSelect.value;
  if (mediaStream && sourceMode === "camera") startCamera().catch((error) => setNotice(error.message));
});

audioSelect.addEventListener("change", () => {
  selectedAudioDeviceId = audioSelect.value;
  if (mediaStream && sourceMode === "camera") {
    startCamera().catch((error) => setNotice(error.message));
  } else if (mediaStream && sourceMode === "screen") {
    refreshScreenCaptureAudio()
      .then(() => setNotice("画面キャプチャのマイクを変更しました。"))
      .catch((error) => setNotice(error.message));
  }
});

micEnabledCheckbox.addEventListener("change", () => {
  micEnabled = micEnabledCheckbox.checked;
  audioMuted = false;
  if (mediaStream && sourceMode === "camera") {
    startCamera().catch((error) => setNotice(error.message));
  } else if (mediaStream && sourceMode === "screen") {
    refreshScreenCaptureAudio()
      .then(() => setNotice(micEnabled ? "画面キャプチャにマイク音声をミックスしました。" : "画面キャプチャのマイク音声を外しました。"))
      .catch((error) => setNotice(error.message));
  } else {
    renderStatus(status);
  }
});

resolutionSelect.addEventListener("change", () => {
  updateStats();
  if (mediaStream && sourceMode === "camera") {
    startCamera().catch((error) => setNotice(error.message));
  } else if (mediaStream) {
    setNotice("画面キャプチャ中の解像度はブラウザ側の選択に従います。");
  }
});

frameRateSelect.addEventListener("change", () => {
  updateStats();
  if (mediaStream && sourceMode === "camera") {
    startCamera().catch((error) => setNotice(error.message));
  } else if (mediaStream) {
    setNotice("画面キャプチャ中のFPS変更は次回の画面キャプチャ開始時に反映されます。");
  }
});

bitrateSelect.addEventListener("change", () => {
  updateStats();
  setSenderBitrate().catch((error) => setNotice(error.message));
});

codecSelect.addEventListener("change", () => {
  updateStats();
  if (peerConnection) setNotice("圧縮方式は次回の配信開始から反映されます。");
});

zoomRange.addEventListener("input", () => {
  applyZoom(zoomRange.value).catch((error) => setNotice(error.message));
});

focusRange.addEventListener("input", () => {
  if (!focusControlReady) return;
  applyFocus(focusRange.value).catch((error) => setNotice(error.message));
});

publishButton.addEventListener("click", () => {
  startPublishing().catch((error) => setNotice(error.message));
});

stopButton.addEventListener("click", stopPublishing);

refresh();
updateStats();
fetchStreamHealth().catch(() => undefined);
loadAudioDevices().catch(() => undefined);
renderRecordingList().catch(() => undefined);
setInterval(refresh, 5000);
setInterval(updateStats, 2000);
setInterval(() => fetchStreamHealth().catch(() => undefined), 2000);
setInterval(() => updateOutboundStats().catch(() => undefined), 1000);
