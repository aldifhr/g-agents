import { parseMentions, type Agent, type Conversation, type Message } from "@agent-chat/shared";
import type { AppConfig } from "../platform/config.js";
import type { Store } from "../database/store.js";
import { ProviderError, requestChatCompletion, type ChatMessage, type ProviderCredentials } from "../provider/provider.js";
import { ToolRegistry } from "../tools/registry.js";
import { runToolLoop, type ToolCallRecord } from "./tool-loop.js";
import type { RunEventBus } from "./run-events.js";

/** One active member of a room, with the credentials its turns will use. */
type Speaker = {
  agent: Agent;
  credentials: ProviderCredentials;
};

/**
 * Raised when a second run is asked for while one is already in flight for the
 * same conversation. The route turns this into a 409; it is not a failure of
 * the room, it is the room being busy.
 */
export class ConversationBusyError extends Error {
  constructor(readonly conversationId: string) {
    super("This conversation is already running. Wait for it to finish or stop it first.");
    this.name = "ConversationBusyError";
  }
}

/**
 * The orchestrator: turns one user message into agent replies.
 *
 * A DM is a single call. A group is a conversation between the agents
 * themselves: every active member answers in turn, each one seeing what the
 * others have already said, for a bounded number of rounds. The user is a
 * participant in that transcript, not the only thing the agents respond to.
 *
 * Concurrency: exactly one run per conversation at a time. A second request
 * for a room that is already running is rejected outright rather than being
 * allowed to interleave writes into the same transcript — two runs sharing a
 * room would each read a half-written history and each append replies the
 * other never saw.
 */

export type RunResult = {
  replies: Message[];
  errors: string[];
  /** True when the user stopped the run before it finished on its own. */
  interrupted: boolean;
  /** The persisted run id, so the caller can link tool calls and artifacts. */
  runId: string;
};

/** How many past messages of the room are replayed into each prompt. */
const HISTORY_LIMIT = 40;

/** The live state of the run in flight for a conversation. */
type ActiveRun = {
  controller: AbortController;
  runId: string;
};

export class Orchestrator {
  /**
   * The run in flight for each conversation. The map is the single-flight
   * lock: a run is registered synchronously before any `await`, so a second
   * caller can never observe a half-registered room.
   */
  private readonly running = new Map<string, ActiveRun>();

  constructor(
    private readonly store: Store,
    private readonly config: AppConfig,
    private readonly tools: ToolRegistry,
    private readonly events: RunEventBus,
  ) {}

  /** Whether a run is currently in flight for a conversation. */
  isRunning(conversationId: string): boolean {
    return this.running.has(conversationId);
  }

  /** Aborts the run in flight for a conversation. Returns whether one existed. */
  stopRun(conversationId: string): boolean {
    const active = this.running.get(conversationId);
    if (!active) return false;
    active.controller.abort();
    return true;
  }

  /**
   * Loads the room's active members and their LLM credentials.
   *
   * Called before anything is stored, so a room that cannot answer — no active
   * member, or a member without a provider — fails the send outright instead
   * of leaving a message behind that no one will ever reply to.
   *
   * Who answers is the room's turn policy, not its kind:
   *   - single:   the one member answers.
   *   - mentions: only the members the user calls by @Name answer; an
   *               unmentioned agent stays silent. If nobody is mentioned, the
   *               first member answers, so the room is never a dead end.
   *   - rounds:   every active member answers, taking turns.
   */
  async prepare(conversation: Conversation, text = ""): Promise<Speaker[]> {
    const loaded = await Promise.all(conversation.agentIds.map((id) => this.store.getAgent(id)));
    const active = loaded
      .filter((agent): agent is Agent => Boolean(agent))
      .filter((agent) => agent.active);

    const responders = this.selectResponders(conversation, active, text);
    if (responders.length === 0) {
      throw new ProviderError("No active agent in this room can reply.");
    }

    const speakers: Speaker[] = [];
    for (const agent of responders) {
      const credentials = await this.store.getAgentCredentials(agent.id);
      if (!credentials || !credentials.baseUrl || !credentials.model) {
        throw new ProviderError(`${agent.name} has no LLM configured yet.`);
      }
      speakers.push({ agent, credentials });
    }
    return speakers;
  }

  /** Narrows the active members to those who should answer this send. */
  private selectResponders(conversation: Conversation, active: Agent[], text: string): Agent[] {
    if (active.length === 0) return [];
    if (conversation.turnPolicy !== "mentions") return active;

    const mentioned = parseMentions(text, active);
    if (mentioned.length === 0) return [active[0]!];
    const chosen = new Set(mentioned);
    return active.filter((agent) => chosen.has(agent.id));
  }

