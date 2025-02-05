open Jscoq_core
open Jscoq_core.Jscoq_interp
open Jscoq_core.Jscoq_proto.Proto

external emit : string -> unit = "wacoq_emit" (* implemented in `core.ts` *)

let deserialize (json : string) =
  [%of_yojson: jscoq_cmd] @@ Yojson.Safe.from_string json
  
let serialize (answers : jscoq_answer list) =
  Yojson.Safe.to_string @@ `List (List.map [%to_yojson: jscoq_answer] answers)
  
let doc = ref (Obj.magic 0)

let handleRequest json_str =
  let resp =
    try
      let cmd = deserialize json_str                     in
      match cmd with
        | Result.Error e -> [JsonExn e]
        | Result.Ok cmd -> jscoq_execute doc cmd; []
    with exn ->
      [coq_exn_info exn]
  in
  serialize resp

let handleRequestsFromStdin () =
  try
    while true do
      emit @@ handleRequest @@ Stdlib.read_line ()
    done
  with End_of_file -> ()


let wasm_cb =
  Jscoq_interp.Callbacks.
    { pre_init = (fun () -> ())
    ; post_message = (fun msg -> emit @@ Yojson.Safe.to_string @@ `List [msg])
    ; post_file = (fun _ _ _ -> ())
    ; interrupt_setup = (fun _ -> ())
    ; branding = "waCoq"
    ; subsystem_version = "wasi-sdk 12"
    ; read_file = (fun ~name:_ -> "")
    ; write_file = (fun ~name:_ ~content:_ -> ())
    ; register_cma = (fun ~file_path:_ -> ())
    ; load_pkg = (fun ~base_path:_ ~pkg:_ ~cb:_ -> failwith "handled in JS")
    ; info_pkg = (fun ~base_path:_ ~pkgs:_ ~cb:_ -> failwith "handled in JS")
    }
  
let () =
  Jscoq_interp.Callbacks.set wasm_cb;
  try
    Callback.register "wacoq_post" handleRequest ;
    if (Array.length Sys.argv > 1) && Sys.argv.(1) = "-stdin" then
      handleRequestsFromStdin ()
  with CErrors.UserError(pp) ->
    print_endline @@ "error! " ^ Pp.string_of_ppcmds pp
