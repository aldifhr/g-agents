/**
 * The run event bus.
 *
 * A run is long: several agents, several provider calls, tool executions in
 * between. A client should not have to wait for the whole thing to see that it
 * started, which agent is speaking, or that a tool just fired. This bus is the
 * seam between the orchestrator, which emits as it works, and the SSE routes,
 * which forward to whoever is watching.
 *
 * It is in-process on purpose. The app is a single local server; a run lives in
 * one process, so a broker would be ceremony. What matters is that events are
 * buffered per run, so a subscriber that connects late — or reconnects after a
 * dropped connection — still gets a coherent history before the live tail.
 */

/** One thing that happened during a run, in the order it happened. */
export type RunEvent =
  | { type: "run.started"; runId: string; conversationId: string; at: string }
  | { type: "run.agent"; runId: string; agentId: string; agentName: string; at: string }
  | { type: "run.tool"; runId: string; agentId: string; tool: string; ok: boolean; durationMs: number; at: string }
  | { type: "run.message"; runId: string; messageId: string; agentId: string; at: string }
  | { type: "run.error"; runId: string; agentName: string; error: string; at: string }
  | { type: "run.finished"; runId: string; status: "done" | "error" | "interrupted"; at: string };

type Listener = (event: RunEvent) => void;

/** How many events are kept per run for late subscribers. */
const REPLAY_LIMIT = 200;

/** How long a finished run's buffer is kept before it is swept. */
const RETAIN_MS = 10 * 60 * 1000;

type Channel = {
  events: RunEvent[];
  listeners: Set<Listener>;
  finishedAt: number | null;
};

export class RunEventBus {
  private readonly channels = new Map<string, Channel>();

  private channel(runId: string): Channel {
    let channel = this.channels.get(runId);
    if (!channel) {
      channel = { events: [], listeners: new Set(), finishedAt: null };
      this.channels.set(runId, channel);
    }
    return channel;
  }

  /** Publishes an event to every listener and the replay buffer. */
  publish(event: RunEvent) {
    const channel = this.channel(event.runId);
    channel.events.push(event);
    if (channel.events.length > REPLAY_LIMIT) channel.events.shift();
    if (event.type === "run.finished") {
      channel.finishedAt = Date.now();
      // A finished run has no more events; drop the buffer after a grace period
      // so a client that reconnects right after the end still sees the tail.
      setTimeout(() => this.channels.delete(event.runId), RETAIN_MS).unref?.();
    }
    for (const listener of channel.listeners) {
      try {
        listener(event);
      } catch {
        // A broken listener must never take down the run that is publishing.
      }
    }
  }

  /**
   * Subscribes to a run: replays what already happened, then follows live.
   * Returns an unsubscribe function.
   */
  subscribe(runId: string, listener: Listener): () => void {
    const channel = this.channel(runId);
    for (const event of channel.events) listener(event);
    // If the run already finished, there is nothing live to follow.
    if (channel.finishedAt !== null) return () => undefined;
    channel.listeners.add(listener);
    return () => channel.listeners.delete(listener);
  }

  /** Whether the run has already emitted its terminal event. */
  isFinished(runId: string): boolean {
    return this.channels.get(runId)?.finishedAt !== null && this.channels.has(runId);
  }
}
