import { closeDatabase } from './client.ts';
import { migrate } from './migrate.ts';

/** `pnpm --filter @ev/db db:migrate` */
const result = await migrate();

if (result.applied.length === 0) {
  console.log(`No new migrations. ${result.skipped.length} already applied.`);
} else {
  console.log(`Applied ${result.applied.length}: ${result.applied.join(', ')}`);
}

await closeDatabase();
