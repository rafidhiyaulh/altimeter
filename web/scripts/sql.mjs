// Run one SQL statement (argv[2]) as the admin role and print the rows. Dev helper only.
import postgres from 'postgres'
const sql = postgres(process.env.DATABASE_ADMIN_URL, { prepare: false, max: 1, onnotice: () => {} })
try {
  const rows = await sql.unsafe(process.argv[2])
  console.table(rows)
} finally {
  await sql.end()
}
