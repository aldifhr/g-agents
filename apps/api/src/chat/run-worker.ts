import type { Conversation } from "@agent-chat/shared";
import type { Orchestrator } from "./orchestrator.js";

/**
 * The run worker.
 *
 * A synchronous send holds an HTTP connection open for the whole run — every
 * agent turn and every tool execution. That is fine for a quick DM and wrong
 * for a long audit: the connection times out, a proxy cuts it, or the browser
 * navigates away, and the run is lost with it.
 *
 * The worker decouples the two. A send in async mode is enqueued and the
 * request returns at once with the run id; the worker drains the queue and runs
 * each job to completion off the request thread. Progress reaches the client
 * over the run event stream, and the run's result is durable in the database
 * whether or not anyone was watching.
 *
 * The queue is in-process and serial per conversation: the orchestrator's own
 * single-flight guard is the real lock, and the worker simply never starts a
 * second job for a room that is already running.
 */

export type RunJob = {
  conversation: Conversation;
  triggerMessageId: string | null;
};

export class RunWorker {
  private readonly queue: RunJob[] = [];
  /** Conversation ids that are queued or running, so a room is never doubled. */
  private readonly active = new Set<string>();
  private draining = false;

  constructor(private readonly orchestrator: Orchestrator) {}

  /** Whether a room already has a queued or running job. */
  isBusy(conversationId: string): boolean {
    return this.active.has(conversationId);
  }

  /**
   * Enqueues a run. Returns false when the room already has one queued or
   * running — the caller turns that into a 409, exactly as the synchronous
   * path does.
   */
  enqueue(job: RunJob): boolean {
    if (this.active.has(job.conversation.id)) return false;
    this.active.add(job.conversation.id);
    this.queue.push(job);
    void this.drain();
    return true;
  }

  private async drain() {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.queue.length > 0) {
        const job = this.queue.shift()!;
        try {
          await this.orchestrator.run(job.conversation, { triggerMessageId: job.triggerMessageId });
        } catch (error) {
          // A failed job must never stall the queue; the run's status row and
          // the event stream already carry the failure to the client.
          console.error(`Run for conversation ${job.conversation.id} failed in the worker.`, error);
        } finally {
          this.active.delete(job.conversation.id);
        }
      }
    } finally {
      this.draining = false;
    }
  }

  /** How many jobs are waiting; for a health or status view. */
  get depth(): number {
    return this.queue.length;
  }
}
