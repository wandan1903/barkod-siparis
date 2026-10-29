'use client';

import { createContext, useContext } from 'react';

export const OrgContext = createContext(null);

export function useOrg() {
  return useContext(OrgContext);
}
