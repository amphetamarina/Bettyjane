const REFRESH_MS = 8000;
const STORAGE_KEY = "bettyjane-explorer";

const els = {
  form: document.getElementById("controls"),
  agent: document.getElementById("agent"),
  human: document.getElementById("human"),
  network: document.getElementById("network"),
  showSpent: document.getElementById("show-spent"),
  agentStack: document.getElementById("agent-stack"),
  humanStack: document.getElementById("human-stack"),
  agentCount: document.getElementById("agent-count"),
  humanCount: document.getElementById("human-count"),
  status: document.getElementById("status"),
  tabs: document.getElementById("tabs"),
  viewExplore: document.getElementById("view-explore"),
  viewDiscover: document.getElementById("view-discover"),
  discoverControls: document.getElementById("discover-controls"),
  discoverNetwork: document.getElementById("discover-network"),
  discoverCount: document.getElementById("discover-count"),
  discoverStack: document.getElementById("discover-stack"),
};

function make(tagName, className, text) {
  const node = document.createElement(tagName);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function tag(name, label) {
  return make("span", `tag ${name}`, label);
}

function txLink(href, text) {
  const link = make("a", null, text);
  link.href = href;
  link.target = "_blank";
  link.rel = "noreferrer";
  return link;
}

async function fetchJson(url) {
  const response = await fetch(url);
  const body = await response.text();
  let data;
  try {
    data = JSON.parse(body);
  } catch {
    throw new Error(body.trim().slice(0, 140) || `HTTP ${response.status}`);
  }
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

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
    showSpent: (params.get("all") ?? (saved.showSpent ? "1" : "")) === "1",
  };
}

function saveConfig(config) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  const params = new URLSearchParams();
  if (config.agent) params.set("agent", config.agent);
  if (config.human) params.set("human", config.human);
  params.set("network", config.network);
  if (config.showSpent) params.set("all", "1");
  history.replaceState(null, "", `${location.pathname}?${params.toString()}`);
}

function currentConfig() {
  return {
    agent: els.agent.value.trim(),
    human: els.human.value.trim(),
    network: els.network.value,
    showSpent: els.showSpent.checked,
  };
}

async function fetchAddress(address, network, showSpent) {
  const query = new URLSearchParams({ address, network });
  if (showSpent) query.set("all", "1");
  return (await fetchJson(`/api/memories?${query.toString()}`)).memories;
}

async function fetchDiscover(network) {
  const query = new URLSearchParams({ network });
  return (await fetchJson(`/api/discover?${query.toString()}`)).memories;
}

function renderColumn(stack, countEl, address, network, label, showSpent) {
  if (!address) {
    stack.innerHTML = "";
    countEl.textContent = "";
    stack.append(make("div", "empty", `Enter an address to see ${label}.`));
    return Promise.resolve(0);
  }
  return fetchAddress(address, network, showSpent)
    .then((memories) => {
      stack.innerHTML = "";
      const live = memories.filter((m) => !m.spent).length;
      countEl.textContent = showSpent
        ? `${live} live · ${memories.length} total · ${shorten(address)}`
        : `${memories.length} live · ${shorten(address)}`;
      if (memories.length === 0) {
        stack.append(make("div", "empty", `No ${label} at this address yet.`));
      } else {
        for (const memory of memories) stack.append(card(memory));
      }
      return live;
    })
    .catch((error) => {
      stack.innerHTML = "";
      countEl.textContent = "";
      stack.append(make("div", "error", `Could not read the chain: ${error.message}`));
      return 0;
    });
}

async function refresh() {
  const config = currentConfig();
  const [pins, memories] = await Promise.all([
    renderColumn(els.humanStack, els.humanCount, config.human, config.network, "pins", config.showSpent),
    renderColumn(els.agentStack, els.agentCount, config.agent, config.network, "memories", config.showSpent),
  ]);
  const scope = config.showSpent ? " · including spent" : "";
  els.status.textContent = `${pins} pin(s) · ${memories} memory(ies) · ${config.network}${scope} · refreshed ${timestamp()}`;
}

function shorten(address) {
  const body = address.includes(":") ? address.split(":")[1] : address;
  return body.length > 16 ? `${body.slice(0, 8)}…${body.slice(-6)}` : body;
}

