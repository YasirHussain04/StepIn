import { readConfig } from "./config";
import { buildApp } from "./app";
async function main() {
  const config = readConfig();
  const app = await buildApp(config);
  await app.listen({ host: config.HOST, port: config.PORT });
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
main().catch(() => {
  console.error(
    "StepIn API could not start. Check server configuration and port availability.",
  );
  process.exitCode = 1;
});
