import os
import sys
import subprocess
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel
import uvicorn
import requests
from typing import List, Optional
from requests.exceptions import RequestException

# Windows環境でのコンソール文字コード問題(UnicodeEncodeError)を回避するためのUTF-8強制
if sys.platform.startswith('win'):
    try:
        sys.stdout.reconfigure(encoding='utf-8')
        sys.stderr.reconfigure(encoding='utf-8')
    except Exception:
        pass

app = FastAPI(title="Gemini-Local AI Bridge Engine")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ★ 基準となるプロジェクトの絶対パスを確実に定義
# Vercel環境やローカル環境に合わせて動的に親ディレクトリを特定
CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
BASE_DIR = os.path.dirname(CURRENT_DIR)

# 現在実行中の学習プロセス（CMD）を保持するグローバル変数
current_evolution_process = None


def should_use_curl_fallback(err: Exception) -> bool:
    msg = str(err).lower()
    # Windows/セキュリティソフト由来の接続拒否(WinError 10013)を主対象に、接続拒否系も許可
    keywords = [
        "winerror 10013",
        "forbidden by its access permissions",
        "connection refused",
        "actively refused",
        "failed to establish a new connection",
    ]
    return any(k in msg for k in keywords)


def fetch_url(url: str, timeout: int = 10):
    """
    1) requests.get を試行
    2) RequestException または HTTP 200以外の場合のみ curl.exe にフォールバック
    3) curl.exe の実HTTPステータスも取得する

    戻り値: (status_code, text, meta)
    """
    meta = {
        "curl_fallback_used": False,
        "requests_error": "",
        "requests_status": None,
        "curl_status": None,
        "response_length": 0,
        "body_head": ""
    }

    headers = {"User-Agent": "Mozilla/5.0"}

    def curl_fetch(reason: str):
        meta["curl_fallback_used"] = True
        if not meta["requests_error"]:
            meta["requests_error"] = reason

        cp = subprocess.run(
            [
                "curl.exe",
                "-L",
                "--silent",
                "--show-error",
                "--max-time", str(timeout),
                "-A", "Mozilla/5.0",
                "-w", "\n__HTTP_STATUS__:%{http_code}",
                url
            ],
            capture_output=True,
            text=True,
            check=False
        )

        if cp.returncode != 0:
            raise RuntimeError(f"curl.exe failed rc={cp.returncode}: {cp.stderr.strip()}")

        stdout = cp.stdout or ""
        marker = "\n__HTTP_STATUS__:"

        if marker in stdout:
            body, status_text = stdout.rsplit(marker, 1)
            try:
                status_code = int(status_text.strip())
            except Exception:
                status_code = 0
        else:
            body = stdout
            status_code = 0

        meta["curl_status"] = status_code
        meta["response_length"] = len(body or "")
        meta["body_head"] = (body or "")[:200]

        return status_code, body, meta

    try:
        r = requests.get(url, headers=headers, timeout=timeout)

        meta["requests_status"] = r.status_code
        meta["response_length"] = len(r.text or "")
        meta["body_head"] = (r.text or "")[:200]

        if r.status_code != 200:
            return curl_fetch(f"requests returned HTTP {r.status_code}")

        return r.status_code, r.text, meta

    except RequestException as e:
        meta["requests_error"] = str(e)
        return curl_fetch(str(e))

# リクエストデータの型定義
class AnalyseRequest(BaseModel):
    prompt: str

class QaPair(BaseModel):
    question: str
    answer: str

class EvolveRequest(BaseModel):
    theme: Optional[str] = "default_theme"
    qa_data: Optional[str] = None
    qa_pairs: Optional[List[QaPair]] = None
    epochs: Optional[int] = 15
    session_id: Optional[str] = None

@app.get("/")
def read_root():
    return {"status": "ONLINE", "message": "Bridge is active and waiting for Gemini command."}

@app.get("/health")
def health_check():
    return {"status": "ONLINE"}

@app.post("/v1/analyse")
def analyse_market(request: AnalyseRequest):
    try:
        print(f"[Gemini Input] Received trial prompt: {request.prompt}")
        response_text = "ローカルONNXモデルによる相場分析の回答(ダミー)"
        return {"status": "success", "response": response_text}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/v1/evolve")
