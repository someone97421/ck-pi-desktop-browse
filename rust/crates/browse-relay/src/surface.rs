//! MCP clients see all tools by default; OPENCODE_BROWSER_TOOLS=plain|execute|all selects an explicit surface.

use browse_core::ToolSpec;

const INSTRUCTIONS: &str = include_str!("instructions.md");
const EXECUTE_INSTRUCTIONS: &str = include_str!("instructions-execute.md");
const ALL_INSTRUCTIONS: &str = include_str!("instructions-all.md");
const EXECUTE: &str = "execute";
const EXECUTE_SURFACE: &[&str] = &[EXECUTE, "status", "tabs"];

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Surface {
    Plain,
    Execute,
    All,
}

/// The surface for a client by its `clientInfo.name`, honoring OPENCODE_BROWSER_TOOLS.
pub fn for_client(client: &str) -> Surface {
    choose(std::env::var("OPENCODE_BROWSER_TOOLS").ok().as_deref(), client)
}

fn choose(choice: Option<&str>, _client: &str) -> Surface {
    match choice.map(str::to_ascii_lowercase).as_deref() {
        Some("plain") => Surface::Plain,
        Some("execute") => Surface::Execute,
        _ => Surface::All,
    }
}

/// The tools a client sees; `client` None (the CLI, a health check) sees them all.
pub fn tools(client: Option<&str>, specs: Vec<ToolSpec>) -> Vec<ToolSpec> {
    tools_for_surface(client.map(for_client).unwrap_or(Surface::All), specs)
}

fn tools_for_surface(surface: Surface, specs: Vec<ToolSpec>) -> Vec<ToolSpec> {
    match surface {
        Surface::All => specs,
        Surface::Plain => specs.into_iter().filter(|s| s.name != EXECUTE).collect(),
        Surface::Execute => EXECUTE_SURFACE.iter().filter_map(|name| specs.iter().find(|s| s.name == *name).cloned()).collect(),
    }
}

/// The MCP server instructions for a client.
pub fn instructions(client: &str) -> &'static str {
    instructions_for_surface(for_client(client))
}

fn instructions_for_surface(surface: Surface) -> &'static str {
    match surface {
        Surface::Plain => INSTRUCTIONS,
        Surface::Execute => EXECUTE_INSTRUCTIONS,
        Surface::All => ALL_INSTRUCTIONS,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn spec(name: &str) -> ToolSpec {
        ToolSpec { name: name.into(), description: String::new(), input_schema: json!({}) }
    }

    #[test]
    fn every_client_defaults_to_all_tools() {
        for client in ["this-is-a-agent", "pi-desktop", "opencode", "OpenCode-desktop", "claude-code", ""] {
            for choice in [None, Some(""), Some("unknown"), Some("all"), Some("ALL")] {
                assert_eq!(choose(choice, client), Surface::All);
            }
            assert_eq!(choose(Some("plain"), client), Surface::Plain);
            assert_eq!(choose(Some("EXECUTE"), client), Surface::Execute);
        }
    }

    #[test]
    fn explicit_surfaces_keep_their_tools_and_instructions() {
        let all = || ["status", "tabs", "navigate", "click", "execute", "settings"].map(spec).to_vec();
        let names = |list: Vec<ToolSpec>| list.into_iter().map(|s| s.name).collect::<Vec<_>>();
        assert_eq!(names(tools_for_surface(Surface::Plain, all())), ["status", "tabs", "navigate", "click", "settings"]);
        assert_eq!(names(tools_for_surface(Surface::Execute, all())), ["execute", "status", "tabs"]);
        assert_eq!(names(tools_for_surface(Surface::All, all())), names(all()));
        assert_eq!(names(tools(None, all())), names(all()), "the CLI sees every tool");
        assert_eq!(instructions_for_surface(Surface::Plain), INSTRUCTIONS);
        assert_eq!(instructions_for_surface(Surface::Execute), EXECUTE_INSTRUCTIONS);
        let instructions = instructions_for_surface(Surface::All);
        for tool in ["snapshot", "ref", "click", "fill", "console", "network", "screenshot", "execute"] {
            assert!(instructions.contains(tool), "missing {tool} instructions");
        }
    }
}