  /**
   * Runs a conversation for one user message and returns the agent replies.
   *
   * The user message is expected to be stored already; it is the last row of
   * the transcript this method reads. A stop aborts the provider calls in
   * flight and ends the loop, keeping whatever replies already landed.
   *
   * Throws `ConversationBusyError` if a run is already in flight for the room.
   */
  async run(
    conversation: Conversation,
    options: { triggerMessageId?: string | null; externalSignal?: AbortSignal } = {},
  ): Promise<RunResult> {
    // Check-and-set before the first await: two concurrent sends for the same
    // room cannot both pass this point, because neither yields in between.
    if (this.running.has(conversation.id)) {
      throw new ConversationBusyError(conversation.id);
    }

    const controller = new AbortController();
    const run = await this.store.startRun(conversation.id, options.triggerMessageId ?? null);
    this.running.set(conversation.id, { controller, runId: run.id });
    this.events.publish({ type: "run.started", runId: run.id, conversationId: conversation.id, at: new Date().toISOString() });

    const onExternalAbort = () => controller.abort();
    options.externalSignal?.addEventListener("abort", onExternalAbort, { once: true });
    const signal = controller.signal;

    try {
      const result = await this.execute(conversation, run.id, signal);
      const status = result.interrupted
        ? "interrupted"
        : result.errors.length > 0 && result.replies.length === 0
          ? "error"
          : "done";
      await this.store.finishRun(run.id, status, result.errors.join(" "));
      this.events.publish({ type: "run.finished", runId: run.id, status, at: new Date().toISOString() });
      return { ...result, runId: run.id };
    } catch (error) {
      await this.store.finishRun(run.id, "error", error instanceof Error ? error.message : "The run failed.");
      this.events.publish({ type: "run.finished", runId: run.id, status: "error", at: new Date().toISOString() });
      throw error;
    } finally {
      this.running.delete(conversation.id);
      options.externalSignal?.removeEventListener("abort", onExternalAbort);
    }
  }

  private async execute(conversation: Conversation, runId: string, signal: AbortSignal): Promise<Omit<RunResult, "runId">> {
    // The trigger is the last user turn in the transcript; a chat room uses it
    // to decide which agents the user actually called.
    const history = await this.store.listMessages(conversation.id, 1);
    const trigger = [...history].reverse().find((message) => message.sender === "user");
    const speakers = await this.prepare(conversation, trigger?.text ?? "");
    const members = speakers.map((speaker) => speaker.agent);

    const replies: Message[] = [];
    const errors: string[] = [];
    if (members.length === 0) return { replies, errors, interrupted: false };

    // A `single` room answers once. `mentions` answers with the called agents,
    // once each. `rounds` runs `groupRounds` passes of turn-taking, but never
    // more turns than the configured ceiling, so a chatty room cannot bill the
    // operator into the ground.
    const rounds = conversation.turnPolicy === "rounds" ? Math.max(1, this.config.groupRounds) : 1;
    let turns = 0;
    let interrupted = false;

    for (let round = 0; round < rounds; round += 1) {
      for (const agent of members) {
        if (turns >= this.config.groupMaxTurns) return { replies, errors, interrupted };
        if (signal.aborted) {
          interrupted = true;
          return { replies, errors, interrupted };
        }
        turns += 1;

        // Each turn is its own agent_run, so one agent's failure, latency, and
        // token spend are attributable on their own.
        const agentRun = await this.store.startAgentRun(runId, agent.id);
        this.events.publish({ type: "run.agent", runId, agentId: agent.id, agentName: agent.name, at: new Date().toISOString() });
        try {
          const speaker = speakers.find((candidate) => candidate.agent.id === agent.id)!;
          await this.store.setRunActiveAgent(runId, agent.id);
          const text = await this.speak(conversation, agent, speaker.credentials, members, runId, agentRun.id, signal);
          if (!text) {
            await this.store.finishAgentRun(agentRun.id, "done");
            continue;
          }
          const message = await this.store.addMessage({
            conversationId: conversation.id,
            sender: "agent",
            agentId: agent.id,
            author: agent.name,
            text,
            runId,
          });
          replies.push(message);
          await this.store.finishAgentRun(agentRun.id, "done");
          this.events.publish({ type: "run.message", runId, messageId: message.id, agentId: agent.id, at: new Date().toISOString() });
        } catch (error) {
          // A stop is the user's decision, not a failure: end the run quietly
          // and keep the replies that already landed.
          if (signal.aborted) {
            await this.store.finishAgentRun(agentRun.id, "interrupted");
            interrupted = true;
            return { replies, errors, interrupted };
          }
          // One agent's provider failing must not silence the rest of the room.
          const detail = error instanceof ProviderError ? error.message : "The agent could not reply.";
          await this.store.finishAgentRun(agentRun.id, "error", detail);
          errors.push(`${agent.name}: ${detail}`);
          this.events.publish({ type: "run.error", runId, agentName: agent.name, error: detail, at: new Date().toISOString() });
        }
      }
    }

    return { replies, errors, interrupted };
  }