def trigger_evolution(request: EvolveRequest):
    """
    外部Geminiからの遠隔指示を受け取り、ローカル側で
    1. Q&Aデータをraw_dataに保存
    2. train.pyを裏でキックして15エポック増分学習
    3. export.pyでONNXを上書き
    を完全に自動実行するエンドポイント
    """
    try:
        theme = request.theme or f"session_{request.session_id or 'unknown'}"
        qa_data = request.qa_data
        
        # 新しいパケット形式(qa_pairs)からテキストデータを再構成する
        if not qa_data and request.qa_pairs:
            lines = [
                "--- CRAWLER HEADER START ---",
                f"Generated by Gemini Session: {request.session_id or 'unknown'}",
                "--- CRAWLER HEADER END ---"
            ]
            for pair in request.qa_pairs:
                lines.append(f"Q: {pair.question}")
                lines.append(f"A: {pair.answer}\n")
            qa_data = "\n".join(lines)
            
        if not qa_data:
            raise HTTPException(status_code=400, detail="qa_data or qa_pairs is required")

        print(f"[Gemini Command] Evolution triggered for Theme: {theme}")
        
        # 1. データの自動保存場所を設定
        raw_data_dir = os.path.join(BASE_DIR, "raw_data")
        os.makedirs(raw_data_dir, exist_ok=True)
        file_path = os.path.join(raw_data_dir, f"qa_evolved_{theme}.txt")
        
        with open(file_path, "w", encoding="utf-8") as f:
            f.write(qa_data)
        print(f"-> Saved high-density Q&A data to: {file_path}")
        
        # 2. 仮想環境のパスをプロジェクト基準で厳密に構築
        python_exe = os.path.join(BASE_DIR, "venv", "Scripts", "python.exe")
        teacher_script = os.path.join(BASE_DIR, "src", "teacher_pipeline.py")
        train_script = os.path.join(BASE_DIR, "src", "train.py")
        export_script = os.path.join(BASE_DIR, "src", "export.py")
        
        epochs = request.epochs or 15
        print(f"-> Launching evolution pipeline in a new CMD window ({epochs} epochs)...")
        
        # 新しいCMDウィンドウで teacher_pipeline.py -> train.py -> export.py を順次実行するコマンドラインを作成
        cmd_str = (
            f'title [Trading AI Evolution] Theme: {theme} ({epochs} epochs) && '
            f'echo -> [Teacher Phase] Calling local giant model (Ollama) to refine and distill knowledge... && '
            f'"{python_exe}" "{teacher_script}" "{file_path}" && '
            f'echo. && '
            f'echo -> [Training Phase] Launching high-precision learning loop (85M brain)... && '
            f'"{python_exe}" "{train_script}" --epochs {epochs} --lr 3e-5 --cpu --incremental && '
            f'echo. && '
            f'echo -> [Success] Training completed. Running export.py to overwrite ONNX... && '
            f'"{python_exe}" "{export_script}" && '
            f'echo. && '
            f'echo -> [Success] ONNX model successfully updated and deployed! && '
            f'pause'
        )

        # Windows専用のフラグ： CREATE_NEW_CONSOLE (0x00000010) を指定して新しいCMDウィンドウを立ち上げる
        global current_evolution_process
        current_evolution_process = subprocess.Popen(
            f'cmd.exe /c "{cmd_str}"',
            creationflags=subprocess.CREATE_NEW_CONSOLE,
            cwd=BASE_DIR
        )
        
        print("-> [Success] Evolution pipeline launched successfully in a new console window!")
        
        return {
            "status": "success",
            "message": f"Theme '{theme}' evolution pipeline successfully launched in a new CMD window. ONNX will be updated upon completion."
        }
        
    except Exception as e:
        print(f"[Critical Error] {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/v1/evolve/status")
def get_evolution_status():
    """現在の学習プロセス（CMD）的実行状態を取得する"""
    global current_evolution_process
    if current_evolution_process is None:
        return {"status": "idle"}
    
    poll_result = current_evolution_process.poll()
    if poll_result is None:
        return {"status": "learning"}
    else:
        return {"status": "completed", "returncode": poll_result}

