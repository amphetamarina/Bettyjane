const REFRESH_MS = 8000;
const STORAGE_KEY = "bettyjane-explorer";

const els = {
  form: document.getElementById("controls"),
  agent: document.getElementById("agent"),
  human: document.getElementById("human"),
  network: document.getElementById("network"),
  agentStack: document.getElementById("agent-stack"),
  humanStack: document.getElementById("human-stack"),
  agentCount: document.getElementById("agent-count"),
  humanCount: document.getElementById("human-count"),
  status: document.getElementById("status"),
};

function loadConfig() {
  const params = new URLSearchParams(location.search);
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
  } catch {
    saved = {};
  }
  return {
    agent: params.get("agent") ?? saved.agent ?? "",
    human: params.get("human") ?? saved.human ?? "",
    network: params.get("network") ?? saved.network ?? "mainnet",
  };
}

function saveConfig(config) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  const params = new URLSearchParams();
  if (config.agent) params.set("agent", config.agent);
  if (config.human) params.set("human", config.human);
  params.set("network", config.network);
  history.replaceState(null, "", `${location.pathname}?${params.toString()}`);
}

function currentConfig() {
  return {
    agent: els.agent.value.trim(),
    human: els.human.value.trim(),
    network: els.network.value,
  };
}

async function fetchAddress(address, network) {
  const query = new URLSearchParams({ address, network });
  const response = await fetch(`/api/memories?${query.toString()}`);
  const body = await response.text();
  let data;
  try {
    data = JSON.parse(body);
  } catch {
    throw new Error(body.trim().slice(0, 140) || `HTTP ${response.status}`);
  }
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data.memories;
}

function renderColumn(stack, countEl, address, network, label) {
  if (!address) {
    stack.innerHTML = "";
    countEl.textContent = "";
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = `Enter an address to see ${label}.`;
    stack.append(empty);
    return Promise.resolve(0);
  }
  return fetchAddress(address, network)
    .then((memories) => {
      stack.innerHTML = "";
      countEl.textContent = `${memories.length} live · ${shorten(address)}`;
      if (memories.length === 0) {
        const empty = document.createElement("div");
        empty.className = "empty";
        empty.textContent = `No live ${label} at this address yet.`;
        stack.append(empty);
      } else {
        for (const memory of memories) stack.append(card(memory));
      }
      return memories.length;
    })
    .catch((error) => {
      stack.innerHTML = "";
      countEl.textContent = "";
      const div = document.createElement("div");
      div.className = "error";
      div.textContent = `Could not read the chain: ${error.message}`;
      stack.append(div);
      return 0;
    });
}

async function refresh() {
  const config = currentConfig();
  const [pins, memories] = await Promise.all([
    renderColumn(els.humanStack, els.humanCount, config.human, config.network, "pins"),
    renderColumn(els.agentStack, els.agentCount, config.agent, config.network, "memories"),
  ]);
  els.status.textContent = `${pins} pin(s) · ${memories} memory(ies) · ${config.network} · refreshed ${timestamp()}`;
}

function shorten(address) {
  const body = address.includes(":") ? address.split(":")[1] : address;
  return body.length > 16 ? `${body.slice(0, 8)}…${body.slice(-6)}` : body;
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
  if (memory.authorVerified) row.append(tag("signed", "signed"));
  if (memory.content.type === "encrypted") row.append(tag("encrypted", "encrypted"));
  const author = document.createElement("span");
  author.className = "author";
  author.textContent =
    memory.kind === "consensus"
      ? "team · 2-of-2 consensus"
      : memory.kind === "pin"
        ? "human · durable pin"
        : "agent · working memory";
  row.append(author);
  el.append(row);

  const content = document.createElement("div");
  if (memory.content.type === "text") {
    content.className = "content";
    content.textContent = memory.content.text;
  } else if (memory.content.type === "encrypted") {
    content.className = "content encrypted";
    content.textContent = "encrypted — readable only with the key";
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

let timer = null;
function startPolling() {
  if (timer) clearInterval(timer);
  refresh();
  timer = setInterval(refresh, REFRESH_MS);
}

els.form.addEventListener("submit", (event) => {
  event.preventDefault();
  saveConfig(currentConfig());
  startPolling();
});

const initial = loadConfig();
els.agent.value = initial.agent;
els.human.value = initial.human;
els.network.value = initial.network;
saveConfig(initial);
startPolling();
