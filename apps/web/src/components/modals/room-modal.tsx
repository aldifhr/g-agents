"use client";

import { useState } from "react";
import type { Agent, TurnPolicy } from "@agent-chat/shared";
import { avatarClass, cn, initialsFrom } from "@/lib/ui";
import { Button, Field, TextInput } from "@/components/ui/form";

/**
 * Create a group: a name, its member agents, and how they take turns.
 *
 * A room with several agents is one thing; whether they all speak or only the
 * ones you call is a setting on it, not a different kind of room. So the form
 * asks for a turn policy rather than a room type.
 */
export function RoomModal({
  agents,
  onCancel,
  onSubmit,
}: {
  agents: Agent[];
  onCancel: () => void;
  onSubmit: (input: { title: string; agentIds: string[]; turnPolicy: TurnPolicy }) => Promise<void>;
}) {
  const [policy, setPolicy] = useState<TurnPolicy>("rounds");
  const [title, setTitle] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function toggle(id: string) {
    setSelected((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (selected.length === 0) {
      setError("Pick at least one agent.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await onSubmit({ title: title.trim(), agentIds: selected, turnPolicy: policy });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create the room.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <div className="grid gap-1.5">
        <span className="text-xs font-medium">Turns</span>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setPolicy("rounds")}
            className={cn(
              "rounded-[10px] border px-3 py-2 text-left transition-colors",
              policy === "rounds" ? "border-accent bg-accent/10" : "border-border hover:bg-surface-2",
            )}
          >
            <strong className="block text-xs font-semibold">Take turns</strong>
            <small className="text-[10px] text-faint">Everyone answers, in order</small>
          </button>
          <button
            type="button"
            onClick={() => setPolicy("mentions")}
            className={cn(
              "rounded-[10px] border px-3 py-2 text-left transition-colors",
              policy === "mentions" ? "border-accent bg-accent/10" : "border-border hover:bg-surface-2",
            )}
          >
            <strong className="block text-xs font-semibold">By mention</strong>
            <small className="text-[10px] text-faint">Only who you @Name answers</small>
          </button>
        </div>
      </div>

      <Field label="Group name" hint="Leave empty to name it after its members.">
        <TextInput value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Design review" autoFocus />
      </Field>

      <div className="grid gap-1.5">
        <span className="text-xs font-medium">Members</span>
        {agents.length === 0 ? (
          <p className="text-xs text-faint">Create an agent first.</p>
        ) : (
          <div className="grid max-h-64 gap-1 overflow-y-auto rounded-[10px] border border-border p-1.5">
            {agents.map((agent) => {
              const active = selected.includes(agent.id);
              return (
                <button
                  key={agent.id}
                  type="button"
                  onClick={() => toggle(agent.id)}
                  className={cn(
                    "flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors",
                    active ? "bg-accent-soft" : "hover:bg-surface-2",
                  )}
                >
                  <span className={cn("grid h-7 w-7 flex-none place-items-center rounded-lg text-[10px] font-bold", avatarClass(agent.color))}>
                    {agent.initials || initialsFrom(agent.name)}
                  </span>
                  <span className="grid min-w-0 flex-1">
                    <strong className="truncate text-xs font-semibold">{agent.name}</strong>
                    <small className="truncate text-[10px] text-faint">{agent.role || "Agent"}</small>
                  </span>
                  <span
                    className={cn(
                      "grid h-5 w-5 flex-none place-items-center rounded-md border",
                      active ? "border-accent bg-accent text-accent-foreground" : "border-border-strong",
                    )}
                  >
                    {active && (
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M20 6 9 17l-5-5" />
                      </svg>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {error && <p className="text-xs text-danger">{error}</p>}

      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy || agents.length === 0}>
          {busy ? "Creating…" : "Create group"}
        </Button>
      </div>
    </form>
  );
}