@app.get("/v1/ticker")
def get_ticker(symbol: str = "USDJPY", tf: str = "15m"):
    symbol_map = {
        "USDJPY": "USDJPY=X",
        "EURUSD": "EURUSD=X",
        "GBPUSD": "GBPUSD=X",
        "EURJPY": "EURJPY=X",
        "AUDJPY": "AUDJPY=X"
    }
    
    ticker_symbol = symbol_map.get(symbol.upper(), "USDJPY=X")
    
    tf_map = {
        "1m": ("1m", "2d"),
        "5m": ("5m", "5d"),
        "15m": ("15m", "7d"),
        "1h": ("60m", "30d"),
        "4h": ("60m", "60d"),
        "1d": ("1d", "1y"),
        "1w": ("1wk", "5y"),
    }
    
    if tf not in tf_map:
        raise HTTPException(status_code=400, detail="Invalid timeframe")
    
    interval, range_param = tf_map[tf]
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{ticker_symbol}?interval={interval}&range={range_param}"
    
    try:
        status_code, body, meta = fetch_url(url, timeout=10)
        print(
            f"[v1/ticker] curl_fallback_used={meta['curl_fallback_used']} "
            f"requests_status={meta.get('requests_status')} "
            f"curl_status={meta.get('curl_status')} "
            f"requests_error={meta['requests_error']!r} "
            f"response_length={meta['response_length']} "
            f"body_head={meta.get('body_head', '')[:200]!r}"
        )
        if status_code != 200:
            raise HTTPException(status_code=500, detail="Failed to fetch data from Yahoo Finance")

        try:
            js = requests.models.complexjson.loads(body)
        except Exception as je:
            print(f"[v1/ticker] JSON parse failed: {je} body_head={(body or '')[:300]!r}")
            raise HTTPException(status_code=502, detail=f"Yahoo response is not JSON: {je}")
        res = js.get("chart", {}).get("result", [])
        if not res:
            raise HTTPException(status_code=500, detail="No data available")
        
        result = res[0]
        timestamps = result.get("timestamp", [])
        quote = result.get("indicators", {}).get("quote", [{}])[0]
        
        opens = quote.get("open", [])
        highs = quote.get("high", [])
        lows = quote.get("low", [])
        closes = quote.get("close", [])
        
        data = []
        is_jpy_pair = "JPY" in ticker_symbol
        round_digits = 3 if is_jpy_pair else 5
        
        for i in range(len(timestamps)):
            if i >= len(opens) or i >= len(highs) or i >= len(lows) or i >= len(closes):
                break
            t = timestamps[i]
            o = opens[i]
            h = highs[i]
            l = lows[i]
            c = closes[i]
            
            if t is None or o is None or h is None or l is None or c is None:
                continue
                
            data.append({
                "time": t,
                "open": round(o, round_digits),
                "high": round(h, round_digits),
                "low": round(l, round_digits),
                "close": round(c, round_digits)
            })
            
        if tf == "4h":
            merged_data = []
            current_candle = None
            for candle in data:
                group_id = candle["time"] // 14400
                if current_candle is None:
                    current_candle = {
                        "time": group_id * 14400,
                        "open": candle["open"],
                        "high": candle["high"],
                        "low": candle["low"],
                        "close": candle["close"]
                    }
                elif current_candle["time"] // 14400 == group_id:
                    current_candle["high"] = max(current_candle["high"], candle["high"])
                    current_candle["low"] = min(current_candle["low"], candle["low"])
                    current_candle["close"] = candle["close"]
                else:
                    merged_data.append(current_candle)
                    current_candle = {
                        "time": group_id * 14400,
                        "open": candle["open"],
                        "high": candle["high"],
                        "low": candle["low"],
                        "close": candle["close"]
                    }
            if current_candle:
                merged_data.append(current_candle)
            data = merged_data
            
        return data
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/v1/rate")
def get_rate(symbol: str = "USDJPY"):
    symbol_map = {
        "USDJPY": "USDJPY=X",
        "EURUSD": "EURUSD=X",
        "GBPUSD": "GBPUSD=X",
        "EURJPY": "EURJPY=X",
        "AUDJPY": "AUDJPY=X"
    }
    ticker_symbol = symbol_map.get(symbol.upper(), f"{symbol.upper()}=X")
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{ticker_symbol}?interval=1m&range=1d"
    try:
        status_code, body, meta = fetch_url(url, timeout=5)
        print(
            f"[v1/rate] curl_fallback_used={meta['curl_fallback_used']} "
            f"requests_status={meta.get('requests_status')} "
            f"curl_status={meta.get('curl_status')} "
            f"requests_error={meta['requests_error']!r} "
            f"response_length={meta['response_length']} "
            f"body_head={meta.get('body_head', '')[:200]!r}"
        )
        if status_code == 200:
            try:
                js = requests.models.complexjson.loads(body)
            except Exception as je:
                print(f"[v1/rate] JSON parse failed: {je} body_head={(body or '')[:300]!r}")
                raise HTTPException(status_code=502, detail=f"Yahoo response is not JSON: {je}")
            res = js.get("chart", {}).get("result", [])
            if res:
                meta = res[0].get("meta", {})
                price = meta.get("regularMarketPrice")
                if price is not None:
                    is_jpy_pair = "JPY" in ticker_symbol
                    round_digits = 3 if is_jpy_pair else 5
                    return {"symbol": symbol, "price": round(price, round_digits)}
        raise HTTPException(status_code=404, detail="Rate not found")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

