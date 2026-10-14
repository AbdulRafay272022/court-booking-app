"use client";

import { courtLabel } from "@/components/court-label";
import { Suspense, use, useEffect, useRef, useState } from "react";
import { useRequireAuth } from "@/lib/use-require-auth";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import { ApiError } from "@court-booking/api-client";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { formatPKR } from "@/lib/format";
import { useBookingFlowStore } from "@/lib/booking-flow-store";
import type { ChatAction } from "@court-booking/types";
import { useT } from "@/components/i18n/lang-provider";
import { useFmt } from "@/lib/use-fmt";
import type { Fmt } from "@/lib/format-i18n";
import type { TFunction } from "@/lib/i18n";

interface Turn {
  id: string;
  sender: "player" | "ai";
  content: string;
  actions?: ChatAction[];
  /** When the message was sent/received (ms since epoch), shown under the bubble. */
  at: number;
}

/** "7:42 PM" for today's messages, "Wed, 23 Sep · 7:42 PM" for older ones (history opened days later). */
function stamp(at: number, fmt: Fmt): string {
  const d = new Date(at);
  return fmt.date(d) === fmt.date(new Date()) ? fmt.time(d) : `${fmt.date(d)} · ${fmt.time(d)}`;
}

/** Offered under an assistant reply that carries no buttons, so a player is never stuck typing from scratch. */
const QUICK_REPLY_KEYS = ["play.chat.quick1", "play.chat.quick2", "play.chat.quick3"] as const;

/** The Yes button the assistant proposes names the exact slot ("Yes, book 7:00 PM to 8:00 PM, Wed 23 Sep"). */
function actionLabel(action: ChatAction, t: TFunction): string {
  const slot = action.data?.label;
  return action.type === "confirm_booking" && typeof slot === "string" && slot ? t("play.chat.yesBook", { slot }) : action.label;
}

function AssistantAvatar() {
  return (
    <span
      aria-hidden="true"
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-player-accent-soft-border bg-player-accent-soft text-player-accent"
    >
      <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z" />
        <path d="M8.5 12h.01M12 12h.01M15.5 12h.01" />
      </svg>
    </span>
  );
}

function TypingBubble() {
  const t = useT();
  return (
    <div className="flex items-end gap-2" role="status" aria-label={t("play.chat.typing")} data-testid="typing-indicator">
      <AssistantAvatar />
      <div className="flex items-center gap-1.5 rounded-2xl rounded-bl-md border border-player-border-light bg-player-surface px-4 py-3.5 shadow-[0_1px_2px_rgba(20,26,29,0.05)]">
        {[0, 1, 2].map((i) => (
          <span key={i} className="h-2 w-2 animate-bounce rounded-full bg-player-ink-fainter" style={{ animationDelay: `${i * 150}ms` }} />
        ))}
      </div>
    </div>
  );
}

