// Test-only stub for the 'server-only' package (see tsconfig.test.json).
// The real package throws under Node's default export condition; its
// tripwire semantics only apply inside the Next client bundle, where
// the production build resolves the REAL package.
export {};
