-- S13-66: target-hex pointer centre vs wedge side (÷100 in client). Reload Reference Data after run.
INSERT INTO combat_config (key, value, description)
VALUES
  (
    'aim_center_pct',
    '42',
    'On a target footprint hex: inside this % of hex radius from centre → shortest attack stand; outside → pointer wedge picks approach side.'
  )
ON CONFLICT (key) DO UPDATE SET
  value = EXCLUDED.value,
  description = EXCLUDED.description;