import fs from "node:fs";
import pg from "pg";
import {
  APP_TIMEZONE,
  DATA_DIR,
  DATABASE_SSL,
  DATABASE_SSL_REJECT_UNAUTHORIZED,
  DATABASE_URL,
  DB_PATH
} from "./config.js";
import { computeEndsAtIso } from "./utils.js";

const { Pool } = pg;

const SQLITE_SCHEMA_SQL = `
  PRAGMA foreign_keys = ON;
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS psychologists (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    age_category TEXT NOT NULL,
    age_categories TEXT,
    email TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS slots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    psychologist_id INTEGER NOT NULL REFERENCES psychologists(id) ON DELETE CASCADE,
    starts_at TEXT NOT NULL,
    ends_at TEXT NOT NULL,
    timezone TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('available', 'booked', 'deleted')),
    booking_id INTEGER,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS bookings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slot_id INTEGER REFERENCES slots(id),
    psychologist_id INTEGER REFERENCES psychologists(id),
    age_category TEXT NOT NULL,
    parent_name TEXT NOT NULL,
    parent_email TEXT NOT NULL,
    parent_phone TEXT NOT NULL,
    parent_telegram TEXT NOT NULL,
    child_name TEXT NOT NULL,
    child_age TEXT NOT NULL,
    country TEXT NOT NULL,
    request_text TEXT NOT NULL,
    preferred_time TEXT,
    preferred_contact_method TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('new', 'awaiting_payment', 'confirmed', 'cancelled', 'completed')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_psychologists_category_active
    ON psychologists(age_category, is_active);

  CREATE INDEX IF NOT EXISTS idx_slots_listing
    ON slots(psychologist_id, starts_at, status);

  CREATE INDEX IF NOT EXISTS idx_bookings_filters
    ON bookings(status, psychologist_id, created_at);
`;

export const POSTGRES_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS psychologists (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    age_category TEXT NOT NULL,
    age_categories TEXT,
    email TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
  );

  CREATE TABLE IF NOT EXISTS slots (
    id BIGSERIAL PRIMARY KEY,
    psychologist_id BIGINT NOT NULL REFERENCES psychologists(id) ON DELETE CASCADE,
    starts_at TIMESTAMPTZ NOT NULL,
    ends_at TIMESTAMPTZ NOT NULL,
    timezone TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('available', 'booked', 'deleted')),
    booking_id BIGINT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
  );

  CREATE TABLE IF NOT EXISTS bookings (
    id BIGSERIAL PRIMARY KEY,
    slot_id BIGINT REFERENCES slots(id),
    psychologist_id BIGINT REFERENCES psychologists(id),
    age_category TEXT NOT NULL,
    parent_name TEXT NOT NULL,
    parent_email TEXT NOT NULL,
    parent_phone TEXT NOT NULL,
    parent_telegram TEXT NOT NULL,
    child_name TEXT NOT NULL,
    child_age TEXT NOT NULL,
    country TEXT NOT NULL,
    request_text TEXT NOT NULL,
    preferred_time TEXT,
    preferred_contact_method TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('new', 'awaiting_payment', 'confirmed', 'cancelled', 'completed')),
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_psychologists_category_active
    ON psychologists(age_category, is_active);

  CREATE INDEX IF NOT EXISTS idx_slots_listing
    ON slots(psychologist_id, starts_at, status);

  CREATE INDEX IF NOT EXISTS idx_bookings_filters
    ON bookings(status, psychologist_id, created_at);
