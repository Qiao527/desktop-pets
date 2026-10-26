"use strict";

// Local-first, versioned storage for activity history.
//
//  - One JSON document in <userData>/activity/history.json (mode 0600).
//  - Writes are atomic: temp file -> fsync -> rename -> fsync(dir).
//  - The last file that loaded cleanly is kept as history.json.bak.
//  - Unreadable/invalid files are moved aside as history.corrupt-<ts>.json
//    (at most MAX_QUARANTINE kept) and the store falls back to the backup,
//    then to an empty history. Nothing is ever silently overwritten.
//  - A file written by a newer schema version is left untouched and the
//    store becomes read-only rather than downgrading it.
//  - Saves are serialized; a save requested mid-write runs once afterwards.

const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const { CATEGORIES } = require("./tracker");

const SCHEMA_VERSION = 1;
const FILE_NAME = "history.json";
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_QUARANTINE = 3;
const DEFAULT_RETENTION_DAYS = 90;
const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS_MAX = 25 * 3600 * 1000; // a DST day can have 25 hours

function emptyHistory(nowMs) {
  return { schemaVersion: SCHEMA_VERSION, createdAt: nowMs, updatedAt: nowMs, days: {} };
}

function isNonNegFinite(n) {
  return typeof n === "number" && Number.isFinite(n) && n >= 0;
}

/** Returns a list of problems; empty means the document is usable. */
function validateHistory(doc) {
  const errors = [];
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return ["not an object"];
  if (!Number.isInteger(doc.schemaVersion)) errors.push("schemaVersion missing");
  if (!doc.days || typeof doc.days !== "object" || Array.isArray(doc.days)) {
    errors.push("days missing");
    return errors;
  }
  for (const [key, day] of Object.entries(doc.days)) {
    if (!DAY_KEY.test(key)) { errors.push(`bad day key ${key}`); continue; }
    if (!day || typeof day !== "object" || !day.totalsMs || !day.hourlyMs) { errors.push(`bad day ${key}`); continue; }
    let total = 0;
    for (const c of CATEGORIES) {
      const v = day.totalsMs[c];
      if (!isNonNegFinite(v)) errors.push(`${key}.totalsMs.${c}`);
      else total += v;
      const hours = day.hourlyMs[c];
      if (!Array.isArray(hours) || hours.length !== 24 || !hours.every(isNonNegFinite)) errors.push(`${key}.hourlyMs.${c}`);
    }
    if (total > DAY_MS_MAX) errors.push(`${key} exceeds 25h`);
  }
  return errors;
}

/** Upgrade older documents in place. Schema v1 is the first version. */
function migrate(doc) {
  // Future: if (doc.schemaVersion === 1) { ...; doc.schemaVersion = 2; }
  return doc;
}

function pruneDays(doc, nowMs, retentionDays) {
  const cutoff = new Date(nowMs);
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - (retentionDays - 1));
  const pad = (n) => String(n).padStart(2, "0");
  const cutoffKey = `${cutoff.getFullYear()}-${pad(cutoff.getMonth() + 1)}-${pad(cutoff.getDate())}`;
  let removed = 0;
  for (const key of Object.keys(doc.days)) {
    if (key < cutoffKey) { delete doc.days[key]; removed++; }
  }
  return removed;
}

