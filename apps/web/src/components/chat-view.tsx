"use client";

import { useEffect, useRef, useState } from "react";
import type { Agent, Conversation, Message } from "@agent-chat/shared";
import { avatarClass, cn, formatTime, initialsFrom } from "@/lib/ui";
import { MarkdownMessage } from "@/components/markdown-message";

/**
 * The chat panel: the message list and the composer.
 *
 * Auto-scroll follows the newest message only while the reader is already at
 * the bottom, so scrolling up to read history is never yanked back.
 */
export function ChatView({
  conversation,
  agents,
  messages,
  sending,
  error,
  failedSend,
  onRetry,
  onDismissError,
  onSend,
  onStop,
  onOpenProvider,
}: {
  conversation: Conversation;
  agents: Agent[];
  messages: Message[];
  sending: boolean;
  error: string;
  /** The send that got no reply; its bubble offers a retry. */
  failedSend: { id: string; text: string } | null;
  onRetry: () => void;
  onDismissError: () => void;
  onSend: (text: string) => void;
  onStop: () => void;
  onOpenProvider: (agent: Agent) => void;
}) {
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);

  const members = conversation.agentIds
    .map((id) => agents.find((agent) => agent.id === id))
    .filter((agent): agent is Agent => Boolean(agent));

  useEffect(() => {
    const node = scrollRef.current;
    if (node && pinnedRef.current) node.scrollTop = node.scrollHeight;
  }, [messages, sending]);

  function handleScroll() {
    const node = scrollRef.current;
    if (!node) return;
    pinnedRef.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80;
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || sending) return;
    setDraft("");
    pinnedRef.current = true;
    onSend(text);
  }

  const agentMissingProvider = members.filter((agent) => agent.active);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center gap-3 border-b border-border px-4 py-3 max-md:hidden">
        <div className="flex min-w-0 items-center gap-3">
          {members.map((agent) => (
            <button
              key={agent.id}
              type="button"
              onClick={() => onOpenProvider(agent)}
              title={`${agent.name} — LLM settings`}
              className={cn(
                "grid h-7 w-7 place-items-center rounded-full text-[10px] font-bold transition-transform hover:scale-105",
                avatarClass(agent.color),
                !agent.active && "opacity-40",
              )}
            >
              {agent.initials || initialsFrom(agent.name)}
            </button>
          ))}
          <div className="grid min-w-0">
            <strong className="truncate text-sm font-semibold">{conversation.title}</strong>
            {conversation.kind === "group" ? (
              <small className="flex items-center gap-1.5 truncate text-[11px] text-faint">
                <span>{members.length} agents · they reply to each other</span>
                <span className="flex flex-none items-center -space-x-1">
                  {members.map((agent) => (
                    <span
                      key={agent.id}
                      title={agent.name}
                      className={cn(
                        "grid h-4 w-4 place-items-center rounded-full border border-surface text-[8px] font-bold",
                        avatarClass(agent.color),
                      )}
                    >
                      {agent.initials || initialsFrom(agent.name)}
                    </span>
                  ))}
                </span>
              </small>
            ) : (
              <small className="truncate text-[11px] text-faint">
                {members[0]?.role || "Direct message"}
              </small>
            )}
          </div>
        </div>
      </header>

      <div ref={scrollRef} onScroll={handleScroll} className="min-h-0 flex-1 overflow-y-auto px-4 py-5">
        <div className="mx-auto flex max-w-3xl flex-col gap-5">
          {messages.length === 0 && (
            <div className="py-16 text-center text-sm text-faint">
              {conversation.kind === "group"
                ? "Say something to start the group. The agents will take turns."
                : `Start a conversation with ${members[0]?.name ?? "this agent"}.`}
            </div>
          )}
          {messages.map((message) => (
            <MessageBubble
              key={message.id}
              message={message}
              members={members}
              failed={failedSend?.id === message.id}
              onRetry={onRetry}
            />
          ))}
          {sending && <TypingRow members={agentMissingProvider} />}
        </div>
      </div>

      {error && (
        <div className="mx-auto mb-2 flex w-full max-w-3xl items-start gap-2 rounded-[10px] border border-border bg-surface-2 px-3 py-2 text-xs text-danger">
          <span className="flex-1">{error}</span>
          <button type="button" onClick={onDismissError} className="text-muted hover:text-foreground" aria-label="Dismiss">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      <form onSubmit={submit} className="border-t border-border px-4 py-3">
        <div className="mx-auto flex max-w-3xl items-end gap-2 rounded-app border border-border bg-surface p-2 focus-within:border-accent">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                submit(event);
              }
            }}
            rows={1}
            placeholder={
              conversation.kind === "group"
                ? "Message the group…"
                : `Message ${members[0]?.name ?? "the agent"}…`
            }
            className="max-h-40 min-h-[38px] flex-1 resize-none bg-transparent px-1.5 py-2 text-sm outline-none placeholder:text-faint"
          />
          {sending ? (
            <button
              type="button"
              onClick={onStop}
              className="grid h-9 w-9 flex-none place-items-center rounded-[10px] bg-danger text-white"
              aria-label="Stop generating"
              title="Stop generating"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
            </button>
          ) : (
            <button
              type="submit"
              disabled={!draft.trim()}
              className="grid h-9 w-9 flex-none place-items-center rounded-[10px] bg-accent text-accent-foreground transition-opacity disabled:opacity-40"
              aria-label="Send"
            >
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 19V5M5 12l7-7 7 7" />
              </svg>
            </button>
          )}
        </div>
        <p className="mx-auto mt-1.5 max-w-3xl text-[10px] text-faint">
          Enter to send · Shift+Enter for a new line
        </p>
      </form>
    </div>
  );
}

