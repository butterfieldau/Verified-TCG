import app from "./app";
import { logger } from "./lib/logger";
import { runMigrations } from "./lib/migrate";
import { recoverQueuedRefreshJobs } from "./routes/adminOperations";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// Run versioned migrations before accepting any traffic.
// If migrations fail (table missing, DB unreachable, etc.) the process exits.
runMigrations()
  .then(() => {
    // Recover any refresh jobs that were queued before the last restart.
    // Failures here are non-fatal — jobs remain queued for the next restart.
    recoverQueuedRefreshJobs().catch((err) => {
      logger.warn({ err }, "Queued refresh job recovery failed — jobs will retry on next restart");
    });
    app.listen(port, (err) => {
      if (err) {
        logger.error({ err }, "Error listening on port");
        process.exit(1);
      }
      logger.info({ port }, "Server listening");
    });
  })
  .catch((err) => {
    logger.error({ err }, "Database migration failed — refusing to start");
    process.exit(1);
  });
