import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20261018203723_server_instance",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`server_instance\` (
          \`id\` text PRIMARY KEY,
          \`boot_id\` text,
          \`pid\` integer NOT NULL,
          \`time_started\` integer NOT NULL,
          \`time_heartbeat\` integer NOT NULL
        );
      `)
      yield* tx.run(`CREATE INDEX \`server_instance_heartbeat_idx\` ON \`server_instance\` (\`time_heartbeat\`);`)
    })
  },
} satisfies DatabaseMigration.Migration
