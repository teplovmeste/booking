import test from "node:test";
import assert from "node:assert/strict";
import { getStaticFile, isStaticMethod, normalizePathname, stripBasePath } from "../src/http-routing.js";

test("normalizePathname keeps root and trims trailing slash elsewhere", () => {
  assert.equal(normalizePathname("/"), "/");
  assert.equal(normalizePathname("/admin/"), "/admin");
  assert.equal(normalizePathname("/api/admin/bookings/"), "/api/admin/bookings");
});

test("getStaticFile resolves admin and public pages with or without trailing slash", () => {
  assert.deepEqual(getStaticFile("/"), ["index.html", "text/html; charset=utf-8"]);
  assert.deepEqual(getStaticFile("/admin"), ["admin.html", "text/html; charset=utf-8"]);
  assert.deepEqual(getStaticFile("/admin/"), ["admin.html", "text/html; charset=utf-8"]);
  assert.equal(getStaticFile("/missing"), null);
});

test("static method guard accepts GET and HEAD only", () => {
  assert.equal(isStaticMethod("GET"), true);
  assert.equal(isStaticMethod("HEAD"), true);
  assert.equal(isStaticMethod("POST"), false);
});

test("stripBasePath supports root and mounted app paths", () => {
  assert.equal(stripBasePath("/admin", ""), "/admin");
  assert.equal(stripBasePath("/booking", "/booking"), "/");
  assert.equal(stripBasePath("/booking/admin/", "/booking"), "/admin");
  assert.equal(stripBasePath("/outside", "/booking"), null);
});
