import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import { Client } from "pg";
import { assertTestDatabaseTarget } from "./support/assert-test-target";
import {
  minimalChildEnv,
  REPO_ROOT,
  runNpmScript,
} from "./support/test-helpers";

// P6-8a (#294, PR #346 review round 2 and 3): regression coverage for the route-snapshot migrations on a REAL PostgreSQL, including a
// database that already holds data from the round-1 snapshot migration. Like the other migration suites this RESETS the guarded test
// database and leaves it fully migrated for the specs that follow.
describe("P6-8a — route snapshot migrations on a database with older data", () => {
  const migrationsDir = path.join(REPO_ROOT, "database", "migrations");
  const names = readdirSync(migrationsDir)
    .filter((file) => file.endsWith(".sql"))
    .sort()
    .map((file) => file.replace(/\.sql$/, ""));
  const ROUND1 = names.find((name) =>
    name.endsWith("_route-snapshots"),
  ) as string;
  const ROUND2 = names.find((name) =>
    name.endsWith("_route-snapshots-review-round2"),
  ) as string;
  const BEFORE_ROUND2 = names.slice(0, names.indexOf(ROUND2));
  const CONTENT_KEY_SQL =
    "encode(sha256(convert_to(route_version || '|' || distance_m::text || '|' || duration_s::text || '|' || geometry, 'UTF8')), 'hex')";
  const PURGE = "app.purge_unreferenced_route_snapshots(interval)";
  const databaseUrl = process.env.DATABASE_URL;
  let client: Client;

  function migrate(extra: string[] = []): ReturnType<typeof runNpmScript> {
    return runNpmScript(
      "db:migrate",
      extra,
      minimalChildEnv({ APP_ENV: "test", DATABASE_URL: databaseUrl }),
    );
  }

  async function reset(): Promise<void> {
    await assertTestDatabaseTarget(client);
    await client.query("DROP SCHEMA IF EXISTS app CASCADE");
    await client.query("DROP TABLE IF EXISTS public.pgmigrations");
  }

  async function historyNames(): Promise<string[]> {
    const result = await client.query<{ name: string }>(
      "SELECT name FROM public.pgmigrations ORDER BY id",
    );
    return result.rows.map((row) => row.name);
  }

  async function insertSnapshot(
    id: string,
    version: string,
    distance: number,
    geometry = "a_b",
  ): Promise<void> {
    // Round 1 has no content_key: a row written before round 2 is exactly this shape.
    await client.query(
      `INSERT INTO app.route_snapshots (id, route_version, distance_m, duration_s, geometry)
       VALUES ($1::uuid, $2, $3, 600, $4)`,
      [id, version, distance, geometry],
    );
  }

  async function triggerEnabled(name: string): Promise<string | undefined> {
    const result = await client.query<{ tgenabled: string }>(
      "SELECT tgenabled FROM pg_trigger WHERE tgname = $1 AND tgrelid = 'app.route_snapshots'::regclass",
      [name],
    );
    return result.rows[0]?.tgenabled;
  }

  beforeAll(async () => {
    client = new Client({ connectionString: databaseUrl });
    await client.connect();
    await assertTestDatabaseTarget(client);
  });

  afterAll(async () => {
    try {
      const result = migrate();
      if (result.status !== 0) {
        throw new Error("could not restore the migrated test database");
      }
    } finally {
      await client.end();
    }
  });

  it("round 2 is the migration right after round 1 (applied migrations are never edited)", () => {
    expect(ROUND1).toBeDefined();
    expect(ROUND2).toBeDefined();
    expect(BEFORE_ROUND2[BEFORE_ROUND2.length - 1]).toBe(ROUND1);
  });

  it("an upgrade from round 1 with distinct legacy snapshots: content_key is backfilled exactly as the trigger computes it, rows are unchanged", async () => {
    await reset();
    expect(migrate([String(BEFORE_ROUND2.length)]).status).toBe(0);
    const a = "6f1d7a52-0000-4000-8000-000000000001";
    const b = "6f1d7a52-0000-4000-8000-000000000002";
    await insertSnapshot(a, "legacy-a", 1200);
    await insertSnapshot(b, "legacy-b", 3400, "other_geometry");
    expect(migrate().status).toBe(0);
    expect(await historyNames()).toEqual(names);
    const rows = await client.query<{
      id: string;
      distance_m: number;
      ok: boolean;
    }>(
      `SELECT id::text, distance_m, content_key = ${CONTENT_KEY_SQL} AS ok FROM app.route_snapshots ORDER BY distance_m`,
    );
    expect(rows.rows).toEqual([
      { id: a, distance_m: 1200, ok: true },
      { id: b, distance_m: 3400, ok: true },
    ]);
    expect(await triggerEnabled("route_snapshots_append_only")).toBe("O");
  });

  it("after the upgrade the content identity holds for new rows and the append-only trigger still refuses UPDATE and DELETE", async () => {
    // Same content as a legacy row: the repository's INSERT ... ON CONFLICT DO NOTHING reuses it, no second row.
    const again = await client.query(
      `INSERT INTO app.route_snapshots (id, route_version, distance_m, duration_s, geometry)
       VALUES (gen_random_uuid(), 'legacy-a', 1200, 600, 'a_b') ON CONFLICT DO NOTHING`,
    );
    expect(again.rowCount).toBe(0);
    await expect(
      client.query(`INSERT INTO app.route_snapshots (id, route_version, distance_m, duration_s, geometry)
       VALUES (gen_random_uuid(), 'legacy-a', 1200, 600, 'a_b')`),
    ).rejects.toThrow(/route_snapshots_content_key_uidx|unique/);
    await expect(
      client.query(
        "UPDATE app.route_snapshots SET duration_s = duration_s + 1",
      ),
    ).rejects.toThrow(/append-only/);
    await expect(
      client.query("DELETE FROM app.route_snapshots"),
    ).rejects.toThrow(/append-only/);
    expect(
      (await client.query("SELECT count(*)::int AS n FROM app.route_snapshots"))
        .rows[0],
    ).toEqual({ n: 2 });
  });

  it("runtime grants: a disposable role built from ops/selfhosted 02 + 03 can EXECUTE the purge, cannot DELETE route_snapshots, and PUBLIC cannot EXECUTE", async () => {
    // The real runtime role (ship11_app) is not created here. Its grants come from the same two files the operator runs, applied to a
    // throw-away NOLOGIN role; the role is dropped afterwards. Removing the GRANT EXECUTE line for the purge from 03 makes this fail.
    const probe = `p68a_probe_${randomBytes(6).toString("hex")}`;
    const grantScripts = [
      "02-runtime-grants.sql",
      "03-runtime-function-grants.sql",
    ]
      .map((file) =>
        readFileSync(path.join(REPO_ROOT, "ops", "selfhosted", file), "utf8"),
      )
      .join("\n")
      .replace(/\bship11_app\b/g, probe);
    await client.query(`CREATE ROLE ${probe} NOLOGIN`);
    try {
      await client.query(grantScripts);
      const result = await client.query<{
        exec: boolean;
        insert: boolean;
        del: boolean;
        public_exec: boolean;
      }>(
        `SELECT has_function_privilege($1, '${PURGE}', 'EXECUTE') AS exec,
                has_table_privilege($1, 'app.route_snapshots', 'INSERT') AS insert,
                has_table_privilege($1, 'app.route_snapshots', 'DELETE') AS del,
                has_function_privilege('public', '${PURGE}', 'EXECUTE') AS public_exec`,
        [probe],
      );
      expect(result.rows[0]).toEqual({
        exec: true,
        insert: true,
        del: false,
        public_exec: false,
      });
    } finally {
      await client.query(`DROP OWNED BY ${probe}`);
      await client.query(`DROP ROLE ${probe}`);
    }
  }, 180_000);

  it("a database that already holds DUPLICATE round-1 content: round 2 refuses, rolls back as a whole, and round 1 stays exactly as it was", async () => {
    await reset();
    expect(migrate([String(BEFORE_ROUND2.length)]).status).toBe(0);
    await insertSnapshot("6f1d7a52-0000-4000-8000-0000000000a1", "dup", 500);
    await insertSnapshot("6f1d7a52-0000-4000-8000-0000000000a2", "dup", 500);
    const failed = migrate();
    expect(failed.status).not.toBe(0);
    // Fail closed: no history row for round 2, no content_key column, the append-only trigger enabled again, both rows kept.
    expect(await historyNames()).toEqual(BEFORE_ROUND2);
    const column = await client.query(
      "SELECT 1 FROM information_schema.columns WHERE table_schema = 'app' AND table_name = 'route_snapshots' AND column_name = 'content_key'",
    );
    expect(column.rowCount).toBe(0);
    expect(await triggerEnabled("route_snapshots_append_only")).toBe("O");
    expect(
      (await client.query("SELECT count(*)::int AS n FROM app.route_snapshots"))
        .rows[0],
    ).toEqual({ n: 2 });
  }, 180_000);

  it("the documented remedy works: after the duplicate is removed by hand, round 2 applies once and a second up is a no-op", async () => {
    // The migrator owns the table in the test database; the append-only trigger is lifted only for this repair step.
    await client.query(
      "ALTER TABLE app.route_snapshots DISABLE TRIGGER route_snapshots_append_only",
    );
    await client.query(
      "DELETE FROM app.route_snapshots WHERE id = '6f1d7a52-0000-4000-8000-0000000000a2'",
    );
    await client.query(
      "ALTER TABLE app.route_snapshots ENABLE TRIGGER route_snapshots_append_only",
    );
    expect(migrate().status).toBe(0);
    expect(await historyNames()).toEqual(names);
    const before = await client.query(
      "SELECT name, run_on FROM public.pgmigrations ORDER BY id",
    );
    expect(migrate().status).toBe(0);
    expect(
      (
        await client.query(
          "SELECT name, run_on FROM public.pgmigrations ORDER BY id",
        )
      ).rows,
    ).toEqual(before.rows);
    expect(
      (
        await client.query(
          "SELECT count(*)::int AS n FROM app.route_snapshots WHERE content_key IS NULL",
        )
      ).rows[0],
    ).toEqual({ n: 0 });
  }, 180_000);
});
