import fs from "node:fs";
import path from "node:path";
import http from "node:http";
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
import { getStaticFile, isStaticMethod, stripBasePath } from "./src/http-routing.js";
import { createBookingModule } from "./src/module.js";
import { handleRouteError, notFound, readJsonBody, sendJson } from "./src/utils.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = __dirname;

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
  const pathname = stripBasePath(url.pathname, BASE_PATH);

  if (pathname === null) {
    notFound(res);
    return;
  }

  if (isProtectedAdminPath(pathname) && !enforceAdminAuth(req, res)) {
    return;
  }

  if (isStaticMethod(req.method)) {
    const staticFile = getStaticFile(pathname);
    if (staticFile) {
      const [fileName, contentType] = staticFile;
      const fullPath = path.join(rootDir, fileName);
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

function enforceAdminAuth(req, res) {
  if (!ADMIN_BASIC_AUTH_USER || !ADMIN_BASIC_AUTH_PASS) {
    return true;
  }

  const header = req.headers.authorization || "";
  const [scheme, encoded] = header.split(" ");

  if (scheme !== "Basic" || !encoded) {
    writeUnauthorized(res);
    return false;
  }

  const decoded = Buffer.from(encoded, "base64").toString("utf8");
  const separatorIndex = decoded.indexOf(":");
  const username = separatorIndex >= 0 ? decoded.slice(0, separatorIndex) : "";
  const password = separatorIndex >= 0 ? decoded.slice(separatorIndex + 1) : "";

  if (username !== ADMIN_BASIC_AUTH_USER || password !== ADMIN_BASIC_AUTH_PASS) {
    writeUnauthorized(res);
    return false;
  }

  return true;
}

function writeUnauthorized(res) {
  res.writeHead(401, {
    "Content-Type": "application/json; charset=utf-8",
    "WWW-Authenticate": 'Basic realm="Teplovmeste Admin"'
  });
  res.end(
    JSON.stringify({
      ok: false,
      error: {
        code: "UNAUTHORIZED",
        message: "Требуется авторизация администратора."
      }
    })
  );
}
