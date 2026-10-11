/** `building.payload.unique_key` values (Rod sets in SQL). */
export const TOWN_UNIQUE_KEY = {
  whisperingTimberworks: 'whispering_timberworks',
  unionLodge: 'union_lodge',
  reliquaryOfElevation: 'reliquary_of_elevation',
  recruitmentBeacon: 'recruitment_beacon',
  vault: 'vault',
  architectsSpire: 'architects_spire',
  boneNursery: 'bone_nursery',
  infernalArchive: 'infernal_archive',
  warRoom: 'war_room',
} as const

export type TownUniqueKey =
  (typeof TOWN_UNIQUE_KEY)[keyof typeof TOWN_UNIQUE_KEY]
