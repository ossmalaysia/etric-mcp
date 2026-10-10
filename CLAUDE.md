# Claude project instructions

## Objective

Build a local, model-independent MCP server that makes HRD Corp eTRiS easy to navigate and operate through natural-language requests. Support local credential setup, encrypted saved login, background browser operation, authorized menu discovery, and programme management with verified results.

## Required context and workflow

Read and follow [AGENTS.md](AGENTS.md) as the common project instruction source. Before every task, also read [intents.md](intents.md), the durable lessons and latest relevant entries in [learning.md](learning.md), and the relevant implementation and README sections.

Update `learning.md` for every task before handoff, recording what was attempted, what was learned, how the result was verified, and what remains. Update `intents.md` when the user's objective changes. Keep this file aligned with `AGENTS.md` rather than maintaining a conflicting workflow.

## Project defaults

- Source is maintained in the **public** `ossmalaysia/etris-mcp` repository.
- Local stdio MCP and the shared loopback browser worker come first.
- Routine browser work runs in the background; interactive setup and requested verification can be visible.
- Credentials remain local and encrypted. Do not ask for passwords in chat or copy secrets/account records into the public source, notes, fixtures, logs, or command arguments.
- Capture authorized menu routes dynamically. Use fresh page references and distinguish workspace windows from notices.
- Preparing a form is not submitting it, and clicking an action is not evidence of success. Follow the existing local write review and verify the result.
- Documentation-only work does not require restarting a browser or repeating unrelated live tests.

The latest explicit user instruction takes precedence over project defaults. See `AGENTS.md` for the complete implementation, validation, and publication rules.
