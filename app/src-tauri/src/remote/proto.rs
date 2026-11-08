//! 外からの操作の決まり。アプリと CLI の両方が読むので、std と依存クレートのほかは使わない。
//!
//! パイプの上では、1 行に 1 つの JSON で JSON-RPC 2.0 の要求と応答をやり取りする。
//! 最初の要求は hello で、名乗った口に許した権限の操作だけを受け付ける。

use std::io;
use std::path::PathBuf;

use interprocess::local_socket::{GenericFilePath, GenericNamespaced, Name, prelude::*};

const SOCKET: &str = if cfg!(debug_assertions) {
    "patchouli-debug"
} else {
    "patchouli"
};

/// Native Messaging のホストの名前。拡張機能は、この名前でつなぐ。
pub const HOST: &str = if cfg!(debug_assertions) {
    "dev.4of.patchouli.debug"
} else {
    "dev.4of.patchouli"
};

/// Windows は名前付きパイプ、ほかは利用者ごとの一時フォルダに置くソケット。
pub fn socket_name() -> io::Result<Name<'static>> {
    if cfg!(windows) {
        return SOCKET.to_ns_name::<GenericNamespaced>();
    }
    let dir = std::env::var_os("XDG_RUNTIME_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir);
    dir.join(format!("{SOCKET}.sock"))
        .to_fs_name::<GenericFilePath>()
        .map(Name::into_owned)
}

/// hello の前でも受け付ける要求。二重に起動したアプリが、動いているほうのウィンドウを出す。
pub const ACTIVATE: &str = "app.activate";
pub const HELLO: &str = "hello";

pub const PERMISSIONS: [&str; 6] = ["library", "assets", "notes", "edit", "delete", "window"];

pub fn permission_label(p: &str) -> &str {
    match p {
        "library" => "ライブラリの情報を読み取り",
        "assets" => "素材を追加",
        "notes" => "ノートを作成・編集",
        "edit" => "名前・タグ・プロジェクトを変更",
        "delete" => "ごみ箱に移動",
        "window" => "ウィンドウとトーストを表示・アプリを終了",
        _ => p,
    }
}

/// JSON-RPC のエラーの番号。
pub const PARSE_ERROR: i64 = -32700;
pub const INVALID: i64 = -32600;
pub const NOT_FOUND: i64 = -32601;
pub const DENIED: i64 = -32001;
pub const FAILED: i64 = -32000;

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    Str,
    /// 長い文字列。CLI では「-」を渡すと標準入力から読む
    Text,
    Int,
    Bool,
    /// 文字列の並び。CLI では同じオプションを繰り返す
    List,
}

pub struct Param {
    /// JSON での名前
    pub name: &'static str,
    /// CLI のオプションの名前。位置で渡すものは、ヘルプに出す名前
    pub flag: &'static str,
    pub kind: Kind,
    pub required: bool,
    /// CLI で、オプションの名前を付けずに順に渡す
    pub positional: bool,
    pub help: &'static str,
}

pub struct Op {
    pub method: &'static str,
    /// CLI のコマンド。空なら CLI からは使わない
    pub cli: &'static [&'static str],
    pub permission: &'static str,
    pub summary: &'static str,
    pub params: &'static [Param],
}

const fn arg(name: &'static str, kind: Kind, help: &'static str) -> Param {
    Param {
        name,
        flag: name,
        kind,
        required: true,
        positional: true,
        help,
    }
}

const fn opt_arg(name: &'static str, kind: Kind, help: &'static str) -> Param {
    Param {
        required: false,
        ..arg(name, kind, help)
    }
}

const fn opt(name: &'static str, flag: &'static str, kind: Kind, help: &'static str) -> Param {
    Param {
        name,
        flag,
        kind,
        required: false,
        positional: false,
        help,
    }
}

const fn need(name: &'static str, flag: &'static str, kind: Kind, help: &'static str) -> Param {
    Param {
        required: true,
        ..opt(name, flag, kind, help)
    }
}

