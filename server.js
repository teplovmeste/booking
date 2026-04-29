import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  ADMIN_BASIC_AUTH_PASS,
  ADMIN_BASIC_AUTH_USER,
  APP_PORT,
  AUTO_SEED_DEMO_DATA,
  BASE_PATH,
  DATABASE_URL
} from "./src/config.js";
import { createRepository } from "./src/db.js";
import { sendBookingNotifications } from "./src/email.js";
import { getStaticFile, isStaticMethod, ROOT_STATIC_ASSETS, stripBasePath } from "./src/http-routing.js";
import { createBookingModule } from "./src/module.js";
import { AppError, handleRouteError, notFound, readFormBody, readJsonBody, sendJson } from "./src/utils.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = __dirname;
const ADMIN_SESSION_COOKIE = "teplovmeste_admin_session";
const ADMIN_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const shouldSeedDemoData = AUTO_SEED_DEMO_DATA === null ? !DATABASE_URL : AUTO_SEED_DEMO_DATA;
const repository = await createRepository({
  seedDemoData: shouldSeedDemoData
});

const moduleApi = createBookingModule({
  repository,
  sendBookingNotifications
});

async function routeRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const directStaticFile = isStaticMethod(req.method) && ROOT_STATIC_ASSETS.has(url.pathname)
    ? getStaticFile(url.pathname)
    : null;

  if (directStaticFile) {
    serveStaticFile(req, res, directStaticFile);
    return;
  }

  const pathname = stripBasePath(url.pathname, BASE_PATH);

  if (pathname === null) {
    notFound(res);
    return;
  }

  if (req.method === "GET" && pathname === "/admin/login") {
    if (isAdminSessionValid(req)) {
      redirect(res, toAppPath("/admin"));
      return;
    }
  }

  if (req.method === "POST" && pathname === "/admin/login") {
    const payload = await readFormBody(req);

    if (payload.username === ADMIN_BASIC_AUTH_USER && payload.password === ADMIN_BASIC_AUTH_PASS) {
      writeAdminSessionCookie(req, res, payload.username);
      redirect(res, toAppPath("/admin"));
      return;
    }

    redirect(res, `${toAppPath("/admin/login")}?error=1`);
    return;
  }

  if (req.method === "GET" && pathname === "/admin/logout") {
    clearAdminSessionCookie(req, res);
    redirect(res, `${toAppPath("/admin/login")}?logged_out=1`);
    return;
  }

  if (isProtectedAdminPath(pathname) && !enforceAdminAuth(req, res, pathname)) {
    return;
  }

  if (isStaticMethod(req.method)) {
    const staticFile = getStaticFile(pathname);
    if (staticFile) {
      serveStaticFile(req, res, staticFile);
      return;
    }
  }

  if (req.method === "GET" && pathname === "/api/public/meta") {
    sendJson(res, 200, { ok: true, data: await moduleApi.getPublicMeta() });
    return;
  }

  if (req.method === "GET" && pathname === "/api/public/availability") {
    const ageCategory = url.searchParams.get("age_category");
    sendJson(res, 200, { ok: true, data: await moduleApi.listPublicAvailability(ageCategory) });
    return;
  }

  if (req.method === "POST" && pathname === "/api/public/bookings") {
    const payload = await readJsonBody(req);
    const result = await moduleApi.createBooking(payload);
    sendJson(res, result.notification.ok ? 201 : 202, {
      ok: true,
      data: result
    });
    return;
  }

  if (req.method === "GET" && pathname === "/api/admin/meta") {
    sendJson(res, 200, { ok: true, data: await moduleApi.getAdminMeta() });
    return;
  }

  if (req.method === "GET" && pathname === "/api/admin/psychologists") {
    sendJson(res, 200, { ok: true, data: await moduleApi.listPsychologists() });
    return;
  }

  if (req.method === "POST" && pathname === "/api/admin/psychologists") {
    const payload = await readJsonBody(req);
    sendJson(res, 201, { ok: true, data: await moduleApi.createPsychologist(payload) });
    return;
  }

  if (req.method === "PATCH" && /^\/api\/admin\/psychologists\/\d+$/.test(pathname)) {
    const psychologistId = Number(pathname.split("/").pop());
    const payload = await readJsonBody(req);
    sendJson(res, 200, { ok: true, data: await moduleApi.updatePsychologist(psychologistId, payload) });
    return;
  }

  if (req.method === "GET" && pathname === "/api/admin/bookings") {
    sendJson(res, 200, {
      ok: true,
      data: await moduleApi.listAdminBookings({
        date: url.searchParams.get("date"),
        psychologist_id: url.searchParams.get("psychologist_id"),
        status: url.searchParams.get("status")
      })
    });
    return;
  }

  if (req.method === "GET" && pathname === "/api/admin/slots") {
    sendJson(res, 200, {
      ok: true,
      data: await moduleApi.listAdminSlots({
        date: url.searchParams.get("date"),
        psychologist_id: url.searchParams.get("psychologist_id"),
        status: url.searchParams.get("status")
      })
    });
    return;
  }

  if (req.method === "POST" && pathname === "/api/admin/slots") {
    const payload = await readJsonBody(req);
    sendJson(res, 201, { ok: true, data: await moduleApi.createSlot(payload) });
    return;
  }

  if (req.method === "DELETE" && /^\/api\/admin\/slots\/\d+$/.test(pathname)) {
    const slotId = Number(pathname.split("/").pop());
    sendJson(res, 200, { ok: true, data: await moduleApi.deleteSlot(slotId) });
    return;
  }

  if (req.method === "PATCH" && /^\/api\/admin\/bookings\/\d+\/status$/.test(pathname)) {
    const bookingId = Number(pathname.split("/")[4]);
    const payload = await readJsonBody(req);
    sendJson(res, 200, {
      ok: true,
      data: await moduleApi.updateBookingStatus(bookingId, payload.status)
    });
    return;
  }

  if (req.method === "POST" && /^\/api\/admin\/bookings\/\d+\/cancel$/.test(pathname)) {
    const bookingId = Number(pathname.split("/")[4]);
    const payload = await readJsonBody(req);
    sendJson(res, 200, {
      ok: true,
      data: await moduleApi.cancelBooking(bookingId, { releaseSlot: Boolean(payload.release_slot) })
    });
    return;
  }

  if (req.method === "POST" && /^\/api\/admin\/bookings\/\d+\/transfer$/.test(pathname)) {
    const bookingId = Number(pathname.split("/")[4]);
    const payload = await readJsonBody(req);
    sendJson(res, 200, {
      ok: true,
      data: await moduleApi.transferBooking(bookingId, payload.target_slot_id)
    });
    return;
  }

  if ((req.method === "GET" || req.method === "HEAD") && pathname === "/health") {
    await repository.healthCheck();

    if (req.method === "HEAD") {
      res.writeHead(200, { "Cache-Control": "no-store" });
      res.end();
      return;
    }

    sendJson(res, 200, { ok: true });
    return;
  }

  notFound(res);
}

