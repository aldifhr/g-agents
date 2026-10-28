"use client";

import type { Agent, Conversation, ConversationKind } from "@agent-chat/shared";
import { avatarClass, cn, formatRelative, initialsFrom } from "@/lib/ui";

/**
 * The sidebar: the agent roster on top, then the two shared room lists.
 *
 * The agent list is the primary navigation — each row opens that agent's DM
 * (the "Direct messages" category) and carries its own menu. Chats and groups
 * live below, because they are rooms you return to, not personas.
 */
export function Sidebar({
  agents,
  conversations,
  activeId,
  open,
  theme,
  onToggleTheme,
  onClose,
  onSelectConversation,
  onOpenDm,
  onNewAgent,
  onEditAgent,
  onDeleteAgent,
  onConfigureProvider,
  onNewRoom,
  onDeleteConversation,
}: {
  agents: Agent[];
  conversations: Conversation[];
  activeId: string;
  open: boolean;
  theme: "light" | "dark";
  onToggleTheme: () => void;
  onClose: () => void;
  onSelectConversation: (id: string) => void;
  onOpenDm: (agentId: string) => void;
  onNewAgent: () => void;
  onEditAgent: (agent: Agent) => void;
  onDeleteAgent: (agent: Agent) => void;
  onConfigureProvider: (agent: Agent) => void;
  onNewRoom: () => void;
  onDeleteConversation: (conversation: Conversation) => void;
}) {
  const groups = conversations.filter((conversation) => conversation.kind === "group");
  const dms = conversations.filter((conversation) => conversation.kind === "dm");

  return (
    <>
      {open && (
        <div className="fixed inset-0 z-30 bg-black/40 md:hidden" onClick={onClose} aria-hidden />
      )}
      <aside
        className={cn(
          "z-40 flex h-full w-[272px] min-w-[272px] flex-col border-r border-border bg-surface",
          "max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:transition-transform",
          open ? "max-md:translate-x-0" : "max-md:-translate-x-full",
        )}
      >
        <div className="flex items-center gap-2 px-4 pb-3 pt-4">
          <span className="grid h-8 w-8 place-items-center rounded-[10px] bg-accent text-accent-foreground">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          </span>
          <span className="text-[15px] font-bold tracking-tight">GAgents</span>
          <button
            type="button"
            onClick={onToggleTheme}
            className="ml-auto grid h-8 w-8 place-items-center rounded-lg text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
            aria-label="Toggle theme"
          >
            {theme === "dark" ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <circle cx="12" cy="12" r="4" />
                <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
              </svg>
            )}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-2.5 pb-4">
          <div className="mb-1 flex items-center justify-between px-2 pt-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-faint">Direct messages</span>
            <button
              type="button"
              onClick={onNewAgent}
              className="grid h-6 w-6 place-items-center rounded-md text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
              aria-label="New agent"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M12 5v14M5 12h14" />
              </svg>
            </button>
          </div>
          {agents.length === 0 ? (
            <p className="px-2 py-3 text-xs text-faint">
              No agents yet. Create one to start chatting.
            </p>
          ) : (
            <div className="grid gap-0.5">
              {agents.map((agent) => (
                <AgentRow
                  key={agent.id}
                  agent={agent}
                  active={dms.some(
                    (conversation) =>
                      conversation.id === activeId && conversation.agentIds[0] === agent.id,
                  )}
                  onOpen={() => onOpenDm(agent.id)}
                  onEdit={() => onEditAgent(agent)}
                  onProvider={() => onConfigureProvider(agent)}
                  onDelete={() => onDeleteAgent(agent)}
                />
              ))}
            </div>
          )}

          <div className="mb-1 mt-5 flex items-center justify-between px-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-faint">Groups</span>
            <button
              type="button"
              onClick={() => onNewRoom()}
              className="grid h-6 w-6 place-items-center rounded-md text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
              aria-label="New group"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M12 5v14M5 12h14" />
              </svg>
            </button>
          </div>
          {groups.length === 0 ? (
            <p className="px-2 py-3 text-xs text-faint">
              No groups yet. Put two or more agents in a room.
            </p>
          ) : (
            <div className="grid gap-0.5">
              {groups.map((conversation) => (
                <ConversationRow
                  key={conversation.id}
                  conversation={conversation}
                  agents={agents}
                  active={conversation.id === activeId}
                  onSelect={() => onSelectConversation(conversation.id)}
                  onDelete={() => onDeleteConversation(conversation)}
                />
              ))}
            </div>
          )}

          <div className="mb-1 mt-5 flex items-center justify-between px-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-faint">Groups</span>
            <button
              type="button"
              onClick={() => onNewRoom()}
              className="grid h-6 w-6 place-items-center rounded-md text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
              aria-label="New group"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M12 5v14M5 12h14" />
              </svg>
            </button>
          </div>
          {groups.length === 0 ? (
            <p className="px-2 py-3 text-xs text-faint">
              No groups yet. Put two or more agents in a room.
            </p>
          ) : (
            <div className="grid gap-0.5">
              {groups.map((conversation) => (
                <ConversationRow
                  key={conversation.id}
                  conversation={conversation}
                  agents={agents}
                  active={conversation.id === activeId}
                  onSelect={() => onSelectConversation(conversation.id)}
                  onDelete={() => onDeleteConversation(conversation)}
                />
              ))}
            </div>
          )}
        </div>
      </aside>
    </>
  );
}

