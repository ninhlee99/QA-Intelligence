export type StateTransition = Readonly<{ from: string; action: string; to: string }>;
export function generateStateJourneys(input: Readonly<{ initial_state: string; transitions: readonly StateTransition[]; max_steps: number }>): Readonly<{ journeys: readonly Readonly<{ actions: readonly string[]; states: readonly string[] }>[]; uncovered_transitions: readonly string[] }> {
  const journeys: { actions: string[]; states: string[] }[] = []; const covered = new Set<string>();
  const queue: { state: string; actions: string[]; states: string[] }[] = [{ state: input.initial_state, actions: [], states: [input.initial_state] }];
  while (queue.length > 0) {
    const current = queue.shift()!; if (current.actions.length >= input.max_steps) continue;
    for (const transition of input.transitions.filter((item) => item.from === current.state)) {
      const key = transitionKey(transition); const journey = { actions: [...current.actions, transition.action], states: [...current.states, transition.to] };
      if (!covered.has(key)) { covered.add(key); journeys.push(journey); }
      if (!journey.states.slice(0, -1).includes(transition.to)) queue.push({ state: transition.to, ...journey });
    }
  }
  return { journeys, uncovered_transitions: input.transitions.filter((item) => !covered.has(transitionKey(item))).map(transitionKey) };
}
function transitionKey(item: StateTransition): string { return `${item.from} --${item.action}--> ${item.to}`; }
