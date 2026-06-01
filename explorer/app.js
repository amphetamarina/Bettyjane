const REFRESH_MS = 8000;

const els = {
  network: document.getElementById("network"),
  address: document.getElementById("address"),
  memories: document.getElementById("memories"),
  status: document.getElementById("status"),
};

async function refresh() {
  try {
    const response = await fetch("/api/memories");
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    render(data);
  } catch (error) {
    els.memories.innerHTML = "";
    const div = document.createElement("div");
    div.className = "error";
    div.textContent = `Could not read the chain: ${error.message}`;
    els.memories.append(div);
  }
}

function render(data) {
  els.network.textContent = data.network;
  els.address.textContent = data.address;

  const pins = data.memories.filter((m) => m.kind === "pin");
  const memories = data.memories.filter((m) => m.kind !== "pin");
  const ordered = [...pins, ...memories];

  els.memories.innerHTML = "";
  if (ordered.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "No live memories at this address yet.";
    els.memories.append(empty);
  } else {
    for (const memory of ordered) els.memories.append(card(memory));
  }

  els.status.textContent = `${pins.length} pin(s), ${memories.length} memory(ies) · refreshed ${timestamp()}`;
}

function card(memory) {
  const el = document.createElement("article");
  el.className = `card ${memory.kind}`;

  const row = document.createElement("div");
  row.className = "row";
  row.append(
    tag(memory.kind, memory.kind),
    tag(memory.confirmed ? "live" : "spent", memory.confirmed ? "live" : "pending"),
  );
  const author = document.createElement("span");
  author.className = "author";
  author.textContent = memory.author === "human" ? "human · durable pin" : "agent · working memory";
  row.append(author);
  el.append(row);

  const content = document.createElement("div");
  if (memory.content.type === "text") {
    content.className = "content";
    content.textContent = memory.content.text;
  } else {
    content.className = "content pointer";
    content.textContent = `pointer ${memory.content.pointerHex}`;
  }
  el.append(content);

  if (memory.content.type === "text" && memory.content.viaPointer) {
    const note = document.createElement("div");
    note.className = "viapointer";
    note.textContent = "↳ stored across multiple coins";
    el.append(note);
  }

  const meta = document.createElement("div");
  meta.className = "meta";
  const outpoint = document.createElement("span");
  outpoint.className = "outpoint";
  outpoint.textContent = memory.outpoint;
  meta.append(outpoint, document.createTextNode(` · ${memory.sats} sats`));
  if (memory.explorerUrl) {
    meta.append(document.createTextNode(" · "));
    const link = document.createElement("a");
    link.href = memory.explorerUrl;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = "view tx";
    meta.append(link);
  }
  el.append(meta);

  return el;
}

function tag(kind, label) {
  const el = document.createElement("span");
  el.className = `tag ${kind}`;
  el.textContent = label;
  return el;
}

function timestamp() {
  return new Date().toLocaleTimeString();
}

refresh();
setInterval(refresh, REFRESH_MS);
