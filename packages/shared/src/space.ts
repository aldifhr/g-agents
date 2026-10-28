/**
 * The domain model, shared by the API and the web client.
 *
 * Three nouns carry the whole app:
 *   - Agent: a persona with its own LLM (base URL, model, key).
 *   - Conversation: a DM with one agent, or a group with several.
 *   - Message: one turn in a conversation, from the user or an agent.
 */

/** A persona the user chats with. Each agent carries its own LLM settings. */
export type Agent = {
  id: string;
  name: string;
  /** Short label under the name in the sidebar, e.g. "Researcher". */
  role: string;
  /** System prompt: who the agent is and how it should behave. */
  systemPrompt: string;
  /** Avatar color token, chosen from a fixed palette. */
  color: AgentColor;
  /** Two-letter avatar initials, derived from the name if not set. */
  initials: string;
  /** Whether the agent may reply. A quiet agent stays in the room, silent. */
  active: boolean;
  /** The model connection this agent uses; null when unconfigured. */
  providerId: string | null;
  /** The model id to use on that provider. */
  model: string;
  /** The persona this agent was created from, if any. */
  personaId: string | null;
  /**
   * Tool permissions: the names of the tools this agent may call.
   * An empty list means every registered tool is allowed.
   */
  tools: string[];
  createdAt: string;
};

export type AgentColor = "violet" | "mint" | "peach" | "sky" | "rose" | "amber";

/**
 * A model connection: one OpenAI-compatible endpoint plus its key.
 *
 * Providers are shared: several agents can point at one connection, so a key
 * is configured once. The API key is stored encrypted and never returned;
 * `hasApiKey` is all the client learns.
 */
export type Provider = {
  id: string;
  name: string;
  baseUrl: string;
  hasApiKey: boolean;
  createdAt: string;
  updatedAt: string;
};

/**
 * A reusable character preset. An agent may adopt one, so a "Reviewer" persona
 * is written once and applied to several agents.
 */
export type Persona = {
  id: string;
  name: string;
  role: string;
  systemPrompt: string;
  color: AgentColor;
  createdAt: string;
  updatedAt: string;
};

/**
 * Per-agent LLM settings, as the settings form reads and writes them.
 *
 * This is the wire shape for one agent's connection: the provider's base URL
 * and key plus the model. The store resolves it against the shared `providers`
 * table; the client never sees a provider id here.
 */
export type AgentProvider = {
  agentId: string;
  baseUrl: string;
  model: string;
  hasApiKey: boolean;
};

export type MessageSender = "user" | "agent" | "system";

/** The ordered content of a turn. Text today; tool calls and reasoning later. */
export type MessagePart =
  | { type: "text"; text: string }
  | { type: "tool_call"; tool: string; input: string }
  | { type: "tool_result"; tool: string; output: string; ok: boolean };

export type MessageStatus = "complete" | "streaming" | "error";

export type Message = {
  id: string;
  conversationId: string;
  /** The run that produced this turn; null for a user send not yet run. */
  runId: string | null;
  sender: MessageSender;
  /** Set when `sender` is "agent"; null for the user. */
  agentId: string | null;
  /** Display name captured at write time, so history survives a rename. */
  author: string;
  /** Ordered content parts. */
  parts: MessagePart[];
  /** Plain-text rendering of the parts, for search, previews, and prompts. */
  text: string;
  status: MessageStatus;
  createdAt: string;
};

export type ConversationKind = "dm" | "group";

/**
 * The two room categories.
 *
 *   - dm:    one user, one agent. Private history, private context.
 *   - group: a room with several agents. How they take turns is a separate
 *            concern, carried by `turnPolicy` — a room with several agents is
 *            one thing, and whether they all speak or only the ones you call
 *            is a setting on it, not a different kind of room.
 */