function authorLabel(kind) {
  if (kind === "consensus") return "team · 2-of-2 consensus";
  if (kind === "pin") return "human · durable pin";
  return "agent · working memory";
}

function statusRow(memory, { signed }) {
  const row = make("div", "row");
  row.append(tag(memory.kind, memory.kind));
  if (memory.spent) row.append(tag("forgotten", "forgotten"));
  else row.append(tag(memory.confirmed ? "live" : "pending", memory.confirmed ? "live" : "pending"));
  if (signed && memory.authorVerified) row.append(tag("signed", "signed"));
  if (memory.content.type === "encrypted") row.append(tag("encrypted", "encrypted"));
  return row;
}

function contentEl(content) {
  if (content.type === "text") return make("div", "content", content.text);
  if (content.type === "encrypted") return make("div", "content encrypted", "encrypted, readable only with the key");
  const pointer = content.pointerHex ? `pointer ${content.pointerHex}` : "pointer (stored across multiple coins)";
  return make("div", "content pointer", pointer);
}

function card(memory) {
  const el = make("article", `card ${memory.kind}${memory.spent ? " forgotten" : ""}`);

  const row = statusRow(memory, { signed: true });
  row.append(make("span", "author", authorLabel(memory.kind)));
  el.append(row);

  el.append(contentEl(memory.content));
  if (memory.content.type === "text" && memory.content.viaPointer) {
    el.append(make("div", "viapointer", "↳ stored across multiple coins"));
  }

  const meta = make("div", "meta");
  meta.append(make("span", "outpoint", memory.outpoint), document.createTextNode(` · ${memory.sats} sats`));
  if (memory.explorerUrl) {
    meta.append(document.createTextNode(" · "), txLink(memory.explorerUrl, "view tx"));
  }
  el.append(meta);

  return el;
}

function discoverCard(memory) {
  const el = make("article", `card ${memory.kind}${memory.spent ? " forgotten" : ""}`);

  const who = make("div", "who");
  who.append(memory.explorerUrl ? txLink(memory.explorerUrl, memory.address) : document.createTextNode(memory.address));
  el.append(who);

  el.append(statusRow(memory, { signed: false }));
  el.append(contentEl(memory.content));

  return el;
}

function timestamp() {
  return new Date().toLocaleTimeString();
}

async function refreshDiscover() {
  const network = els.discoverNetwork.value;
  els.discoverStack.innerHTML = "";
  els.discoverCount.textContent = "scanning the chain…";
  try {
    const memories = await fetchDiscover(network);
    const addresses = new Set(memories.map((m) => m.address)).size;
    const live = memories.filter((m) => !m.spent).length;
    els.discoverCount.textContent = `${memories.length} memories · ${live} live · ${addresses} address(es) · ${network}`;
    els.discoverStack.innerHTML = "";
    if (memories.length === 0) {
      els.discoverStack.append(make("div", "empty", "No Bettyjane memories found on this network yet."));
    } else {
      for (const memory of memories) els.discoverStack.append(discoverCard(memory));
    }
  } catch (error) {
    els.discoverCount.textContent = "";
    els.discoverStack.append(make("div", "error", `Could not read the chain: ${error.message}`));
  }
}

function showView(view) {
  const discover = view === "discover";
  els.viewExplore.hidden = discover;
  els.viewDiscover.hidden = !discover;
  for (const tab of els.tabs.querySelectorAll(".tab")) {
    tab.classList.toggle("active", tab.dataset.view === view);
  }
  if (discover && !els.discoverStack.childElementCount) refreshDiscover();
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

els.showSpent.addEventListener("change", () => {
  saveConfig(currentConfig());
  startPolling();
});

els.tabs.addEventListener("click", (event) => {
  const tab = event.target.closest(".tab");
  if (tab) showView(tab.dataset.view);
});

els.discoverControls.addEventListener("submit", (event) => {
  event.preventDefault();
  refreshDiscover();
});

const initial = loadConfig();
els.agent.value = initial.agent;
els.human.value = initial.human;
els.network.value = initial.network;
els.discoverNetwork.value = initial.network;
els.showSpent.checked = initial.showSpent;
saveConfig(initial);
startPolling();
