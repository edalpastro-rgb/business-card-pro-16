// V50.z311 — tipo messaggio chat condiviso (estratto da AssistantChat.tsx)
export type ChatMsg = {
  role: "user" | "assistant";
  content: string;
  created_at?: string;
  // V38T — Track which assistant messages were augmented with web search
  used_web_search?: boolean;
  web_sources?: { title: string; url: string }[];
  // V29.n — Etichetta breve per messaggi generati da azioni rapide (es. "PUN MEDIO PER FASCE").
  // Se presente, la bubble utente mostra questa label compatta invece del prompt completo.
  quick_label?: string;
  // V29.ag — Metadata cache azione rapida: data ultimo aggiornamento + flag from_cache.
  qa_updated_at?: string;
  qa_from_cache?: boolean;
  // V40 — Streaming state + semantic cache flag
  streaming?: boolean;
  from_cache?: boolean;
  // V41 — Feedback per assistant message
  message_id?: string;
  feedback_rating?: "up" | "down" | null;
};
