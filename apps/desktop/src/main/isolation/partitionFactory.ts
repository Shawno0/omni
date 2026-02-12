export function createPartitionForWorkspace(workspaceId: string): string {
  return `persist:session_${workspaceId}`;
}