function createStore({ dir, now = () => Date.now(), retentionDays = DEFAULT_RETENTION_DAYS, fsImpl = fsp } = {}) {
  if (!dir) throw new TypeError("dir is required");
  const file = path.join(dir, FILE_NAME);
  const backup = file + ".bak";

  let doc = null;
  let readOnly = false;
  let lastLoad = { source: null, recoveredFrom: null, quarantined: null };
  let saving = null;
  let saveAgain = false;

  async function readJson(p) {
    const stat = await fsImpl.stat(p);
    if (stat.size > MAX_FILE_BYTES) throw new Error(`file too large (${stat.size} bytes)`);
    return JSON.parse(await fsImpl.readFile(p, "utf8"));
  }

  async function quarantine(p) {
    const target = path.join(dir, `history.corrupt-${now()}.json`);
    try { await fsImpl.rename(p, target); } catch { return null; }
    try {
      const old = (await fsImpl.readdir(dir)).filter((n) => n.startsWith("history.corrupt-")).sort();
      for (const n of old.slice(0, Math.max(0, old.length - MAX_QUARANTINE))) await fsImpl.unlink(path.join(dir, n));
    } catch {}
    return target;
  }

  async function tryLoad(p) {
    let parsed;
    try { parsed = await readJson(p); } catch (err) {
      if (err.code === "ENOENT") return { status: "missing" };
      return { status: "corrupt", error: err.message };
    }
    if (Number.isInteger(parsed.schemaVersion) && parsed.schemaVersion > SCHEMA_VERSION) {
      return { status: "newer", doc: parsed };
    }
    const errors = validateHistory(parsed);
    if (errors.length) return { status: "corrupt", error: errors.slice(0, 5).join("; ") };
    return { status: "ok", doc: migrate(parsed) };
  }

  async function load() {
    await fsImpl.mkdir(dir, { recursive: true, mode: 0o700 });
    readOnly = false;
    lastLoad = { source: null, recoveredFrom: null, quarantined: null, error: null };

    const primary = await tryLoad(file);
    if (primary.status === "ok") {
      doc = primary.doc;
      lastLoad.source = "primary";
      // Known-good snapshot for corruption recovery
      try { await fsImpl.copyFile(file, backup); } catch {}
    } else if (primary.status === "newer") {
      doc = primary.doc;
      readOnly = true;
      lastLoad.source = "primary";
      lastLoad.error = `written by a newer version (schema ${primary.doc.schemaVersion}); not modifying`;
    } else {
      if (primary.status === "corrupt") {
        lastLoad.error = primary.error;
        lastLoad.quarantined = await quarantine(file);
      }
      const fallback = await tryLoad(backup);
      if (fallback.status === "ok") {
        doc = fallback.doc;
        lastLoad.source = "backup";
        lastLoad.recoveredFrom = "backup";
      } else {
        doc = emptyHistory(now());
        lastLoad.source = primary.status === "missing" ? "new" : "reset";
        if (primary.status === "corrupt") lastLoad.recoveredFrom = "empty";
      }
    }
    if (!readOnly) pruneDays(doc, now(), retentionDays);
    return doc;
  }

  async function writeAtomic(content) {
    const tmp = `${file}.tmp-${process.pid}`;
    const fh = await fsImpl.open(tmp, "w", 0o600);
    try {
      await fh.writeFile(content, "utf8");
      await fh.sync();
    } finally {
      await fh.close();
    }
    await fsImpl.rename(tmp, file);
    try {
      const dh = await fsImpl.open(dir, "r");
      try { await dh.sync(); } finally { await dh.close(); }
    } catch { /* directory fsync is best-effort on some filesystems */ }
  }

  async function saveOnce() {
    doc.updatedAt = now();
    pruneDays(doc, now(), retentionDays);
    await writeAtomic(JSON.stringify(doc));
  }

  /** Persist the current document. Concurrent calls coalesce. */
  async function save() {
    if (!doc) throw new Error("store not loaded");
    if (readOnly) return false;
    if (saving) { saveAgain = true; return saving; }
    saving = (async () => {
      try {
        do {
          saveAgain = false;
          await saveOnce();
        } while (saveAgain);
        return true;
      } finally {
        saving = null;
      }
    })();
    return saving;
  }

  /** Apply a mutation to the in-memory document (call save() to persist). */
  function update(fn) {
    if (!doc) throw new Error("store not loaded");
    if (readOnly) return false;
    fn(doc);
    return true;
  }

  /** Remove every file this store has written, including backups. */
  async function deleteAll() {
    if (saving) { try { await saving; } catch {} }
    let names = [];
    try { names = await fsImpl.readdir(dir); } catch (err) { if (err.code !== "ENOENT") throw err; }
    for (const n of names) {
      if (n === FILE_NAME || n.startsWith(FILE_NAME + ".") || n.startsWith("history.corrupt-")) {
        await fsImpl.unlink(path.join(dir, n));
      }
    }
    doc = emptyHistory(now());
    readOnly = false;
  }

  /** True if a history (or its backup) exists. Never creates anything. */
  async function hasData() {
    for (const p of [file, backup]) {
      try { await fsImpl.stat(p); return true; } catch {}
    }
    return false;
  }

  return {
    file,
    hasData,
    load,
    save,
    update,
    deleteAll,
    getDoc: () => doc,
    isReadOnly: () => readOnly,
    getLoadInfo: () => ({ ...lastLoad }),
  };
}

module.exports = {
  SCHEMA_VERSION,
  DEFAULT_RETENTION_DAYS,
  createStore,
  validateHistory,
  pruneDays,
  emptyHistory,
};
