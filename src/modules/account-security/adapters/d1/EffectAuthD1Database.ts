import type {
  D1SqliteDatabaseLike,
  D1SqlitePreparedStatementLike,
} from "@effect-auth/core/D1Sqlite";

export interface EffectAuthD1PreparedStatement extends D1SqlitePreparedStatementLike<EffectAuthD1PreparedStatement> {
  readonly statement: D1PreparedStatement;
}

const prepareStatement = (
  statement: D1PreparedStatement
): EffectAuthD1PreparedStatement => ({
  statement,
  all: <Row extends Readonly<Record<string, unknown>>>() =>
    statement.all<Row>(),
  bind: (...values) => prepareStatement(statement.bind(...values)),
});

/** Adapts Cloudflare D1 to effect-auth's minimal recursive statement boundary. */
export const effectAuthD1Database = (
  database: D1Database
): D1SqliteDatabaseLike<EffectAuthD1PreparedStatement> => ({
  prepare: (sql) => prepareStatement(database.prepare(sql)),
  batch: (statements) =>
    database.batch<Readonly<Record<string, unknown>>>(
      statements.map(({ statement }) => statement)
    ),
});
