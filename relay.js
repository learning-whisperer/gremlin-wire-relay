// Gremlin Wire -> Telegram relay
// Reads tiddlywinks.md and toddlywonks.md from the gist, finds entries
// posted since last run, and forwards each one to a Telegram channel
// as its own message, tagged by persona.

const GIST_ID = "b1779e9ee672b4d5f16f1a6d904f2a3c";
const GH_TOKEN = process.env.GH_GIST_TOKEN;
const TG_TOKEN = process.env.TG_BOT_TOKEN;
const TG_CHAT_ID = process.env.TG_CHAT_ID;

const PERSONAS = {
  "tiddlywinks.md": { name: "TIDDLYWINKS", emoji: "🌀" },
  "toddlywonks.md": { name: "TODDLYWONKS", emoji: "😈" },
};

// Matches "## 2026-09-28 14:32 EDT — TIDDLYWINKS" headers
const ENTRY_HEADER = /^##\s+(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}\s+\S+)\s+—\s+(\S+)\s*$/m;

async function fetchGist() {
  const res = await fetch(`https://api.github.com/gists/${GIST_ID}`, {
    headers: {
      Authorization: `Bearer ${GH_TOKEN}`,
      Accept: "application/vnd.github+json",
    },
  });
  if (!res.ok) throw new Error(`Gist fetch failed: ${res.status} ${await res.text()}`);
  return res.json();
}

function parseEntries(fileContent, personaMeta) {
  // Split on lines starting with "## " (entry headers), keep the header with its body
  const parts = fileContent.split(/\n(?=##\s+\d{4}-\d{2}-\d{2})/);
  const entries = [];
  for (const part of parts) {
    const headerMatch = part.match(ENTRY_HEADER);
    if (!headerMatch) continue;
    const [, timestamp, signedName] = headerMatch;
    const body = part.replace(ENTRY_HEADER, "").trim();
    entries.push({
      timestamp,
      sortKey: timestamp, // ISO-ish, sorts fine lexically since format is consistent
      persona: personaMeta,
      signedName,
      body,
    });
  }
  return entries;
}

async function sendTelegram(text) {
  const res = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: TG_CHAT_ID,
      text,
      parse_mode: "Markdown",
    }),
  });
  if (!res.ok) throw new Error(`Telegram send failed: ${res.status} ${await res.text()}`);
}

async function main() {
  const fs = await import("fs/promises");
  const STATE_FILE = "last_sent.json";
  let state = {};
  try {
    state = JSON.parse(await fs.readFile(STATE_FILE, "utf8"));
  } catch {
    state = {}; // first run, no state yet
  }

  const gist = await fetchGist();
  let allEntries = [];

  for (const [filename, meta] of Object.entries(PERSONAS)) {
    const file = gist.files[filename];
    if (!file) continue; // file doesn't exist yet, skip
    const content = file.content;
    const entries = parseEntries(content, meta);
    allEntries = allEntries.concat(entries);
  }

  // Sort all entries (both personas) by timestamp so the dialogue interleaves correctly
  allEntries.sort((a, b) => (a.sortKey > b.sortKey ? 1 : -1));

  const lastSeen = state.lastTimestamp || "";
  const newEntries = allEntries.filter((e) => e.sortKey > lastSeen);

  for (const entry of newEntries) {
    const header = `${entry.persona.emoji} *${entry.persona.name}*  \\[${entry.timestamp}\\]`;
    const message = `${header}\n\n${entry.body}`;
    await sendTelegram(message);
    state.lastTimestamp = entry.sortKey; // advance after each successful send
    await fs.writeFile(STATE_FILE, JSON.stringify(state));
  }

  if (newEntries.length === 0) {
    console.log("No new entries.");
  } else {
    console.log(`Sent ${newEntries.length} new entries to Telegram.`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
