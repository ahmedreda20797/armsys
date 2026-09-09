// src/lib/quality-migration/__tests__/test-env.ts
// Environment bootstrap — MUST be the first import of this folder's
// test files. @/lib/quality-migration transitively loads @/lib/auth,
// which REFUSES to load without JWT_SECRET (fail-closed security).
// These tests exercise pure business logic only, so installing the
// variable here keeps the suite hermetic (no .env dependency, no
// order dependence on other test files having set it first).
process.env.JWT_SECRET = process.env.JWT_SECRET || 'quality-migration-test-jwt-secret-0123456789abcdef';
export {};
