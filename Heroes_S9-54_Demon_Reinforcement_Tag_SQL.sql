-- S9-54: Pandemonium demon reinforcement roster (Warlock / Heretic passive).
-- Tags by unit.name (NOT legacy numeric ids — those rows were reassigned).
-- Intended roster from demonReinforcement.ts comments @ bd16d3d (S6-1).
-- Rod: confirm each name resolves to the expected Pandemonium creature before COMMIT.
BEGIN;

INSERT INTO unit_tag (value)
SELECT v FROM (VALUES
  ('demon_reinforcement')
) AS t(v)
WHERE NOT EXISTS (SELECT 1 FROM unit_tag ut WHERE lower(ut.value) = lower(t.v));

-- Merge helper: append demon_reinforcement unit_tag.id to unit.tags
-- Tier 1 — Homunculus / Imp (new picks: random base only; advanced in pool for reinforce)
UPDATE unit SET tags = (SELECT COALESCE(jsonb_agg(DISTINCT elem ORDER BY elem), '[]'::jsonb) FROM (SELECT jsonb_array_elements_text(COALESCE(unit.tags, '[]'::jsonb))::int AS elem UNION SELECT ut.id FROM unit_tag ut WHERE lower(ut.value) = lower('demon_reinforcement')) s) WHERE lower(trim(name)) = lower('Homunculus');
UPDATE unit SET tags = (SELECT COALESCE(jsonb_agg(DISTINCT elem ORDER BY elem), '[]'::jsonb) FROM (SELECT jsonb_array_elements_text(COALESCE(unit.tags, '[]'::jsonb))::int AS elem UNION SELECT ut.id FROM unit_tag ut WHERE lower(ut.value) = lower('demon_reinforcement')) s) WHERE lower(trim(name)) = lower('Advanced Homunculus');
UPDATE unit SET tags = (SELECT COALESCE(jsonb_agg(DISTINCT elem ORDER BY elem), '[]'::jsonb) FROM (SELECT jsonb_array_elements_text(COALESCE(unit.tags, '[]'::jsonb))::int AS elem UNION SELECT ut.id FROM unit_tag ut WHERE lower(ut.value) = lower('demon_reinforcement')) s) WHERE lower(trim(name)) = lower('Imp');
UPDATE unit SET tags = (SELECT COALESCE(jsonb_agg(DISTINCT elem ORDER BY elem), '[]'::jsonb) FROM (SELECT jsonb_array_elements_text(COALESCE(unit.tags, '[]'::jsonb))::int AS elem UNION SELECT ut.id FROM unit_tag ut WHERE lower(ut.value) = lower('demon_reinforcement')) s) WHERE lower(trim(name)) = lower('Advanced Imp');

-- Tier 3 — Horned Hellion (no Pandemonium T2 demon; tier 2 rounds down to T1)
UPDATE unit SET tags = (SELECT COALESCE(jsonb_agg(DISTINCT elem ORDER BY elem), '[]'::jsonb) FROM (SELECT jsonb_array_elements_text(COALESCE(unit.tags, '[]'::jsonb))::int AS elem UNION SELECT ut.id FROM unit_tag ut WHERE lower(ut.value) = lower('demon_reinforcement')) s) WHERE lower(trim(name)) = lower('Horned Hellion');
UPDATE unit SET tags = (SELECT COALESCE(jsonb_agg(DISTINCT elem ORDER BY elem), '[]'::jsonb) FROM (SELECT jsonb_array_elements_text(COALESCE(unit.tags, '[]'::jsonb))::int AS elem UNION SELECT ut.id FROM unit_tag ut WHERE lower(ut.value) = lower('demon_reinforcement')) s) WHERE lower(trim(name)) = lower('Advanced Horned Hellion');

-- Tier 4 — Succubus
UPDATE unit SET tags = (SELECT COALESCE(jsonb_agg(DISTINCT elem ORDER BY elem), '[]'::jsonb) FROM (SELECT jsonb_array_elements_text(COALESCE(unit.tags, '[]'::jsonb))::int AS elem UNION SELECT ut.id FROM unit_tag ut WHERE lower(ut.value) = lower('demon_reinforcement')) s) WHERE lower(trim(name)) = lower('Succubus');
UPDATE unit SET tags = (SELECT COALESCE(jsonb_agg(DISTINCT elem ORDER BY elem), '[]'::jsonb) FROM (SELECT jsonb_array_elements_text(COALESCE(unit.tags, '[]'::jsonb))::int AS elem UNION SELECT ut.id FROM unit_tag ut WHERE lower(ut.value) = lower('demon_reinforcement')) s) WHERE lower(trim(name)) = lower('Advanced Succubus');

-- Tier 5 — Efreeti (legacy comment: "Efreti"; include both spellings if present)
UPDATE unit SET tags = (SELECT COALESCE(jsonb_agg(DISTINCT elem ORDER BY elem), '[]'::jsonb) FROM (SELECT jsonb_array_elements_text(COALESCE(unit.tags, '[]'::jsonb))::int AS elem UNION SELECT ut.id FROM unit_tag ut WHERE lower(ut.value) = lower('demon_reinforcement')) s) WHERE lower(trim(name)) = lower('Efreeti');
UPDATE unit SET tags = (SELECT COALESCE(jsonb_agg(DISTINCT elem ORDER BY elem), '[]'::jsonb) FROM (SELECT jsonb_array_elements_text(COALESCE(unit.tags, '[]'::jsonb))::int AS elem UNION SELECT ut.id FROM unit_tag ut WHERE lower(ut.value) = lower('demon_reinforcement')) s) WHERE lower(trim(name)) = lower('Advanced Efreeti');
UPDATE unit SET tags = (SELECT COALESCE(jsonb_agg(DISTINCT elem ORDER BY elem), '[]'::jsonb) FROM (SELECT jsonb_array_elements_text(COALESCE(unit.tags, '[]'::jsonb))::int AS elem UNION SELECT ut.id FROM unit_tag ut WHERE lower(ut.value) = lower('demon_reinforcement')) s) WHERE lower(trim(name)) = lower('Efreti');
UPDATE unit SET tags = (SELECT COALESCE(jsonb_agg(DISTINCT elem ORDER BY elem), '[]'::jsonb) FROM (SELECT jsonb_array_elements_text(COALESCE(unit.tags, '[]'::jsonb))::int AS elem UNION SELECT ut.id FROM unit_tag ut WHERE lower(ut.value) = lower('demon_reinforcement')) s) WHERE lower(trim(name)) = lower('Advanced Efreti');

-- Tier 6 — Pit Fiend Arch
UPDATE unit SET tags = (SELECT COALESCE(jsonb_agg(DISTINCT elem ORDER BY elem), '[]'::jsonb) FROM (SELECT jsonb_array_elements_text(COALESCE(unit.tags, '[]'::jsonb))::int AS elem UNION SELECT ut.id FROM unit_tag ut WHERE lower(ut.value) = lower('demon_reinforcement')) s) WHERE lower(trim(name)) = lower('Pit Fiend Arch');
UPDATE unit SET tags = (SELECT COALESCE(jsonb_agg(DISTINCT elem ORDER BY elem), '[]'::jsonb) FROM (SELECT jsonb_array_elements_text(COALESCE(unit.tags, '[]'::jsonb))::int AS elem UNION SELECT ut.id FROM unit_tag ut WHERE lower(ut.value) = lower('demon_reinforcement')) s) WHERE lower(trim(name)) = lower('Advanced Pit Fiend Arch');

COMMIT;
