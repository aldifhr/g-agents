"use client";

import type { Agent, Conversation, ConversationKind } from "@agent-chat/shared";
import { avatarClass, formatRelative, initialsFrom } from "@/lib/ui";
import { Button } from "@/components/ui/form";

/**
 * The empty state: what the app is, and the three ways to start.
 *
 * It doubles as the agent roster, so a brand-new space is usable without
 * hunting for the sidebar.
 */
export function WelcomeView({
  agents,
  conversations,
  onOpenDm,
  onNewAgent,
  onNewRoom,
  onSelectConversation,
}: {
  agents: Agent[];
  conversations: Conversation[];
  onOpenDm: (agentId: string) => void;
  onNewAgent: () => void;
  onNewRoom: () => void;
  onSelectConversation: (id: string) => void;
}) {
  const recent = conversations.slice(0, 4);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-6 py-10">
      <div className="mx-auto max-w-3xl">
        <h1 className="text-2xl font-bold tracking-tight">Chat with your agents</h1>
        <p className="mt-2 text-sm text-muted">
          Talk one-on-one in a DM, or put several agents in a group and let them take turns.
        </p>

        {agents.length === 0 ? (
          <div className="mt-8 rounded-app border border-dashed border-border-strong p-8 text-center">
            <p className="text-sm text-muted">Your space is empty. Create your first agent to begin.</p>
            <Button className="mt-4" onClick={onNewAgent}>
              Create an agent
            </Button>
          </div>
        ) : (
          <>
            <div className="mt-8 flex items-center justify-between">
              <h2 className="text-xs font-bold uppercase tracking-wider text-faint">Your agents</h2>
              <div className="flex gap-2">
                <Button variant="ghost" onClick={onNewAgent}>
                  New agent
                </Button>
                <Button variant="ghost" onClick={() => onNewRoom()} disabled={agents.length < 1}>
                  New group
                </Button>
              </div>
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {agents.map((agent) => (
                <button
                  key={agent.id}
                  type="button"
                  onClick={() => onOpenDm(agent.id)}
                  className="flex items-center gap-3 rounded-app border border-border bg-surface p-3 text-left transition-colors hover:border-accent"
                >
                  <span
                    className={`grid h-10 w-10 flex-none place-items-center rounded-[12px] text-xs font-bold ${avatarClass(agent.color)}`}
                  >
                    {agent.initials || initialsFrom(agent.name)}
                  </span>
                  <span className="grid min-w-0">
                    <strong className="truncate text-sm font-semibold">{agent.name}</strong>
                    <small className="truncate text-[11px] text-faint">{agent.role || "Agent"}</small>
                  </span>
                </button>
              ))}
            </div>

            {recent.length > 0 && (
              <>
                <h2 className="mt-8 text-xs font-bold uppercase tracking-wider text-faint">Recent</h2>
                <div className="mt-3 grid gap-1.5">
                  {recent.map((conversation) => (
                    <button
                      key={conversation.id}
                      type="button"
                      onClick={() => onSelectConversation(conversation.id)}
                      className="flex items-center gap-3 rounded-[10px] px-3 py-2 text-left transition-colors hover:bg-surface-2"
                    >
                      <span className="grid h-7 w-7 flex-none place-items-center rounded-lg bg-surface-2 text-muted">
                        {conversation.kind === "group" ? (
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                            <circle cx="9" cy="7" r="4" />
                          </svg>
                        ) : (
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z" />
                          </svg>
                        )}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm">{conversation.title}</span>
                      {conversation.lastMessage && (
                        <span className="flex-none text-[10px] text-faint">
                          {formatRelative(conversation.lastMessage.createdAt)}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
