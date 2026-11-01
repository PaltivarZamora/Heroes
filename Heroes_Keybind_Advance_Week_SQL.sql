-- Advance Week (W) — add if missing (catalog API + in-game handler expect this action).
DELETE FROM keybind WHERE action = 'advance_week';
INSERT INTO keybind (action, label, key, alt_key, scope, rebindable, sort_order)
VALUES (
  'advance_week',
  'Advance Week',
  'w',
  NULL,
  'world',
  1,
  15
);
