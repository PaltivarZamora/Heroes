/**
 * Emits Heroes_S9-46_Unit_Tags_SQL.sql from live catalog (names → ids).
 * Run: node scripts/generate-unit-tags-sql.mjs  (needs API at :8080)
 */
import fs from 'fs'
import { fileURLToPath } from 'url'

const outPath = fileURLToPath(
  new URL('../../Heroes_S9-46_Unit_Tags_SQL.sql', import.meta.url),
)

/** tag → unit name matchers (case-insensitive exact, or regex on lower(name)) */
const ASSIGNMENTS = [
  // s75 — base + advanced share tag where old code paired them
  { tag: 's75_fear_spirit_adv', names: ['Advanced Spirit'] },
  { tag: 's75_fear_nightmare', names: ['Nightmare'] },
  { tag: 's75_fear_nightmare_adv', names: ['Advanced Nightmare'] },
  { tag: 's75_fear_leviathan', names: ['Leviathan'] },
  { tag: 's75_fear_bound_spirit', names: ['Bound Spirit'] },
  { tag: 's75_stun_medusa', names: ['Medusa'] },
  { tag: 's75_stun_medusa_adv', names: ['Advanced Medusa'] },
  { tag: 's75_stun_arbalast', names: ['Arbalast'] },
  { tag: 's75_stun_arbalast_adv', names: ['Advanced Arbalast'] },
  { tag: 's75_silence_concussive', names: ['Concussive Turret'] },
  { tag: 's75_silence_concussive_adv', names: ['Advanced Concussive Turret'] },
  { tag: 's75_silence_siren', names: ['Abyssal Siren'] },
  { tag: 's75_silence_siren_adv', names: ['Advanced Abyssal Siren'] },
  { tag: 's75_confuse_succubus', names: ['Succubus'] },
  { tag: 's75_confuse_succubus_adv', names: ['Advanced Succubus'] },
  // designed_factory
  { tag: 'designed_factory_ninja', names: ['Ninja', 'Advanced Ninja'] },
  {
    tag: 'designed_factory_hammersmith',
    names: ['Goblin Hammersmith', 'Advanced Goblin Hammersmith'],
  },
  { tag: 'designed_factory_void', names: ['Void', 'Advanced Void'] },
  {
    tag: 'designed_factory_bouncy_bomb',
    names: ['Bouncy Bomb', 'Advanced Bouncy Bomb'],
  },
  {
    tag: 'designed_factory_flesh_golem',
    names: ['Flesh Golem', 'Advanced Flesh Golem'],
  },
  {
    tag: 'designed_factory_pit_fiend_arch',
    names: ['Pit Fiend Arch', 'Advanced Pit Fiend Arch'],
  },
  {
    tag: 'designed_factory_fire_immune',
    names: [
      'Homunculus',
      'Advanced Homunculus',
      'Imp',
      'Advanced Imp',
      'Smoldering Ooze',
      'Advanced Smoldering Ooze',
      'Horned Hellion',
      'Advanced Horned Hellion',
      'Arsonist',
      'Advanced Arsonist',
      'Fire Giant',
      'Advanced Fire Giant',
    ],
  },
  {
    tag: 'designed_factory_weeping_angel',
    names: ['Weeping Angel', 'Advanced Weeping Angel'],
  },
  { tag: 'designed_factory_blink_dog', names: ['Blink Dog', 'Advanced Blink Dog'] },
  {
    tag: 'designed_factory_chronomancer',
    names: ['Chronomancer', 'Advanced Chronomancer'],
  },
  { tag: 'designed_factory_imp_trail', names: ['Imp', 'Advanced Imp'] },
  {
    tag: 'designed_factory_smoldering_ooze_trail',
    names: ['Smoldering Ooze', 'Advanced Smoldering Ooze'],
  },
  { tag: 'designed_factory_cerberus_trail', names: ['Cerberus', 'Advanced Cerberus'] },
  {
    tag: 'designed_factory_efreeti_trail',
    names: ['Efreti', 'Advanced Efreti', 'Efreeti', 'Advanced Efreeti'],
  },
  { tag: 'designed_factory_jouster_charge', names: ['Jouster', 'Advanced Jouster'] },
  {
    tag: 'designed_factory_war_mammoth_charge',
    names: ['War Mammoth', 'Advanced War Mammoth'],
  },
  { tag: 'designed_factory_gladiator_slow', names: ['Gladiator', 'Advanced Gladiator'] },
  // designed_confluence
  { tag: 'designed_confluence_mud_sprite', names: ['Mud Sprite', 'Advanced Mud Sprite'] },
  { tag: 'designed_confluence_spark', names: ['Spark', 'Advanced Spark'] },
  {
    tag: 'designed_confluence_tidal_caller',
    names: ['Tidal Caller', 'Advanced Tidal Caller'],
  },
  {
    tag: 'designed_confluence_thunder_lizard',
    names: ['Thunder Lizard', 'Advanced Thunder Lizard'],
  },
  { tag: 'designed_confluence_tempest', names: ['Tempest', 'Advanced Tempest'] },
  {
    tag: 'designed_confluence_pyromaniac',
    names: ['Pyromaniac', 'Advanced Pyromaniac'],
  },
  {
    tag: 'designed_confluence_tesla_coil',
    names: ['Tesla Coil', 'Advanced Tesla Coil'],
  },
  { tag: 'designed_confluence_phoenix', names: ['Phoenix', 'Advanced Phoenix'] },
  {
    tag: 'designed_confluence_cloud_panther',
    names: ['Cloud Panther', 'Advanced Cloud Panther'],
  },
  { tag: 'designed_confluence_channeler', names: ['Channeler', 'Advanced Channeler'] },
  { tag: 'designed_confluence_void_immune', names: ['Void', 'Advanced Void'] },
  { tag: 'designed_confluence_lightning_totem', names: ['Lightning Totem'] },
  // designed_temple
  { tag: 'designed_temple_zealot', names: ['Zealot', 'Advanced Zealot'] },
  {
    tag: 'designed_temple_high_priestess',
    names: ['High Priestess', 'Advanced High Priestess'],
  },
  {
    tag: 'designed_temple_inquisitor',
    names: ['Inquisitor Grand', 'Advanced Inquisitor Grand'],
  },
  {
    tag: 'designed_temple_angelic_warrior',
    names: ['Angelic Warrior', 'Advanced Angelic Warrior'],
  },
  {
    tag: 'designed_temple_divine_aura',
    names: ['Divine Aura Master', 'Advanced Divine Aura Master'],
  },
  // enrichCatalogUnits
  { tag: 'designed_mud_golem', names: ['Mud Golem'] },
  { tag: 'designed_vines_resist', names: ['Vines', 'Advanced Vines'] },
  { tag: 'designed_halberdier_reach', names: ['Halberdier'] },
  { tag: 'designed_arcane_illusion', names: ['Arcane Illusion'] },
  { tag: 'designed_arcane_shield', names: ['Arcane Shield'] },
  { tag: 'designed_arcane_animated_weapon', names: ['Animated Weapon'] },
  { tag: 'fire_totem', names: ['Fire Totem'] },
  { tag: 'lightning_totem', names: ['Lightning Totem'] },
  { tag: 'nature_totem', names: ['Nature Totem'] },
  { tag: 'terrain_los_blocker', names: ['Unstable Rift', 'Earth Spikes', 'Ice Shards'] },
  { tag: 'unstable_rift', names: ['Unstable Rift'] },
  // siege / auto-target (fixture names vary by town; match suffix patterns too)
  { tag: 'siege_wall', namePatterns: [/^wall$/i, / wall$/i, /^necropolis wall$/i] },
  { tag: 'siege_shooter', namePatterns: [/^shooter$/i, / shooter$/i] },
  { tag: 'siege_drawbridge', namePatterns: [/^drawbridge$/i, / drawbridge$/i] },
  {
    tag: 'siege_engine',
    namePatterns: [/^siege$/i, /^catapult$/i, / siege$/i, / catapult$/i],
  },
  { tag: 'auto_target_random_wall', namePatterns: [/^siege$/i, /^catapult$/i] },
  { tag: 'auto_target_random_enemy', namePatterns: [/^shooter$/i, /^animated weapon$/i] },
]

