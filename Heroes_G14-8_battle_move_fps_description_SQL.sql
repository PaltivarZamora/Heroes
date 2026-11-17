-- G14-8 follow-up: clarify battle_move_fps scope (Reload Reference Data after run).
UPDATE anim_config
SET description = 'Battle: frames per second for Move, Attack, Hit, Die and effects (everything except Idle)'
WHERE key = 'battle_move_fps';