import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");
const dataDir = path.join(__dirname, "data");
const stateFile = path.join(dataDir, "state.json");
const audienceFile = path.join(dataDir, "audience.json");

const port = Number(process.env.PORT || 7031);
const adminToken = process.env.ADMIN_TOKEN || "change-this-admin-token";
const publishToken = process.env.PUBLISH_TOKEN || "";
const streamName = process.env.STREAM_NAME || "live";
const rtmpIngestName = process.env.RTMP_INGEST_NAME || "live/rtmp";
const mediaBaseUrl = (process.env.MEDIA_BASE_URL || "http://127.0.0.1:8889").replace(/\/$/, "");
const mediaApiBaseUrl = (process.env.MEDIA_API_BASE_URL || "http://127.0.0.1:9997").replace(/\/$/, "");
const publicScheme = process.env.PUBLIC_SCHEME || "http";
const publicHost = process.env.PUBLIC_HOST || `localhost:${port}`;

const sessions = new Map();
const activeViewers = new Map();
const viewerTimeoutMs = 20000;
const maxViewerHistory = 500;
const maxComments = 500;
const maxArchivedLives = 100;
let streamHealthSample;
let publisherMetrics = {};
let state = loadState();
let audience = loadAudience();

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(stateFile, "utf8"));
  } catch {
    return {
      liveEnabled: false,
      title: "Live",
      message: "",
      viewerPassword: "",
      updatedAt: new Date().toISOString()
    };
  }
}

function saveState() {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
}

function loadAudience() {
  try {
    const data = JSON.parse(fs.readFileSync(audienceFile, "utf8"));
    const current = data.current || data;
    return {
      current: {
        history: Array.isArray(current.history) ? current.history.slice(0, maxViewerHistory) : [],
        comments: Array.isArray(current.comments) ? current.comments.slice(-maxComments) : []
      },
      lives: Array.isArray(data.lives) ? data.lives.slice(0, maxArchivedLives) : []
    };
  } catch {
    return { current: { history: [], comments: [] }, lives: [] };
  }
}

function saveAudience() {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(audienceFile, JSON.stringify(audience, null, 2));
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(body)
  });
  res.end(body);
}

