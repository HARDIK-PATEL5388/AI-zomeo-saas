import 'dotenv/config'
import { Pool } from 'pg'
import { scryptSync, randomBytes } from 'crypto'

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
})

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(password, salt, 64).toString('hex')
  return `${salt}:${hash}`
}

async function seed() {
  const client = await pool.connect()
  try {
    // ── Master Admin ──────────────────────────────────────────
    const masterHash = hashPassword('Admin@123')
    await client.query(`
      INSERT INTO users (email, password_hash, role, first_name, last_name, mobile_code, mobile_number, is_active)
      VALUES ('siddharth@welcomecure.com', $1, 'master_admin', 'Siddharth', 'Admin', '91', '9687298058', true)
      ON CONFLICT (email) DO UPDATE
        SET password_hash  = EXCLUDED.password_hash,
            mobile_code    = EXCLUDED.mobile_code,
            mobile_number  = EXCLUDED.mobile_number,
            role           = EXCLUDED.role,
            first_name     = EXCLUDED.first_name,
            is_active      = true
    `, [masterHash])
    console.log('  master_admin  siddharth@welcomecure.com  (mobile: 9687298058)')

    // Demo clinic
    const { rows: [clinic] } = await client.query(`
      INSERT INTO clinics (name, email, subscription_plan)
      VALUES ('Demo Homeopathy Clinic', 'demo@clinic.com', 'professional')
      ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
      RETURNING id
    `)
    console.log(`  clinic  ${clinic.id}`)

    // Demo admin user
    const passwordHash = hashPassword('password123')
    const { rows: [user] } = await client.query(`
      INSERT INTO users (clinic_id, email, password_hash, role, first_name, last_name)
      VALUES ($1, 'doctor@demo.com', $2, 'admin', 'Demo', 'Doctor')
      ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash
      RETURNING id
    `, [clinic.id, passwordHash])
    console.log(`  user    ${user.id}`)

    // Repertory source
    const { rows: [source] } = await client.query(`
      INSERT INTO repertory_sources (name, slug, publisher, description)
      VALUES ('Kent Repertory', 'kent', 'James Tyler Kent', 'Repertory of the Homoeopathic Materia Medica by James Tyler Kent')
      ON CONFLICT DO NOTHING
      RETURNING id
    `)
    if (source) {
      console.log(`  source  ${source.id}`)

      const { rows: [version] } = await client.query(`
        INSERT INTO repertory_versions (source_id, version, year, is_current)
        VALUES ($1, '6th Edition', 1897, true)
        ON CONFLICT DO NOTHING
        RETURNING id
      `, [source.id])

      if (version) {
        // Sample chapter
        const { rows: [chapter] } = await client.query(`
          INSERT INTO chapters (source_id, code, slug, name, sort_order)
          VALUES ($1, 'MIND', 'mind', 'Mind', 1)
          ON CONFLICT DO NOTHING
          RETURNING id
        `, [source.id])

        if (chapter) {
          // Sample remedies
          const remedies = [
            ['Aconitum napellus', 'Acon', 'Aconite'],
            ['Arsenicum album', 'Ars', 'Arsenic album'],
            ['Belladonna', 'Bell', 'Belladonna'],
            ['Calcarea carbonica', 'Calc', 'Calc carb'],
            ['Ignatia amara', 'Ign', 'Ignatia'],
            ['Lycopodium clavatum', 'Lyc', 'Lycopodium'],
            ['Natrum muriaticum', 'Nat-m', 'Nat mur'],
            ['Nux vomica', 'Nux-v', 'Nux vomica'],
            ['Phosphorus', 'Phos', 'Phosphorus'],
            ['Sulphur', 'Sul', 'Sulphur'],
          ]
          const remedyIds: string[] = []
          for (const [name, abbr, common] of remedies) {
            const { rows: [rem] } = await client.query(`
              INSERT INTO remedies (name, abbreviation, common_name)
              VALUES ($1, $2, $3)
              ON CONFLICT DO NOTHING
              RETURNING id
            `, [name, abbr, common])
            if (rem) remedyIds.push(rem.id)
          }

          // Sample rubric
          const { rows: [rubric] } = await client.query(`
            INSERT INTO rubrics (source_id, chapter_id, name, full_path, level, parent_id, search_vector, embedding)
            VALUES ($1, $2, 'Fear of death', 'Mind > Fear > Death', 3, NULL,
              to_tsvector('english', 'Fear of death mind anxiety'), NULL)
            ON CONFLICT DO NOTHING
            RETURNING id
          `, [source.id, chapter.id])

          if (rubric && remedyIds.length >= 3) {
            const grades = [4, 3, 2]
            for (let i = 0; i < Math.min(3, remedyIds.length); i++) {
              await client.query(`
                INSERT INTO rubric_remedies (rubric_id, remedy_id, grade)
                VALUES ($1, $2, $3)
                ON CONFLICT DO NOTHING
              `, [rubric.id, remedyIds[i], grades[i]])
            }
            console.log(`  rubric  ${rubric.id} with ${Math.min(3, remedyIds.length)} remedies`)
          }
        }
      }
    }

    console.log('\nSeed complete.')
    console.log('Login: doctor@demo.com / password123')
  } catch (err) {
    console.error('Seed failed:', err)
    process.exit(1)
  } finally {
    client.release()
    await pool.end()
  }
}

seed()
