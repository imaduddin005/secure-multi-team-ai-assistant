import { asOwner, bootstrapLocal, createClient, migrate, seed, withContext } from './database';
import { contexts, initializeLocalEnvironment, localDatabaseUrl } from './config';

async function main(): Promise<void> {
  const command = process.argv[2];
  if (command === 'local-init') {
    console.log(initializeLocalEnvironment()
      ? 'Created root .env with random local database credentials. No secrets were printed.'
      : 'Existing root .env preserved without changes. See docs/module-1-database.md for required database settings.');
    return;
  }
  if (command === 'bootstrap') {
    await bootstrapLocal(false);
    await bootstrapLocal(true);
    console.log('Provisioned separate local demo/test database roles and pgvector. No application schema was reset.');
    return;
  }
  if (command === 'migrate') {
    const applied = await asOwner(localDatabaseUrl('MIGRATION_DATABASE_URL', 'assistant'), migrate);
    console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'All migrations already applied; checksums match.');
    return;
  }
  if (command === 'seed') {
    await asOwner(localDatabaseUrl('MIGRATION_DATABASE_URL', 'assistant'), seed);
    console.log('Safe TechCo metadata fixture applied without overwriting existing rows. No Auth accounts or storage files were created.');
    return;
  }
  if (command === 'inspect') {
    const argument = process.argv.indexOf('--member');
    const selected = argument >= 0 ? process.argv[argument + 1] : undefined;
    const entries = selected ? [[selected, contexts[selected]]] as const : Object.entries(contexts);
    if (selected && !contexts[selected]) throw new Error('Unknown demo membership label.');
    const client = createClient(localDatabaseUrl('API_DATABASE_URL', 'assistant'));
    await client.connect();
    try {
      console.log('Database-context demonstration only; this is not Supabase Auth login.');
      for (const [label, identity] of entries) {
        if (!identity) continue;
        const titles = await withContext(client, identity, async scoped =>
          (await scoped.query<{ title: string }>('SELECT title FROM app.documents ORDER BY title')).rows.map(row => row.title));
        console.log(`${label}: ${titles.join(', ') || '(no readable documents)'}`);
      }
    } finally { await client.end(); }
    return;
  }
  throw new Error('Use local-init, bootstrap, migrate, seed, or inspect.');
}

main().catch((error: unknown) => {
  const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : 'configuration';
  // Database errors are deliberately not dumped with their queries/connection config.
  const message = code === 'configuration' && error instanceof Error ? error.message
    : 'Database operation failed. Check service readiness and docs/module-1-database.md; credentials were not logged.';
  console.error(`Command failed (${code}): ${message}`);
  process.exitCode = 1;
});
