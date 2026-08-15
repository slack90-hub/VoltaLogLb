const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store, max-age=0",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

function hasSameOrigin(request) {
  const origin = request.headers.get("origin");
  return origin === new URL(request.url).origin;
}

async function ensureSchema(db) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS murex_reveals (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      total INTEGER NOT NULL DEFAULT 0 CHECK (total >= 0),
      last_revealed_at TEXT
    )
  `).run();
}

export async function onRequestPost({ request, env }) {
  if (!env.DB) {
    return json({ error: "Shared storage is not connected yet." }, 503);
  }

  if (!hasSameOrigin(request)) {
    return json({ error: "This request must come from the celebration page." }, 403);
  }

  try {
    await ensureSchema(env.DB);
    const result = await env.DB.prepare(`
      INSERT INTO murex_reveals (id, total, last_revealed_at)
      VALUES (1, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      ON CONFLICT(id) DO UPDATE SET
        total = total + 1,
        last_revealed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      RETURNING total, last_revealed_at
    `).first();

    return json({ reveal: result }, 201);
  } catch (error) {
    console.error("Unable to record Murex reveal", error);
    return json({ error: "Reveal could not be recorded right now." }, 500);
  }
}
