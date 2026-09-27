// A minimal publish/subscribe helper. A module that owns some state (for
// example the library) exposes an emitter so other features can react to it
// without the owner having to know about them (or import them).
//
//   const events = createEmitter();
//   events.on("changed", (detail) => ...);   // subscribe
//   events.emit("changed", detail);          // notify

export function createEmitter() {
  const handlers = new Map();
  return {
    on(name, fn) {
      if (!handlers.has(name)) handlers.set(name, []);
      handlers.get(name).push(fn);
    },
    emit(name, ...args) {
      for (const fn of handlers.get(name) || []) fn(...args);
    },
  };
}
