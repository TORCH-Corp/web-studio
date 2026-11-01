'use client';

import { createContext, useContext, type ReactNode } from 'react';

/**
 * Web Studio Parts Context
 *
 * Tells the builder UI whether the server flag WS_PARTS=1 is up, i.e. whether
 * Collections and Forms are shown (parts 2 and 3). The value is read from the
 * environment on the server in the /ycode layout.
 */
const WsPartsContext = createContext<boolean>(false);

export function WsPartsProvider({ value, children }: { value: boolean; children: ReactNode }) {
  return <WsPartsContext.Provider value={value}>{children}</WsPartsContext.Provider>;
}

/** True when Collections and Forms are shown. */
export function useWsParts(): boolean {
  return useContext(WsPartsContext);
}
