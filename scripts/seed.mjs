/**
 * Optional seed script to populate the database with demo data
 * from a reference repository for testing.
 */
import pg from 'pg';
const { Pool } = pg;

async function seed() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://gitlore:gitlore@localhost:5432/gitlore',
  });

  const client = await pool.connect();
  try {
    // Check if we already have data
    const { rows } = await client.query('SELECT COUNT(*) as count FROM repositories');
    if (parseInt(rows[0].count) > 0) {
      console.log('Database already has data. Skipping seed.');
      return;
    }

    console.log('Seeding demo data...');

    // Insert a demo repository
    const repo = await client.query(
      `INSERT INTO repositories (owner, name, full_name, is_indexed)
       VALUES ('demo', 'example-repo', 'demo/example-repo', true)
       RETURNING id`
    );
    const repoId = repo.rows[0].id;
    console.log(`Created demo repository: ${repoId}`);

    // Insert some sample artifacts
    const artifacts = [
      {
        type: 'commit', ext: 'abc123', title: 'feat: add validation for email format',
        content: 'Added email format validation to prevent invalid inputs', author: 'dev1',
        date: '2024-01-15', url: 'https://github.com/demo/example-repo/commit/abc123',
      },
      {
        type: 'pr', ext: '42', title: 'Add email validation',
        content: 'This PR adds email validation to the user registration flow. We need to validate email format before creating accounts. Related to issue #41.', author: 'dev1',
        date: '2024-01-14', url: 'https://github.com/demo/example-repo/pull/42',
      },
      {
        type: 'issue', ext: '41', title: 'Invalid emails causing registration failures',
        content: 'Users can register with malformed emails. We need validation to reject invalid formats.', author: 'reporter',
        date: '2024-01-13', url: 'https://github.com/demo/example-repo/issues/41',
      },
      {
        type: 'doc', ext: 'readme', title: 'README',
        content: '# Example Repo\nThis is a demo repository for testing GitLore.',
        author: 'admin', url: 'https://github.com/demo/example-repo#readme',
      },
    ];

    for (const a of artifacts) {
      await client.query(
        `INSERT INTO artifacts (repository_id, artifact_type, external_id, title, content, author, date, url)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [repoId, a.type, a.ext, a.title, a.content, a.author, a.date, a.url]
      );
    }
    console.log(`Seeded ${artifacts.length} artifacts`);

    // Create relations
    await client.query(
      `INSERT INTO relations (source_id, target_id, relation_type)
       SELECT a1.id, a2.id, 'fixes'
       FROM artifacts a1, artifacts a2
       WHERE a1.external_id = '42' AND a2.external_id = '41' AND a1.repository_id = $1`,
      [repoId]
    );
    console.log('Seeded relations');

    console.log('Seed completed successfully.');
  } catch (err) {
    console.error('Seed failed:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