/**
 * How the orchestrator decides who answers:
 *   - single:   the one agent answers (a DM).
 *   - mentions: only the agents the user calls by @Name answer; the rest stay
 *               silent. Good for several independent perspectives.
 *   - rounds:   every active member answers in turn, for bounded rounds, and
 *               each sees what the others said. Good for a team.
 */
export type TurnPolicy = "single" | "mentions" | "rounds";

export type Conversation = {
  id: string;
  kind: ConversationKind;
  title: string;
  turnPolicy: TurnPolicy;
  /** "You" for the user, or an agent's name when one created the room. */
  createdBy: string;
  /** Members of the room. A DM has exactly one; a group has one or more. */
  agentIds: string[];
  createdAt: string;
  updatedAt: string;
  /** Newest message, for the sidebar preview. */
  lastMessage: Message | null;
};

/** The whole space, as returned by GET /api/space. */
export type SpaceData = {
  agents: Agent[];
  conversations: Conversation[];
};

/**
 * Run context: one execution of the orchestrator.
 *
 * Separate from history on purpose. History is the durable transcript a user
 * reopens; a run is the transient record of one piece of work — which agents
 * spoke, which tools fired, and how it ended. Persisted so a restart can
 * reconcile a run that was in flight, and so tool calls and artifacts have a
 * stable parent to point at.
 */
export type RunStatus = "running" | "done" | "error" | "interrupted";

export type Run = {
  id: string;
  conversationId: string;
  /** The user message that started it; null once rolled back. */
  triggerMessageId: string | null;
  status: RunStatus;
  /** The agent turn in flight, for a live view; null between turns. */
  activeAgentId: string | null;
  /** Operator-facing summary of how the run ended. */
  error: string;
  startedAt: string;
  endedAt: string | null;
};

/**
 * One agent's execution inside a run. A group run has one row per agent turn,
 * so a single agent's failure, latency, and token spend are attributable on
 * their own. This is also where a task handoff lands.
 */
export type AgentRun = {
  id: string;
  runId: string;
  agentId: string | null;
  taskId: string | null;
  status: RunStatus;
  error: string;
  startedAt: string;
  endedAt: string | null;
};

/**
 * One model call: the token and cost record. Recorded per call, not per run,
 * so a router, a main agent, a reviewer, and a retry are each attributable.
 */
export type UsageEvent = {
  id: string;
  runId: string | null;
  agentRunId: string | null;
  providerId: string | null;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  /** Cost in millionths of the provider's currency; null when unknown. */
  costMicros: number | null;
  createdAt: string;
};

/**
 * A compressed summary of a conversation's earlier history. `coversUntilMessageId`
 * is the inclusive upper bound the summary stands in for.
 */
export type ConversationSummary = {
  id: string;
  conversationId: string;
  coversUntilMessageId: string | null;
  summary: string;
  tokenCount: number;
  createdAt: string;
};

/**
 * Project memory: the durable decisions, architecture, and rules that outlive
 * any single conversation. Read into every agent's prompt; written when the
 * operator records something worth remembering.
 */
export type MemoryScope = "project" | "conversation";
export type MemoryKind = "decision" | "architecture" | "rule" | "note";

