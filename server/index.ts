import { readConfig } from "./config";
import { buildApp } from "./app";
import { ZodError } from "zod";
async function main() {
  const config = readConfig();
  const app = await buildApp(config);
  try {
    await app.listen({ host: config.HOST, port: config.PORT });
  } catch (error) {
    await app.close();
    throw error;
  }
  console.log(
    `StepIn API listening on ${config.HOST}:${config.PORT}. Provider access is not verified by startup.`,
  );
  const stop = async () => {
    await app.close();
    process.exit(0);
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}
main().catch((error: unknown) => {
  if ((error as NodeJS.ErrnoException | null)?.code === "EADDRINUSE") {
    console.error(
      "StepIn API could not start because its port is already in use. Another backend may already be running. Check its /health endpoint; stop that process before restarting, or choose a different PORT in .env and update the app's Backend URL.",
    );
  } else if (error instanceof ZodError) {
    const fields = [
      ...new Set(error.issues.map((issue) => issue.path.join("."))),
    ].join(", ");
    console.error(
      `Invalid server configuration. Check these .env fields: ${fields}.`,
    );
  } else {
    console.error(
      "StepIn API could not start. Check server configuration and port availability.",
    );
  }
  process.exitCode = 1;
});
