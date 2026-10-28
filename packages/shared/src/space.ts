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
  createdAt: string;
};

export type AgentColor = "violet" | "mint" | "peach" | "sky" | "rose" | "amber";

/**
 * Per-agent LLM settings.
 *
 * Each agent talks to its own OpenAI-compatible endpoint, so one group can mix
 * models and providers freely. The API key is stored encrypted and never
 * returned; `hasApiKey` is all the client learns.
 */
export type AgentProvider = {
  agentId: string;
  baseUrl: string;
  model: string;
  hasApiKey: boolean;
};

export type MessageSender = "user" | "agent";

export type Message = {
  id: string;
  conversationId: string;
  sender: MessageSender;
  /** Set when `sender` is "agent"; null for the user. */
  agentId: string | null;
  /** Display name captured at write time, so history survives a rename. */
  author: string;
  text: string;
  createdAt: string;
};

export type ConversationKind = "dm" | "chat" | "group";

/**
 * The three room categories.
 *
 *   - dm:    one user, one agent. Private history, private context.
 *   - chat:  one user, several agents. The user calls who answers with @Name;
 *            unmentioned agents stay silent. Good for several perspectives.
 *   - group: a team. Agents take turns, see each other, and share tasks.
 */

export type Conversation = {
  id: string;
  kind: ConversationKind;
  title: string;
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
};

export type UpdateTaskRequest = {
  title?: string;
  detail?: string;
  status?: TaskStatus;
  assigneeAgentId?: string | null;
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
