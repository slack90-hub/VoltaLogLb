const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store, max-age=0",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

async function ensureSchema(db) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS murex_notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      author TEXT NOT NULL CHECK (author IN ('Nad', 'Maria')),
      message TEXT NOT NULL CHECK (length(message) BETWEEN 1 AND 5000),
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    )
  `).run();
}

function hasSameOrigin(request) {
  const origin = request.headers.get("origin");
  return origin === new URL(request.url).origin;
}

export async function onRequestGet({ env }) {
  if (!env.DB) {
    return json({ error: "Shared storage is not connected yet." }, 503);
  }

  try {
    await ensureSchema(env.DB);
    const result = await env.DB.prepare(`
      SELECT id, author, message, created_at
      FROM murex_notes
      ORDER BY id DESC
      LIMIT 200
    `).all();

    return json({ notes: result.results || [] });
  } catch (error) {
    console.error("Unable to read Murex notes", error);
    return json({ error: "Notes could not be loaded right now." }, 500);
  }
}

export async function onRequestPost({ request, env }) {
  if (!env.DB) {
    return json({ error: "Shared storage is not connected yet." }, 503);
  }

  if (!hasSameOrigin(request)) {
    return json({ error: "This request must come from the shared page." }, 403);
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "Invalid note data." }, 400);
  }

  const author = typeof payload.author === "string" ? payload.author.trim() : "";
  const message = typeof payload.message === "string" ? payload.message.trim() : "";

  if (!['Nad', 'Maria'].includes(author)) {
    return json({ error: "Choose who is writing this note." }, 400);
  }

  if (!message || message.length > 5000) {
    return json({ error: "Write a note between 1 and 5,000 characters." }, 400);
  }

  try {
    await ensureSchema(env.DB);
    const inserted = await env.DB.prepare(`
      INSERT INTO murex_notes (author, message)
      VALUES (?, ?)
      RETURNING id, author, message, created_at
    `).bind(author, message).first();

    return json({ note: inserted }, 201);
  } catch (error) {
    console.error("Unable to save Murex note", error);
    return json({ error: "Your note could not be saved right now." }, 500);
  }
}
