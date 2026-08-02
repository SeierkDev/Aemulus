"use client";

import { useState } from "react";
import { Button, Card, Label } from "@/components/ui";

/**
 * Redeeming the code the bot handed out.
 *
 * The wallet has already signed to get here, which is the whole point of
 * finishing this flow on the site: the server can bind the chat to a wallet it
 * has actually verified, rather than to one somebody typed.
 */
export function TelegramLink({ initial }: { initial: string[] }) {
  const [chats, setChats] = useState(initial);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit() {
    if (!code.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/telegram/link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setError(data.error ?? "Could not link this chat.");
        return;
      }
      setDone(true);
      setCode("");
      const list = await fetch("/api/telegram/link").then((r) => r.json());
      setChats((list as { chats?: string[] }).chats ?? []);
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Card className="p-6">
        <Label>Code from Telegram</Label>
        <div className="mt-3 flex flex-col gap-3 sm:flex-row">
          <input
            value={code}
            onChange={(e) => {
              setCode(e.target.value.toUpperCase());
              setDone(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") void submit();
            }}
            placeholder="A1B2C3D4"
            maxLength={12}
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            className="mono w-full rounded-lg border border-border bg-surface-2 px-4 py-3 text-lg tracking-[0.25em] outline-none placeholder:text-ink-3 focus:border-border-strong"
          />
          <Button variant="primary" onClick={() => void submit()} disabled={busy || !code.trim()}>
            {busy ? "Linking…" : "Link"}
          </Button>
        </div>

        {error && <p className="mt-3 text-sm text-ink-2">{error}</p>}
        {done && (
          <p className="mt-3 text-sm text-ink">
            Linked. Alerts will arrive in that chat.
          </p>
        )}
      </Card>

      {chats.length > 0 && (
        <Card className="mt-4 p-6">
          <Label>Connected</Label>
          <p className="mt-2 text-sm text-ink-2">
            {chats.length === 1
              ? "One Telegram chat is receiving your alerts."
              : `${chats.length} Telegram chats are receiving your alerts.`}{" "}
            Send <span className="mono">/unlink</span> in a chat to disconnect it.
          </p>
        </Card>
      )}
    </>
  );
}
