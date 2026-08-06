# Sovereign Router Work Items for VS Code

This optional desktop extension reads the local Work Protocol records created by the Obsidian plugin. It does not communicate with OpenRouter or Hermes, does not read API keys, and does not open a network port.

## Install for development

1. Open this `vscode-extension` folder in VS Code.
2. Run `npm install` and `npm run compile` in this folder.
3. Press **F5** to launch an Extension Development Host.
4. Set **Sovereign Router: Vault Path** to the absolute path of the vault.

## Commands

- **Sovereign Router: Open work item** opens its requirement, plan, execution, or evidence Markdown artifact.
- **Sovereign Router: Prepare approved worktree** only lists approved work items that request an isolated worktree. It asks for confirmation, invokes `git worktree add` without a shell, writes under `<repository>/.sovereign-worktrees/`, and records the resulting path in the local work item history.

Open the target repository as the VS Code workspace before preparing a worktree. Git permissions and repository policy remain the user's responsibility.