function AgentRow({
  agent,
  active,
  onOpen,
  onEdit,
  onProvider,
  onDelete,
}: {
  agent: Agent;
  active: boolean;
  onOpen: () => void;
  onEdit: () => void;
  onProvider: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      className={cn(
        "group flex items-center gap-2.5 rounded-[10px] px-2 py-1.5 transition-colors",
        active ? "bg-accent-soft" : "hover:bg-surface-2",
      )}
    >
      <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
        <span
          className={cn(
            "relative grid h-8 w-8 flex-none place-items-center rounded-[10px] text-[11px] font-bold",
            avatarClass(agent.color),
          )}
        >
          {agent.initials || initialsFrom(agent.name)}
          <span
            className={cn(
              "absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-surface",
              agent.active ? "bg-success" : "bg-faint",
            )}
          />
        </span>
        <span className="grid min-w-0">
          <strong className="truncate text-xs font-semibold">{agent.name}</strong>
          <small className="truncate text-[10px] text-faint">{agent.role || "Agent"}</small>
        </span>
      </button>
      <AgentMenu onEdit={onEdit} onProvider={onProvider} onDelete={onDelete} />
    </div>
  );
}

function AgentMenu({
  onEdit,
  onProvider,
  onDelete,
}: {
  onEdit: () => void;
  onProvider: () => void;
  onDelete: () => void;
}) {
  return (
    <details className="relative">
      <summary
        className="grid h-6 w-6 cursor-pointer list-none place-items-center rounded-md text-muted opacity-0 transition-opacity hover:bg-surface-2 hover:text-foreground group-hover:opacity-100 [&::-webkit-details-marker]:hidden"
        aria-label="Agent options"
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="12" cy="5" r="1.6" />
          <circle cx="12" cy="12" r="1.6" />
          <circle cx="12" cy="19" r="1.6" />
        </svg>
      </summary>
      <div className="absolute right-0 top-7 z-20 w-44 rounded-[10px] border border-border bg-surface p-1 shadow-xl">
        <MenuItem onClick={onEdit}>Edit agent</MenuItem>
        <MenuItem onClick={onProvider}>LLM settings</MenuItem>
        <MenuItem onClick={onDelete} danger>
          Delete agent
        </MenuItem>
      </div>
    </details>
  );
}

function ConversationRow({
  conversation,
  agents,
  active,
  onSelect,
  onDelete,
}: {
  conversation: Conversation;
  agents: Agent[];
  active: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  const members = conversation.agentIds
    .map((id) => agents.find((agent) => agent.id === id))
    .filter((agent): agent is Agent => Boolean(agent));
  const preview = conversation.lastMessage?.text ?? "No messages yet";

  return (
    <div
      className={cn(
        "group flex items-center gap-2.5 rounded-[10px] px-2 py-1.5 transition-colors",
        active ? "bg-accent-soft" : "hover:bg-surface-2",
      )}
    >
      <button type="button" onClick={onSelect} className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
        <span className="grid h-8 w-8 flex-none place-items-center rounded-[10px] bg-surface-2 text-muted">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
          </svg>
        </span>
        <span className="grid min-w-0">
          <strong className="truncate text-xs font-semibold">{conversation.title}</strong>
          <small className="truncate text-[10px] text-faint">
            {members.length} {members.length === 1 ? "agent" : "agents"} · {preview}
          </small>
        </span>
      </button>
      <div className="flex flex-none items-center gap-1">
        {conversation.lastMessage && (
          <span className="text-[10px] text-faint">{formatRelative(conversation.lastMessage.createdAt)}</span>
        )}
        <button
          type="button"
          onClick={onDelete}
          className="grid h-6 w-6 place-items-center rounded-md text-muted opacity-0 transition-opacity hover:bg-surface-2 hover:text-danger group-hover:opacity-100"
          aria-label="Delete group"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
          </svg>
        </button>
      </div>
    </div>
  );
}

function MenuItem({
  children,
  onClick,
  danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "block w-full rounded-md px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-surface-2",
        danger ? "text-danger" : "text-foreground",
      )}
    >
      {children}
    </button>
  );
}
