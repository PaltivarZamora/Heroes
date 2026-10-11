import { formatAmount, resourceById } from './resources';
import { mobLabel } from '../session/mobs';
import { mobIsAggressive } from './mobAggro';
import { heroTypeName, resourceWeeklyNode, } from '../town/catalog';
/** One reusable World-map hover label per object kind. */
export function worldHoverTooltipText(session, catalog, hit) {
    if (hit.town) {
        const typeName = catalog?.town.find((row) => row.id === hit.town.town_type_id)?.name?.trim() ||
            null;
        return typeName ? `${typeName}: ${hit.town.name}` : hit.town.name;
    }
    if (hit.hero) {
        const className = catalog
            ? heroTypeName(catalog, hit.hero.class_id).trim()
            : '';
        const label = className ? `${className}: ${hit.hero.name}` : hit.hero.name;
        return hit.hero.flight
            ? `${label}${hit.hero.flight.circling ? ' (circling)' : ' (in flight)'}`
            : label;
    }
    if (hit.mob) {
        const label = mobLabel(session, catalog, hit.mob);
        if (hit.viewer &&
            mobIsAggressive(session, catalog, hit.viewer, hit.mob)) {
            return `${label}\nLooks dangerous`;
        }
        return label;
    }
    if (hit.chestName) {
        return hit.chestName;
    }
    if (hit.groundItemName) {
        return hit.groundItemName;
    }
    if (hit.libraryText) {
        return hit.libraryText;
    }
    if (hit.noticeBoardText) {
        return hit.noticeBoardText;
    }
    if (hit.hanger) {
        return 'Hanger: fly to any of your towns with a Hanger';
    }
    if (hit.dock) {
        return 'Dock: Buy a boat';
    }
    if (hit.recruits) {
        return 'Recruits for Hire';
    }
    if (hit.emptyBoat) {
        return 'Boat';
    }
    if (hit.signText) {
        return hit.signText;
    }
    if (hit.fountain) {
        return "Fountain restores Hero's Mana and/or Energy";
    }
    if (hit.node) {
        const resource = resourceById(hit.node.resource_id);
        const name = resource?.name ?? 'Resource';
        if (hit.node.kind === 'mine') {
            const weekly = resourceWeeklyNode(catalog, hit.node.resource_id);
            return `Generates ${formatAmount(weekly)} ${name} weekly but paid daily`;
        }
        // Pile: name only — qty stays hidden until pickup.
        return name;
    }
    return null;
}
