import { hasTownBuiltToday } from '../session/accessors';
import { slotFromPlayerId } from '../session/types';
export function townTooltipText(catalog, session, town) {
    const typeName = catalog?.town.find((row) => row.id === town.town_type_id)?.name?.trim() ||
        'Town';
    const ownerSlot = town.player_id
        ? slotFromPlayerId(town.player_id)
        : null;
    const ownerRow = ownerSlot != null
        ? catalog?.player_color.find((row) => row.id === ownerSlot)
        : undefined;
    const owner = ownerRow?.name?.trim() || (town.player_id ? 'Player' : 'Neutral');
    const builtToday = hasTownBuiltToday(session, town.id) ? 'yes' : 'no';
    return `${town.name}\nOwner: ${owner}\nType: ${typeName}\nBuilt today: ${builtToday}`;
}