def get_fallback_news():
    import datetime
    now = datetime.datetime.now()
    t1 = (now - datetime.timedelta(hours=2)).strftime("%m/%d %H:%M")
    t2 = (now - datetime.timedelta(hours=5)).strftime("%m/%d %H:%M")
    t3 = (now - datetime.timedelta(hours=9)).strftime("%m/%d %H:%M")
    return [
        {"title": "日銀総裁 「追加の利上げ判断はデータ次第、急激な為替変動は強く警戒」", "time": t1},
        {"title": "FRB議長 「インフレ目標2%達成への進展は確認も、利下げは慎重に判断」", "time": t2},
        {"title": "財務官 「為替相場の過度な変動には極めて注視、必要なら適切な措置」", "time": t3}
    ]

@app.get("/v1/news")
def get_news():
    url = "https://fx.minkabu.jp/news/category/speech"
    try:
        from bs4 import BeautifulSoup
        r = requests.get(url, headers={"User-Agent": "Mozilla/5.0"}, timeout=8)
        if r.status_code != 200:
            return get_fallback_news()
            
        soup = BeautifulSoup(r.text, "html.parser")
        news_items = []
        
        # みんかぶFXの要人発言リストの抽出
        articles = soup.select(".news-list__item-link, a.news-card, li.news-list__item")[:3]
        for art in articles:
            title_el = art.select_one(".news-list__item-title, h3, .title")
            time_el = art.select_one("time, .time, .date")
            
            title = title_el.text.strip() if title_el else art.text.strip()[:60]
            time_str = time_el.text.strip() if time_el else "本日"
            
            # クレンジング
            title = title.replace("\n", "").replace("  ", "")
            
            news_items.append({
                "title": title,
                "time": time_str
            })
            
        if not news_items or len(news_items) < 2:
            return get_fallback_news()
            
        return news_items
    except Exception:
        return get_fallback_news()

class DebugLog(BaseModel):
    message: str
    filename: Optional[str] = None
    lineno: Optional[int] = None
    colno: Optional[int] = None
    error: Optional[str] = None

@app.post("/v1/debug_log")
def post_debug_log(log: DebugLog):
    print(f"\n🚨 [BROWSER JS ERROR] {log.filename}:{log.lineno}:{log.colno}")
    print(f"   Message: {log.message}")
    if log.error:
        print(f"   Stack: {log.error}\n")
    return {"status": "ok"}

@app.get("/chart.html")
def get_chart_html():
    path = os.path.join(BASE_DIR, "chart.html")
    if not os.path.exists(path):
        path = os.path.join(BASE_DIR, "scratch", "chart.html")
    if not os.path.exists(path):
        path = r"C:\Users\hayami\.gemini\antigravity-ide\scratch\chart.html"
    return FileResponse(
        path,
        headers={"Cache-Control": "no-store, no-cache, must-revalidate, max-age=0"}
    )

@app.get("/lightweight-charts.js")
def get_lightweight_charts_js():
    path = os.path.join(BASE_DIR, "scratch", "lightweight-charts.js")
    if not os.path.exists(path):
        path = r"C:\Users\hayami\.gemini\antigravity-ide\scratch\lightweight-charts.js"
    return FileResponse(
        path,
        headers={"Cache-Control": "no-store, no-cache, must-revalidate, max-age=0"}
    )

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8001)
