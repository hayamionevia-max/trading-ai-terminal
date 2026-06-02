import os

print("Searching D:\\ for backup best_model.pth (excluding active project)...")
found_paths = []
for root, dirs, files in os.walk("D:\\"):
    # 無駄なフォルダをスキップ
    if "$RECYCLE.BIN" in root or "System Volume Information" in root or "venv" in root or ".git" in root:
        continue
    # アクティブプロジェクトはスキップ
    if "\u2605\u30c6\u30af\u30cb\u30ab\u30eb\u5206\u6790" in root or "テクニカル" in root:
        continue
        
    if "best_model.pth" in files:
        found_paths.append(root)
        print(f"FOUND: {repr(root)}")
        
print("Search finished.")