function serveStaticFile(req, res, staticFile) {
  const [fileName, contentType] = staticFile;
  const fullPath = path.join(rootDir, fileName);

  if (!fs.existsSync(fullPath)) {
    notFound(res);
    return;
  }

  const fileBuffer = fs.readFileSync(fullPath);

  res.writeHead(200, {
    "Content-Type": contentType,
    "Content-Length": fileBuffer.byteLength,
    "Cache-Control": "no-store"
  });

  if (req.method === "HEAD") {
    res.end();
    return;
  }

  res.end(fileBuffer);
}

const server = http.createServer(async (req, res) => {
  try {
    await routeRequest(req, res);
  } catch (error) {
    if (pathnameLooksLikeHealthCheck(req.url) && !(error instanceof AppError)) {
      sendJson(res, 503, {
        ok: false,
        error: {
          code: "HEALTHCHECK_FAILED",
          message: "Проверка состояния сервиса не пройдена."
        }
      });
      return;
    }
    handleRouteError(res, error);
  }
});

server.listen(APP_PORT, () => {
  console.log(`Teplovmeste booking MVP is running on http://localhost:${APP_PORT}${BASE_PATH || "/"}`);
});

function pathnameLooksLikeHealthCheck(urlString) {
  if (!urlString) {
    return false;
  }

  const url = new URL(urlString, "http://localhost");
  const pathname = stripBasePath(url.pathname, BASE_PATH);
  return pathname === "/health";
}

