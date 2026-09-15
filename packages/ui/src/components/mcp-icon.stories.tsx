// @ts-nocheck
import * as mod from "./mcp-icon"
import { iconNames } from "./mcp-icon"
import { create } from "../storybook/scaffold"

const docs = `### Overview
MCP icon sprite renderer for built-in MCP server badges.

Use in MCP pickers or server lists. Returns null for unknown ids so rows degrade to text-only.

### API
- Required: \`id\` (MCP server name, matched case-insensitively against built-in ids).
- Accepts standard SVG props.

### Variants and states
- Single visual style; size via CSS.

### Behavior
- Renders from the MCP SVG sprite sheet.
- Unknown ids render nothing.

### Accessibility
- Provide accessible text nearby when the icon conveys meaning.

### Theming/tokens
- Uses \`data-component="mcp-icon"\`.

`

const story = create({ title: "UI/McpIcon", mod, args: { id: "github" } })
export default {
  title: "UI/McpIcon",
  id: "components-mcp-icon",
  component: story.meta.component,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component: docs,
      },
    },
  },
  argTypes: {
    id: {
      control: "select",
      options: iconNames,
    },
  },
}

export const Basic = story.Basic

export const AllIcons = {
  render: () => (
    <div
      style={{
        display: "grid",
        gap: "12px",
        "grid-template-columns": "repeat(auto-fill, minmax(80px, 1fr))",
      }}
    >
      {iconNames.map((id) => (
        <div style={{ display: "grid", gap: "6px", "justify-items": "center" }}>
          <mod.McpIcon id={id} width="28" height="28" aria-label={id} />
          <div style={{ "font-size": "10px", color: "var(--text-weak)", "text-align": "center" }}>{id}</div>
        </div>
      ))}
    </div>
  ),
}
