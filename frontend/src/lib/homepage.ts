export function getHomepageLeaderboard<T>(agents: T[], pageSize = 24) {
  return {
    agents: agents.slice(0, pageSize),
    totalAgents: agents.length,
  };
}