  /**
   * Builds one agent's prompt from the room transcript and calls its provider.
   *
   * When the agent has any tool permission, the turn runs through the
   * tool-calling loop: the model may ask for tools, each call is executed and
   * audited against this run, and the results are fed back until it answers or
   * the step cap is hit. With no tools permitted it is a single completion.
   */
  private async speak(
    conversation: Conversation,
    agent: Agent,
    credentials: ProviderCredentials,
    members: Agent[],
    runId: string,
    agentRunId: string,
    signal?: AbortSignal,
  ): Promise<string> {
    const messages = await this.buildMessages(conversation, agent, members);
    const permitted = this.tools.forAgent(agent.tools);

    if (Object.keys(permitted).length === 0) {
      const result = await requestChatCompletion({
        credentials,
        messages,
        limits: {
          timeoutMs: this.config.providerTimeoutMs,
          maxResponseBytes: this.config.providerMaxResponseBytes,
          maxTokens: this.config.providerMaxTokens,
        },
        signal,
      });
      await this.recordUsage(runId, agentRunId, agent, credentials.model, result.usage);
      return result.text;
    }

    const loop = await runToolLoop({
      credentials,
      messages,
      tools: permitted,
      limits: { timeoutMs: this.config.providerTimeoutMs, maxTokens: this.config.providerMaxTokens },
      maxSteps: this.config.toolMaxSteps,
      signal,
    });

    // Every executed tool call is the audit trail and the result store; a run
    // that touched the workspace is fully reconstructable from these rows.
    for (const record of loop.toolCalls) {
      await this.store.recordToolCall(conversation.id, agent.id, record, runId);
      this.events.publish({
        type: "run.tool",
        runId,
        agentId: agent.id,
        tool: record.tool,
        ok: record.ok,
        durationMs: record.durationMs,
        at: new Date().toISOString(),
      });
    }
    await this.recordUsage(runId, agentRunId, agent, credentials.model, loop.usage);
    return loop.text;
  }

  /** Records one model call against the run and agent run. */
  private async recordUsage(
    runId: string,
    agentRunId: string,
    agent: Agent,
    model: string,
    usage: { promptTokens: number; completionTokens: number } | null,
  ) {
    if (!usage) return;
    await this.store.recordUsage({
      runId,
      agentRunId,
      providerId: agent.providerId,
      model,
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
    });
  }

  /**
   * The system prompt plus the room transcript.
   *
   * In a group, the system prompt names the other members and tells the agent
   * to speak as itself, address people by name, and keep its turn short — the
   * difference between a group chat and several monologues stacked together.
   * Active project memory is folded in so every agent starts from the same
   * durable decisions and rules.
   */
  private async buildMessages(conversation: Conversation, agent: Agent, members: Agent[]): Promise<ChatMessage[]> {
    const system = await this.systemPrompt(conversation, agent, members);
    const history = await this.store.listMessages(conversation.id, HISTORY_LIMIT);

    const messages: ChatMessage[] = [{ role: "system", content: system }];
    for (const message of history) {
      // The room is shared, so every turn is labelled with its speaker and the
      // user's words read as the user's, not as the agent's own.
      messages.push({
        role: message.sender === "user" ? "user" : "assistant",
        content: `${message.author}: ${message.text}`,
      });
    }
    // The provider needs the last turn to be a user turn for some gateways.
    messages.push({
      role: "user",
      content:
        conversation.kind === "group"
          ? `It is your turn, ${agent.name}. Reply as yourself.`
          : "Reply to the message above.",
    });
    return messages;
  }

  private async systemPrompt(conversation: Conversation, agent: Agent, members: Agent[]): Promise<string> {
    const lines: string[] = [];
    lines.push(`You are ${agent.name}${agent.role ? `, ${agent.role}` : ""}.`);
    if (agent.systemPrompt) lines.push(agent.systemPrompt);

    if (conversation.kind === "group") {
      const others = members.filter((member) => member.id !== agent.id).map((member) => member.name);
      lines.push("");
      lines.push(
        `You are in a group chat titled "${conversation.title}" with other participants: ${others.join(", ") || "no one else"}.`,
      );
      lines.push(
        "This is a live multi-party conversation. Speak only as yourself, address the others by name when you reply to them, and keep your turn focused and brief. Do not write lines for anyone else and do not prefix your message with your own name.",
      );
    } else {
      lines.push("");
      lines.push(
        "This is a one-on-one conversation. Answer the user directly and stay in character. Do not prefix your message with your own name.",
      );
    }

    const memories = await this.store.listActiveMemoriesForConversation(conversation.id);
    if (memories.length > 0) {
      lines.push("");
      lines.push("Project memory — decisions, architecture, and rules you must respect:");
      for (const memory of memories) {
        lines.push(`- [${memory.kind}] ${memory.title}${memory.body ? `: ${memory.body}` : ""}`);
      }
    }

    const permitted = Object.keys(this.tools.forAgent(agent.tools));
    if (permitted.length > 0) {
      lines.push("");
      lines.push(
        `You can use these tools: ${permitted.join(", ")}. Call a tool when you need to inspect or change the workspace, and use its result to ground your answer.`,
      );
    }

    return lines.join("\n");
  }
}

export type { ToolCallRecord };