function sendText(res, status, text) {
  res.writeHead(status, {
    "content-type": "text/plain; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(text);
}

function parseCookies(req) {
  const cookies = {};
  for (const part of (req.headers.cookie || "").split(";")) {
    const [rawKey, ...rawValue] = part.trim().split("=");
    if (!rawKey) continue;
    cookies[rawKey] = decodeURIComponent(rawValue.join("="));
  }
  return cookies;
}

function bearerToken(req) {
  const authorization = req.headers.authorization || "";
  return authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
}

function isAdmin(req) {
  return parseCookies(req).adminToken === adminToken || bearerToken(req) === adminToken;
}

function isPublishAllowed(req, url) {
  if (!publishToken) return true;
  return url.searchParams.get("token") === publishToken || bearerToken(req) === publishToken;
}

function readBody(req, maxBytes = 2 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error("Request body is too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function readJson(req, maxBytes) {
  const body = await readBody(req, maxBytes);
  if (!body.length) return {};
  return JSON.parse(body.toString("utf8"));
}

function getPublicBase() {
  return `${publicScheme}://${publicHost}`;
}

function getRtmpPublicInfo() {
  const host = publicHost.replace(/:\d+$/, "");
  const parts = rtmpIngestName.split("/").filter(Boolean);
  const streamKey = parts.pop() || rtmpIngestName;
  const appPath = parts.join("/");
  const base = appPath ? `rtmp://${host}/${appPath}` : `rtmp://${host}`;

  return {
    rtmpServer: base,
    rtmpStreamKey: streamKey,
    rtmpUrl: `${base}/${streamKey}`
  };
}

function formatTrack(track) {
  if (typeof track === "string") return { codec: track };
  const props = track?.codecProps || {};
  return {
    codec: track?.codec || "",
    width: props.width || 0,
    height: props.height || 0
  };
}

function numberMetric(value, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(min, Math.min(max, number));
}

function cleanMetricText(value, maxLength = 80) {
  return String(value || "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function publicPublisherMetrics() {
  if (!publisherMetrics.updatedAt) return {};
  const ageMs = Date.now() - new Date(publisherMetrics.updatedAt).getTime();
  if (!Number.isFinite(ageMs) || ageMs > 15000) return { stale: true };
  return { ...publisherMetrics, stale: false };
}

function streamHealthFromPath(pathInfo, apiReachable = true, error = "") {
  const tracks = Array.isArray(pathInfo?.tracks2)
    ? pathInfo.tracks2.map(formatTrack)
    : Array.isArray(pathInfo?.tracks)
      ? pathInfo.tracks.map(formatTrack)
      : [];
  const videoTrack = tracks.find((track) => /^(AV1|VP9|VP8|H265|H264|MPEG|M-JPEG)/i.test(track.codec));
  const audioTrack = tracks.find((track) => track !== videoTrack);
  const online = Boolean(pathInfo?.online ?? pathInfo?.available ?? pathInfo?.ready);
  const inboundBytes = Number(pathInfo?.inboundBytes ?? pathInfo?.bytesReceived ?? 0);
  const timestamp = Date.now();
  let inboundBitrate = 0;

  if (streamHealthSample && timestamp > streamHealthSample.timestamp && inboundBytes >= streamHealthSample.inboundBytes) {
    inboundBitrate = ((inboundBytes - streamHealthSample.inboundBytes) * 8 * 1000) / (timestamp - streamHealthSample.timestamp);
  }
  streamHealthSample = { inboundBytes, timestamp };

  return {
    apiReachable,
    online,
    status: !apiReachable ? "api_unreachable" : online ? "online" : "waiting",
    streamName,
    sourceType: pathInfo?.source?.type || "",
    readers: Array.isArray(pathInfo?.readers) ? pathInfo.readers.length : 0,
    inboundBytes,
    inboundBitrate,
    videoCodec: videoTrack?.codec || "",
    audioCodec: audioTrack?.codec || "",
    width: videoTrack?.width || 0,
    height: videoTrack?.height || 0,
    tracks,
    publisher: publicPublisherMetrics(),
    onlineAt: pathInfo?.onlineTime || pathInfo?.availableTime || pathInfo?.readyTime || "",
    updatedAt: new Date().toISOString(),
    error
  };
}

async function getStreamHealth() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1500);
  try {
    const response = await fetch(`${mediaApiBaseUrl}/v3/paths/get/${encodeURIComponent(streamName)}`, {
      cache: "no-store",
      signal: controller.signal
    });
    if (response.status === 404) return streamHealthFromPath({}, true);
    if (!response.ok) return streamHealthFromPath({}, false, `Media API returned ${response.status}`);
    return streamHealthFromPath(await response.json(), true);
  } catch (error) {
    return streamHealthFromPath({}, false, error.message);
  } finally {
    clearTimeout(timeout);
  }
}

function sanitizeText(value, maxLength) {
  return String(value || "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function sanitizePassword(value) {
  return String(value || "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, 80);
}

function timingSafeEqualText(left, right) {
  const leftBuffer = Buffer.from(String(left || ""));
  const rightBuffer = Buffer.from(String(right || ""));
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function viewerFromUrl(url) {
  const viewer = activeViewers.get(url.searchParams.get("viewerId") || "");
  if (!viewer || viewer.token !== url.searchParams.get("viewerToken")) return undefined;
  return viewer;
}

function viewerFromBody(body) {
  const viewer = activeViewers.get(String(body.viewerId || ""));
  if (!viewer || viewer.token !== String(body.viewerToken || "")) return undefined;
  return viewer;
}

function archiveViewer(viewer, leftAt = new Date().toISOString(), reason = "left") {
  if (!viewer) return;
  activeViewers.delete(viewer.id);

  const joinedAt = new Date(viewer.joinedAt).getTime();
  const endedAt = new Date(leftAt).getTime();
  const durationSeconds = Number.isFinite(joinedAt) && Number.isFinite(endedAt)
    ? Math.max(0, Math.round((endedAt - joinedAt) / 1000))
    : 0;

  audience.current.history.unshift({
    id: viewer.id,
    name: viewer.name,
    joinedAt: viewer.joinedAt,
    leftAt,
    durationSeconds,
    reason
  });
  audience.current.history = audience.current.history.slice(0, maxViewerHistory);
  saveAudience();
}

function sweepInactiveViewers() {
  const now = Date.now();
  for (const viewer of activeViewers.values()) {
    const lastSeenAt = new Date(viewer.lastSeenAt).getTime();
    if (Number.isFinite(lastSeenAt) && now - lastSeenAt > viewerTimeoutMs) {
      archiveViewer(viewer, new Date(lastSeenAt + viewerTimeoutMs).toISOString(), "timeout");
    }
  }
}

function audienceStatus() {
  sweepInactiveViewers();
  const currentViewers = [...activeViewers.values()]
    .sort((a, b) => String(a.joinedAt).localeCompare(String(b.joinedAt)))
    .map((viewer) => ({
      id: viewer.id,
      name: viewer.name,
      joinedAt: viewer.joinedAt,
      lastSeenAt: viewer.lastSeenAt
    }));

  return {
    currentViewers,
    pastViewers: audience.current.history.slice(0, 100),
    comments: audience.current.comments.slice(-120)
  };
}

function archiveCurrentLive() {
  const endedAt = new Date().toISOString();
  for (const viewer of [...activeViewers.values()]) {
    archiveViewer(viewer, endedAt, "stopped");
  }
  activeViewers.clear();

  const hasAudience =
    audience.current.comments.length > 0 ||
    audience.current.history.length > 0 ||
    state.liveStartedAt ||
    state.liveEnabled;

  if (hasAudience) {
    audience.lives.unshift({
      id: state.liveId || crypto.randomUUID(),
      title: state.title || "Live",
      message: state.message || "",
      startedAt: state.liveStartedAt || state.updatedAt || endedAt,
      endedAt,
      viewers: audience.current.history,
      comments: audience.current.comments
    });
    audience.lives = audience.lives.slice(0, maxArchivedLives);
  }

  audience.current = { history: [], comments: [] };
  saveAudience();
}

function liveSummary(live) {
  return {
    id: live.id,
    title: live.title || "Live",
    startedAt: live.startedAt,
    endedAt: live.endedAt,
    viewerCount: Array.isArray(live.viewers) ? live.viewers.length : 0,
    commentCount: Array.isArray(live.comments) ? live.comments.length : 0
  };
}

function publicStatus(includePrivate = false) {
  const whipUrl = new URL("/whip", getPublicBase());
  if (publishToken) whipUrl.searchParams.set("token", publishToken);

  const status = {
    liveEnabled: state.liveEnabled,
    title: state.liveEnabled ? state.title : "配信準備中",
    message: state.liveEnabled ? state.message : "",
    updatedAt: state.updatedAt,
    whepUrl: "/whep"
  };

  if (!includePrivate) return status;

  return {
    ...status,
    title: state.title,
    message: state.message,
    viewerPassword: state.viewerPassword || "",
    whipUrl: whipUrl.toString(),
    ...getRtmpPublicInfo(),
    publisherUrl: `${getPublicBase()}/publish.html`
  };
}

async function proxyMedia(req, res, upstreamUrl, kind) {
  const body = ["GET", "HEAD"].includes(req.method || "") ? undefined : await readBody(req);
  const headers = {};

  for (const name of ["authorization", "content-type", "if-match", "link"]) {
    if (req.headers[name]) headers[name] = req.headers[name];
  }

  let upstreamResponse;
  try {
    upstreamResponse = await fetch(upstreamUrl, {
      method: req.method,
      headers,
      body
    });
  } catch (error) {
    sendJson(res, 502, { error: "Media server is not reachable", detail: error.message });
    return;
  }

  const responseHeaders = {};
  upstreamResponse.headers.forEach((value, key) => {
    if (!["connection", "content-length", "location", "transfer-encoding"].includes(key.toLowerCase())) {
      responseHeaders[key] = value;
    }
  });

  const location = upstreamResponse.headers.get("location");
  if (location) {
    const upstreamSessionUrl = new URL(location, upstreamUrl).toString();
    const sessionId = crypto.randomUUID();
    sessions.set(sessionId, { kind, upstreamUrl: upstreamSessionUrl, createdAt: Date.now() });
    responseHeaders.location = `/session/${sessionId}`;
  }

  const responseBody = Buffer.from(await upstreamResponse.arrayBuffer());
  res.writeHead(upstreamResponse.status, responseHeaders);
  res.end(responseBody);
}

async function stopWhipSessions() {
  const deletions = [];
  for (const [id, session] of sessions) {
    if (session.kind !== "whip") continue;
    deletions.push(fetch(session.upstreamUrl, { method: "DELETE" }).catch(() => undefined));
    sessions.delete(id);
  }
  await Promise.allSettled(deletions);
}

function serveStatic(req, res, pathname) {
  const normalizedPath = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.normalize(path.join(publicDir, normalizedPath));

  if (!filePath.startsWith(publicDir)) {
    sendText(res, 403, "Forbidden");
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      sendText(res, 404, "Not found");
      return;
    }

    const ext = path.extname(filePath);
    const contentType = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "application/javascript; charset=utf-8"
    }[ext] || "application/octet-stream";

    res.writeHead(200, {
      "content-type": contentType,
      "cache-control": "no-store"
    });
    res.end(content);
  });
}

async function handleApi(req, res, pathname) {
  if (req.method === "GET" && pathname === "/api/status") {
    sendJson(res, 200, publicStatus(false));
    return;
  }

  if (req.method === "GET" && pathname === "/api/stream-health") {
    sendJson(res, 200, await getStreamHealth());
    return;
  }

  if (req.method === "GET" && pathname === "/api/audience") {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const viewer = viewerFromUrl(url);
    if (!viewer) {
      sendJson(res, 401, { error: "Viewer login required" });
      return;
    }
    viewer.lastSeenAt = new Date().toISOString();
    sendJson(res, 200, audienceStatus());
    return;
  }

  if (req.method === "POST" && pathname === "/api/viewer/join") {
    const body = await readJson(req, 64 * 1024);
    const name = sanitizeText(body.name, 40);
    const password = sanitizePassword(body.password);
    const viewerPassword = sanitizePassword(state.viewerPassword);
    if (!state.liveEnabled) {
      sendJson(res, 409, { error: "Live is not available" });
      return;
    }
    if (!name) {
      sendJson(res, 400, { error: "Name is required" });
      return;
    }
    if (!viewerPassword || !timingSafeEqualText(password, viewerPassword)) {
      sendJson(res, 401, { error: "Invalid viewer password" });
      return;
    }

    const now = new Date().toISOString();
    const viewer = {
      id: crypto.randomUUID(),
      token: crypto.randomBytes(24).toString("hex"),
      name,
      joinedAt: now,
      lastSeenAt: now
    };
    activeViewers.set(viewer.id, viewer);
    sendJson(res, 200, {
      viewerId: viewer.id,
      viewerToken: viewer.token,
      whepUrl: `/whep?viewerId=${encodeURIComponent(viewer.id)}&viewerToken=${encodeURIComponent(viewer.token)}`,
      ...audienceStatus()
    });
    return;
  }

  if (req.method === "POST" && pathname === "/api/viewer/heartbeat") {
    const body = await readJson(req, 64 * 1024);
    const viewer = viewerFromBody(body);
    if (!viewer) {
      sendJson(res, 401, { error: "Viewer login required" });
      return;
    }
    viewer.lastSeenAt = new Date().toISOString();
    sendJson(res, 200, audienceStatus());
    return;
  }

  if (req.method === "POST" && pathname === "/api/viewer/leave") {
    const body = await readJson(req, 64 * 1024);
    const viewer = viewerFromBody(body);
    if (viewer) archiveViewer(viewer);
    sendJson(res, 200, audienceStatus());
    return;
  }

  if (req.method === "POST" && pathname === "/api/comments") {
    const body = await readJson(req, 64 * 1024);
    const viewer = viewerFromBody(body);
    const name = sanitizeText(viewer?.name, 40);
    const text = sanitizeText(body.text, 500);
    if (!viewer || !name || !text) {
      sendJson(res, 400, { error: "Name and comment are required" });
      return;
    }

    if (viewer) viewer.lastSeenAt = new Date().toISOString();
    audience.current.comments.push({
      id: crypto.randomUUID(),
      viewerId: viewer?.id || "",
      name,
      text,
      createdAt: new Date().toISOString()
    });
    audience.current.comments = audience.current.comments.slice(-maxComments);
    saveAudience();
    sendJson(res, 200, audienceStatus());
    return;
  }

  if (req.method === "POST" && pathname === "/api/admin/login") {
    const body = await readJson(req);
    if (body.token !== adminToken) {
      sendJson(res, 401, { error: "Invalid admin token" });
      return;
    }

    res.writeHead(204, {
      "set-cookie": `adminToken=${encodeURIComponent(adminToken)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000`,
      "cache-control": "no-store"
    });
    res.end();
    return;
  }

  if (!isAdmin(req)) {
    sendJson(res, 401, { error: "Admin login required" });
    return;
  }

  if (req.method === "GET" && pathname === "/api/admin/status") {
    sendJson(res, 200, {
      ...publicStatus(true),
      streamHealth: await getStreamHealth(),
      streamName,
      activeSessions: sessions.size,
      archivedLives: audience.lives.map(liveSummary)
    });
    return;
  }

  if (req.method === "POST" && pathname === "/api/publisher/metrics") {
    const body = await readJson(req, 64 * 1024);
    const targetBitrate = numberMetric(body.targetBitrate, 0, 50000000);
    const measuredBitrate = numberMetric(body.measuredBitrate, 0, 50000000);
    const sendDelayMs = numberMetric(body.sendDelayMs, 0, 10000);
    const rttMs = numberMetric(body.rttMs, 0, 10000);
    const bitrateRatio = targetBitrate ? measuredBitrate / targetBitrate : 0;
    const qualityLimitationReason = cleanMetricText(body.qualityLimitationReason, 40);
    const lagRisk = Boolean(
      body.lagRisk ||
      (targetBitrate && measuredBitrate && bitrateRatio < 0.8) ||
      sendDelayMs > 250 ||
      rttMs > 500 ||
      ["bandwidth", "cpu"].includes(qualityLimitationReason)
    );

    publisherMetrics = {
      targetBitrate,
      measuredBitrate,
      bitrateRatio,
      sendDelayMs,
      rttMs,
      qualityLimitationReason,
      adaptiveBitrate: numberMetric(body.adaptiveBitrate, 0, 50000000),
      autoLimited: Boolean(body.autoLimited),
      lagRisk,
      updatedAt: new Date().toISOString()
    };
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "GET" && pathname === "/api/admin/lives") {
    sendJson(res, 200, { lives: audience.lives.map(liveSummary) });
    return;
  }

  if (req.method === "GET" && pathname.startsWith("/api/admin/lives/")) {
    const liveId = decodeURIComponent(pathname.split("/").pop() || "");
    const live = audience.lives.find((item) => item.id === liveId);
    if (!live) {
      sendJson(res, 404, { error: "Live not found" });
      return;
    }
    sendJson(res, 200, {
      id: live.id,
      title: live.title || "Live",
      message: live.message || "",
      startedAt: live.startedAt,
      endedAt: live.endedAt,
      viewers: Array.isArray(live.viewers) ? live.viewers : [],
      comments: Array.isArray(live.comments) ? live.comments : []
    });
    return;
  }

  if (req.method === "POST" && pathname === "/api/admin/start") {
    const body = await readJson(req);
    const wasLive = Boolean(state.liveEnabled);
    const viewerPassword = sanitizePassword(body.viewerPassword);
    if (!viewerPassword) {
      sendJson(res, 400, { error: "Viewer password is required" });
      return;
    }
    state = {
      ...state,
      liveEnabled: true,
      title: String(body.title || state.title || "Live").slice(0, 80),
      message: String(body.message || "").slice(0, 240),
      viewerPassword,
      liveId: wasLive ? state.liveId : crypto.randomUUID(),
      liveStartedAt: wasLive ? state.liveStartedAt : new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    saveState();
    sendJson(res, 200, publicStatus(true));
    return;
  }

  if (req.method === "POST" && pathname === "/api/admin/stop") {
    await stopWhipSessions();
    archiveCurrentLive();
    state = {
      ...state,
      liveEnabled: false,
      liveId: "",
      liveStartedAt: "",
      updatedAt: new Date().toISOString()
    };
    saveState();
    sendJson(res, 200, publicStatus(true));
    return;
  }

  if (req.method === "POST" && pathname === "/api/admin/logout") {
    res.writeHead(204, {
      "set-cookie": "adminToken=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0",
      "cache-control": "no-store"
    });
    res.end();
    return;
  }

  sendJson(res, 404, { error: "Not found" });
}

async function handleRequest(req, res) {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const pathname = url.pathname;

  try {
    if (pathname.startsWith("/api/")) {
      await handleApi(req, res, pathname);
      return;
    }

    if (pathname === "/whip") {
      if (!state.liveEnabled) {
        sendJson(res, 409, { error: "Live is stopped by admin" });
        return;
      }
      if (!isPublishAllowed(req, url)) {
        sendJson(res, 401, { error: "Invalid publish token" });
        return;
      }
      await proxyMedia(req, res, `${mediaBaseUrl}/${encodeURIComponent(streamName)}/whip`, "whip");
      return;
    }

    if (pathname === "/whep") {
      if (!state.liveEnabled) {
        sendJson(res, 409, { error: "Live is not available" });
        return;
      }
      const viewer = viewerFromUrl(url);
      if (!viewer || viewer.token !== url.searchParams.get("viewerToken")) {
        sendJson(res, 401, { error: "Viewer login required" });
        return;
      }
      viewer.lastSeenAt = new Date().toISOString();
      await proxyMedia(req, res, `${mediaBaseUrl}/${encodeURIComponent(streamName)}/whep`, "whep");
      return;
    }

    if (pathname.startsWith("/session/")) {
      const sessionId = pathname.split("/")[2];
      const session = sessions.get(sessionId);
      if (!session) {
        sendJson(res, 404, { error: "Session not found" });
        return;
      }

      if (!state.liveEnabled && session.kind !== "whip") {
        sendJson(res, 409, { error: "Live is not available" });
        return;
      }

      await proxyMedia(req, res, session.upstreamUrl, session.kind);
      if (req.method === "DELETE") sessions.delete(sessionId);
      return;
    }

    serveStatic(req, res, pathname);
  } catch (error) {
    sendJson(res, 500, { error: "Server error", detail: error.message });
  }
}

http.createServer(handleRequest).listen(port, "0.0.0.0", () => {
  console.log(`Larix WebRTC live control is listening on ${port}`);
});
