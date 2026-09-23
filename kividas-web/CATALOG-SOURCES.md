# Catalogue sources and execution boundaries

Public plugin source: https://github.com/anthropics/knowledge-work-plugins/tree/1bd4282

17 top-level Anthropic bundles contain 181 Markdown skills. Local Markdown references and CONNECTORS.md are packaged with each skill; source author, version and commit are retained. Apache-2.0 license and adaptation notice are shipped in public/licenses. Partner/private Claude marketplace entries are not fabricated or copied from screenshots. Catalog JSON is loaded on demand per bundle.

Installation stores selected skill instructions in the existing backend. It does not execute downloaded scripts, hooks, agents or arbitrary JavaScript. External tool access still requires an authorized connector; code execution requires a separate supported runtime. Removing a bundle deletes only the signed-in user's tagged skill records, not other users' shared skills.

Connector addresses were sourced from the public repository MCP manifests and provider documentation:
- https://www.notion.com/help/notion-mcp
- https://www.canva.dev/docs/apps/mcp/
- https://linear.app/docs/mcp
- https://developers.figma.com/docs/figma-mcp-server/remote-server-installation/
- https://github.com/anthropics/knowledge-work-plugins/blob/1bd4282/productivity/.mcp.json
- https://github.com/anthropics/knowledge-work-plugins/blob/1bd4282/data/.mcp.json

Google Drive, Gmail and Calendar need a workspace MCP gateway; no endpoint or OAuth credentials are invented. Some providers require preapproved OAuth clients; registration failures surface in the UI. Real provider authorization and tool execution were not performed during local verification. Local demo verify/save endpoints operate on memory fixtures only.
