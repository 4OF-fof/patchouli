//! 右クリックメニューに「ページの関係図を開く」を足し、選んだら screens の graph を開く。

wit_bindgen::generate!({
    inline: "
        package local:graph;

        world graph {
            include patchouli:plugin/menu-role@0.13.0;
        }
    ",
    path: "../../app/plugins/sdk/wit",
    world: "local:graph/graph",
    generate_all,
});

use exports::patchouli::plugin as role;
use patchouli::plugin::types::{MenuItem, MenuOutput, Read, Run, Target};

const GRAPH: &str = "graph";

struct Graph;

impl role::menu::Guest for Graph {
    fn menu(_read: &Read, _targets: Vec<Target>) -> Result<Vec<MenuItem>, String> {
        Ok(vec![MenuItem {
            id: GRAPH.into(),
            label: "ページの関係図を開く".into(),
        }])
    }

    fn run_menu(
        _read: &Read,
        _run: &Run,
        _targets: Vec<Target>,
        id: String,
    ) -> Result<MenuOutput, String> {
        if id != GRAPH {
            return Err(format!("{id} には対応していません"));
        }
        Ok(MenuOutput::Screen(GRAPH.into()))
    }
}

export!(Graph);
