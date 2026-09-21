// Barrel for the report-audience module.
//
// Server-side routes import from here (hr-report pulls kpi-reporting
// TYPES only — safe for both worlds). Client components that need
// just the audience resolver import '@/lib/report-audience/profiles'
// directly to keep the client bundle minimal. `server-guard` is
// server-only (api-error) and is imported directly by routes, never
// re-exported to clients.
export * from './profiles';
export * from './hr-report';
