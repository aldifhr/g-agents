/**
 * @Name mention parsing, shared by the API and the web client.
 *
 * A chat room answers the agents the user calls by name. The match is
 * case-insensitive and anchored on a word boundary, so "@Theo" calls Theo
 * while "@Theodore" does not, and "@Theo's fix" still counts.
 */

/** Escapes a name for safe use inside a RegExp. */
function escapeName(name: string) {
  return name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The ids of the given agents that are mentioned in the text, in agent order.
 * An agent mentioned twice is returned once.
 */
export function parseMentions(text: string, agents: Array<{ id: string; name: string }>): string[] {
  const mentioned: string[] = [];
  for (const agent of agents) {
    if (!agent.name) continue;
    const pattern = new RegExp(`@${escapeName(agent.name)}(?![\\w])`, "i");
    if (pattern.test(text)) mentioned.push(agent.id);
  }
  return mentioned;
}

/** Every @token in the text, without the leading "@", for the composer UI. */
export function mentionTokens(text: string): string[] {
  return [...text.matchAll(/@([\w-]*)/g)].map((match) => match[1] ?? "");
}