function isProtectedAdminPath(pathname) {
  return pathname === "/admin" || pathname === "/admin.html" || pathname.startsWith("/api/admin");
}

function enforceAdminAuth(req, res, pathname) {
  if (!ADMIN_BASIC_AUTH_USER || !ADMIN_BASIC_AUTH_PASS) {
    return true;
  }

  if (!isAdminSessionValid(req)) {
    writeUnauthorized(req, res, pathname);
    return false;
  }

  return true;
}

function writeUnauthorized(req, res, pathname) {
  if (pathname.startsWith("/api/admin")) {
    sendJson(res, 401, {
      ok: false,
      error: {
        code: "UNAUTHORIZED",
        message: "Требуется авторизация администратора."
      }
    });
    return;
  }

  redirect(res, toAppPath("/admin/login"));
}

function isAdminSessionValid(req) {
  const sessionCookie = readCookie(req, ADMIN_SESSION_COOKIE);
  if (!sessionCookie) {
    return false;
  }

  return verifyAdminSessionToken(sessionCookie);
}

function createAdminSessionToken(username) {
  const expiresAt = Date.now() + ADMIN_SESSION_TTL_MS;
  const payload = `${username}:${expiresAt}`;
  const signature = signAdminSessionPayload(payload);
  return `${Buffer.from(payload, "utf8").toString("base64url")}.${signature}`;
}

function verifyAdminSessionToken(token) {
  const [encodedPayload, providedSignature] = String(token || "").split(".");
  if (!encodedPayload || !providedSignature) {
    return false;
  }

  let payload = "";

  try {
    payload = Buffer.from(encodedPayload, "base64url").toString("utf8");
  } catch {
    return false;
  }

  const expectedSignature = signAdminSessionPayload(payload);
  const providedBuffer = Buffer.from(providedSignature);
  const expectedBuffer = Buffer.from(expectedSignature);

  if (providedBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(providedBuffer, expectedBuffer)) {
    return false;
  }

  const [username, expiresAtRaw] = payload.split(":");
  const expiresAt = Number(expiresAtRaw);

  return username === ADMIN_BASIC_AUTH_USER && Number.isFinite(expiresAt) && expiresAt > Date.now();
}

function signAdminSessionPayload(payload) {
  return crypto
    .createHmac("sha256", `${ADMIN_BASIC_AUTH_USER}:${ADMIN_BASIC_AUTH_PASS}`)
    .update(payload)
    .digest("base64url");
}

function writeAdminSessionCookie(req, res, username) {
  const token = createAdminSessionToken(username);
  writeCookie(res, `${ADMIN_SESSION_COOKIE}=${token}`, req);
}

function clearAdminSessionCookie(req, res) {
  writeCookie(res, `${ADMIN_SESSION_COOKIE}=; Max-Age=0`, req);
}

function writeCookie(res, baseValue, req) {
  const parts = [
    baseValue,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax"
  ];

  if (isSecureRequest(req)) {
    parts.push("Secure");
  }

  if (!baseValue.includes("Max-Age=0")) {
    parts.push(`Max-Age=${Math.floor(ADMIN_SESSION_TTL_MS / 1000)}`);
  }

  const existing = res.getHeader("Set-Cookie");
  const nextValue = parts.join("; ");

  if (!existing) {
    res.setHeader("Set-Cookie", nextValue);
    return;
  }

  res.setHeader("Set-Cookie", Array.isArray(existing) ? [...existing, nextValue] : [existing, nextValue]);
}

function readCookie(req, name) {
  const cookieHeader = req.headers.cookie || "";
  const parts = cookieHeader.split(";").map((item) => item.trim()).filter(Boolean);
  const target = `${name}=`;
  const cookie = parts.find((item) => item.startsWith(target));
  return cookie ? cookie.slice(target.length) : "";
}

function isSecureRequest(req) {
  const forwardedProto = String(req.headers["x-forwarded-proto"] || "").toLowerCase();
  return forwardedProto.includes("https");
}

function toAppPath(pathname) {
  return `${BASE_PATH}${pathname}` || pathname;
}

function redirect(res, location) {
  res.writeHead(302, {
    Location: location,
    "Cache-Control": "no-store"
  });
  res.end();
}
