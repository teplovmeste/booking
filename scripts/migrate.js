import { DATABASE_URL } from "../src/config.js";
import { createRepository } from "../src/db.js";

if (!DATABASE_URL) {
  console.error("DATABASE_URL is required for migrations.");
  process.exit(1);
}

const repository = await createRepository({
  driver: "postgres",
  databaseUrl: DATABASE_URL,
  seedDemoData: false
});

console.log("Database schema is ready.");
await repository.close();
