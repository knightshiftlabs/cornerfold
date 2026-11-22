// Stands in for the PWA plugin's "virtual:pwa-register" module in unit tests, which have no service worker.
export type RegisterOptions = { immediate?: boolean; onNeedRefresh?: () => void; onRegisteredSW?: (url: string, registration: ServiceWorkerRegistration | undefined) => void }
export const registerSW = (_options?: RegisterOptions) => async (_reload?: boolean) => {}
