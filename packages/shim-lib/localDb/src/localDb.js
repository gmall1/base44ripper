// localDb.js — injected by base44ripper into ejected projects.
//
// A schema-driven, localStorage-backed drop-in replacement for the Base44 SDK
// surface that your source code already talks to:
//
//   import { db } from '@/api/base44Client';
//   await db.auth.me();
//   await db.entities.Card.filter({ rarity: 'rare' });
//   await db.entities.Deck.create({ name: 'My deck' });
//   const off = db.entities.GameRoom.subscribe((event) => { ... });
//
// No network, no backend. All data lives in `localStorage` under a single
// namespaced key, so every browser tab gets a consistent view and everything
// keeps working offline.
//
// Cross-tab live updates use `window.addEventListener('storage', ...)`.
// Same-tab subscribers are notified via an in-memory EventTarget.
//
// To migrate to a real backend later, replace this file (keep the exported
// `db` shape) and your app keeps working unchanged.

const STORAGE_KEY = 'base44ripper:db:v1';
const SCHEMA_KEY = 'base44ripper:schemas:v1';

// Entity schemas are injected at codemod time by base44ripper. Importing the
// generated file avoids a circular dependency on the runtime while still
// letting each project ship its own list of entities.
import { entitySchemas } from './_entitySchemas.generated.js';

// ---------- storage primitives ----------

function hasLocalStorage() {
  try {
    return typeof localStorage !== 'undefined';
  } catch {
    return false;
  }
}