const ID: Param = arg("id", Kind::Str, "素材かノートの ID");
const PROJECT: Param = opt(
    "project",
    "project",
    Kind::Str,
    "プロジェクト名。グループを指定したときは、グループのプロジェクトになります",
);
const GROUP: Param = opt("group", "group", Kind::Str, "グループの ID");
const TAGS: Param = opt("tags", "tag", Kind::List, "付けるタグ");
const URL: Param = opt(
    "url",
    "url",
    Kind::Str,
    "項目に記録する URL（取得元のページなど）",
);

pub const OPS: &[Op] = &[
    Op {
        method: "library.info",
        cli: &["info"],
        permission: "library",
        summary: "開いているライブラリの場所と件数を表示",
        params: &[],
    },
    Op {
        method: "items.list",
        cli: &["list"],
        permission: "library",
        summary: "素材とノートの一覧を更新順に表示",
        params: &[
            opt_arg(
                "query",
                Kind::Str,
                "名前・別名・メモ・ノートの本文で検索する語。空白で区切ると、すべてを含む項目",
            ),
            opt(
                "tags",
                "tag",
                Kind::List,
                "タグ。サブタグも含みます。複数指定すると、すべてが付いている項目",
            ),
            opt(
                "project",
                "project",
                Kind::Str,
                "プロジェクト名。空にすると、所属なしの項目",
            ),
            opt(
                "group",
                "group",
                Kind::Str,
                "グループの ID。サブグループの項目は含みません",
            ),
            opt(
                "type",
                "type",
                Kind::Str,
                "種類。note（ノート）か asset（素材）",
            ),
            opt("exts", "ext", Kind::List, "拡張子"),
            opt("limit", "limit", Kind::Int, "最大件数。既定は 50 件"),
            opt("offset", "offset", Kind::Int, "先頭から飛ばす件数"),
        ],
    },
    Op {
        method: "items.get",
        cli: &["show"],
        permission: "library",
        summary: "素材かノート 1 件の情報を表示",
        params: &[ID],
    },
    Op {
        method: "notes.read",
        cli: &["note", "read"],
        permission: "library",
        summary: "ノートの本文を表示",
        params: &[ID],
    },
    Op {
        method: "tags.list",
        cli: &["tags"],
        permission: "library",
        summary: "タグと件数の一覧を表示",
        params: &[],
    },
    Op {
        method: "projects.list",
        cli: &["projects"],
        permission: "library",
        summary: "プロジェクトとグループの一覧を表示",
        params: &[],
    },
    Op {
        method: "search.content",
        cli: &["search"],
        permission: "library",
        summary: "AI 検索で、内容の近い項目を検索。AI 機能と AI 検索が有効なときだけ使用できます",
        params: &[
            arg("query", Kind::Text, "検索する内容"),
            opt("limit", "limit", Kind::Int, "最大件数。既定は 20 件"),
        ],
    },
    Op {
        method: "items.import",
        cli: &["import"],
        permission: "assets",
        summary: "ファイルかフォルダを取り込み。フォルダはグループとして取り込みます",
        params: &[
            arg("paths", Kind::List, "ファイルかフォルダのパス"),
            PROJECT,
            GROUP,
            TAGS,
            URL,
            opt(
                "move",
                "move",
                Kind::Bool,
                "コピーせずに移動。指定しなければ、設定の取り込み方に従います",
            ),
        ],
    },
    Op {
        method: "items.importUrl",
        cli: &["import-url"],
        permission: "assets",
        summary: "URL のファイル（画像など）をダウンロードして取り込み。項目の URL には、ダウンロード元を記録します",
        params: &[
            arg("url", Kind::Str, "http か https の URL"),
            opt(
                "name",
                "name",
                Kind::Str,
                "ファイル名。拡張子がなければ、ダウンロードした形式から付けます",
            ),
            PROJECT,
            GROUP,
            TAGS,
            opt(
                "referer",
                "referer",
                Kind::Str,
                "ダウンロードするときに送る Referer（取得元のページの URL）",
            ),
            opt(
                "cookie",
                "cookie",
                Kind::Text,
                "ダウンロードするときに送る Cookie。ダウンロード元と同じホストにだけ送ります",
            ),
        ],
    },
    Op {
        method: "items.addLink",
        cli: &["add-link"],
        permission: "assets",
        summary: "ページの URL をショートカット（.url）として追加",
        params: &[
            arg("url", Kind::Str, "http か https の URL"),
            opt(
                "name",
                "name",
                Kind::Str,
                "名前。指定しなければ、ページのタイトルにします",
            ),
            PROJECT,
            GROUP,
            TAGS,
        ],
    },
    Op {
        method: "items.importData",
        cli: &[],
        permission: "assets",
        summary: "Base64 で受け取ったファイルを取り込み",
        params: &[
            need("name", "name", Kind::Str, "拡張子つきのファイル名"),
            need("data", "data", Kind::Text, "ファイルの中身（Base64）"),
            PROJECT,
            GROUP,
            TAGS,
            URL,
        ],
    },
    Op {
        method: "notes.create",
        cli: &["note", "create"],
        permission: "notes",
        summary: "ノートを作成",
        params: &[
            arg("name", Kind::Str, "ノートの名前"),
            opt("body", "body", Kind::Text, "本文"),
            PROJECT,
            GROUP,
            TAGS,
            URL,
        ],
    },
    Op {
        method: "notes.write",
        cli: &["note", "write"],
        permission: "notes",
        summary: "ノートの本文を置き換え",
        params: &[ID, need("body", "body", Kind::Text, "新しい本文")],
    },
    Op {
        method: "notes.append",
        cli: &["note", "append"],
        permission: "notes",
        summary: "ノートの本文の末尾に追記",
        params: &[ID, arg("text", Kind::Text, "追記する文")],
    },
    Op {
        method: "items.update",
        cli: &["update"],
        permission: "edit",
        summary: "タグ・別名・メモ・URL を変更",
        params: &[
            ID,
            opt("addTags", "add-tag", Kind::List, "付けるタグ"),
            opt("removeTags", "remove-tag", Kind::List, "削除するタグ"),
            opt("addAliases", "add-alias", Kind::List, "追加する別名"),
            opt("removeAliases", "remove-alias", Kind::List, "削除する別名"),
            opt("memo", "memo", Kind::Text, "メモ。空にすると削除します"),
            opt(
                "url",
                "url",
                Kind::Str,
                "URL。空にすると削除します。ショートカット（.url）は、リンク先を書き換えます",
            ),
        ],
    },
    Op {
        method: "items.rename",
        cli: &["rename"],
        permission: "edit",
        summary: "素材かノートの名前を変更。拡張子は変わりません",
        params: &[ID, arg("name", Kind::Str, "新しい名前")],
    },
    Op {
        method: "items.move",
        cli: &["move"],
        permission: "edit",
        summary: "素材かノートを別のプロジェクトかグループに移動。どちらも指定しなければ所属なしに移します",
        params: &[ID, PROJECT, GROUP],
    },
    Op {
        method: "projects.create",
        cli: &["project", "create"],
        permission: "edit",
        summary: "プロジェクトを作成",
        params: &[arg("name", Kind::Str, "プロジェクトの名前")],
    },
    Op {
        method: "projects.rename",
        cli: &["project", "rename"],
        permission: "edit",
        summary: "プロジェクトの名前を変更",
        params: &[
            arg("from", Kind::Str, "現在の名前"),
            arg("to", Kind::Str, "新しい名前"),
        ],
    },
    Op {
        method: "groups.create",
        cli: &["group", "create"],
        permission: "edit",
        summary: "グループを作成。グループを指定すると、そのサブグループとして作成します",
        params: &[arg("name", Kind::Str, "グループの名前"), PROJECT, GROUP],
    },
    Op {
        method: "tags.rename",
        cli: &["tag", "rename"],
        permission: "edit",
        summary: "タグの名前を変更。サブタグと、項目に付いているタグも変更します",
        params: &[
            arg("from", Kind::Str, "現在の名前"),
            arg("to", Kind::Str, "新しい名前"),
        ],
    },
    Op {
        method: "items.delete",
        cli: &["delete"],
        permission: "delete",
        summary: "素材かノートをごみ箱に移動",
        params: &[ID],
    },
    Op {
        method: "projects.delete",
        cli: &["project", "delete"],
        permission: "delete",
        summary: "プロジェクトを解散。中の項目は所属なしに移し、フォルダと概要はごみ箱に移動します",
        params: &[arg("name", Kind::Str, "プロジェクトの名前")],
    },
    Op {
        method: "app.show",
        cli: &["open"],
        permission: "window",
        summary: "ウィンドウを表示。ID を指定すると、その素材かノートを開きます",
        params: &[opt_arg("id", Kind::Str, "素材かノートの ID")],
    },
    Op {
        method: "toast.show",
        cli: &[],
        permission: "window",
        summary: "保存の進み具合と結果を、画面の右下のトーストに表示。同じ key で呼ぶと表示を置き換えます。再試行のボタンを押すと、toast.retry（params は key）を知らせます",
        params: &[
            need("key", "key", Kind::Str, "トーストを見分ける文字列"),
            need(
                "state",
                "state",
                Kind::Str,
                "saving（保存中）・saved（保存済み）・failed（失敗）",
            ),
            opt(
                "kind",
                "kind",
                Kind::Str,
                "保存するもの。image・audio・video・file・url・note",
            ),
            opt(
                "name",
                "name",
                Kind::Str,
                "保存中と失敗のときに表示する名前",
            ),
            opt("id", "id", Kind::Str, "保存した素材かノートの ID"),
            opt(
                "attached",
                "attached",
                Kind::List,
                "一緒に保存した素材の ID。保存先を変えると、一緒に移動します",
            ),
            opt("done", "done", Kind::Int, "取り込み終えたファイルの件数"),
            opt("total", "total", Kind::Int, "取り込むファイルの件数"),
            opt("error", "error", Kind::Str, "失敗の理由"),
            opt("retry", "retry", Kind::Bool, "再試行のボタンを表示"),
        ],
    },
    Op {
        method: "app.quit",
        cli: &["quit"],
        permission: "window",
        summary: "アプリを終了",
        params: &[],
    },
];

