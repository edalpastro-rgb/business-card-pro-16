// useBlocks.ts — tag 2026-10-19 (blocchi) — BLOCCHI: moduli attivabili per organizzazione in base alla licenza.
// Catalogo + stato da GET /blocks (backend routes/axon_blocks.py). Solo i blocchi `enabled` producono voci di menu
// (categoria «BLOCCHI»): spento = sparisce per tutti. Cache in memoria per sessione + refresh esplicito.
import { useCallback, useEffect, useState } from "react";
import { api } from "@/src/api";
import { useAuth } from "@/src/auth";

export type BlockChild = { key: string; label: string; icon: string; description: string; route: string };
export type Block = { key: string; label: string; icon: string; color: string; description: string; route: string; enabled: boolean; children: BlockChild[] };

let _cache: { uid: string; items: Block[] } | null = null;
const _listeners = new Set<() => void>();

export async function refreshBlocks(uid: string): Promise<Block[]> {
  try {
    const r = await api<{ items: Block[] }>("/blocks");
    _cache = { uid, items: r.items || [] };
  } catch {
    if (!_cache || _cache.uid !== uid) _cache = { uid, items: [] };
  }
  _listeners.forEach((fn) => fn());
  return _cache.items;
}

export function useBlocks(): { blocks: Block[]; enabled: Block[]; loading: boolean; reload: () => Promise<void> } {
  const { user } = useAuth();
  const uid = (user as any)?.user_id || "";
  const [items, setItems] = useState<Block[]>(_cache && _cache.uid === uid ? _cache.items : []);
  const [loading, setLoading] = useState(!(_cache && _cache.uid === uid));
  const reload = useCallback(async () => { if (!uid) return; setLoading(true); setItems(await refreshBlocks(uid)); setLoading(false); }, [uid]);
  useEffect(() => {
    if (!uid) { setItems([]); setLoading(false); return; }
    const sync = () => { if (_cache && _cache.uid === uid) setItems(_cache.items); };
    _listeners.add(sync);
    if (!_cache || _cache.uid !== uid) void reload(); else setLoading(false);
    return () => { _listeners.delete(sync); };
  }, [uid, reload]);
  return { blocks: items, enabled: items.filter((b) => b.enabled), loading, reload };
}

/** Voci di menu (drawer / sidebar) per i blocchi abilitati: blocco + sottovoci (es. Energia → ANT, Fotovoltaico). */
export function blockMenuItems(enabled: Block[]): { label: string; icon: any; href: string; categoryKey: "blocks"; sub?: boolean }[] {
  const out: { label: string; icon: any; href: string; categoryKey: "blocks"; sub?: boolean }[] = [];
  for (const b of enabled) {
    out.push({ label: b.label, icon: b.icon, href: b.route, categoryKey: "blocks" });
    for (const c of b.children || []) out.push({ label: `${b.label} · ${c.label}`, icon: c.icon, href: c.route, categoryKey: "blocks", sub: true });
  }
  return out;
}
