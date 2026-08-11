"use strict";
const fs = require("fs");
const path = require("path");

/**
 * File-backed key/value store, one JSON file per record.
 * This stands in for a real database (Postgres/Mongo/etc). It is isolated
 * behind this module so swapping in a real DB later touches only this file.
 */
class Store {
  constructor(dir) {
    this.dir = dir;
    fs.mkdirSync(this.dir, { recursive: true });
  }

  _file(id) {
    return path.join(this.dir, `${id}.json`);
  }

  save(id, data) {
    fs.writeFileSync(this._file(id), JSON.stringify(data, null, 2));
    return data;
  }

  get(id) {
    try {
      return JSON.parse(fs.readFileSync(this._file(id), "utf8"));
    } catch {
      return null;
    }
  }

  delete(id) {
    try {
      fs.unlinkSync(this._file(id));
      return true;
    } catch {
      return false;
    }
  }

  all() {
    return fs
      .readdirSync(this.dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => JSON.parse(fs.readFileSync(path.join(this.dir, f), "utf8")))
      .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  }
}

module.exports = { Store };
