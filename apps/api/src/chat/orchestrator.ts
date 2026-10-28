import type { Agent, Conversation, Message } from "@agent-chat/shared";
import type { AppConfig } from "../platform/config.js";
import type { Store } from "../database/store.js";
import { ProviderError, requestChatCompletion, type ChatMessage, type ProviderCredentials } from "../provider/provider.js";

/** One active member of a room, with the credentials its turns will use. */
type Speaker = {
  agent: Agent;
  credentials: ProviderCredentials;
};

/**
 * The orchestrator: turns one user message into agent replies.
 *
 * A DM is a single call. A group is a conversation between the agents
 * themselves: every active member answers in turn, each one seeing what the
 * others have already said, for a bounded number of rounds. The user is a
 * participant in that transcript, not the only thing the agents respond to.
 */

export type RunResult = {
  replies: Message[];
  errors: string[];
  /** True when the user stopped the run before it finished on its own. */
  interrupted: boolean;
};

/** How many past messages of the room are replayed into each prompt. */
const HISTORY_LIMIT = 40;

export class Orchestrator {
  /**
   * The run in flight for each conversation, so a stop request can abort it.
   * One run per room at a time: a second message while one is running waits
   * behind the same controller and is cancelled by the same stop.
   */
  private readonly running = new Map<string, AbortController>();

  constructor(
    private readonly store: Store,
    private readonly config: AppConfig,
  ) {}

  /** Aborts the run in flight for a conversation. Returns whether one existed. */
  stopRun(conversationId: string): boolean {
    const controller = this.running.get(conversationId);
    if (!controller) return false;
    controller.abort();
    return true;
  }

  /**
   * Loads the room's active members and their LLM credentials.
   *
   * Called before anything is stored, so a room that cannot answer — no active
   * member, or a member without a provider — fails the send outright instead
   * of leaving a message behind that no one will ever reply to.
   */
  async prepare(conversation: Conversation): Promise<Speaker[]> {
    const loaded = await Promise.all(conversation.agentIds.map((id) => this.store.getAgent(id)));
    const active = loaded
      .filter((agent): agent is Agent => Boolean(agent))
      .filter((agent) => agent.active);
    if (active.length === 0) {
      throw new ProviderError("No active agent in this room can reply.");
    }

    const speakers: Speaker[] = [];
    for (const agent of active) {
      const credentials = await this.store.getAgentCredentials(agent.id);
      if (!credentials || !credentials.baseUrl || !credentials.model) {
        throw new ProviderError(`${agent.name} has no LLM configured yet.`);
      }
      speakers.push({ agent, credentials });
    }
    return speakers;
  }

  /**
   * Runs a conversation for one user message and returns the agent replies.
   *
   * The user message is expected to be stored already; it is the last row of
   * the transcript this method reads. A stop aborts the provider calls in
   * flight and ends the loop, keeping whatever replies already landed.
   */
  async run(conversation: Conversation, externalSignal?: AbortSignal): Promise<RunResult> {
    const controller = new AbortController();
    this.running.set(conversation.id, controller);
    const onExternalAbort = () => controller.abort();
    externalSignal?.addEventListener("abort", onExternalAbort, { once: true });
    const signal = controller.signal;

    try {
      return await this.execute(conversation, signal);
    } finally {
      this.running.delete(conversation.id);
      externalSignal?.removeEventListener("abort", onExternalAbort);
    }
  }

  private async execute(conversation: Conversation, signal: AbortSignal): Promise<RunResult> {
    const speakers = await this.prepare(conversation);
    const members = speakers.map((speaker) => speaker.agent);

    const replies: Message[] = [];
    const errors: string[] = [];
    if (members.length === 0) return { replies, errors, interrupted: false };

    // A DM answers once. A group runs `groupRounds` rounds of turn-taking, but
    // never more turns than the configured ceiling, so a chatty group cannot
    // bill the operator into the ground.
    const rounds = conversation.kind === "dm" ? 1 : Math.max(1, this.config.groupRounds);
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

        try {
          const speaker = speakers.find((candidate) => candidate.agent.id === agent.id)!;
          const text = await this.speak(conversation, agent, speaker.credentials, members, signal);
          if (!text) continue;
          const message = await this.store.addMessage({
            conversationId: conversation.id,
            sender: "agent",
            agentId: agent.id,
            author: agent.name,
            text,
          });
          replies.push(message);
        } catch (error) {
          // A stop is the user's decision, not a failure: end the run quietly
          // and keep the replies that already landed.
          if (signal.aborted) {
            interrupted = true;
            return { replies, errors, interrupted };
          }
          // One agent's provider failing must not silence the rest of the room.
          const detail = error instanceof ProviderError ? error.message : "The agent could not reply.";
          errors.push(`${agent.name}: ${detail}`);
        }
      }
    }

    return { replies, errors, interrupted };
  }

  /** Builds one agent's prompt from the room transcript and calls its provider. */
  private async speak(
    conversation: Conversation,
    agent: Agent,
    credentials: ProviderCredentials,
    members: Agent[],
    signal?: AbortSignal,
  ): Promise<string> {
    const messages = await this.buildMessages(conversation, agent, members);
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
    return result.text;
  }

  /**
   * The system prompt plus the room transcript.
   *
   * In a group, the system prompt names the other members and tells the agent
   * to speak as itself, address people by name, and keep its turn short — the
   * difference between a group chat and several monologues stacked together.
   */
  private async buildMessages(conversation: Conversation, agent: Agent, members: Agent[]): Promise<ChatMessage[]> {
    const system = this.systemPrompt(conversation, agent, members);
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

  private systemPrompt(conversation: Conversation, agent: Agent, members: Agent[]): string {
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
    return lines.join("\n");
  }
}