pub fn op(method: &str) -> Option<&'static Op> {
    OPS.iter().find(|o| o.method == method)
}

fn value_label(p: &Param) -> &'static str {
    match p.kind {
        Kind::Int => "数",
        Kind::Text => "文",
        _ => "値",
    }
}

/// CLI の書き方。例：patchouli note create <name> [--body <文>]
pub fn usage(command: &str, op: &Op) -> String {
    let mut s = format!("{command} {}", op.cli.join(" "));
    for p in op.params.iter().filter(|p| p.positional) {
        let more = if p.kind == Kind::List { "..." } else { "" };
        if p.required {
            s.push_str(&format!(" <{}>{more}", p.flag));
        } else {
            s.push_str(&format!(" [{}]{more}", p.flag));
        }
    }
    for p in op.params.iter().filter(|p| !p.positional) {
        let v = if p.kind == Kind::Bool {
            String::new()
        } else {
            format!(" <{}>", value_label(p))
        };
        let more = if p.kind == Kind::List { "..." } else { "" };
        if p.required {
            s.push_str(&format!(" --{}{v}", p.flag));
        } else {
            s.push_str(&format!(" [--{}{v}]{more}", p.flag));
        }
    }
    s
}

/// CLI のコマンドの一覧。ヘルプと skill に使う。
pub fn reference(command: &str) -> String {
    let mut s = String::new();
    for op in OPS.iter().filter(|o| !o.cli.is_empty()) {
        s.push_str(&format!("{}\n    {}\n", usage(command, op), op.summary));
        for p in op.params {
            let name = if p.positional {
                p.flag.to_owned()
            } else {
                format!("--{}", p.flag)
            };
            s.push_str(&format!("    {name}: {}\n", p.help));
        }
        s.push('\n');
    }
    s
}
