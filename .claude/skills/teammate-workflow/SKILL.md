---
name: teammate-workflow
description: Workflow guide for agents operating as teammates within a team. Use when an agent needs to find, claim, and work through tasks from a shared task list. Covers task discovery, claiming, blocking resolution, and coordination with the team lead.
context: fork
---

# Teammate Workflow

When working as a teammate:

1. **Find available work** - After completing your current task, call TaskList to find available work
2. **Identify claimable tasks** - Look for tasks with status `pending`, no owner, and empty `blockedBy`
3. **Prefer ID order** - When multiple tasks are available, prefer tasks in ID order (lowest ID first), as earlier tasks often set up context for later ones
4. **Claim a task** - Claim an available task using TaskUpdate (set owner to your name), or wait for leader assignment
5. **If blocked** - Focus on unblocking tasks or notify the team lead
