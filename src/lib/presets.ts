/**
 * Ferdige rollelister å starte med.
 *
 * Dette er bare tekst. Appen lagrer aldri hvilket spill du valgte — bare navnene
 * som havnet i lagets liste. Derfor koster det ingenting å legge til flere spill,
 * og laget kan endre alt etterpå.
 *
 * Coach og Sub følger med alle spill: de er vanlige roller, ikke noe eget.
 * Rekkefølgen er alltid den samme: Coach først, så spillrollene, så Sub.
 */
export interface RolePreset {
  id: string;
  name: string;
  roles: string[];
}

const withStaff = (roles: string[]) => ["Coach", ...roles, "Sub"];

export const rolePresets: RolePreset[] = [
  {
    id: "lol",
    name: "League of Legends",
    roles: withStaff(["Top", "Jungle", "Mid", "ADC", "Support"]),
  },
  {
    id: "valorant",
    name: "Valorant",
    roles: withStaff(["Duelist", "Controller", "Initiator", "Sentinel"]),
  },
  {
    id: "cs",
    name: "Counter-Strike",
    roles: withStaff(["IGL", "AWP", "Entry", "Support", "Lurker"]),
  },
  {
    id: "overwatch",
    name: "Overwatch",
    roles: withStaff(["Tank", "DPS", "Support"]),
  },
  {
    id: "rocket-league",
    name: "Rocket League",
    roles: withStaff(["Striker", "Midfielder", "Defender"]),
  },
  {
    id: "r6",
    name: "Rainbow Six",
    roles: withStaff(["Entry", "Support", "Flex", "Anchor"]),
  },
  {
    id: "apex",
    name: "Apex Legends",
    roles: withStaff(["Fragger", "Support", "IGL"]),
  },
  {
    id: "dota",
    name: "Dota 2",
    roles: withStaff(["Carry", "Mid", "Offlane", "Soft support", "Hard support"]),
  },
  {
    id: "football",
    name: "Football",
    roles: withStaff(["Goalkeeper", "Defender", "Midfielder", "Forward"]),
  },
  {
    id: "custom",
    name: "Custom",
    roles: [],
  },
];

export const presetById = (id: string): RolePreset | undefined =>
  rolePresets.find((p) => p.id === id);