`;

const DEMO_PSYCHOLOGISTS = [
  { name: "Анна Тихонова", age_categories: ["preschool"], email: "anna@teplovmeste.com" },
  { name: "Мария Ларионова", age_categories: ["primary_school"], email: "maria@teplovmeste.com" },
  { name: "Елизавета Орлова", age_categories: ["teens"], email: "elizaveta@teplovmeste.com" },
  { name: "Дарья Соболева", age_categories: ["primary_school", "teens"], email: "daria@teplovmeste.com" }
];

function serializeAgeCategories(ageCategories, fallbackAgeCategory = "") {
  const values = [...new Set((Array.isArray(ageCategories) ? ageCategories : []).map((value) => String(value || "").trim()).filter(Boolean))];
  if (values.length > 0) {
    return JSON.stringify(values);
  }

  return fallbackAgeCategory ? JSON.stringify([fallbackAgeCategory]) : JSON.stringify([]);
}

function parseAgeCategories(rawValue, fallbackAgeCategory = "") {
  if (Array.isArray(rawValue)) {
    return rawValue;
  }

  if (typeof rawValue === "string" && rawValue.trim()) {
    try {
      const parsed = JSON.parse(rawValue);
      if (Array.isArray(parsed)) {
        return parsed.map((value) => String(value || "").trim()).filter(Boolean);
      }
    } catch {
      // noop
    }
  }

  return fallbackAgeCategory ? [fallbackAgeCategory] : [];
}

function hydratePsychologistRow(row) {
  if (!row) {
    return null;
  }

  return {
    ...row,
    age_categories: parseAgeCategories(row.age_categories, row.age_category)
  };
}

function hydrateRows(rows, transform = normalizeRow) {
  return rows.map((row) => hydratePsychologistRow(transform(row)));
}

function buildDemoSlots(psychologists, nowProvider) {
  const baseDate = nowProvider();
  baseDate.setUTCMinutes(0, 0, 0);

  const slots = [];
  psychologists.forEach((psychologist, index) => {
    for (let dayOffset = 2; dayOffset <= 8; dayOffset += 3) {
      const morningStart = new Date(baseDate.getTime() + (dayOffset * 24 + 12 + index) * 60 * 60 * 1000);
      const eveningStart = new Date(baseDate.getTime() + (dayOffset * 24 + 16 + index) * 60 * 60 * 1000);

      for (const startsAt of [morningStart.toISOString(), eveningStart.toISOString()]) {
        slots.push({
          psychologist_id: psychologist.id,
          starts_at: startsAt,
          ends_at: computeEndsAtIso(startsAt),
          timezone: APP_TIMEZONE
        });
      }
    }
  });

  return slots;
}

function buildSqliteFilterQuery(baseQuery, filters, aliasPrefix = "") {
  const conditions = [];
  const values = [];

  if (filters.status) {
    conditions.push(`${aliasPrefix}status = ?`);
    values.push(filters.status);
  }

  if (Number(filters.psychologist_id) > 0) {
    conditions.push(`${aliasPrefix}psychologist_id = ?`);
    values.push(Number(filters.psychologist_id));
  }

  if (filters.date) {
    conditions.push(`date(datetime(s.starts_at, '+3 hours')) = ?`);
    values.push(filters.date);
  }

  const where = conditions.length ? ` WHERE ${conditions.join(" AND ")}` : "";
  return {
    query: `${baseQuery}${where}`,
    values
  };
}

function buildPostgresFilters(filters, options = {}) {
  const conditions = [];
  const values = [];
  const statusColumn = options.statusColumn || "status";
  const psychologistColumn = options.psychologistColumn || "psychologist_id";
  const startsAtColumn = options.startsAtColumn || "s.starts_at";

  if (filters.status) {
    values.push(filters.status);
    conditions.push(`${statusColumn} = $${values.length}`);
  }

  if (Number(filters.psychologist_id) > 0) {
    values.push(Number(filters.psychologist_id));
    conditions.push(`${psychologistColumn} = $${values.length}`);
  }

  if (filters.date) {
    values.push(filters.date);
    conditions.push(`DATE(${startsAtColumn} AT TIME ZONE '${APP_TIMEZONE}') = $${values.length}`);
  }

  return {
    where: conditions.length ? ` WHERE ${conditions.join(" AND ")}` : "",
    values
  };
}

function normalizeRow(row) {
  return row ? { ...row } : null;
}

async function createSqliteRepository({ sqlitePath = DB_PATH, seedDemoData = true, nowProvider = () => new Date() } = {}) {
  const { DatabaseSync } = await import("node:sqlite");

  if (sqlitePath !== ":memory:") {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  const db = new DatabaseSync(sqlitePath);
  db.exec(SQLITE_SCHEMA_SQL);

  const listSlotsBase = `
    SELECT
      s.*,
      p.name AS psychologist_name,
      p.age_category,
      p.age_categories,
      p.email AS psychologist_email,
      p.is_active
    FROM slots s
    JOIN psychologists p ON p.id = s.psychologist_id
  `;

  const listBookingsBase = `
    SELECT
      b.*,
      p.name AS psychologist_name,
      p.email AS psychologist_email,
      s.starts_at AS slot_starts_at,
      s.ends_at AS slot_ends_at,
      s.timezone AS slot_timezone,
      s.status AS slot_status
    FROM bookings b
    LEFT JOIN psychologists p ON p.id = b.psychologist_id
    LEFT JOIN slots s ON s.id = b.slot_id
  `;

  function ensureSqlitePsychologistCategoryStorage() {
    const columns = db.prepare("PRAGMA table_info(psychologists)").all();
    const hasAgeCategoriesColumn = columns.some((column) => column.name === "age_categories");

    if (!hasAgeCategoriesColumn) {
      db.exec("ALTER TABLE psychologists ADD COLUMN age_categories TEXT");
    }

    const rows = db.prepare("SELECT id, age_category, age_categories FROM psychologists").all();
    const update = db.prepare("UPDATE psychologists SET age_categories = ? WHERE id = ?");

    for (const row of rows) {
      const serialized = serializeAgeCategories(parseAgeCategories(row.age_categories, row.age_category), row.age_category);
      if (serialized !== row.age_categories) {
        update.run(serialized, Number(row.id));
      }
    }
  }

  function ensureSqliteBookingRequestSupport() {
    const columns = db.prepare("PRAGMA table_info(bookings)").all();
    const slotColumn = columns.find((column) => column.name === "slot_id");
    const psychologistColumn = columns.find((column) => column.name === "psychologist_id");
    const hasPreferredTimeColumn = columns.some((column) => column.name === "preferred_time");
    const needsRebuild = !hasPreferredTimeColumn || slotColumn?.notnull === 1 || psychologistColumn?.notnull === 1;

    if (!needsRebuild) {
      return;
    }

    db.exec(`
      CREATE TABLE bookings_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        slot_id INTEGER REFERENCES slots(id),
        psychologist_id INTEGER REFERENCES psychologists(id),
        age_category TEXT NOT NULL,
        parent_name TEXT NOT NULL,
        parent_email TEXT NOT NULL,
        parent_phone TEXT NOT NULL,
        parent_telegram TEXT NOT NULL,
        child_name TEXT NOT NULL,
        child_age TEXT NOT NULL,
        country TEXT NOT NULL,
        request_text TEXT NOT NULL,
        preferred_time TEXT,
        preferred_contact_method TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('new', 'awaiting_payment', 'confirmed', 'cancelled', 'completed')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      INSERT INTO bookings_new (
        id,
        slot_id,
        psychologist_id,
        age_category,
        parent_name,
        parent_email,
        parent_phone,
        parent_telegram,
        child_name,
        child_age,
        country,
        request_text,
        preferred_time,
        preferred_contact_method,
        status,
        created_at,
        updated_at
      )
      SELECT
        id,
        slot_id,
        psychologist_id,
        age_category,
        parent_name,
        parent_email,
        parent_phone,
        parent_telegram,
        child_name,
        child_age,
        country,
        request_text,
        NULL,
        preferred_contact_method,
        status,
        created_at,
        updated_at
      FROM bookings;

      DROP TABLE bookings;
      ALTER TABLE bookings_new RENAME TO bookings;

      CREATE INDEX IF NOT EXISTS idx_bookings_filters
        ON bookings(status, psychologist_id, created_at);
    `);
  }

  function countRows(tableName) {
    return Number(db.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get().count);
  }

  function seedIfEmpty() {
    if (!seedDemoData || countRows("psychologists") > 0) {
      return;
    }

    const timestamp = nowProvider().toISOString();
    const insertPsychologist = db.prepare(`
      INSERT INTO psychologists (name, age_category, age_categories, email, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, 1, ?, ?)
    `);

    for (const psychologist of DEMO_PSYCHOLOGISTS) {
      insertPsychologist.run(
        psychologist.name,
        psychologist.age_categories[0],
        serializeAgeCategories(psychologist.age_categories, psychologist.age_categories[0]),
        psychologist.email,
        timestamp,
        timestamp
      );
    }

    const psychologists = db.prepare("SELECT id FROM psychologists ORDER BY id").all();
    const slots = buildDemoSlots(psychologists, nowProvider);
    const insertSlot = db.prepare(`
      INSERT INTO slots (psychologist_id, starts_at, ends_at, timezone, status, booking_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'available', NULL, ?, ?)
    `);

    for (const slot of slots) {
      insertSlot.run(
        slot.psychologist_id,
        slot.starts_at,
        slot.ends_at,
        slot.timezone,
        timestamp,
        timestamp
      );
    }
  }

  ensureSqlitePsychologistCategoryStorage();
  ensureSqliteBookingRequestSupport();
  seedIfEmpty();

  const repository = {
    driver: "sqlite",
    async close() {},
    async healthCheck() {
      db.prepare("SELECT 1").get();
    },
    async transaction(run) {
      db.exec("BEGIN IMMEDIATE");
      try {
        const result = await run(repository);
        db.exec("COMMIT");
        return result;
      } catch (error) {
        try {
          db.exec("ROLLBACK");
        } catch {
          // noop
        }
        throw error;
      }
    },
    async getPsychologistsByCategory(ageCategory) {
      if (ageCategory === "not_important") {
        return repository.listPsychologists().then((rows) => rows.filter((row) => Boolean(row.is_active)));
      }

      return hydrateRows(
        db
        .prepare(`
          SELECT id, name, age_category, age_categories, email, is_active
          FROM psychologists
          WHERE is_active = 1
          ORDER BY name
        `)
        .all()
          .map(normalizeRow)
      ).filter((row) => row.age_categories.includes(ageCategory));
    },
    async getPublicAvailableSlotsByCategory(ageCategory) {
      if (ageCategory === "not_important") {
        return hydrateRows(
          db
            .prepare(`
              ${listSlotsBase}
              WHERE p.is_active = 1
                AND s.status = 'available'
                AND s.booking_id IS NULL
              ORDER BY s.starts_at
            `)
            .all()
            .map(normalizeRow)
        );
      }

      return hydrateRows(
        db
        .prepare(`
          ${listSlotsBase}
          WHERE p.is_active = 1
            AND s.status = 'available'
            AND s.booking_id IS NULL
          ORDER BY s.starts_at
        `)
        .all()
          .map(normalizeRow)
      ).filter((row) => row.age_categories.includes(ageCategory));
    },
    async getSlotWithPsychologist(slotId) {
      return hydratePsychologistRow(normalizeRow(
        db
          .prepare(`
            ${listSlotsBase}
            WHERE s.id = ?
          `)
          .get(Number(slotId))
      ));
    },
    async getSlotById(slotId) {
      return hydratePsychologistRow(normalizeRow(
        db
          .prepare(`
            ${listSlotsBase}
            WHERE s.id = ?
          `)
          .get(Number(slotId))
      ));
    },
    async insertBooking(payload, timestamp) {
      const result = db
        .prepare(`
          INSERT INTO bookings (
            slot_id,
            psychologist_id,
            age_category,
            parent_name,
            parent_email,
            parent_phone,
            parent_telegram,
            child_name,
            child_age,
            country,
            request_text,
            preferred_time,
            preferred_contact_method,
            status,
            created_at,
            updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?)
        `)
        .run(
          payload.slot_id ?? null,
          payload.psychologist_id,
          payload.age_category,
          payload.parent_name,
          payload.parent_email,
          payload.parent_phone,
          payload.parent_telegram,
          payload.child_name,
          payload.child_age,
          payload.country,
          payload.request_text,
          payload.preferred_time || null,
          payload.preferred_contact_method,
          timestamp,
          timestamp
        );

      return Number(result.lastInsertRowid);
    },
    async markSlotBooked(bookingId, timestamp, slotId) {
      const result = db
        .prepare(`
          UPDATE slots
          SET status = 'booked', booking_id = ?, updated_at = ?
          WHERE id = ? AND status = 'available' AND booking_id IS NULL
        `)
        .run(Number(bookingId), timestamp, Number(slotId));

      return result.changes;
    },
    async getBookingDetails(bookingId) {
      return normalizeRow(
        db
          .prepare(`
            ${listBookingsBase}
            WHERE b.id = ?
          `)
          .get(Number(bookingId))
      );
    },
    async listPsychologists() {
      return hydrateRows(
        db
        .prepare(`
          SELECT id, name, age_category, age_categories, email, is_active
          FROM psychologists
          ORDER BY is_active DESC, name
        `)
        .all()
          .map(normalizeRow)
      );
    },
    async listAdminBookings(filters = {}) {
      const built = buildSqliteFilterQuery(listBookingsBase, filters, "b.");
      return db.prepare(`${built.query} ORDER BY b.created_at DESC`).all(...built.values).map(normalizeRow);
    },
    async listAdminSlots(filters = {}) {
      const built = buildSqliteFilterQuery(listSlotsBase, filters, "s.");
      return hydrateRows(db.prepare(`${built.query} ORDER BY s.starts_at ASC`).all(...built.values).map(normalizeRow));
    },
    async getPsychologistById(psychologistId) {
      return hydratePsychologistRow(normalizeRow(
        db
          .prepare(`
            SELECT id, name, age_category, age_categories, email, is_active
            FROM psychologists
            WHERE id = ?
          `)
          .get(Number(psychologistId))
      ));
    },
    async insertPsychologist(payload, timestamp) {
      const result = db
        .prepare(`
          INSERT INTO psychologists (name, age_category, age_categories, email, is_active, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          payload.name,
          payload.age_category,
          serializeAgeCategories(payload.age_categories, payload.age_category),
          payload.email,
          payload.is_active ? 1 : 0,
          timestamp,
          timestamp
        );

      return Number(result.lastInsertRowid);
    },
    async updatePsychologist(psychologistId, payload, timestamp) {
      db.prepare(`
        UPDATE psychologists
        SET name = ?, age_category = ?, age_categories = ?, email = ?, is_active = ?, updated_at = ?
        WHERE id = ?
      `).run(
        payload.name,
        payload.age_category,
        serializeAgeCategories(payload.age_categories, payload.age_category),
        payload.email,
        payload.is_active ? 1 : 0,
        timestamp,
        Number(psychologistId)
      );
    },
    async insertSlot(payload, timestamp) {
      const result = db
        .prepare(`
          INSERT INTO slots (
            psychologist_id,
            starts_at,
            ends_at,
            timezone,
            status,
            booking_id,
            created_at,
            updated_at
          ) VALUES (?, ?, ?, ?, 'available', NULL, ?, ?)
        `)
        .run(
          payload.psychologist_id,
          payload.starts_at,
          payload.ends_at,
          payload.timezone,
          timestamp,
          timestamp
        );

      return Number(result.lastInsertRowid);
    },
    async updateBookingStatus(bookingId, status, timestamp) {
      db.prepare("UPDATE bookings SET status = ?, updated_at = ? WHERE id = ?").run(status, timestamp, Number(bookingId));
    },
    async releaseSlotByBooking(bookingId, timestamp) {
      db.prepare("UPDATE slots SET status = 'available', booking_id = NULL, updated_at = ? WHERE booking_id = ?").run(
        timestamp,
        Number(bookingId)
      );
    },
    async getBookingWithSlot(bookingId) {
      return normalizeRow(
        db
          .prepare(`
            ${listBookingsBase}
            WHERE b.id = ?
          `)
          .get(Number(bookingId))
      );
    },
    async softDeleteSlot(slotId, timestamp) {
      const result = db
        .prepare("UPDATE slots SET status = 'deleted', booking_id = NULL, updated_at = ? WHERE id = ? AND status != 'booked'")
        .run(timestamp, Number(slotId));
      return result.changes;
    },
    async markTargetSlotBooked(bookingId, timestamp, slotId) {
      const result = db
        .prepare(`
          UPDATE slots
          SET status = 'booked', booking_id = ?, updated_at = ?
          WHERE id = ? AND status = 'available' AND booking_id IS NULL
        `)
        .run(Number(bookingId), timestamp, Number(slotId));
      return result.changes;
    },
    async freeOriginalSlot(timestamp, slotId, bookingId) {
      db.prepare("UPDATE slots SET status = 'available', booking_id = NULL, updated_at = ? WHERE id = ? AND booking_id = ?").run(
        timestamp,
        Number(slotId),
        Number(bookingId)
      );
    },
    async reassignBooking({ bookingId, slotId, psychologistId, ageCategory, timestamp }) {
      db.prepare(`
        UPDATE bookings
        SET slot_id = ?, psychologist_id = ?, age_category = ?, updated_at = ?
        WHERE id = ?
      `).run(Number(slotId), Number(psychologistId), ageCategory, timestamp, Number(bookingId));
    }
  };

  return repository;
}

