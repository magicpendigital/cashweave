// Injected platform services. Web defaults remain the original browser behavior.
let services = null;
const listeners = new Set();
export function configureLegacyServices(value) { services = value; for (const listener of listeners) listener(services); }
export function currentLegacyServices() { return services; }
export function onLegacyServicesChanged(listener) { listeners.add(listener); return () => listeners.delete(listener); }
