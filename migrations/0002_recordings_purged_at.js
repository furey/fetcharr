export const up = async (knex) => {
  await knex.schema.alterTable('recordings', (t) => {
    t.timestamp('purged_at')
  })
}

export const down = async (knex) => {
  await knex.schema.alterTable('recordings', (t) => {
    t.dropColumn('purged_at')
  })
}
