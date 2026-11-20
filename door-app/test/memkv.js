export function memKV() {
  const m = new Map();
  return {
    m,
    async get(k, type) {
      const v = m.get(k);
      if (v === undefined) return null;
      return type === 'json' ? JSON.parse(v) : v;
    },
    async put(k, v) { m.set(k, v); },
    async delete(k) { m.delete(k); },
  };
}
