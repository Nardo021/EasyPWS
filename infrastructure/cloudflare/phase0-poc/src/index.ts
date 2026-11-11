export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
}

async function nodeSqliteProbe(): Promise<string> {
  try {
    const sqlite = await import("node:sqlite");
    const DatabaseSync = sqlite.DatabaseSync;
    if (typeof DatabaseSync !== "function") {
      return "module imported; DatabaseSync export missing";
    }
    const db = new DatabaseSync(":memory:");
    db.prepare("SELECT 1 AS ok").get();
    db.close();
    return "DatabaseSync memory query succeeded";
  } catch (error) {
    return error instanceof Error ? error.message : "import failed";
  }
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/api/v1/health") {
      const row = await env.DB.prepare(
        "SELECT COUNT(*) AS n FROM probe_events",
      ).first<{ n: number }>();
      const due = await env.DB.prepare(
        "SELECT COUNT(*) AS n FROM probe_jobs WHERE status = 'queued'",
      ).first<{ n: number }>();
      return Response.json({
        ok: true,
        runtime: "workerd-local",
        probeEvents: row?.n ?? null,
        queuedJobs: due?.n ?? null,
        nodeSqlite: await nodeSqliteProbe(),
      });
    }
    if (url.pathname === "/api/v1/jobs/claim") {
      const job = await env.DB.prepare(
        "SELECT id FROM probe_jobs WHERE status = 'queued' ORDER BY id LIMIT 1",
      ).first<{ id: string }>();
      if (!job) {
        return Response.json({ claimed: null });
      }
      await env.DB.prepare(
        "UPDATE probe_jobs SET status = 'done', attempts = attempts + 1 WHERE id = ? AND status = 'queued'",
      )
        .bind(job.id)
        .run();
      return Response.json({ claimed: job.id });
    }
    return env.ASSETS.fetch(request);
  },

  async scheduled(_controller, env, ctx): Promise<void> {
    ctx.waitUntil(
      env.DB.prepare(
        "INSERT INTO probe_events (kind, created_at) VALUES ('cron', ?)",
      )
        .bind(new Date().toISOString())
        .run(),
    );
  },
} satisfies ExportedHandler<Env>;