async function createPostgresRepository({ databaseUrl = DATABASE_URL, seedDemoData = false, nowProvider = () => new Date() } = {}) {
  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: getPostgresSslConfig()
  });

  async function query(text, params = [], client = pool) {
    const result = await client.query(text, params);
    return result.rows;
  }

  async function execute(text, params = [], client = pool) {
    return client.query(text, params);
  }

  async function countRows(tableName) {
    const rows = await query(`SELECT COUNT(*)::int AS count FROM ${tableName}`);
    return rows[0].count;
  }

  await execute(POSTGRES_SCHEMA_SQL);
  await execute("ALTER TABLE psychologists ADD COLUMN IF NOT EXISTS age_categories TEXT");
  await execute(`
    UPDATE psychologists
    SET age_categories = CONCAT('["', age_category, '"]')
    WHERE age_categories IS NULL OR age_categories = ''
  `);
  await execute("ALTER TABLE bookings ALTER COLUMN child_age TYPE TEXT USING child_age::text");
  await execute("ALTER TABLE bookings ALTER COLUMN slot_id DROP NOT NULL");
  await execute("ALTER TABLE bookings ALTER COLUMN psychologist_id DROP NOT NULL");
  await execute("ALTER TABLE bookings ADD COLUMN IF NOT EXISTS preferred_time TEXT");

  if (seedDemoData && (await countRows("psychologists")) === 0) {
    const timestamp = nowProvider().toISOString();
    const insertedPsychologists = [];

    for (const psychologist of DEMO_PSYCHOLOGISTS) {
      const rows = await query(
        `
          INSERT INTO psychologists (name, age_category, age_categories, email, is_active, created_at, updated_at)
          VALUES ($1, $2, $3, $4, TRUE, $5, $5)
          RETURNING id
        `,
        [
          psychologist.name,
          psychologist.age_categories[0],
          serializeAgeCategories(psychologist.age_categories, psychologist.age_categories[0]),
          psychologist.email,
          timestamp
        ]
      );
      insertedPsychologists.push({ id: rows[0].id });
    }

    const slots = buildDemoSlots(insertedPsychologists, nowProvider);
    for (const slot of slots) {
      await execute(
        `
          INSERT INTO slots (
            psychologist_id,
            starts_at,
            ends_at,
            timezone,
            status,
            booking_id,
            created_at,
            updated_at
          ) VALUES ($1, $2, $3, $4, 'available', NULL, $5, $5)
        `,
        [slot.psychologist_id, slot.starts_at, slot.ends_at, slot.timezone, timestamp]
      );
    }
  }

  function createAdapter(client) {
    const runner = client || pool;

    return {
      driver: "postgres",
      async close() {},
      async healthCheck() {
        await runner.query("SELECT 1");
      },
      async transaction(run) {
        const txClient = await pool.connect();
        try {
          await txClient.query("BEGIN");
          const result = await run(createAdapter(txClient));
          await txClient.query("COMMIT");
          return result;
        } catch (error) {
          try {
            await txClient.query("ROLLBACK");
          } catch {
            // noop
          }
          throw error;
        } finally {
          txClient.release();
        }
      },
      async getPsychologistsByCategory(ageCategory) {
        if (ageCategory === "not_important") {
          return runner.listPsychologists
            ? runner.listPsychologists().then((rows) => rows.filter((row) => Boolean(row.is_active)))
            : hydrateRows(await query(
              `
                SELECT id, name, age_category, age_categories, email, is_active
                FROM psychologists
                WHERE is_active = TRUE
                ORDER BY name
              `,
              [],
              runner
            ), (row) => row);
        }

        const rows = await query(
          `
            SELECT id, name, age_category, age_categories, email, is_active
            FROM psychologists
            WHERE is_active = TRUE
            ORDER BY name
          `,
          [],
          runner
        );
        return hydrateRows(rows, (row) => row).filter((row) => row.age_categories.includes(ageCategory));
      },
      async getPublicAvailableSlotsByCategory(ageCategory) {
        if (ageCategory === "not_important") {
          return hydrateRows(await query(
            `
              SELECT
                s.*,
                p.name AS psychologist_name,
                p.age_category,
                p.age_categories,
                p.email AS psychologist_email,
                p.is_active
              FROM slots s
              JOIN psychologists p ON p.id = s.psychologist_id
              WHERE p.is_active = TRUE
                AND s.status = 'available'
                AND s.booking_id IS NULL
              ORDER BY s.starts_at
            `,
            [],
            runner
          ), (row) => row);
        }

        const rows = await query(
          `
            SELECT
              s.*,
              p.name AS psychologist_name,
              p.age_category,
              p.age_categories,
              p.email AS psychologist_email,
              p.is_active
            FROM slots s
            JOIN psychologists p ON p.id = s.psychologist_id
            WHERE p.is_active = TRUE
              AND s.status = 'available'
              AND s.booking_id IS NULL
            ORDER BY s.starts_at
          `,
          [],
          runner
        );
        return hydrateRows(rows, (row) => row).filter((row) => row.age_categories.includes(ageCategory));
      },
      async getSlotWithPsychologist(slotId, options = {}) {
        const params = [Number(slotId)];
        const locking = options.forUpdate ? " FOR UPDATE" : "";
        const rows = await query(
          `
            SELECT
              s.*,
              p.name AS psychologist_name,
              p.age_category,
              p.age_categories,
              p.email AS psychologist_email,
              p.is_active
            FROM slots s
            JOIN psychologists p ON p.id = s.psychologist_id
            WHERE s.id = $1
            ${locking}
          `,
          params,
          runner
        );
        return hydratePsychologistRow(rows[0] || null);
      },
      async getSlotById(slotId) {
        const rows = await query(
          `
            SELECT
              s.*,
              p.name AS psychologist_name,
              p.age_category,
              p.age_categories,
              p.email AS psychologist_email,
              p.is_active
            FROM slots s
            JOIN psychologists p ON p.id = s.psychologist_id
            WHERE s.id = $1
          `,
          [Number(slotId)],
          runner
        );
        return hydratePsychologistRow(rows[0] || null);
      },
      async insertBooking(payload, timestamp) {
        const rows = await query(
          `
            INSERT INTO bookings (
              slot_id,
              psychologist_id,
              age_category,
              parent_name,
              parent_email,
              parent_phone,
              parent_telegram,
              child_name,
              child_age,
              country,
              request_text,
              preferred_time,
              preferred_contact_method,
              status,
              created_at,
              updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'new', $14, $14)
            RETURNING id
          `,
          [
            payload.slot_id ?? null,
            payload.psychologist_id,
            payload.age_category,
            payload.parent_name,
            payload.parent_email,
            payload.parent_phone,
            payload.parent_telegram,
            payload.child_name,
            payload.child_age,
            payload.country,
            payload.request_text,
            payload.preferred_time || null,
            payload.preferred_contact_method,
            timestamp
          ],
          runner
        );

        return Number(rows[0].id);
      },
      async markSlotBooked(bookingId, timestamp, slotId) {
        const result = await execute(
          `
            UPDATE slots
            SET status = 'booked', booking_id = $1, updated_at = $2
            WHERE id = $3 AND status = 'available' AND booking_id IS NULL
          `,
          [Number(bookingId), timestamp, Number(slotId)],
          runner
        );
        return result.rowCount;
      },
      async getBookingDetails(bookingId) {
        const rows = await query(
          `
            SELECT
              b.*,
              p.name AS psychologist_name,
              p.email AS psychologist_email,
              s.starts_at AS slot_starts_at,
              s.ends_at AS slot_ends_at,
              s.timezone AS slot_timezone,
              s.status AS slot_status
            FROM bookings b
            LEFT JOIN psychologists p ON p.id = b.psychologist_id
            LEFT JOIN slots s ON s.id = b.slot_id
            WHERE b.id = $1
          `,
          [Number(bookingId)],
          runner
        );
        return rows[0] || null;
      },
      async listPsychologists() {
        return hydrateRows(await query(
          `
            SELECT id, name, age_category, age_categories, email, is_active
            FROM psychologists
            ORDER BY is_active DESC, name
          `,
          [],
          runner
        ), (row) => row);
      },
      async listAdminBookings(filters = {}) {
        const built = buildPostgresFilters(filters, {
          statusColumn: "b.status",
          psychologistColumn: "b.psychologist_id",
          startsAtColumn: "s.starts_at"
        });
        return query(
          `
            SELECT
              b.*,
              p.name AS psychologist_name,
              p.email AS psychologist_email,
              s.starts_at AS slot_starts_at,
              s.ends_at AS slot_ends_at,
              s.timezone AS slot_timezone,
              s.status AS slot_status
            FROM bookings b
            LEFT JOIN psychologists p ON p.id = b.psychologist_id
            LEFT JOIN slots s ON s.id = b.slot_id
            ${built.where}
            ORDER BY b.created_at DESC
          `,
          built.values,
          runner
        );
      },
      async listAdminSlots(filters = {}) {
        const built = buildPostgresFilters(filters, {
          statusColumn: "s.status",
          psychologistColumn: "s.psychologist_id",
          startsAtColumn: "s.starts_at"
        });
        return hydrateRows(await query(
          `
            SELECT
              s.*,
              p.name AS psychologist_name,
              p.age_category,
              p.age_categories,
              p.email AS psychologist_email,
              p.is_active
            FROM slots s
            JOIN psychologists p ON p.id = s.psychologist_id
            ${built.where}
            ORDER BY s.starts_at ASC
          `,
          built.values,
          runner
        ), (row) => row);
      },
      async getPsychologistById(psychologistId) {
        const rows = await query(
          `
            SELECT id, name, age_category, age_categories, email, is_active
            FROM psychologists
            WHERE id = $1
          `,
          [Number(psychologistId)],
          runner
        );
        return hydratePsychologistRow(rows[0] || null);
      },
      async insertPsychologist(payload, timestamp) {
        const rows = await query(
          `
            INSERT INTO psychologists (name, age_category, age_categories, email, is_active, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $6)
            RETURNING id
          `,
          [
            payload.name,
            payload.age_category,
            serializeAgeCategories(payload.age_categories, payload.age_category),
            payload.email,
            payload.is_active,
            timestamp
          ],
          runner
        );
        return Number(rows[0].id);
      },
      async updatePsychologist(psychologistId, payload, timestamp) {
        await execute(
          `
            UPDATE psychologists
            SET name = $1, age_category = $2, age_categories = $3, email = $4, is_active = $5, updated_at = $6
            WHERE id = $7
          `,
          [
            payload.name,
            payload.age_category,
            serializeAgeCategories(payload.age_categories, payload.age_category),
            payload.email,
            payload.is_active,
            timestamp,
            Number(psychologistId)
          ],
          runner
        );
      },
      async insertSlot(payload, timestamp) {
        const rows = await query(
          `
            INSERT INTO slots (
              psychologist_id,
              starts_at,
              ends_at,
              timezone,
              status,
              booking_id,
              created_at,
              updated_at
            ) VALUES ($1, $2, $3, $4, 'available', NULL, $5, $5)
            RETURNING id
          `,
          [payload.psychologist_id, payload.starts_at, payload.ends_at, payload.timezone, timestamp],
          runner
        );
        return Number(rows[0].id);
      },
      async updateBookingStatus(bookingId, status, timestamp) {
        await execute("UPDATE bookings SET status = $1, updated_at = $2 WHERE id = $3", [status, timestamp, Number(bookingId)], runner);
      },
      async releaseSlotByBooking(bookingId, timestamp) {
        await execute(
          "UPDATE slots SET status = 'available', booking_id = NULL, updated_at = $1 WHERE booking_id = $2",
          [timestamp, Number(bookingId)],
          runner
        );
      },
      async getBookingWithSlot(bookingId, options = {}) {
        const locking = options.forUpdate ? " FOR UPDATE OF b" : "";
        const rows = await query(
          `
            SELECT
              b.*,
              p.name AS psychologist_name,
              p.email AS psychologist_email,
              s.starts_at AS slot_starts_at,
              s.ends_at AS slot_ends_at,
              s.timezone AS slot_timezone,
              s.status AS slot_status
            FROM bookings b
            LEFT JOIN psychologists p ON p.id = b.psychologist_id
            LEFT JOIN slots s ON s.id = b.slot_id
            WHERE b.id = $1
            ${locking}
          `,
          [Number(bookingId)],
          runner
        );
        return rows[0] || null;
      },
      async softDeleteSlot(slotId, timestamp) {
        const result = await execute(
          "UPDATE slots SET status = 'deleted', booking_id = NULL, updated_at = $1 WHERE id = $2 AND status != 'booked'",
          [timestamp, Number(slotId)],
          runner
        );
        return result.rowCount;
      },
      async markTargetSlotBooked(bookingId, timestamp, slotId) {
        const result = await execute(
          `
            UPDATE slots
            SET status = 'booked', booking_id = $1, updated_at = $2
            WHERE id = $3 AND status = 'available' AND booking_id IS NULL
          `,
          [Number(bookingId), timestamp, Number(slotId)],
          runner
        );
        return result.rowCount;
      },
      async freeOriginalSlot(timestamp, slotId, bookingId) {
        await execute(
          "UPDATE slots SET status = 'available', booking_id = NULL, updated_at = $1 WHERE id = $2 AND booking_id = $3",
          [timestamp, Number(slotId), Number(bookingId)],
          runner
        );
      },
      async reassignBooking({ bookingId, slotId, psychologistId, ageCategory, timestamp }) {
        await execute(
          `
            UPDATE bookings
            SET slot_id = $1, psychologist_id = $2, age_category = $3, updated_at = $4
            WHERE id = $5
          `,
          [Number(slotId), Number(psychologistId), ageCategory, timestamp, Number(bookingId)],
          runner
        );
      }
    };
  }

  const repository = createAdapter();
  repository.close = async () => {
    await pool.end();
  };
  return repository;
}

function getPostgresSslConfig() {
  if (DATABASE_SSL === "disable") {
    return false;
  }

  if (DATABASE_SSL === "require") {
    return { rejectUnauthorized: DATABASE_SSL_REJECT_UNAUTHORIZED };
  }

  return undefined;
}

export async function createRepository(options = {}) {
  const driver = options.driver || (options.databaseUrl || DATABASE_URL ? "postgres" : "sqlite");

  if (driver === "postgres") {
    return createPostgresRepository(options);
  }

  return createSqliteRepository(options);
}
