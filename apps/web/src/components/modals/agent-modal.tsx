"use client";

import { useState } from "react";
import type { Agent, AgentColor } from "@agent-chat/shared";
import { AGENT_COLORS, avatarClass, cn } from "@/lib/ui";
import { Button, Field, TextArea, TextInput } from "@/components/ui/form";

const ROLE_PRESETS = [
  {
    role: "Developer",
    systemPrompt: "You are a software developer. Write clear, maintainable code, explain important trade-offs, and state assumptions.",
  },
  {
    role: "QA",
    systemPrompt: "You are a QA engineer. Find bugs and edge cases, provide reproducible steps, and prioritize findings by severity.",
  },
] as const;

/** Create or edit an agent's persona. LLM settings live in their own modal. */
export function AgentModal({
  agent,
  onCancel,
  onSubmit,
}: {
  agent?: Agent;
  onCancel: () => void;
  onSubmit: (input: {
    name: string;
    role: string;
    systemPrompt: string;
    color: AgentColor;
  }) => Promise<void>;
}) {
  const [name, setName] = useState(agent?.name ?? "");
  const [role, setRole] = useState(agent?.role ?? "");
  const [systemPrompt, setSystemPrompt] = useState(agent?.systemPrompt ?? "");
  const [color, setColor] = useState<AgentColor>(agent?.color ?? "violet");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) {
      setError("An agent needs a name.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await onSubmit({ name: name.trim(), role: role.trim(), systemPrompt: systemPrompt.trim(), color });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save the agent.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <Field label="Name">
        <TextInput value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Ada" autoFocus />
      </Field>
      <Field label="Role" hint="A short label shown under the name, e.g. Researcher.">
        <TextInput value={role} onChange={(event) => setRole(event.target.value)} placeholder="Researcher" />
        <div className="mt-2 flex gap-2" aria-label="Role presets">
          {ROLE_PRESETS.map((preset) => (
            <button
              key={preset.role}
              type="button"
              aria-pressed={role === preset.role && systemPrompt === preset.systemPrompt}
              onClick={() => {
                setRole(preset.role);
                setSystemPrompt(preset.systemPrompt);
              }}
              className={cn(
                "rounded-lg border px-2.5 py-1 text-xs transition-colors",
                role === preset.role && systemPrompt === preset.systemPrompt
                  ? "border-accent bg-accent/10 text-accent"
                  : "border-border text-muted hover:text-foreground",
              )}
            >
              {preset.role}
            </button>
          ))}
        </div>
      </Field>
      <Field label="System prompt" hint="Who the agent is and how it should behave.">
        <TextArea
          value={systemPrompt}
          onChange={(event) => setSystemPrompt(event.target.value)}
          rows={5}
          placeholder="You are a meticulous researcher who cites sources and admits uncertainty."
        />
      </Field>
      <Field label="Color">
        <div className="flex gap-2">
          {AGENT_COLORS.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setColor(option)}
              className={cn(
                "h-8 w-8 rounded-[10px] transition-transform",
                avatarClass(option),
                color === option ? "scale-110 ring-2 ring-accent ring-offset-2 ring-offset-surface" : "opacity-70",
              )}
              aria-label={option}
            />
          ))}
        </div>
      </Field>

      {error && <p className="text-xs text-danger">{error}</p>}

      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy}>
          {busy ? "Saving…" : agent ? "Save changes" : "Create agent"}
        </Button>
      </div>
    </form>
  );
}
