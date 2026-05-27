export const up = async (knex) => {
  await knex.schema.createTable('settings', (t) => {
    t.string('key').primary()
    t.text('value')
  })

  await knex.schema.createTable('shows', (t) => {
    t.increments('id').primary()
    t.string('fetch_show_pattern').notNullable()
    t.string('dest_folder').notNullable()
    t.string('season_template').notNullable().defaultTo('Season {season}')
    t.boolean('enabled').notNullable().defaultTo(true)
    t.boolean('delete_after_download').notNullable().defaultTo(false)
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now())
  })

  await knex.schema.createTable('recordings', (t) => {
    t.string('fetch_id').primary()
    t.integer('show_id').references('id').inTable('shows').onDelete('SET NULL')
    t.string('fetch_title').notNullable()
    t.integer('season')
    t.integer('episode')
    t.string('file_path')
    t.bigInteger('size')
    t.string('status').notNullable().defaultTo('pending')
    t.text('error')
    t.timestamp('downloaded_at')
    t.timestamp('deleted_from_fetch_at')
  })

  await knex.schema.createTable('syncs', (t) => {
    t.increments('id').primary()
    t.timestamp('started_at').notNullable().defaultTo(knex.fn.now())
    t.timestamp('finished_at')
    t.string('status').notNullable().defaultTo('running')
    t.text('summary_json')
  })
}

export const down = async (knex) => {
  await knex.schema.dropTableIfExists('syncs')
  await knex.schema.dropTableIfExists('recordings')
  await knex.schema.dropTableIfExists('shows')
  await knex.schema.dropTableIfExists('settings')
}
