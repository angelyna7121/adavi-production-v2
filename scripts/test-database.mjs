import { spawn, spawnSync } from "node:child_process";
import { randomUUID, randomBytes } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const image =
  "postgres:17-alpine@sha256:eee6c6e1b0894fa4fe0075eb054af9fd1cf39a35321c2d4110626cfe506411fb";
const name = `adavi-test-${randomUUID()}`,
  directory = await mkdtemp(join(tmpdir(), "adavi-db-"));
function docker(args) {
  const result = spawnSync("docker", args, { encoding: "utf8" });
  if (result.error || result.status !== 0)
    throw new Error(
      "Docker test database operation failed. Ensure Docker is available.",
    );
  return result.stdout.trim();
}
async function run(args, environment) {
  return new Promise((resolve, reject) => {
    const child = spawn("npm", args, { env: environment, stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => resolve(code ?? 1));
  });
}
let exitCode = 1;
try {
  const password = randomBytes(32).toString("hex"),
    file = join(directory, "postgres.env");
  await writeFile(
    file,
    `POSTGRES_PASSWORD=${password}\nPOSTGRES_DB=adavi_test\n`,
    { mode: 0o600 },
  );
  docker([
    "run",
    "--rm",
    "-d",
    "--name",
    name,
    "--env-file",
    file,
    "-p",
    "127.0.0.1::5432",
    image,
  ]);
  let ready = false;
  for (let attempt = 0; attempt < 80; attempt++) {
    const result = spawnSync(
      "docker",
      ["exec", name, "pg_isready", "-U", "postgres", "-d", "adavi_test"],
      { stdio: "ignore" },
    );
    if (result.status === 0) {
      ready = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!ready) throw new Error("Test database did not become ready.");
  const port = docker(["port", name, "5432/tcp"]).split(":").at(-1);
  const url = `postgresql://postgres:${password}@127.0.0.1:${port}/adavi_test`;
  const environment = {
    ...process.env,
    DATABASE_URL: url,
    DATABASE_MIGRATION_URL: url,
    RUN_DATABASE_TESTS: "1",
    NODE_ENV: "test",
    APP_DATA_ENV: "development",
    STRIPE_MODE: "test",
    FINANCIAL_ANALYSIS_MODE: "disabled",
  };
  for (const key of Object.keys(environment))
    if (
      /^(?:CLERK_SECRET_KEY|OPENAI_|STRIPE_SECRET_KEY|STRIPE_WEBHOOK_SECRET)/.test(
        key,
      )
    )
      delete environment[key];
  console.log(
    "Running migrations and tests against an isolated disposable PostgreSQL database.",
  );
  const migrated = await run(["run", "db:migrate"], environment);
  exitCode = migrated === 0 ? await run(["test"], environment) : migrated;
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "Database test setup failed.",
  );
} finally {
  spawnSync("docker", ["rm", "-f", name], { stdio: "ignore" });
  await rm(directory, { recursive: true, force: true });
}
process.exitCode = exitCode;
