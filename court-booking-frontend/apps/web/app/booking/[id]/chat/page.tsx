"use client";

import { Suspense, use, useEffect, useRef, useState } from "react";
import { useRequireAuth } from "@/lib/use-require-auth";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import { ApiError } from "@court-booking/api-client";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { formatPKR } from "@/lib/format";
import { useBookingFlowStore } from "@/lib/booking-flow-store";
import type { ChatAction } from "@court-booking/types";

interface Turn {
  id: string;
  sender: "player" | "ai";
  content: string;
  actions?: ChatAction[];
}

function ChatInner({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const isNew = id === "new";
  const router = useRouter();
  const search = useSearchParams();
  const venueId = search.get("venueId") ?? undefined;
  const venueName = search.get("venueName") ?? undefined;
  const courtId = search.get("courtId") ?? undefined;
  const courtName = search.get("courtName") ?? undefined;
  const startsAt = search.get("startsAt") ?? undefined;
  const price = search.get("price") ?? undefined;
  const setPaymentInstructions = useBookingFlowStore((s) => s.setPaymentInstructions);

  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [holdingKey, setHoldingKey] = useState<string | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    (async () => {
      if (!isNew) {
        try {
          const history = await api.chat.history({ booking_id: id });
          setTurns(history.map((h) => ({ id: h.id, sender: h.sender_type === "player" ? "player" : "ai", content: h.content })));
        } catch (e) {
          setBootError(friendlyErrorMessage(e));
        }
        return;
      }
      const when = startsAt ? new Date(startsAt) : null;
      const question = when
        ? `Is ${courtName || "a court"} at ${venueName || "this venue"} available on ${when.toISOString().slice(0, 10)} at ${when.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false })}?`
        : "What's available?";
      setTurns([{ id: "local-0", sender: "player", content: question }]);
      setSending(true);
      try {
        const res = await api.chat.send({ message: question, venue_id: venueId, channel: "app" });
        setTurns((t) => [...t, { id: "local-1", sender: "ai", content: res.reply, actions: res.actions }]);
      } catch (e) {
        setBootError(friendlyErrorMessage(e));
      } finally {
        setSending(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns]);

  async function sendMessage() {
    const text = input.trim();
    if (!text || sending) return;
    setInput("");
    setTurns((t) => [...t, { id: `local-${Date.now()}`, sender: "player", content: text }]);
    setSending(true);
    try {
      const res = await api.chat.send({ message: text, venue_id: venueId, booking_id: isNew ? undefined : id, channel: "app" });
      setTurns((t) => [...t, { id: `local-${Date.now()}-ai`, sender: "ai", content: res.reply, actions: res.actions }]);
    } catch (e) {
      setTurns((t) => [...t, { id: `local-${Date.now()}-err`, sender: "ai", content: friendlyErrorMessage(e) }]);
    } finally {
      setSending(false);
    }
  }

  async function handleAction(turnId: string, action: ChatAction) {
    if (action.type === "decline") {
      setTurns((t) => [...t, { id: `local-${Date.now()}`, sender: "ai", content: "No problem — let me know if you want to look at another time." }]);
      return;
    }
    if (action.type !== "confirm_booking") return;
    const key = `${turnId}-${action.label}`;
    setHoldingKey(key);
    try {
      const holdCourtId = String(action.data.court_id ?? courtId);
      const holdStartsAt = String(action.data.starts_at ?? startsAt);
      const { booking, payment_instructions } = await api.bookings.hold({ court_id: holdCourtId, starts_at: holdStartsAt });
      if (payment_instructions) setPaymentInstructions(booking.id, payment_instructions);
      router.replace(`/booking/${booking.id}/pay`);
    } catch (e) {
      const message =
        e instanceof ApiError && e.code === "SLOT_ALREADY_TAKEN"
          ? "Someone just booked this slot first — pick another time."
          : friendlyErrorMessage(e);
      setTurns((t) => [...t, { id: `local-${Date.now()}-holderr`, sender: "ai", content: message }]);
    } finally {
      setHoldingKey(null);
    }
  }

  const when = startsAt ? new Date(startsAt) : null;

  return (
    <main className="max-w-2xl mx-auto min-h-screen flex flex-col">
      <div className="px-6 py-5 bg-player-surface border-b border-player-border-light flex items-center gap-3">
        <button onClick={() => router.back()} className="w-10 h-10 rounded-xl bg-player-surface-2 flex items-center justify-center">
          ←
        </button>
        <div className="flex flex-col">
          <span className="font-bold text-[16px]">{venueName ?? "Booking assistant"}</span>
          <span className="text-[12.5px] text-player-ink-faint flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-player-success inline-block" /> Booking assistant
          </span>
        </div>
      </div>

      {courtName && when ? (
        <div className="px-6 py-3.5 bg-player-accent-soft border-b border-player-accent-soft-border flex items-center justify-between">
          <div className="flex flex-col">
            <span className="text-[11px] font-bold tracking-widest text-player-accent-hover">SELECTED SLOT</span>
            <span className="font-mono text-[14.5px] font-semibold">
              {courtName} · {when.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false })}
            </span>
          </div>
          {price ? <span className="font-mono text-base font-semibold">{formatPKR(Number(price))}</span> : null}
        </div>
      ) : null}

      <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-3.5">
        {turns.map((turn) => (
          <div key={turn.id} className={`flex flex-col gap-2 ${turn.sender === "player" ? "items-end" : "items-start"}`}>
            <div
              className="px-4 py-3 max-w-[82%]"
              style={{
                background: turn.sender === "player" ? "#141A1D" : "#FFFFFF",
                color: turn.sender === "player" ? "#FFFFFF" : "#141A1D",
                borderRadius: 16,
                borderTopRightRadius: turn.sender === "player" ? 4 : 16,
                borderTopLeftRadius: turn.sender === "player" ? 16 : 4,
                border: turn.sender === "player" ? "none" : "1px solid #EBE5E1",
              }}
            >
              <p className="text-[14.5px] leading-relaxed whitespace-pre-wrap">{turn.content}</p>
            </div>
            {turn.actions && turn.actions.length > 0 ? (
              <div className="flex gap-2 flex-wrap">
                {turn.actions.map((action) => {
                  const key = `${turn.id}-${action.label}`;
                  const isHolding = holdingKey === key;
                  return (
                    <button
                      key={key}
                      onClick={() => handleAction(turn.id, action)}
                      disabled={!!holdingKey}
                      className="px-4 h-11 rounded-xl font-bold text-[13.5px] disabled:opacity-50"
                      style={{
                        background: action.type === "confirm_booking" ? "#EF5A2C" : "#FFFFFF",
                        color: action.type === "confirm_booking" ? "#FFFFFF" : "#5C544D",
                        border: action.type === "confirm_booking" ? "none" : "1px solid #E0D9D4",
                      }}
                    >
                      {isHolding ? "…" : action.label}
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
        ))}
        {bootError ? <p className="text-player-danger text-sm text-center">{bootError}</p> : null}
        <div ref={bottomRef} />
      </div>

      <div className="px-6 py-4 bg-player-surface border-t border-player-border-light flex items-center gap-2.5">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && sendMessage()}
          placeholder="Type a message…"
          disabled={sending}
          className="flex-1 h-12 px-4 rounded-full bg-player-surface-2 outline-none text-[14.5px]"
        />
        <button
          onClick={sendMessage}
          disabled={sending || !input.trim()}
          className="w-11 h-11 rounded-full bg-player-accent text-white font-bold disabled:opacity-50"
        >
          →
        </button>
      </div>
    </main>
  );
}

function ChatPageInner({ params }: PageProps<"/booking/[id]/chat">) {
  return (
    <Suspense>
      <ChatInner params={params} />
    </Suspense>
  );
}

/** Booking screens need a session: a signed-out visitor is sent to log in and brought back here,
 * instead of the page silently signing them out on the first 401 with no explanation. */
export default function ChatPage(props: PageProps<"/booking/[id]/chat">) {
  const { ready } = useRequireAuth();
  if (!ready) return null;
  return <ChatPageInner {...props} />;
}