function loadAll() {
  if (!hasLocalStorage()) return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveAll(state) {
  if (!hasLocalStorage()) return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function loadTable(entityName) {
  const all = loadAll();
  return Array.isArray(all[entityName]) ? all[entityName] : [];
}

function saveTable(entityName, rows) {
  const all = loadAll();
  all[entityName] = rows;
  saveAll(all);
}

if (hasLocalStorage()) {
  try {
    localStorage.setItem(SCHEMA_KEY, JSON.stringify(entitySchemas));
  } catch {
    // Quota exceeded; ignore — schemas are a convenience for devtools.
  }
}

// ---------- pub/sub ----------

const sameTabBus = typeof EventTarget !== 'undefined' ? new EventTarget() : null;
const broadcastChannel =
  typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(STORAGE_KEY) : null;

function emitChange(entityName, event) {
  const detail = { entity: entityName, ...event };
  if (sameTabBus) {
    sameTabBus.dispatchEvent(new CustomEvent(`entity:${entityName}`, { detail }));
    sameTabBus.dispatchEvent(new CustomEvent('entity:*', { detail }));
  }
  if (broadcastChannel) {
    try {
      broadcastChannel.postMessage(detail);
    } catch {
      // postMessage can throw when payload isn't structured-clone-safe.
    }
  }
}

if (broadcastChannel) {
  broadcastChannel.addEventListener('message', (ev) => {
    if (!sameTabBus) return;
    const detail = ev.data;
    if (!detail || !detail.entity) return;
    sameTabBus.dispatchEvent(new CustomEvent(`entity:${detail.entity}`, { detail }));
    sameTabBus.dispatchEvent(new CustomEvent('entity:*', { detail }));
  });
}

// ---------- auth (single local user) ----------

const USER_KEY = 'base44ripper:user:v1';

function loadUser() {
  if (!hasLocalStorage()) return null;
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveUser(user) {
  if (!hasLocalStorage()) return;
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

function uuid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'id_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export const auth = {
  async me() {
    let user = loadUser();
    if (!user) {
      // Auto-provision a local user on first access so pages that assume
      // `user?.id` can immediately render something meaningful.
      user = {
        id: uuid(),
        email: 'local@localhost',
        full_name: 'Local Player',
        created_date: new Date().toISOString(),
      };
      saveUser(user);
    }
    return user;
  },
  async isAuthenticated() {
    return Boolean(loadUser());
  },
  async signIn(partial = {}) {
    const existing = loadUser() ?? {};
    const merged = {
      id: existing.id ?? uuid(),
      created_date: existing.created_date ?? new Date().toISOString(),
      ...existing,
      ...partial,
    };
    saveUser(merged);
    return merged;
  },
  async signOut() {
    if (hasLocalStorage()) localStorage.removeItem(USER_KEY);
  },
};

// ---------- entity API ----------

function matchesConditions(row, conditions) {
  for (const [key, value] of Object.entries(conditions)) {
    if (Array.isArray(value)) {
      if (!value.includes(row[key])) return false;
    } else if (row[key] !== value) {
      return false;
    }
  }
  return true;
}

function applyOrderAndLimit(rows, orderBy, limit) {
  let sorted = rows;
  if (orderBy) {
    const desc = orderBy.startsWith('-');
    const field = desc ? orderBy.slice(1) : orderBy;
    sorted = [...rows].sort((a, b) => {
      const av = a[field];
      const bv = b[field];
      if (av === bv) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return av > bv ? (desc ? -1 : 1) : desc ? 1 : -1;
    });
  }
  if (limit) sorted = sorted.slice(0, limit);
  return sorted;
}

function createEntityApi(entityName) {
  return {
    async list(orderBy = '-created_date', limit = null) {
      return applyOrderAndLimit(loadTable(entityName), orderBy, limit);
    },
    async filter(conditions = {}, orderBy = '-created_date', limit = null) {
      const filtered = loadTable(entityName).filter((row) => matchesConditions(row, conditions));
      return applyOrderAndLimit(filtered, orderBy, limit);
    },
    async get(id) {
      return loadTable(entityName).find((row) => row.id === id) ?? null;
    },
    async create(data) {
      const row = {
        id: uuid(),
        created_date: new Date().toISOString(),
        updated_date: new Date().toISOString(),
        ...data,
      };
      const rows = loadTable(entityName);
      rows.push(row);
      saveTable(entityName, rows);
      emitChange(entityName, { type: 'create', row });
      return row;
    },
    async update(id, patch) {
      const rows = loadTable(entityName);
      const idx = rows.findIndex((row) => row.id === id);
      if (idx === -1) return null;
      rows[idx] = { ...rows[idx], ...patch, updated_date: new Date().toISOString() };
      saveTable(entityName, rows);
      emitChange(entityName, { type: 'update', row: rows[idx] });
      return rows[idx];
    },
    async delete(id) {
      const rows = loadTable(entityName);
      const next = rows.filter((row) => row.id !== id);
      saveTable(entityName, next);
      emitChange(entityName, { type: 'delete', id });
      return { id };
    },
    subscribe(handler) {
      if (!sameTabBus) return () => {};
      const fn = (ev) => handler(ev.detail);
      sameTabBus.addEventListener(`entity:${entityName}`, fn);
      return () => sameTabBus.removeEventListener(`entity:${entityName}`, fn);
    },
  };
}

// Proxy so `db.entities.AnyEntityName` works without each one being listed.
export const entities = new Proxy(
  {},
  {
    get(_target, prop) {
      if (typeof prop !== 'string') return undefined;
      return createEntityApi(prop);
    },
  },
);

// ---------- integrations ----------
// All remote-only integrations throw a clear error explaining the user needs to
// wire up their own provider. UploadFile is the common exception — it gets a
// working `blob:` URL implementation so uploads at least display locally.

async function uploadFile({ file } = {}) {
  if (!file) throw new Error('UploadFile: expected { file } argument.');
  if (typeof URL !== 'undefined' && file instanceof Blob) {
    return { file_url: URL.createObjectURL(file), file_name: file.name ?? 'file' };
  }
  throw new Error('UploadFile: unsupported file payload in this environment.');
}

function unimplementedIntegration(name) {
  return async () => {
    throw new Error(
      `${name} is not implemented in the local runtime. Wire it to your own provider (OpenAI, Resend, etc.) in src/api/integrations.js.`,
    );
  };
}

export const integrations = {
  Core: {
    UploadFile: uploadFile,
    InvokeLLM: unimplementedIntegration('InvokeLLM'),
    SendEmail: unimplementedIntegration('SendEmail'),
    GenerateImage: unimplementedIntegration('GenerateImage'),
    SendSMS: unimplementedIntegration('SendSMS'),
  },
};

// ---------- top-level export ----------

export const db = { auth, entities, integrations };
export default db;
