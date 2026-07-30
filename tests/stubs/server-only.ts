/**
 * Stands in for the `server-only` package under Vitest.
 *
 * The real package resolves to a module that throws unless the bundler sets the
 * "react-server" export condition. That guard is exactly what we want at build
 * time — it is how a server module reaching a client bundle fails the build —
 * but Vitest sets no such condition, so importing any module under src/server/
 * would throw before a single assertion ran.
 *
 * Aliased in vitest.config.ts. This file must stay empty of behaviour.
 */
export {}
