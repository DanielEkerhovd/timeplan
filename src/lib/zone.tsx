import { createContext, useContext, useMemo, type ReactNode } from "react";
import {
  hoursAhead,
  viewerZone,
  zoneSlotLabel,
  zoneSlotShort,
} from "./timezone";

/**
 * Hvilken tid klokkeslettene skal vises i.
 *
 * Lagringen er uendret: alt er timetall i lagets tid, og en rad betyr det samme for alle.
 * Det eneste som skjer her er at etikettene regnes om til sonen du sitter i, slik at du
 * slipper å gjøre hoderegning før hver scrim.
 *
 * Forskjellen regnes ut for uka som vises, ikke for i dag, siden sommertid kan skifte
 * mellom dem.
 */
interface Zone {
  /** Timer laget ligger foran deg. 0 betyr samme tid, og da vises alt som før. */
  diff: number;
  teamZone: string;
  yourZone: string;
  /** '13:00 - 16:00', med dag foran hvis blokka havner på et annet døgn hos deg. */
  label: (start: number, end: number, isoDay?: number) => string;
  /** Kort form, '18–21'. Brukes der plassen er trang (mobilkortene). */
  short: (start: number, end: number, isoDay?: number) => string;
}

const same: Zone = {
  diff: 0,
  teamZone: "",
  yourZone: "",
  label: (start, end, isoDay) => zoneSlotLabel(start, end, 0, isoDay),
  short: (start, end, isoDay) => zoneSlotShort(start, end, 0, isoDay),
};

const ZoneContext = createContext<Zone>(same);

export function ZoneProvider({
  teamZone,
  yourZone,
  at,
  children,
}: {
  teamZone: string;
  /** Null = bruk sonen maskinen står i. */
  yourZone?: string | null;
  at: Date;
  children: ReactNode;
}) {
  const value = useMemo<Zone>(() => {
    const mine = viewerZone(yourZone);
    const diff = hoursAhead(teamZone, at, mine) ?? 0;
    return {
      diff,
      teamZone,
      yourZone: mine,
      label: (start, end, isoDay) => zoneSlotLabel(start, end, diff, isoDay),
      short: (start, end, isoDay) => zoneSlotShort(start, end, diff, isoDay),
    };
  }, [teamZone, yourZone, at]);

  return <ZoneContext.Provider value={value}>{children}</ZoneContext.Provider>;
}

/** Uten en provider rundt seg oppfører alt seg som før: lagets tid, ingen omregning. */
export function useZone(): Zone {
  return useContext(ZoneContext);
}
