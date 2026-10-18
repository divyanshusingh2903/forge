import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core"

export const ServerInstanceTable = sqliteTable(
  "server_instance",
  {
    id: text().primaryKey(),
    boot_id: text(),
    // Diagnostics only. PIDs are reused, so liveness never depends on them.
    pid: integer().notNull(),
    time_started: integer().notNull(),
    time_heartbeat: integer().notNull(),
  },
  (table) => [index("server_instance_heartbeat_idx").on(table.time_heartbeat)],
)
