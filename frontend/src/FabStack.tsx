import React, { createContext, useCallback, useContext, useMemo, useState } from "react";

type FabKind = "calculator" | "other";

type FabStackCtx = {
  present: Record<FabKind, boolean>;
  register: (kind: FabKind) => void;
  unregister: (kind: FabKind) => void;
};

const Ctx = createContext<FabStackCtx>({
  present: { calculator: false, other: false },
  register: () => {},
  unregister: () => {},
});

/**
 * Provider that lets FAB components register themselves so other FABs
 * (e.g. the AI Assistant) can reposition to avoid overlap.
 */
export function FabStackProvider({ children }: { children: React.ReactNode }) {
  const [counters, setCounters] = useState<Record<FabKind, number>>({ calculator: 0, other: 0 });

  const register = useCallback((kind: FabKind) => {
    setCounters((c) => ({ ...c, [kind]: (c[kind] || 0) + 1 }));
  }, []);
  const unregister = useCallback((kind: FabKind) => {
    setCounters((c) => ({ ...c, [kind]: Math.max(0, (c[kind] || 0) - 1) }));
  }, []);

  const present = useMemo(
    () => ({ calculator: counters.calculator > 0, other: counters.other > 0 }),
    [counters]
  );

  return <Ctx.Provider value={{ present, register, unregister }}>{children}</Ctx.Provider>;
}

export function useRegisterFab(kind: FabKind, enabled: boolean = true) {
  const { register, unregister } = useContext(Ctx);
  React.useEffect(() => {
    if (!enabled) return;
    register(kind);
    return () => unregister(kind);
  }, [enabled, kind, register, unregister]);
}

export function useFabStack() {
  return useContext(Ctx);
}
