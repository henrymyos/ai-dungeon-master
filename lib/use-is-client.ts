import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

// false during SSR and hydration, true afterwards: a portal-safe "mounted" flag without a setState effect.
export function useIsClient(): boolean {
  return useSyncExternalStore(subscribe, () => true, () => false);
}
