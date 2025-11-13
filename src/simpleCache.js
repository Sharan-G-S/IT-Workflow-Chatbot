class SimpleCache {
  constructor({ maxEntries = 500 } = {}) {
    this.maxEntries = maxEntries;
    this.map = new Map();
  }

  get(key) {
    const v = this.map.get(key);
    if (!v) return null;
    // lru: move to end
    this.map.delete(key);
    this.map.set(key, v);
    return v;
  }

  set(key, value) {
    if (this.map.size >= this.maxEntries && !this.map.has(key)) {
      // delete oldest
      const firstKey = this.map.keys().next().value;
      this.map.delete(firstKey);
    }
    this.map.set(key, value);
  }
}

module.exports = { SimpleCache };
