import os
import sys
import numpy as np
import onnxruntime as ort
from tokenizers import Tokenizer

# 文字コード設定
if sys.platform.startswith('win'):
    try:
        sys.stdout.reconfigure(encoding='utf-8')
        sys.stderr.reconfigure(encoding='utf-8')
    except Exception:
        pass

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ONNX_PATH = os.path.join(PROJECT_ROOT, "models", "model.onnx")
TOKENIZER_PATH = os.path.join(PROJECT_ROOT, "models", "custom_tokenizer", "tokenizer.json")

def softmax(x):
    e_x = np.exp(x - np.max(x))
    return e_x / e_x.sum(axis=-1)

def sample_next_token(logits, generated_ids, temperature=0.7, top_k=50):
    # 重複ペナルティの適用 (直近30トークンの出現回数に応じてロジットを減算)
    recent_counts = {}
    start_idx = max(0, len(generated_ids) - 30)
    for i in range(start_idx, len(generated_ids)):
        t_id = generated_ids[i]
        recent_counts[t_id] = recent_counts.get(t_id, 0) + 1

    for t_id, count in recent_counts.items():
        logits[t_id] -= 15.0 * count

    # 特殊トークンの強力な抑制 (<pad>=0, <s>=1, <unk>=3)
    logits[0] -= 50.0
    logits[1] -= 50.0
    logits[3] -= 50.0

    # 温度適用
    logits = logits / max(temperature, 1e-5)

    # Top-K フィルタリング
    if top_k is not None and top_k > 0:
        top_indices = np.argpartition(logits, -top_k)[-top_k:]
        filtered_logits = np.full_like(logits, -np.inf)
        filtered_logits[top_indices] = logits[top_indices]
        logits = filtered_logits
        
    probs = softmax(logits)
    if np.isnan(probs).any() or np.isinf(probs).any() or probs.sum() <= 0:
        return 3 # <unk>
        
    return np.random.choice(len(probs), p=probs)

def main():
    print("Loading tokenizer...")
    tokenizer = Tokenizer.from_file(TOKENIZER_PATH)
    
    print("Loading ONNX session...")
    session = ort.InferenceSession(ONNX_PATH)
    
    # 厳格なプロンプトの組み立て (改行コード \n を確実に適用)
    prompt = "Q: ダウ理論について完結に教えて\nA:"
    print(f"Input Prompt:\n{prompt}")
    
    encoded = tokenizer.encode("<s>" + prompt)
    input_ids = list(encoded.ids)
    
    generated_ids = []
    
    print("\nAI Response Generating...")
    for _ in range(120):
        active_ids = input_ids if len(input_ids) <= 256 else input_ids[-256:]
        inputs = {"input_ids": np.array([active_ids], dtype=np.int64)}
        
        outputs = session.run(["logits"], inputs)
        logits = outputs[0][0, -1, :]
        
        next_id = sample_next_token(logits, generated_ids, temperature=0.7, top_k=50)
        
        input_ids.append(next_id)
        generated_ids.append(next_id)
        
        if next_id == 2: # </s>
            break
            
    # 最終的な生成テキストを一括で表示
    full_text = tokenizer.decode(generated_ids, skip_special_tokens=False)
    print("\n--- AI Final Result ---")
    print(full_text)
    print("Generated Token IDs:", generated_ids)
    print("-----------------------")
    print("\nDone.")

if __name__ == "__main__":
    main()
