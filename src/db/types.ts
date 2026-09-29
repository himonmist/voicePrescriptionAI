import type { PgDatabase } from "drizzle-orm/pg-core";
import type * as schema from "./schema";
/** Works with both neon-serverless (prod) and node-postgres (tests/CI) drivers. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Db = PgDatabase<any, typeof schema>;
