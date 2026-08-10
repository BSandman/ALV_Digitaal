// MariaDB connection pool — één plek waar de engine wordt aangesproken (ADR-0003).
// Kern: elke verbinding zet een VASTE strict sql_mode, zodat dev en productie identiek
// gedragen ongeacht de serverdefault (prod is NIET strict). Zie ADR-0003.
//
// Vereist dependency: mysql2 (npm i mysql2). Node 20-compatibel.
import mysql from 'mysql2/promise';

const SESSION_SQL_MODE =
  process.env.DB_SESSION_SQL_MODE || 'STRICT_TRANS_TABLES,NO_ENGINE_SUBSTITUTION';

let pool;

/** Lazy singleton pool. Op shared hosting kan de host meerdere app-processen starten;
 *  elk proces krijgt zijn eigen kleine pool. Houd de pool klein i.v.m. het
 *  MySQL-verbindingslimiet per account (supportvraag v0.1.0 §13 q5). */
export function getPool() {
  if (pool) return pool;
  pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: Number(process.env.DB_POOL_SIZE || 5),
    timezone: 'Z', // servertijd in UTC (ADR-0002, regel 5)
    charset: 'utf8mb4',
    // Forceer strict sql_mode op ELKE nieuwe verbinding.
    connectAttributes: {},
  });

  // mysql2 heeft geen 'per-connection init hook' in de pool-API; daarom zetten we
  // sql_mode expliciet bij het lenen van een verbinding via withConnection().
  return pool;
}

/** Leen een verbinding, zet de vaste sql_mode, en geef 'm terug na gebruik. */
export async function withConnection(fn) {
  const conn = await getPool().getConnection();
  try {
    await conn.query('SET SESSION sql_mode = ?', [SESSION_SQL_MODE]);
    await conn.query("SET time_zone = '+00:00'");
    return await fn(conn);
  } finally {
    conn.release();
  }
}

/** Voer fn uit binnen één transactie (BEGIN/COMMIT/ROLLBACK). Gebruikt voor het
 *  atomair sluiten van een ronde (ADR-0002, regel 3). */
export async function withTransaction(fn) {
  return withConnection(async (conn) => {
    await conn.beginTransaction();
    try {
      const result = await fn(conn);
      await conn.commit();
      return result;
    } catch (err) {
      await conn.rollback();
      throw err;
    }
  });
}
