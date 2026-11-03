//! 選んだ素材を埋め込み、選んだノートへのリンクを並べたページを作る。
//! 名前を読むのに library、ページを作るのに notes を使う。

wit_bindgen::generate!({
    inline: "
        package local:collect;

        world collect {
            include patchouli:plugin/menu-role@0.12.0;
        }
    ",
    path: "../../app/plugins/sdk/wit",
    world: "local:collect/collect",
    generate_all,
});

use exports::patchouli::plugin as role;
use patchouli::plugin::types::{
    ItemInfo, MenuItem, MenuOutput, Read, Run, Target, Toast, ToastLevel,
};
use patchouli::plugin::{library, notes};

const COLLECT: &str = "collect";

struct Collect;

impl role::menu::Guest for Collect {
    fn menu(_read: &Read, _targets: Vec<Target>) -> Result<Vec<MenuItem>, String> {
        Ok(vec![MenuItem {
            id: COLLECT.into(),
            label: "選んだものからページを作る".into(),
        }])
    }

    fn run_menu(
        read: &Read,
        run: &Run,
        targets: Vec<Target>,
        id: String,
    ) -> Result<MenuOutput, String> {
        if id != COLLECT {
            return Err(format!("{id} には対応していません"));
        }
        let items = targets
            .iter()
            .map(|t| library::item(read, &t.file))
            .collect::<Result<Vec<_>, _>>()?;
        let first = items.first().ok_or("選んだものがありません")?;
        let name = match items.len() {
            1 => format!("{} のノート", first.name),
            n => format!("{} ほか {} 件のノート", first.name, n - 1),
        };
        notes::create(run, &name, &body(&items))?;
        Ok(MenuOutput::Toast(Toast {
            text: format!("「{name}」を作りました"),
            level: ToastLevel::Success,
        }))
    }
}

/// 素材は埋め込み、ノートはリンクの並びにする。
fn body(items: &[ItemInfo]) -> String {
    let (pages, assets): (Vec<&ItemInfo>, Vec<&ItemInfo>) = items.iter().partition(|it| it.note);
    let mut out = String::new();
    for it in assets {
        out.push_str(&format!("![{}](patchouli:{})\n\n", escape(&it.name), it.id));
    }
    if !pages.is_empty() {
        out.push_str("## ページ\n\n");
        for it in pages {
            out.push_str(&format!("- [{}](patchouli:{})\n", escape(&it.name), it.id));
        }
    }
    out
}

fn escape(s: &str) -> String {
    s.chars()
        .flat_map(|c| match c {
            '\\' | '[' | ']' => vec!['\\', c],
            _ => vec![c],
        })
        .collect()
}

export!(Collect);
