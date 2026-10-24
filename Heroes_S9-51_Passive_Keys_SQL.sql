-- BR S9-51: stable passive_key on every hero_type.passive_stats (run before testing).
-- Merges passive_key into existing JSON; does not remove other passive_stats keys.
BEGIN;

UPDATE hero_type SET passive_stats = COALESCE(passive_stats, '{}'::jsonb) || '{"passive_key":"knight_double_retaliation"}'::jsonb WHERE name = 'Knight';
UPDATE hero_type SET passive_stats = COALESCE(passive_stats, '{}'::jsonb) || '{"passive_key":"monk_reflect_retaliation"}'::jsonb WHERE name = 'Monk';
UPDATE hero_type SET passive_stats = COALESCE(passive_stats, '{}'::jsonb) || '{"passive_key":"cleric_heal"}'::jsonb WHERE name = 'Cleric';
UPDATE hero_type SET passive_stats = COALESCE(passive_stats, '{}'::jsonb) || '{"passive_key":"paladin_army_bonus"}'::jsonb WHERE name = 'Paladin';
UPDATE hero_type SET passive_stats = COALESCE(passive_stats, '{}'::jsonb) || '{"passive_key":"ranger_surprise"}'::jsonb WHERE name = 'Ranger';
UPDATE hero_type SET passive_stats = COALESCE(passive_stats, '{}'::jsonb) || '{"passive_key":"barbarian_army_phys"}'::jsonb WHERE name = 'Barbarian';
UPDATE hero_type SET passive_stats = COALESCE(passive_stats, '{}'::jsonb) || '{"passive_key":"rogue_energy"}'::jsonb WHERE name = 'Rogue';
UPDATE hero_type SET passive_stats = COALESCE(passive_stats, '{}'::jsonb) || '{"passive_key":"druid_mana"}'::jsonb WHERE name = 'Druid';
UPDATE hero_type SET passive_stats = COALESCE(passive_stats, '{}'::jsonb) || '{"passive_key":"wizard_mana"}'::jsonb WHERE name = 'Wizard';
UPDATE hero_type SET passive_stats = COALESCE(passive_stats, '{}'::jsonb) || '{"passive_key":"sorcerer_mana"}'::jsonb WHERE name = 'Sorcerer';
UPDATE hero_type SET passive_stats = COALESCE(passive_stats, '{}'::jsonb) || '{"passive_key":"evoker_spell_bonus"}'::jsonb WHERE name = 'Evoker';
UPDATE hero_type SET passive_stats = COALESCE(passive_stats, '{}'::jsonb) || '{"passive_key":"shaman_totems"}'::jsonb WHERE name = 'Shaman';
UPDATE hero_type SET passive_stats = COALESCE(passive_stats, '{}'::jsonb) || '{"passive_key":"forge_master_army_phys"}'::jsonb WHERE name = 'Forge Master';
UPDATE hero_type SET passive_stats = COALESCE(passive_stats, '{}'::jsonb) || '{"passive_key":"conjurer_army_magic"}'::jsonb WHERE name = 'Conjurer';
UPDATE hero_type SET passive_stats = COALESCE(passive_stats, '{}'::jsonb) || '{"passive_key":"death_knight_shadow"}'::jsonb WHERE name = 'Death Knight';
UPDATE hero_type SET passive_stats = COALESCE(passive_stats, '{}'::jsonb) || '{"passive_key":"necromancer_shadow"}'::jsonb WHERE name = 'Necromancer';
UPDATE hero_type SET passive_stats = COALESCE(passive_stats, '{}'::jsonb) || '{"passive_key":"warlock_demon_reinforcement"}'::jsonb WHERE name = 'Warlock';
UPDATE hero_type SET passive_stats = COALESCE(passive_stats, '{}'::jsonb) || '{"passive_key":"heretic_demon_reinforcement"}'::jsonb WHERE name = 'Heretic';

COMMIT;