function norm(s) {
  return String(s ?? '').trim().toLowerCase()
}

function matchUnit(unit, entry) {
  const name = norm(unit.name)
  if (entry.names) {
    return entry.names.some((n) => norm(n) === name)
  }
  if (entry.namePatterns) {
    return entry.namePatterns.some((re) => re.test(unit.name.trim()))
  }
  return false
}

function auditPairing(units) {
  const issues = []
  for (const unit of units) {
    const level = Math.max(1, Math.floor(Number(unit.level) || 1))
    const cost = unit.upgrade_cost
    const hasCost =
      cost &&
      typeof cost === 'object' &&
      Object.values(cost).some((v) => Number(v) > 0)
    if (level !== 1 || !hasCost) continue
    const matches = units.filter((row) => {
      if (Math.max(1, Math.floor(Number(row.level) || 1)) !== 2) return false
      if ((row.town_id ?? null) !== (unit.town_id ?? null)) return false
      if ((row.tier ?? null) !== (unit.tier ?? null)) return false
      const ac = unit.class_id > 0 ? unit.class_id : null
      const bc = row.class_id > 0 ? row.class_id : null
      return ac === bc
    })
    if (matches.length !== 1) {
      issues.push({
        unitId: unit.id,
        unitName: unit.name,
        kind: matches.length === 0 ? 'no_advanced' : 'ambiguous_advanced',
        matchIds: matches.map((m) => m.id),
      })
    }
  }
  return issues
}