function MessageBubble({
  message,
  members,
  failed,
  onRetry,
}: {
  message: Message;
  members: Agent[];
  failed: boolean;
  onRetry: () => void;
}) {
  const isUser = message.sender === "user";
  const agent = message.agentId ? members.find((member) => member.id === message.agentId) : null;

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div
          className={cn(
            "max-w-[80%] rounded-app rounded-br-sm px-3.5 py-2.5 text-sm",
            failed
              ? "border border-danger bg-surface-2 text-danger"
              : "bg-user-bubble text-user-bubble-foreground",
          )}
        >
          <p className="whitespace-pre-wrap break-words">{message.text}</p>
          {failed ? (
            <div className="mt-2 flex items-center gap-2 border-t border-danger/30 pt-2">
              <span className="flex-1 text-[11px]">Not sent — the agent never replied.</span>
              <button
                type="button"
                onClick={onRetry}
                className="rounded-md border border-danger px-2 py-0.5 text-[11px] font-semibold transition-colors hover:bg-danger hover:text-white"
              >
                Try again
              </button>
            </div>
          ) : (
            <span className="mt-1 block text-right text-[10px] opacity-70">{formatTime(message.createdAt)}</span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-3">
      <span
        className={cn(
          "relative mt-0.5 grid h-8 w-8 flex-none place-items-center rounded-[10px] text-[11px] font-bold",
          avatarClass(agent?.color ?? "violet"),
        )}
      >
        {agent?.initials || initialsFrom(message.author)}
        {agent?.active && (
          <span
            aria-label="LLM active"
            title="LLM active"
            className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-surface bg-success"
          />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-center gap-2">
          <strong className="text-xs font-semibold">{message.author}</strong>
          <span className="text-[10px] text-faint">{formatTime(message.createdAt)}</span>
        </div>
        <div className="rounded-app rounded-tl-sm border border-border bg-agent-bubble px-3.5 py-2.5 text-sm">
          <MarkdownMessage text={message.text} />
        </div>
      </div>
    </div>
  );
}

function TypingRow({ members }: { members: Agent[] }) {
  const label =
    members.length > 1
      ? `${members.length} agents are thinking…`
      : members[0]
        ? `${members[0].name} is thinking…`
        : "Thinking…";
  return (
    <div className="flex items-center gap-3 text-xs text-faint">
      <span className="flex gap-1">
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-faint [animation-delay:-0.3s]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-faint [animation-delay:-0.15s]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-faint" />
      </span>
      {label}
    </div>
  );
}
