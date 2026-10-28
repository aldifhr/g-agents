"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import type {
  Agent,
  Conversation,
  Message,
  SendMessageResponse,
  SpaceResponse,
  Task,
  TurnPolicy,
  UpdateTaskRequest,
} from "@agent-chat/shared";
import { apiErrorMessage, apiFetch } from "@/lib/api";
import { useTheme } from "@/hooks/use-theme";
import { AgentModal } from "@/components/modals/agent-modal";
import { RoomModal } from "@/components/modals/room-modal";
import { ProviderModal } from "@/components/modals/provider-modal";
import { Sidebar } from "@/components/sidebar";
import { ChatView } from "@/components/chat-view";
import { WelcomeView } from "@/components/welcome-view";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/form";

export type ToolInfo = { name: string; description: string };

/**
 * Every room kind is addressed by its own conversation id, so the two routes
 * are symmetric: /dm/:id, /group/:id.
 */
function conversationPath(conversation: Conversation) {
  return `/${conversation.kind}/${encodeURIComponent(conversation.id)}`;
}

/**
 * The whole app: the space state, the routing between rooms, and the actions
 * that mutate them. The sidebar and the chat panel are presentational; every
 * fetch and every write happens here so there is one source of truth.
 */
export function AppShell() {
  const { theme, toggleTheme } = useTheme();
  const pathname = usePathname();
  const router = useRouter();

  const [agents, setAgents] = useState<Agent[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string>("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [toolCatalog, setToolCatalog] = useState<ToolInfo[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [backendDown, setBackendDown] = useState(false);
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  /** The in-flight or failed send, so the bubble can offer a retry. */
  const [pendingSend, setPendingSend] = useState<{ id: string; text: string; failed: boolean } | null>(null);
  const [navOpen, setNavOpen] = useState(false);
  const [modal, setModal] = useState<
    | { kind: "agent" }
    | { kind: "edit-agent"; agent: Agent }
    | { kind: "room" }
    | { kind: "provider"; agent: Agent }
    | { kind: "confirm"; title: string; body: string; onConfirm: () => void }
    | null
  >(null);

  const activeConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === activeId) ?? null,
    [conversations, activeId],
  );

  // --- Load ---------------------------------------------------------------

  const readSpace = useCallback(async () => {
    try {
      const body = await apiFetch<SpaceResponse>("/api/space");
      setAgents(body.space.agents);
      setConversations(body.space.conversations);
      setBackendDown(false);
    } catch (caught) {
      setBackendDown(true);
      setError(apiErrorMessage(caught));
    }
  }, []);

  useEffect(() => {
    void readSpace().finally(() => setLoaded(true));
  }, [readSpace]);

  useEffect(() => {
    void apiFetch<{ tools: ToolInfo[] }>("/api/tools")
      .then((body) => setToolCatalog(body.tools))
      .catch(() => setToolCatalog([]));
  }, []);

  const readMessages = useCallback(async (conversationId: string) => {
    if (!conversationId) {
      setMessages([]);
      return;
    }
    try {
      const body = await apiFetch<{ messages: Message[] }>(
        `/api/conversations/${encodeURIComponent(conversationId)}`,
      );
      setMessages(body.messages);
    } catch (caught) {
      setError(apiErrorMessage(caught));
    }
  }, []);

  useEffect(() => {
    void readMessages(activeId);
  }, [activeId, readMessages]);

  const readTasks = useCallback(async (conversationId: string) => {
    if (!conversationId) {
      setTasks([]);
      return;
    }
    try {
      const body = await apiFetch<{ tasks: Task[] }>(
        `/api/conversations/${encodeURIComponent(conversationId)}/tasks`,
      );
      setTasks(body.tasks);
    } catch {
      setTasks([]);
    }
  }, []);

  useEffect(() => {
    void readTasks(activeId);
  }, [activeId, readTasks]);

  useEffect(() => {
    if (!loaded) return;
    const match = pathname.match(/^\/(dm|group)\/([^/]+)$/);
    if (match) {
      const key = decodeURIComponent(match[2]);
      const conversation = conversations.find((item) => item.kind === match[1] && item.id === key);
      if (conversation) {
        setActiveId(conversation.id);
        return;
      }
      router.replace("/");
      return;
    }
    if (pathname !== "/") {
      router.replace("/");
      return;
    }
    // On the home route, stay on the overview. Opening a room is the user's
    // choice from the sidebar or the welcome list; auto-redirecting into the
    // first room would hijack the landing page every time.
    setActiveId("");
  }, [conversations, loaded, pathname, router]);

  // --- Send ---------------------------------------------------------------

  async function sendMessage(text: string) {
    if (!activeConversation || sending) return;
    setSending(true);
    setError("");

    // One optimistic bubble per send; a retry reuses it instead of stacking.
    const optimisticId = pendingSend?.id ?? `pending-${Date.now()}`;
    const optimistic: Message = {
      id: optimisticId,
      conversationId: activeConversation.id,
      runId: null,
      sender: "user",
      agentId: null,
      author: "You",
      parts: [{ type: "text", text }],
      text,
      status: "complete",
      createdAt: new Date().toISOString(),
    };
    setPendingSend({ id: optimisticId, text, failed: false });
    setMessages((current) => [
      ...current.filter((message) => message.id !== optimisticId),
      optimistic,
    ]);

    try {
      const result = await apiFetch<SendMessageResponse>(
        `/api/conversations/${encodeURIComponent(activeConversation.id)}/messages`,
        { method: "POST", body: JSON.stringify({ text }) },
      );
      setMessages((current) => [
        ...current.filter((message) => message.id !== optimisticId),
        result.userMessage,
        ...result.replies,
      ]);
      setPendingSend(null);
      const runMessages = [
        ...(result.interrupted ? ["Run interrupted · Stopped by user"] : []),
        ...result.errors,
      ];
      if (runMessages.length > 0) setError(runMessages.join(" "));
      await readSpace();
      await readTasks(activeConversation.id);
    } catch (caught) {
      setError(apiErrorMessage(caught));
      // The server rolls back a send no agent answered, so the bubble stays as
      // a failed one with a retry. The only exception is a lost response: the
      // send may have landed anyway, and history is the truth when it did.
      try {
        const body = await apiFetch<{ messages: Message[] }>(
          `/api/conversations/${encodeURIComponent(activeConversation.id)}`,
        );
        const knownIds = new Set(messages.map((message) => message.id));
        const landed = body.messages.some((saved) => !knownIds.has(saved.id));
        if (landed) {
          setMessages(body.messages);
          setPendingSend(null);
        } else {
          setPendingSend({ id: optimisticId, text, failed: true });
        }
      } catch {
        setPendingSend({ id: optimisticId, text, failed: true });
      }
    } finally {
      setSending(false);
    }
  }

  /** Re-sends the text of the failed bubble. */
  function retrySend() {
    if (!pendingSend?.failed || sending) return;
    void sendMessage(pendingSend.text);
  }

  /**
   * Stops the agent run in flight. The server aborts the provider calls, so
   * the pending POST settles with `interrupted: true` and the replies that
   * already landed are kept.
   */
  async function stopGeneration() {
    if (!activeConversation) return;
    try {
      await apiFetch(`/api/conversations/${encodeURIComponent(activeConversation.id)}/stop`, {
        method: "POST",
      });
    } catch (caught) {
      setError(apiErrorMessage(caught));
    }
  }

  // --- Agent actions ------------------------------------------------------

  async function createAgent(input: {
    name: string;
    role: string;
    systemPrompt: string;
    color: Agent["color"];
    tools: string[];
  }) {
    await apiFetch("/api/agents", { method: "POST", body: JSON.stringify(input) });
    await readSpace();
  }

  async function updateAgent(id: string, patch: Partial<Agent>) {
    await apiFetch(`/api/agents/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
    await readSpace();
  }

  function deleteAgent(agent: Agent) {
    setModal({
      kind: "confirm",
      title: `Delete ${agent.name}?`,
      body: "The agent is removed from every conversation. This cannot be undone.",
      onConfirm: async () => {
        await apiFetch(`/api/agents/${encodeURIComponent(agent.id)}`, { method: "DELETE" });
        await readSpace();
      },
    });
  }

  // --- Conversation actions -----------------------------------------------

  async function openDm(agentId: string) {
    const existing = conversations.find(
      (conversation) => conversation.kind === "dm" && conversation.agentIds[0] === agentId,
    );
    if (existing) {
      setActiveId(existing.id);
      router.push(conversationPath(existing));
      setNavOpen(false);
      return;
    }
    const body = await apiFetch<{ conversation: Conversation }>("/api/conversations", {
      method: "POST",
      body: JSON.stringify({ kind: "dm", title: "", agentIds: [agentId] }),
    });
    await readSpace();
    setActiveId(body.conversation.id);
    router.push(conversationPath(body.conversation));
    setNavOpen(false);
  }

  async function createRoom(input: { title: string; agentIds: string[]; turnPolicy: TurnPolicy }) {
    const body = await apiFetch<{ conversation: Conversation }>("/api/conversations", {
      method: "POST",
      body: JSON.stringify({ kind: "group", ...input }),
    });
    await readSpace();
    setActiveId(body.conversation.id);
    router.push(conversationPath(body.conversation));
    setModal(null);
  }

  function deleteConversation(conversation: Conversation) {
    setModal({
      kind: "confirm",
      title: `Delete "${conversation.title}"?`,
      body: "Every message in this room is removed. This cannot be undone.",
      onConfirm: async () => {
        await apiFetch(`/api/conversations/${encodeURIComponent(conversation.id)}`, {
          method: "DELETE",
        });
        if (activeId === conversation.id) {
          setActiveId("");
          router.replace("/");
        }
        await readSpace();
      },
    });
  }

  // --- Task actions -------------------------------------------------------

  async function createTask(input: { title: string; assigneeAgentId: string | null }) {
    if (!activeConversation) return;
    await apiFetch(`/api/conversations/${encodeURIComponent(activeConversation.id)}/tasks`, {
      method: "POST",
      body: JSON.stringify({ title: input.title, assigneeAgentId: input.assigneeAgentId }),
    });
    await readTasks(activeConversation.id);
  }

  async function updateTask(taskId: string, patch: UpdateTaskRequest) {
    if (!activeConversation) return;
    await apiFetch(
      `/api/conversations/${encodeURIComponent(activeConversation.id)}/tasks/${encodeURIComponent(taskId)}`,
      { method: "PATCH", body: JSON.stringify(patch) },
    );
    await readTasks(activeConversation.id);
  }

  async function deleteTask(taskId: string) {
    if (!activeConversation) return;
    await apiFetch(
      `/api/conversations/${encodeURIComponent(activeConversation.id)}/tasks/${encodeURIComponent(taskId)}`,
      { method: "DELETE" },
    );
    await readTasks(activeConversation.id);
  }

  // --- Render -------------------------------------------------------------

  if (!loaded) {
    return (
      <div className="grid h-full place-items-center text-sm text-muted">Loading your space…</div>
    );
  }

  return (
    <div className="flex h-full overflow-hidden">
      <Sidebar
        agents={agents}
        conversations={conversations}
        activeId={activeId}
        open={navOpen}
        theme={theme}
        onToggleTheme={toggleTheme}
        onClose={() => setNavOpen(false)}
        onSelectConversation={(id) => {
          const conversation = conversations.find((item) => item.id === id);
          if (conversation) router.push(conversationPath(conversation));
          setNavOpen(false);
        }}
        onOpenDm={openDm}
        onNewAgent={() => setModal({ kind: "agent" })}
        onEditAgent={(agent) => setModal({ kind: "edit-agent", agent })}
        onDeleteAgent={deleteAgent}
        onConfigureProvider={(agent) => setModal({ kind: "provider", agent })}
        onNewRoom={() => setModal({ kind: "room" })}
        onDeleteConversation={deleteConversation}
      />

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-border px-4 py-3 md:hidden">
          <button
            type="button"
            onClick={() => setNavOpen(true)}
            className="grid h-9 w-9 place-items-center rounded-lg border border-border"
            aria-label="Open menu"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <span className="truncate text-sm font-semibold">
            {activeConversation?.title ?? "GAgents"}
          </span>
        </header>

        {backendDown && (
          <div className="border-b border-border bg-surface-2 px-4 py-2 text-center text-xs text-danger">
            The backend is offline. Start it with <code>npm run dev:api</code>.
          </div>
        )}

        {activeConversation ? (
          <ChatView
            key={activeConversation.id}
            conversation={activeConversation}
            agents={agents}
            messages={messages}
            tasks={tasks}
            sending={sending}
            error={error}
            failedSend={pendingSend?.failed ? { id: pendingSend.id, text: pendingSend.text } : null}
            onRetry={retrySend}
            onDismissError={() => setError("")}
            onSend={sendMessage}
            onStop={stopGeneration}
            onCreateTask={createTask}
            onUpdateTask={updateTask}
            onDeleteTask={deleteTask}
          />
        ) : (
          <WelcomeView
            agents={agents}
            conversations={conversations}
            onOpenDm={openDm}
            onNewAgent={() => setModal({ kind: "agent" })}
            onNewRoom={() => setModal({ kind: "room" })}
            onSelectConversation={(id) => {
              const conversation = conversations.find((item) => item.id === id);
              if (!conversation) return;
              setActiveId(id);
              router.push(conversationPath(conversation));
            }}
          />
        )}
      </main>

      {/* Modals */}
      <Modal
        open={modal?.kind === "agent"}
        title="New agent"
        onClose={() => setModal(null)}
      >
        <AgentModal
          toolCatalog={toolCatalog}
          onCancel={() => setModal(null)}
          onSubmit={async (input) => {
            await createAgent(input);
            setModal(null);
          }}
        />
      </Modal>

      <Modal
        open={modal?.kind === "edit-agent"}
        title="Edit agent"
        onClose={() => setModal(null)}
      >
        {modal?.kind === "edit-agent" && (
          <AgentModal
            agent={modal.agent}
            toolCatalog={toolCatalog}
            onCancel={() => setModal(null)}
            onSubmit={async (input) => {
              await updateAgent(modal.agent.id, input);
              setModal(null);
            }}
          />
        )}
      </Modal>

      <Modal open={modal?.kind === "room"} title="New group" onClose={() => setModal(null)}>
        {modal?.kind === "room" && (
          <RoomModal
            agents={agents}
            onCancel={() => setModal(null)}
            onSubmit={(input) => createRoom(input)}
          />
        )}
      </Modal>

      <Modal
        open={modal?.kind === "provider"}
        title={modal?.kind === "provider" ? `LLM settings — ${modal.agent.name}` : ""}
        onClose={() => setModal(null)}
        width={520}
      >
        {modal?.kind === "provider" && (
          <ProviderModal agent={modal.agent} onClose={() => setModal(null)} />
        )}
      </Modal>

      <Modal
        open={modal?.kind === "confirm"}
        title={modal?.kind === "confirm" ? modal.title : ""}
        onClose={() => setModal(null)}
        width={400}
      >
        {modal?.kind === "confirm" && (
          <div className="grid gap-4">
            <p className="text-sm text-muted">{modal.body}</p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setModal(null)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                onClick={async () => {
                  const run = modal.onConfirm;
                  setModal(null);
                  try {
                    await run();
                  } catch (caught) {
                    setError(apiErrorMessage(caught));
                  }
                }}
              >
                Delete
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