function ChatInner({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const t = useT();
  const fmt = useFmt();
  const isNew = id === "new";
  const router = useRouter();
  const search = useSearchParams();
  const venueId = search.get("venueId") ?? undefined;
  const venueName = search.get("venueName") ?? undefined;
  const courtId = search.get("courtId") ?? undefined;
  const courtName = search.get("courtName") ?? undefined;
  const courtSport = search.get("courtSport") ?? undefined;
  const startsAt = search.get("startsAt") ?? undefined;
  const price = search.get("price") ?? undefined;
  // How long the player chose in the duration sheet (Section 32 Part 4); a link without them means one slot.
  const slotCount = Math.max(1, Number(search.get("slotCount") ?? 1) || 1);
  const minutes = Number(search.get("minutes") ?? 0) || undefined;
  const setPaymentInstructions = useBookingFlowStore((s) => s.setPaymentInstructions);

  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [holdingKey, setHoldingKey] = useState<string | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  // The opening question must be sent ONCE. React's dev mode runs an effect twice on mount, which sent it (and asked
  // the paid AI) twice and showed the answer twice; the ref survives that simulated remount.
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    (async () => {
      if (!isNew) {
        try {
          const history = await api.chat.history({ booking_id: id });
          setTurns(
            history.map((h) => ({
              id: h.id,
              sender: h.sender_type === "player" ? "player" : "ai",
              content: h.content,
              at: new Date(h.created_at).getTime(),
            })),
          );
        } catch (e) {
          setBootError(friendlyErrorMessage(e));
        }
        return;
      }
      const when = startsAt ? new Date(startsAt) : null;
      const questionVars = {
        court: courtName || t("play.chat.courtFallback"),
        venue: venueName || t("play.chat.venueFallback"),
        date: when ? fmt.date(when) : "",
        time: when ? fmt.time(when) : "",
        duration: minutes ? fmt.duration(minutes) : "",
      };
      const question = when
        ? t(minutes ? "play.chat.questionFor" : "play.chat.question", questionVars)
        : t("play.chat.whatsAvailable");
      setTurns([{ id: "local-0", sender: "player", content: question, at: Date.now() }]);
      setSending(true);
      try {
        const res = await api.chat.send({ message: question, venue_id: venueId, channel: "app" });
        setTurns((prev) => [...prev, { id: "local-1", sender: "ai", content: res.reply, actions: res.actions, at: Date.now() }]);
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
  }, [turns, sending]);

  async function sendMessage(override?: string) {
    const text = (override ?? input).trim();
    if (!text || sending) return;
    setInput("");
    setTurns((prev) => [...prev, { id: `local-${Date.now()}`, sender: "player", content: text, at: Date.now() }]);
    setSending(true);
    try {
      const res = await api.chat.send({ message: text, venue_id: venueId, booking_id: isNew ? undefined : id, channel: "app" });
      setTurns((prev) => [...prev, { id: `local-${Date.now()}-ai`, sender: "ai", content: res.reply, actions: res.actions, at: Date.now() }]);
    } catch (e) {
      setTurns((prev) => [...prev, { id: `local-${Date.now()}-err`, sender: "ai", content: friendlyErrorMessage(e), at: Date.now() }]);
    } finally {
      setSending(false);
    }
  }

  async function handleAction(turnId: string, action: ChatAction) {
    if (action.type === "decline") {
      setTurns((prev) => [
        ...prev,
        { id: `local-${Date.now()}`, sender: "ai", content: t("play.chat.decline"), at: Date.now() },
      ]);
      return;
    }
    if (action.type !== "confirm_booking") return;
    const key = `${turnId}-${action.label}`;
    setHoldingKey(key);
    try {
      const holdCourtId = String(action.data.court_id ?? courtId);
      const holdStartsAt = String(action.data.starts_at ?? startsAt);
      // The Yes button the assistant showed carries the length it quoted; fall back to what was picked before the chat.
      const holdSlotCount = Number(action.data.slot_count ?? slotCount) || 1;
      // A name the player gave in the chat (their own or a friend's) rides on the Yes button; the server tidies it.
      const holdPlayerName = typeof action.data.player_name === "string" ? action.data.player_name.trim() : "";
      const { booking, payment_instructions } = await api.bookings.hold({
        court_id: holdCourtId,
        starts_at: holdStartsAt,
        slot_count: holdSlotCount,
        ...(holdPlayerName ? { player_name: holdPlayerName } : {}),
        // The server saves the name on the account only when this hold is created AND it is the player's own name.
        ...(holdPlayerName && action.data.name_is_players_own === true ? { name_is_own: true } : {}),
      });
      if (payment_instructions) setPaymentInstructions(booking.id, payment_instructions);
      router.replace(`/booking/${booking.id}/pay`);
    } catch (e) {
      const message =
        e instanceof ApiError && e.code === "SLOT_ALREADY_TAKEN"
          ? t("play.chat.slotTaken")
          : friendlyErrorMessage(e);
      setTurns((prev) => [...prev, { id: `local-${Date.now()}-holderr`, sender: "ai", content: message, at: Date.now() }]);
    } finally {
      setHoldingKey(null);
    }
  }

  const when = startsAt ? new Date(startsAt) : null;
  const last = turns[turns.length - 1];
  const showQuickReplies = !sending && !holdingKey && !bootError && last?.sender === "ai" && !(last.actions && last.actions.length > 0);

  return (
    <main className="mx-auto flex h-dvh max-w-2xl flex-col bg-player-bg sm:border-x border-player-border-light">
      <header className="flex items-center gap-3 border-b border-player-border-light bg-player-surface px-4 sm:px-6 py-3.5">
        <button
          onClick={() => router.back()}
          aria-label={t("play.chat.back")}
          className="flex h-10 w-10 items-center justify-center rounded-xl bg-player-surface-2 text-player-ink transition-colors hover:bg-player-accent-soft hover:text-player-accent-hover"
        >
          ←
        </button>
        <AssistantAvatar />
        <div className="flex min-w-0 flex-col leading-tight">
          <span className="truncate text-[16px] font-bold">{venueName ?? t("play.chat.assistant")}</span>
          <span className="flex items-center gap-1.5 text-[12.5px] text-player-ink-faint">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-player-success" /> {t("play.chat.assistantSub")}
          </span>
        </div>
      </header>

      {courtName && when ? (
        <div className="flex items-center justify-between gap-3 border-b border-player-accent-soft-border bg-player-accent-soft px-4 sm:px-6 py-3">
          <div className="flex min-w-0 flex-col">
            <span className="text-[11px] font-bold tracking-widest text-player-accent-hover">{t("play.chat.selectedSlot")}</span>
            <span className="font-mono text-[14px] font-semibold">
              {courtLabel(courtName, courtSport)} · {fmt.date(when)}, {minutes ? fmt.timeRange(when, new Date(when.getTime() + minutes * 60_000)) : fmt.time(when)}
              {minutes ? ` · ${fmt.duration(minutes)}` : ""}
            </span>
          </div>
          {price ? <span className="shrink-0 rounded-full bg-player-surface px-3 py-1 font-mono text-[14px] font-bold">PKR {formatPKR(Number(price))}</span> : null}
        </div>
      ) : null}

      <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 sm:px-6 py-6" data-testid="chat-scroll">
        {turns.map((turn) => {
          const mine = turn.sender === "player";
          return (
            <div key={turn.id} className={`flex flex-col gap-1.5 ${mine ? "items-end" : "items-start"}`} data-testid={mine ? "msg-player" : "msg-ai"}>
              <div className={`flex max-w-[88%] items-end gap-2 ${mine ? "flex-row-reverse" : ""}`}>
                {mine ? null : <AssistantAvatar />}
                <div
                  className={`px-4 py-2.5 shadow-[0_1px_2px_rgba(20,26,29,0.06)] ${
                    mine
                      ? "rounded-2xl rounded-br-md bg-player-accent text-white"
                      : "rounded-2xl rounded-bl-md border border-player-border-light bg-player-surface text-player-ink"
                  }`}
                >
                  <p className="whitespace-pre-wrap text-[15px] leading-relaxed">{turn.content}</p>
                </div>
              </div>
              <span className={`text-[11.5px] text-player-ink-fainter ${mine ? "pr-1" : "pl-10"}`}>{stamp(turn.at, fmt)}</span>
              {turn.actions && turn.actions.length > 0 ? (
                <div className="mt-1 flex flex-wrap gap-2 pl-10">
                  {turn.actions.map((action) => {
                    const key = `${turn.id}-${action.label}`;
                    const isHolding = holdingKey === key;
                    const confirm = action.type === "confirm_booking";
                    return (
                      <button
                        key={key}
                        onClick={() => handleAction(turn.id, action)}
                        disabled={!!holdingKey}
                        className={`min-h-11 rounded-xl px-4 py-2 text-[13.5px] font-bold transition-all disabled:opacity-50 ${
                          confirm
                            ? "bg-player-accent text-white shadow-[0_6px_16px_-6px_rgba(239,90,44,0.7)] hover:bg-player-accent-hover"
                            : "border border-player-border bg-player-surface text-player-ink-muted hover:border-player-ink-fainter"
                        }`}
                      >
                        {isHolding ? t("play.chat.holding") : actionLabel(action, t)}
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>
          );
        })}
        {sending ? <TypingBubble /> : null}
        {showQuickReplies ? (
          <div className="flex flex-wrap gap-2 pl-10" data-testid="quick-replies">
            {QUICK_REPLY_KEYS.map((k) => t(k)).map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => sendMessage(q)}
                className="rounded-full border border-player-accent-soft-border bg-player-surface px-3.5 py-2 text-[13px] font-semibold text-player-accent-hover transition-colors hover:bg-player-accent-soft"
              >
                {q}
              </button>
            ))}
          </div>
        ) : null}
        {bootError ? <p className="text-center text-sm text-player-danger">{bootError}</p> : null}
        <div ref={bottomRef} />
      </div>

      <div className="border-t border-player-border-light bg-player-surface px-4 sm:px-6 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="flex items-center gap-2 rounded-full border border-player-border bg-player-bg py-1.5 pl-5 pr-1.5 transition focus-within:border-player-accent focus-within:ring-4 focus-within:ring-player-accent-soft">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && sendMessage()}
            placeholder={t("play.chat.placeholder")}
            aria-label={t("play.chat.inputAria")}
            disabled={sending}
            className="h-10 flex-1 bg-transparent text-[15px] outline-none placeholder:text-player-ink-fainter"
          />
          <button
            onClick={() => sendMessage()}
            disabled={sending || !input.trim()}
            aria-label={t("play.chat.sendAria")}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-player-accent text-white transition-colors hover:bg-player-accent-hover disabled:bg-player-border"
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </button>
        </div>
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
