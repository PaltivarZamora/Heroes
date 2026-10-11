-- S9-36 game log retention (app_config.value is text)
INSERT INTO app_config (key, value) VALUES ('log_world_days', '7')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

INSERT INTO app_config (key, value) VALUES ('log_combat_keep', '10')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
