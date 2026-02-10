# Claude Code Teams Task Viewer (ccteams)

## Team Naming Convention

When creating a team with `TeamCreate`, the `team_name` MUST be a short, descriptive **noun** derived from the user's task request. Do NOT use random or codename-style names.

Rules:
- Use a noun or noun phrase that summarizes the task (e.g., `snake-game`, `auth-api`, `dashboard`, `chat-app`)
- Keep it to 1-3 words, kebab-case
- The name should make it immediately clear what the team is building
- Examples:
  - User asks "Make a snake game" → team_name: `snake-game`
  - User asks "Build a REST API for user authentication" → team_name: `auth-api`
  - User asks "Create a weather dashboard" → team_name: `weather-dashboard`

The GitHub Project title is auto-generated from the team name (`ccteams: {teamName}`), so a good team name also produces a good project title.
