// Test setup for jsdom environment.
// vitest.config sets environment: "jsdom".
//
// Node 22 ships an experimental partial Web Storage that lacks .clear() and
// shadows the jsdom implementation, breaking tests that rely on Storage.
// Replace localStorage and sessionStorage with a small in-memory Storage so
// every test starts from a known shape.

class MemoryStorage {
  constructor() {
    this._data = new Map();
  }
  get length() {
    return this._data.size;
  }
  key(i) {
    return Array.from(this._data.keys())[i] ?? null;
  }
  getItem(k) {
    return this._data.has(String(k)) ? this._data.get(String(k)) : null;
  }
  setItem(k, v) {
    this._data.set(String(k), String(v));
  }
  removeItem(k) {
    this._data.delete(String(k));
  }
  clear() {
    this._data.clear();
  }
}

const installStorage = (name) => {
  const store = new MemoryStorage();
  Object.defineProperty(globalThis, name, {
    configurable: true,
    get: () => store,
  });
  if (typeof window !== "undefined") {
    Object.defineProperty(window, name, {
      configurable: true,
      get: () => store,
    });
  }
};

installStorage("localStorage");
installStorage("sessionStorage");
