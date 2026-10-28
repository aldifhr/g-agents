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
  toolCatalog,
  onCancel,
  onSubmit,
}: {
  agent?: Agent;
  toolCatalog: Array<{ name: string; description: string }>;
  onCancel: () => void;
  onSubmit: (input: {
    name: string;
    role: string;
    systemPrompt: string;
    color: AgentColor;
    tools: string[];
  }) => Promise<void>;
}) {
  const [name, setName] = useState(agent?.name ?? "");
  const [role, setRole] = useState(agent?.role ?? "");
  const [systemPrompt, setSystemPrompt] = useState(agent?.systemPrompt ?? "");
  const [color, setColor] = useState<AgentColor>(agent?.color ?? "violet");
  const [allTools, setAllTools] = useState(!agent || agent.tools.includes("*"));
  const [tools, setTools] = useState<string[]>(agent?.tools.filter((tool) => tool !== "*") ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function toggleTool(name: string) {
    setTools((current) =>
      current.includes(name) ? current.filter((item) => item !== name) : [...current, name],
    );
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) {
      setError("An agent needs a name.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await onSubmit({
        name: name.trim(),
        role: role.trim(),
        systemPrompt: systemPrompt.trim(),
        color,
        tools: allTools ? ["*"] : tools,
      });
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

      <div className="grid gap-1.5">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium">Tools</span>
          <button
            type="button"
            onClick={() => setAllTools((current) => !current)}
            className={cn(
              "rounded-full border px-2.5 py-0.5 text-[10px] font-semibold transition-colors",
              allTools
                ? "border-accent bg-accent text-accent-foreground"
                : "border-border text-muted hover:text-foreground",
            )}
          >
            {allTools ? "All tools" : "Custom"}
          </button>
        </div>
        {allTools ? (
          <p className="text-[11px] text-faint">
            This agent may use every workspace and execution tool.
          </p>
        ) : (
          <div className="grid max-h-52 gap-0.5 overflow-y-auto rounded-[10px] border border-border p-1.5">
            {toolCatalog.map((entry) => {
              const active = tools.includes(entry.name);
              return (
                <button
                  key={entry.name}
                  type="button"
                  onClick={() => toggleTool(entry.name)}
                  className={cn(
                    "flex items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors",
                    active ? "bg-accent-soft" : "hover:bg-surface-2",
                  )}
                >
                  <span
                    className={cn(
                      "grid h-4 w-4 flex-none place-items-center rounded border",
                      active ? "border-accent bg-accent text-accent-foreground" : "border-border-strong",
                    )}
                  >
                    {active && (
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M20 6 9 17l-5-5" />
                      </svg>
                    )}
                  </span>
                  <span className="grid min-w-0">
                    <strong className="truncate font-mono text-[11px] font-semibold">{entry.name}</strong>
                    <small className="truncate text-[10px] text-faint">{entry.description}</small>
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
        <Button type="submit" disabled={busy}>
          {busy ? "Saving…" : agent ? "Save changes" : "Create agent"}
        </Button>
      </div>
    </form>
  );
}