export type Memory = {
  id: string;
  scope: MemoryScope;
  /** Set only when `scope` is `conversation`. */
  conversationId: string | null;
  kind: MemoryKind;
  title: string;
  body: string;
  /** "You" for the user, or the agent's name. */
  createdBy: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

/**
 * Task artifacts: the concrete output a task produced — a report, a diff, a
 * log, a test result. Distinct from a tool call because an artifact is a
 * curated deliverable a reviewer reads, not raw execution noise.
 */
export type ArtifactKind = "report" | "diff" | "log" | "test_result" | "file";

export type TaskArtifact = {
  id: string;
  /** The task it belongs to; null for a run-level artifact with no task yet. */
  taskId: string | null;
  conversationId: string;
  runId: string | null;
  toolCallId: string | null;
  kind: ArtifactKind;
  title: string;
  content: string;
  createdAt: string;
};

/** A unit of work inside a group room. */
export type TaskStatus = "pending" | "in_progress" | "review" | "done";

export type Task = {
  id: string;
  conversationId: string;
  title: string;
  detail: string;
  status: TaskStatus;
  /** The agent responsible; null means unassigned. */
  assigneeAgentId: string | null;
  /** The run that produced or last advanced this task; null for hand-created. */
  runId: string | null;
  /** "You" for the user, or the agent's name. */
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

export type TasksResponse = {
  tasks: Task[];
};

export type CreateTaskRequest = {
  title: string;
  detail?: string;
  assigneeAgentId?: string | null;
  /** The run that produced it, when one did. */
  runId?: string | null;
};

export type UpdateTaskRequest = {
  title?: string;
  detail?: string;
  status?: TaskStatus;
  assigneeAgentId?: string | null;
};

/** Run context reads. */
export type RunsResponse = {
  runs: Run[];
};

export type RunResponse = {
  run: Run;
  /** Tool calls made during this run, in order. */
  toolCalls: ToolCall[];
  /** Artifacts produced during this run. */
  artifacts: TaskArtifact[];
};

/** A recorded tool call, as returned by the audit endpoints. */
export type ToolCall = {
  id: string;
  conversationId: string | null;
  runId: string | null;
  tool: string;
  input: string;
  output: string;
  ok: boolean;
  durationMs: number;
  createdAt: string;
};

/** Project memory reads and writes. */
export type MemoriesResponse = {
  memories: Memory[];
};

export type CreateMemoryRequest = {
  scope?: MemoryScope;
  conversationId?: string | null;
  kind?: MemoryKind;
  title: string;
  body?: string;
};

export type UpdateMemoryRequest = {
  kind?: MemoryKind;
  title?: string;
  body?: string;
  active?: boolean;
};

/** Task artifact reads and writes. */
export type ArtifactsResponse = {
  artifacts: TaskArtifact[];
};

export type CreateArtifactRequest = {
  taskId?: string | null;
  runId?: string | null;
  toolCallId?: string | null;
  kind: ArtifactKind;
  title?: string;
  content?: string;
};

export type SpaceResponse = {
  space: SpaceData;
  revision: number;
};

/** Body of POST /api/conversations/:id/messages. */
export type SendMessageRequest = {
  text: string;
};

/**
 * Response of POST /api/conversations/:id/messages.
 *
 * `replies` are the agent messages the run produced, in order. `errors` names
 * any agent that failed, so one bad provider never hides the others' answers.
 */
export type SendMessageResponse = {
  userMessage: Message;
  replies: Message[];
  errors: string[];
  revision: number;
  /** The persisted run that produced these replies. */
  runId?: string;
  /** True when the run was stopped by the user before every agent had answered. */
  interrupted?: boolean;
};

export type CreateAgentRequest = {
  name: string;
  role: string;
  systemPrompt: string;
  color: AgentColor;
};

export type UpdateAgentRequest = Partial<CreateAgentRequest> & {
  active?: boolean;
};

export type CreateConversationRequest = {
  kind: ConversationKind;
  title: string;
  agentIds: string[];
};

export type UpdateConversationRequest = {
  title?: string;
  agentIds?: string[];
};

export type SaveProviderRequest = {
  baseUrl: string;
  model: string;
  /** Omitted to keep the stored key; empty string clears it. */
  apiKey?: string;
};

export type ProviderModelsRequest = {
  baseUrl: string;
  apiKey?: string;
};

export type ProviderModelsResponse = {
  models: string[];
};

export type TestProviderResponse = {
  ok: boolean;
  model?: string;
  error?: string;
};

export type HealthResponse = {
  status: "ok";
  service: string;
};

/** Every non-2xx response from the API uses this shape. */
export type ApiErrorResponse = {
  error: string;
};
