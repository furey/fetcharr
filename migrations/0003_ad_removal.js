export const up = async (knex) => {
  await knex.schema.alterTable('shows', (t) => {
    t.string('ad_removal').notNullable().defaultTo('off')
  })
  await knex.schema.alterTable('recordings', (t) => {
    t.string('ad_status')
    t.text('ad_breaks_json')
    t.timestamp('ad_processed_at')
  })
}

export const down = async (knex) => {
  await knex.schema.alterTable('shows', (t) => {
    t.dropColumn('ad_removal')
  })
  await knex.schema.alterTable('recordings', (t) => {
    t.dropColumn('ad_status')
    t.dropColumn('ad_breaks_json')
    t.dropColumn('ad_processed_at')
  })
}
