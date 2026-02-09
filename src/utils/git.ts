/**
 * Parse a git remote URL into owner and repo name.
 * Supports both HTTPS and SSH formats:
 *   - https://github.com/owner/repo.git -> { owner: "owner", name: "repo" }
 *   - git@github.com:owner/repo.git     -> { owner: "owner", name: "repo" }
 */
export function parseGitRemoteUrl(url: string): { owner: string; name: string } {
  // SSH: git@github.com:owner/repo.git
  const sshMatch = url.match(/git@[^:]+:([^/]+)\/([^/.]+)(?:\.git)?$/);
  if (sshMatch) {
    return { owner: sshMatch[1], name: sshMatch[2] };
  }

  // HTTPS: https://github.com/owner/repo.git
  const httpsMatch = url.match(/https?:\/\/[^/]+\/([^/]+)\/([^/.]+)(?:\.git)?$/);
  if (httpsMatch) {
    return { owner: httpsMatch[1], name: httpsMatch[2] };
  }

  throw new Error(`Could not parse git remote URL: ${url}`);
}
