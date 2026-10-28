"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { parseMentions, type Agent, type Conversation, type Message, type Task, type TaskStatus, type UpdateTaskRequest } from "@agent-chat/shared";
import { avatarClass, cn, formatTime, initialsFrom } from "@/lib/ui";
import { MarkdownMessage } from "@/components/markdown-message";

/**
 * The chat panel: the message list and the composer.
 *
 * The composer changes with the room kind. In a chat, typing "@" opens an agent
 * picker and the called names decide who answers; in a group, everyone takes
 * turns. The group view also carries the shared task board.
 *
 * Auto-scroll follows the newest message only while the reader is already at
 * the bottom, so scrolling up to read history is never yanked back.
 */
export function ChatView({
  conversation,
  agents,
  messages,
  tasks,
  sending,
  error,
  failedSend,
  onRetry,
  onDismissError,
  onSend,
  onStop,
  onCreateTask,
  onUpdateTask,
  onDeleteTask,
}: {
  conversation: Conversation;
  agents: Agent[];
  messages: Message[];
  tasks: Task[];
  sending: boolean;
  error: string;
  /** The send that got no reply; its bubble offers a retry. */
  failedSend: { id: string; text: string } | null;
  onRetry: () => void;
  onDismissError: () => void;
  onSend: (text: string) => void;
  onStop: () => void;
  onCreateTask: (input: { title: string; assigneeAgentId: string | null }) => Promise<void>;
  onUpdateTask: (taskId: string, patch: UpdateTaskRequest) => Promise<void>;
  onDeleteTask: (taskId: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const pinnedRef = useRef(true);

  const members = conversation.agentIds
    .map((id) => agents.find((agent) => agent.id === id))
    .filter((agent): agent is Agent => Boolean(agent));
  const activeMembers = members.filter((agent) => agent.active);

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

  // The mention popover: open while the draft ends in "@" or "@partial", in a
  // room where mentions actually decide who answers.
  const mentionMatch = conversation.turnPolicy === "mentions" ? /@([\w-]*)$/.exec(draft) : null;
  const mentionOptions = useMemo(() => {
    if (!mentionMatch) return [];
    const query = (mentionMatch[1] ?? "").toLowerCase();
    return activeMembers.filter((agent) => agent.name.toLowerCase().startsWith(query));
  }, [mentionMatch, activeMembers]);

  const draftMentions = useMemo(
    () => parseMentions(draft, activeMembers).map((id) => activeMembers.find((agent) => agent.id === id)?.name).filter(Boolean),
    [draft, activeMembers],
  );

  function pickMention(agent: Agent) {
    setDraft((current) => current.replace(/@([\w-]*)$/, `@${agent.name} `));
    composerRef.current?.focus();
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center gap-3 border-b border-border px-4 py-3 max-md:hidden">
        <div className="flex min-w-0 items-center gap-3">
          <div className="grid min-w-0">
            <strong className="truncate text-sm font-semibold">{conversation.title}</strong>
            {conversation.kind === "group" ? (
              <small className="flex items-center gap-1.5 truncate text-[11px] text-faint">
                <span>{members.length} agents · team, takes turns</span>
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
            ) : conversation.turnPolicy === "mentions" ? (
              <small className="truncate text-[11px] text-faint">
                Shared session · call agents with @Name
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
              {conversation.turnPolicy === "rounds"
                ? "Say something to start the group. The agents will take turns."
                : conversation.turnPolicy === "mentions"
                  ? "Start the session. Call an agent by name with @, or send a message for everyone."
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
          {sending && <TypingRow members={activeMembers} policy={conversation.turnPolicy} />}
        </div>
      </div>

      {conversation.kind === "group" && (
        <TaskBoard
          tasks={tasks}
          members={members}
          onCreate={onCreateTask}
          onUpdate={onUpdateTask}
          onDelete={onDeleteTask}
        />
      )}

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
        <div className="mx-auto max-w-3xl">
          {(draftMentions.length > 0 || conversation.turnPolicy === "mentions") && (
            <div className="mb-1.5 flex flex-wrap items-center gap-1.5 text-[10px] text-faint">
              {conversation.turnPolicy === "mentions" && (
                <>
                  <span>Will reply:</span>
                  {draftMentions.length > 0 ? (
                    draftMentions.map((name) => (
                      <span key={name} className="rounded-full bg-accent-soft px-2 py-0.5 font-semibold text-accent">
                        {name}
                      </span>
                    ))
                  ) : (
                    <span className="rounded-full bg-surface-2 px-2 py-0.5">all active members</span>
                  )}
                </>
              )}
            </div>
          )}

          {mentionOptions.length > 0 && (
            <div className="mb-1.5 flex flex-wrap gap-1 rounded-[10px] border border-border bg-surface p-1.5">
              {mentionOptions.map((agent) => (
                <button
                  key={agent.id}
                  type="button"
                  onClick={() => pickMention(agent)}
                  className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs transition-colors hover:bg-surface-2"
                >
                  <span className={cn("grid h-5 w-5 place-items-center rounded-full text-[9px] font-bold", avatarClass(agent.color))}>
                    {agent.initials || initialsFrom(agent.name)}
                  </span>
                  {agent.name}
                </button>
              ))}
            </div>
          )}

          <div className="flex items-end gap-2 rounded-app border border-border bg-surface p-2 focus-within:border-accent">
            <textarea
              ref={composerRef}
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
                conversation.turnPolicy === "rounds"
                  ? "Message the team…"
                  : conversation.turnPolicy === "mentions"
                    ? "Message the session, or @ an agent…"
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
          <p className="mt-1.5 text-[10px] text-faint">
            Enter to send · Shift+Enter for a new line
            {conversation.turnPolicy === "mentions" && " · @Name picks who answers"}
          </p>
        </div>
      </form>
    </div>
  );
}

const STATUS_LABEL: Record<TaskStatus, string> = {
  pending: "Pending",
  in_progress: "In progress",
  review: "Review",
  done: "Approved",
};

const STATUS_CLASS: Record<TaskStatus, string> = {
  pending: "bg-surface-2 text-muted",
  in_progress: "bg-accent-soft text-accent",
  review: "bg-warning-surface text-warning",
  done: "bg-success-surface text-success",
};

/** The shared plan of a group: add, assign, move, approve, remove. */
function TaskBoard({
  tasks,
  members,
  onCreate,
  onUpdate,
  onDelete,
}: {
  tasks: Task[];
  members: Agent[];
  onCreate: (input: { title: string; assigneeAgentId: string | null }) => Promise<void>;
  onUpdate: (taskId: string, patch: UpdateTaskRequest) => Promise<void>;
  onDelete: (taskId: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(tasks.length > 0);
  const [title, setTitle] = useState("");
  const [assignee, setAssignee] = useState("");
  const [busy, setBusy] = useState(false);

  const done = tasks.filter((task) => task.status === "done").length;

  async function add(event: React.FormEvent) {
    event.preventDefault();
    const value = title.trim();
    if (!value || busy) return;
    setBusy(true);
    try {
      await onCreate({ title: value, assigneeAgentId: assignee || null });
      setTitle("");
      setAssignee("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="border-t border-border bg-surface/60">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="flex w-full items-center gap-2 px-4 py-2 text-left text-[11px] font-semibold text-muted transition-colors hover:text-foreground"
      >
        <span className="uppercase tracking-wider">Tasks</span>
        <span className="rounded-full bg-surface-2 px-1.5 py-0.5 text-[10px] text-faint">
          {done}/{tasks.length} done
        </span>
        <span className="ml-auto text-faint">{open ? "▾" : "▸"}</span>
      </button>

      {open && (
        <div className="grid gap-1.5 px-4 pb-3">
          <form onSubmit={add} className="flex gap-1.5">
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Add a task…"
              className="min-w-0 flex-1 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs outline-none placeholder:text-faint focus:border-accent"
            />
            <select
              value={assignee}
              onChange={(event) => setAssignee(event.target.value)}
              className="rounded-lg border border-border bg-surface px-1.5 py-1.5 text-[11px] text-muted outline-none"
              aria-label="Assignee"
            >
              <option value="">Unassigned</option>
              {members.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name}
                </option>
              ))}
            </select>
            <button
              type="submit"
              disabled={busy || !title.trim()}
              className="rounded-lg bg-accent px-2.5 py-1.5 text-[11px] font-semibold text-accent-foreground disabled:opacity-40"
            >
              Add
            </button>
          </form>

          {tasks.map((task) => (
            <div key={task.id} className="flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2 py-1.5">
              <select
                value={task.status}
                onChange={(event) => void onUpdate(task.id, { status: event.target.value as TaskStatus })}
                className={cn("rounded-md px-1.5 py-0.5 text-[10px] font-semibold outline-none", STATUS_CLASS[task.status])}
                aria-label="Task status"
              >
                {(Object.keys(STATUS_LABEL) as TaskStatus[]).map((status) => (
                  <option key={status} value={status}>
                    {STATUS_LABEL[status]}
                  </option>
                ))}
              </select>
              <span className={cn("min-w-0 flex-1 truncate text-xs", task.status === "done" && "text-faint line-through")}>
                {task.title}
              </span>
              {task.status === "review" && (
                <button
                  type="button"
                  onClick={() => void onUpdate(task.id, { status: "done" })}
                  className="rounded-md border border-success px-1.5 py-0.5 text-[10px] font-semibold text-success transition-colors hover:bg-success hover:text-white"
                >
                  Approve
                </button>
              )}
              <select
                value={task.assigneeAgentId ?? ""}
                onChange={(event) => void onUpdate(task.id, { assigneeAgentId: event.target.value || null })}
                className="max-w-24 truncate rounded-md border border-border bg-surface px-1 py-0.5 text-[10px] text-muted outline-none"
                aria-label="Assignee"
              >
                <option value="">—</option>
                {members.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => void onDelete(task.id)}
                className="grid h-5 w-5 place-items-center rounded text-faint transition-colors hover:bg-surface-2 hover:text-danger"
                aria-label="Delete task"
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
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

/**
 * The "someone is answering" row.
 *
 * The avatars of the agents about to speak, each bouncing on its own beat, so
 * the row says who is working rather than just that something is. A room with
 * more members than fit shows the first few and a count for the rest.
 */
const MAX_TYPING_AVATARS = 4;

function TypingRow({ members, policy }: { members: Agent[]; policy: Conversation["turnPolicy"] }) {
  const label =
    policy === "rounds"
      ? "The team is taking turns…"
      : members.length > 1
        ? `${members.length} agents are thinking…`
        : members[0]
          ? `${members[0].name} is thinking…`
          : "Thinking…";

  const shown = members.slice(0, MAX_TYPING_AVATARS);
  const extra = members.length - shown.length;

  return (
    <div className="flex items-center gap-3 text-xs text-faint">
      <span className="flex items-center gap-1">
        {shown.map((agent, index) => (
          <span
            key={agent.id}
            title={agent.name}
            style={{ animationDelay: `${index * -0.15}s` }}
            className={cn(
              "grid h-6 w-6 animate-bounce place-items-center rounded-full text-[9px] font-bold",
              avatarClass(agent.color),
              !agent.active && "opacity-40",
            )}
          >
            {agent.initials || initialsFrom(agent.name)}
          </span>
        ))}
        {extra > 0 && <span className="ml-0.5 text-[10px] text-faint">+{extra}</span>}
      </span>
      {label}
    </div>
  );
}
