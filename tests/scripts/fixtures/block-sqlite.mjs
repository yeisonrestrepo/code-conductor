// Registered via `node --import`. Makes any resolve of node:sqlite fail so the
// conductor-db degradation path can be exercised on a Node that ships sqlite.
import { register } from 'node:module';
register(new URL('./block-sqlite-hooks.mjs', import.meta.url));
