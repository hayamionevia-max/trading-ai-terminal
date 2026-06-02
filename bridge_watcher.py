import os
from pathlib import Path
import time

BASE_DIR = Path(__file__).resolve().parent

DISCUSSIONS = BASE_DIR / "discussions.flag"
WAKEUP = BASE_DIR / "codex_wakeup.flag"
CODEX_CHECKING = BASE_DIR / "codex_checking.flag"
HUMAN_REVIEW = BASE_DIR / "human_review.flag"

last_state = None

def read_text(path: Path) -> str:
    """明示的なwith openにより、読み込み完了後即座に確実にクローズしてロックを防ぐ"""
    if not path.exists():
        return ""
    try:
        with open(path, "r", encoding="utf-8", errors="ignore") as f:
            return f.read()
    except Exception as e:
        return f"READ_ERROR={e}"

def write_wakeup(mode: str, phase: str, reason: str, note: str = ""):
    """一時ファイルへの書き込み完了後にアトミックに置換(atomic replace)を行い、ロック競合を防止する"""
    content = f"""MODE={mode}
PHASE={phase}
REASON={reason}
NOTE={note}
UPDATED_AT={time.strftime('%Y-%m-%d %H:%M:%S')}
"""
    tmp_path = WAKEUP.with_suffix(".tmp")
    try:
        # 一時ファイルに明示的なwith openで書き込み
        with open(tmp_path, "w", encoding="utf-8") as f:
            f.write(content)
            f.flush()
            os.fsync(f.fileno())  # ディスクへの強制同期で書き込み完了を保証
        
        # 同一ドライブ上でのアトミック置換
        if tmp_path.exists():
            os.replace(tmp_path, WAKEUP)
    except Exception as e:
        print(f"[bridge_watcher] write_wakeup error: {e}")
        # 代替フォールバック: EPERM時は codex_wakeup.pending.txt に書き出す
        try:
            pending_path = BASE_DIR / "codex_wakeup.pending.txt"
            with open(pending_path, "w", encoding="utf-8") as f:
                f.write(content)
        except Exception:
            pass

print("[bridge_watcher] started")
print(f"[bridge_watcher] watching: {BASE_DIR}")

while True:
    try:
        text = read_text(DISCUSSIONS)

        # STATE=APPROVED のときは、必ず PHASE を見て動作モードを決定
        if "STATE=APPROVED" in text:
            if "PHASE=CODEX_REVIEW" in text:
                state = "APPROVED_REVIEW"
                mode = "REVIEW"
                phase = "CODEX_REVIEW"
            elif "PHASE=CODEX_RUN" in text:
                state = "APPROVED_RUN"
                mode = "RUN"
                phase = "CODEX_RUN"
            else:
                state = "APPROVED_UNKNOWN"
                mode = "REVIEW"
                phase = "CODEX_REVIEW"
        elif "STATE=DISCUSSING" in text:
            state = "DISCUSSING"
            mode = "DISCUSS"
            phase = "DISCUSS"
        elif not DISCUSSIONS.exists():
            state = "NO_DISCUSSIONS"
            mode = None
            phase = None
        else:
            state = "UNKNOWN"
            mode = "CHECK"
            phase = "UNKNOWN"

        if state != last_state:
            print(f"[bridge_watcher] state changed: {last_state} -> {state}")

            if mode == "DISCUSS":
                write_wakeup("DISCUSS", "DISCUSS", "discussions.flag is STATE=DISCUSSING")
                print("[bridge_watcher] codex_wakeup.flag written: MODE=DISCUSS")

            elif mode == "REVIEW":
                write_wakeup(
                    "REVIEW",
                    "CODEX_REVIEW",
                    "Antigravity修正済み。Codexによるレビュー・確認フェーズへ移行。",
                    "Codexは勝手に追加修正せず、まず差分確認・問題点確認・動作上の懸念点整理のみを行うこと。"
                )
                print("[bridge_watcher] codex_wakeup.flag written: MODE=REVIEW")

            elif mode == "RUN":
                write_wakeup(
                    "RUN",
                    "CODEX_RUN",
                    "Codexによる実装修正フェーズへ移行。",
                    "Codexは合意済み方針に従って実装修正を行うこと。"
                )
                print("[bridge_watcher] codex_wakeup.flag written: MODE=RUN")

            elif mode == "CHECK":
                write_wakeup("CHECK", "UNKNOWN", "discussions.flag exists but state is unknown")
                print("[bridge_watcher] codex_wakeup.flag written: MODE=CHECK")

            last_state = state

        # ループ間隔を2秒にして、ロック衝突のリスクを低減する
        time.sleep(2)

    except KeyboardInterrupt:
        print("[bridge_watcher] stopped")
        break

    except Exception as e:
        print(f"[bridge_watcher] error: {e}")
        time.sleep(2)