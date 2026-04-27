import { DATABASE_URL } from "../src/config.js";
import { createRepository } from "../src/db.js";

const repository = await createRepository({
  driver: DATABASE_URL ? "postgres" : "sqlite",
  databaseUrl: DATABASE_URL,
  seedDemoData: true
});

console.log(`Demo seed ensured for ${repository.driver}.`);
await repository.close();