function sqlEscape(s) {
  return String(s).replace(/'/g, "''")
}

async function main() {
  const res = await fetch('http://localhost:8080/api/reference/catalog')
  if (!res.ok) {
    throw new Error(`catalog HTTP ${res.status}`)
  }
  const catalog = await res.json()
  const units = catalog.unit ?? []
  const towns = catalog.town ?? []
  const citadelTownId =
    towns.find((t) => norm(t.name) === 'citadel')?.id ?? null

  const allTags = new Set(ASSIGNMENTS.map((a) => a.tag))
  allTags.add('faction_citadel')

  const lines = [
    '-- S9-46: unit_tag rows + unit.tags (JSON array of unit_tag.id)',
    '-- Generated by frontend/scripts/generate-unit-tags-sql.mjs',
    'BEGIN;',
    '',
    'INSERT INTO unit_tag (value)',
    'SELECT v FROM (VALUES',
    [...allTags]
      .sort()
      .map((t) => `  ('${sqlEscape(t)}')`)
      .join(',\n'),
    ') AS t(v)',
    'WHERE NOT EXISTS (SELECT 1 FROM unit_tag ut WHERE lower(ut.value) = lower(t.v));',
    '',
  ]

  for (const entry of ASSIGNMENTS) {
    const ids = units.filter((u) => matchUnit(u, entry)).map((u) => u.id)
    if (ids.length === 0) {
      lines.push(`-- WARNING: no units matched tag ${entry.tag}`)
      continue
    }
    lines.push(`-- ${entry.tag} → unit ids ${ids.join(', ')}`)
    for (const id of ids) {
      lines.push(
        `UPDATE unit SET tags = (` +
          `SELECT COALESCE(jsonb_agg(DISTINCT elem ORDER BY elem), '[]'::jsonb) ` +
          `FROM (` +
          `SELECT jsonb_array_elements_text(COALESCE(unit.tags, '[]'::jsonb))::int AS elem ` +
          `UNION SELECT ut.id FROM unit_tag ut WHERE lower(ut.value) = lower('${sqlEscape(entry.tag)}')` +
          `) s) WHERE id = ${id};`,
      )
    }
    lines.push('')
  }

  if (citadelTownId != null) {
    const citadelUnits = units.filter((u) => u.town_id === citadelTownId)
    lines.push(`-- faction_citadel (town_id = ${citadelTownId})`)
    for (const u of citadelUnits) {
      lines.push(
        `UPDATE unit SET tags = (` +
          `SELECT COALESCE(jsonb_agg(DISTINCT elem ORDER BY elem), '[]'::jsonb) ` +
          `FROM (` +
          `SELECT jsonb_array_elements_text(COALESCE(unit.tags, '[]'::jsonb))::int AS elem ` +
          `UNION SELECT ut.id FROM unit_tag ut WHERE lower(ut.value) = lower('faction_citadel')` +
          `) s) WHERE id = ${u.id};`,
      )
    }
    lines.push('')
  }

  lines.push('COMMIT;', '')
  fs.writeFileSync(outPath, lines.join('\n'))

  const pairing = auditPairing(units)
  console.log('Wrote', outPath)
  console.log('Upgrade pairing issues:', JSON.stringify(pairing, null, 2))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
