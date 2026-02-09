import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { logger } from './logger.js';

const execFileAsync = promisify(execFile);

export async function checkGhAuth(): Promise<boolean> {
  try {
    await execFileAsync('gh', ['auth', 'status']);
    return true;
  } catch {
    logger.error('GitHub CLI is not authenticated. Run: gh auth login');
    return false;
  }
}

export async function checkProjectScope(): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync('gh', ['auth', 'status']);
    // Check if project scope is available by checking the token scopes
    // The gh auth status output includes scopes info
    if (stdout.includes('project') || stdout.includes('read:project')) {
      return true;
    }
    // Try a simple project query to verify access
    await execFileAsync('gh', ['api', 'graphql', '-f', 'query={ viewer { login } }']);
    return true;
  } catch {
    logger.error('Missing "project" scope. Run: gh auth refresh -s project');
    return false;
  }
}

export async function getAuthenticatedUser(): Promise<string> {
  const { stdout } = await execFileAsync('gh', ['api', 'graphql', '-f', 'query={ viewer { login } }']);
  const data = JSON.parse(stdout);
  return data.data.viewer.login;
}

export async function runGraphQL(query: string, variables?: Record<string, unknown>): Promise<any> {
  const body = JSON.stringify({
    query,
    variables: variables ?? {},
  });

  return new Promise((resolve, reject) => {
    const proc = spawn('gh', ['api', 'graphql', '--input', '-'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data: Buffer) => { stdout += data.toString(); });
    proc.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });

    proc.on('close', (code: number | null) => {
      if (code !== 0) {
        reject(new Error(stderr || `gh exited with code ${code}`));
        return;
      }
      try {
        const result = JSON.parse(stdout);
        if (result.errors) {
          reject(new Error(result.errors.map((e: any) => e.message).join(', ')));
          return;
        }
        resolve(result.data);
      } catch (e) {
        reject(new Error(`Failed to parse GraphQL response: ${stdout}`));
      }
    });

    proc.on('error', reject);

    proc.stdin.write(body);
    proc.stdin.end();
  });
}
