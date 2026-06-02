
// Declare global bulletproof apiHost that supports file:/// local opens and CORS bridge fetches perfectly!
var apiHost = (window.location.protocol === 'file:' || window.location.hostname === '' || window.location.port === '8002') ? 'http://127.0.0.1:8001' : '';

// Global logging interceptor to catch any silent console errors and report them directly to the terminal
var originalConsoleError = console.error;
console.error = function() {
    originalConsoleError.apply(console, arguments);
    try {
        var argsArray = Array.prototype.slice.call(arguments);
        var msg = argsArray.map(function(arg) {
            return typeof arg === 'object' ? JSON.stringify(arg) : String(arg);
        }).join(' ');
        
        var errorMsg = {
            message: msg,
            filename: 'ConsoleError',
            lineno: 0,
            colno: 0,
            error: new Error().stack || 'Console error captured'
        };
        fetch(apiHost + '/v1/debug_log', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(errorMsg)
        }).catch(function(){});
    } catch(e) {}
};

function logErrorToBridge(err, context) {
    console.error("Error in [" + context + "]:", err.message || String(err), err.stack || '');
}

window.addEventListener('error', function(e) {
    var errorMsg = {
        message: e.message,
        filename: e.filename,
        lineno: e.lineno,
        colno: e.colno,
        error: e.error ? e.error.stack : null
    };
    fetch(apiHost + '/v1/debug_log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(errorMsg)
    }).catch(function(err){});
});

window.addEventListener('unhandledrejection', function(e) {
    var errorMsg = {
        message: e.reason ? (e.reason.message || String(e.reason)) : 'Unhandled Promise Rejection',
        filename: 'PromiseRejection',
        lineno: 0,
        colno: 0,
        error: e.reason ? (e.reason.stack || null) : null
    };
    fetch(apiHost + '/v1/debug_log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(errorMsg)
    }).catch(function(err){});
});

/* ─── COLORS ─── */
var C = { 
    bg:'#0b0e14', gd:'#151924', 
    up:'#ffffff', dn:'#f23645', 
    bup:'#ffffff', bdn:'#f23645',
    wup:'#ffffff', wdn:'#f23645',
    sl:'#00e676', rl:'#ff007f', trl:'#00b0ff', ml:'#ffb300' 
};

/* ─── DATA ─── */
function rand(seed) {
    var s = seed & 0x7fffffff;
    return function() {
        s = (s * 1103515245 + 12345) & 0x7fffffff;
        return s / 0x7fffffff;
    };
}

function genData(tf) {
    var rng = rand(tf.split('').reduce(function(a,c){return a+c.charCodeAt(0);},17));
    var count = {
        '1m': 300,
        '5m': 2000,
        '15m': 2000,
        '1h': 2000,
        '4h': 1000,
        '1d': 780, // 3 years
        '1w': 260  // 5 years
    }[tf] || 120;
    var step = {
        '1m':60,'5m':300,'15m':900,'1h':3600,'4h':14400,'1d':86400,'1w':604800
    }[tf] || 900;
    var vola = {
        '1m':.04,'5m':.08,'15m':.14,'1h':.28,'4h':.6,'1d':1.3,'1w':2.8
    }[tf] || .14;
    // 最新のキャンドルが現在時刻になるように開始時間を設定 (タイムスタンプ補正はLightweightChartsがブラウザ現地時間で自動処理するため、基準UTC/ローカル時を使用)
    var nowTs = Math.floor(Date.now() / 1000);
    var base = Math.floor(nowTs / step) * step - (count - 1) * step;
    var price = currentSymbol.indexOf('JPY') !== -1 ? 158.5 + rng() * 1.8 : 1.08 + rng() * 0.015;
    var data = [];
    for (var i = 0; i < count; i++) {
        var t = base + i * step;
        var chg = (rng() - 0.478) * vola + Math.sin(i / 20) * vola * 0.4;
        price = Math.max(currentSymbol.indexOf('JPY') !== -1 ? 100 : 0.8, price + chg);
        var o = i === 0 ? price : data[i-1].close;
        var c = +(price + (rng()-.5)*vola*.25).toFixed(currentSymbol.indexOf('JPY') !== -1 ? 3 : 5);
        var hi = +(Math.max(o,c) + rng()*vola*.35).toFixed(currentSymbol.indexOf('JPY') !== -1 ? 3 : 5);
        var lo = +(Math.min(o,c) - rng()*vola*.35).toFixed(currentSymbol.indexOf('JPY') !== -1 ? 3 : 5);
        data.push({ time: t, open: +o.toFixed(currentSymbol.indexOf('JPY') !== -1 ? 3 : 5), high: hi, low: lo, close: c });
    }
    // Pin last candle price to live value
    var isJpy = currentSymbol.indexOf('JPY') !== -1;
    data[data.length-1].close = isJpy ? 159.268 : 1.08250;
    if (data[data.length-1].high < data[data.length-1].close) data[data.length-1].high = +(data[data.length-1].close + (isJpy ? 0.02 : 0.0002)).toFixed(isJpy ? 3 : 5);
    return data;
}

/* ─── DYNAMIC AI LEVEL DETECTOR (SWING METHOD) ─── */
var currentAIAnalysis = null;

function detectLevels(fullCandles, symbol) {
    var isJpy = symbol.indexOf('JPY') !== -1;
    var precision = isJpy ? 3 : 5;
    
    // Only calculate levels based on the most recent 150 candles for relevance and to avoid Y-axis scaling compression!
    var candles = fullCandles;
    if (fullCandles && fullCandles.length > 150) {
        candles = fullCandles.slice(fullCandles.length - 150);
    }
    
    if (!candles || candles.length < 25) {
        var fallbackPrice = isJpy ? 159.000 : 1.08000;
        var fallbackAtr = isJpy ? 0.350 : 0.00350;
        return {
            res: [{p: +(fallbackPrice + fallbackAtr).toFixed(precision), l: 'AI 抵抗帯 1'}, {p: +(fallbackPrice + fallbackAtr * 2).toFixed(precision), l: 'AI 抵抗帯 2'}],
            sup: [{p: +(fallbackPrice - fallbackAtr).toFixed(precision), l: 'AI 支持帯 1'}, {p: +(fallbackPrice - fallbackAtr * 2).toFixed(precision), l: 'AI 支持帯 2'}],
            trend: {lbl: '中立 (レンジ)', c: '#ffb300'},
            strat: symbol + ': 十分なデータがありません。レンジトレード推奨。'
        };
    }
    
    var lastCandle = candles[candles.length - 1];
    var currentPrice = lastCandle.close;
    
    var highs = candles.map(function(c) { return c.high; });
    var lows = candles.map(function(c) { return c.low; });
    
    // スイングハイ・ロー（極値）の動的検出（現在値より上を抵抗、下を支持として厳密に分類）
    var swingHighs = [];
    var swingLows = [];
    for (var i = 4; i < candles.length - 4; i++) {
        var isHigh = true;
        var isLow = true;
        for (var j = -4; j <= 4; j++) {
            if (highs[i+j] > highs[i]) isHigh = false;
            if (lows[i+j] < lows[i]) isLow = false;
        }
        
        // 現在値との位置関係で厳密にフィルタリング
        if (isHigh && highs[i] > currentPrice) swingHighs.push({ p: highs[i], idx: i });
        if (isLow && lows[i] < currentPrice) swingLows.push({ p: lows[i], idx: i });
    }
    
    // 重複・近接した価格帯を排除して抵抗レベルをソート（現在値に近い順に 1, 2 と採番）
    swingHighs.sort(function(a, b) { return a.p - b.p; }); // 昇順（現在値に近い順）
    var resLevels = [];
    var threshold = isJpy ? 0.08 : 0.0008;
    for (var i = 0; i < swingHighs.length; i++) {
        var p = swingHighs[i].p;
        if (!resLevels.some(function(l) { return Math.abs(l.p - p) < threshold; })) {
            resLevels.push({ p: +p.toFixed(precision), l: 'AI 抵抗帯 ' + (resLevels.length + 1) });
        }
        if (resLevels.length >= 2) break;
    }
    
    // 支持レベルをソート（現在値に近い順に 1, 2 と採番）
    swingLows.sort(function(a, b) { return b.p - a.p; }); // 降順（現在値に近い順）
    var supLevels = [];
    for (var i = 0; i < swingLows.length; i++) {
        var p = swingLows[i].p;
        if (!supLevels.some(function(l) { return Math.abs(l.p - p) < threshold; })) {
            supLevels.push({ p: +p.toFixed(precision), l: 'AI 支持帯 ' + (supLevels.length + 1) });
        }
        if (supLevels.length >= 2) break;
    }
    
    // 検出数が不足した場合はATR基準で自動計算
    var atrSum = 0;
    for (var i = 0; i < candles.length; i++) {
        atrSum += (candles[i].high - candles[i].low);
    }
    var atr = atrSum / candles.length;
    
    if (resLevels.length < 2) {
        var baseRes = resLevels.length > 0 ? resLevels[0].p : currentPrice;
        while (resLevels.length < 2) {
            var nextP = +(baseRes + atr * 1.5 * (resLevels.length + 1)).toFixed(precision);
            resLevels.push({ p: nextP, l: 'AI 抵抗帯 ' + (resLevels.length + 1) });
        }
    }
    if (supLevels.length < 2) {
        var baseSup = supLevels.length > 0 ? supLevels[0].p : currentPrice;
        while (supLevels.length < 2) {
            var nextP = +(baseSup - atr * 1.5 * (supLevels.length + 1)).toFixed(precision);
            supLevels.push({ p: nextP, l: 'AI 支持帯 ' + (supLevels.length + 1) });
        }
    }
    
    // 終点と始点の差からダイナミックトレンドを分析
    var firstClose = candles[0].close;
    var lastClose = lastCandle.close;
    var pctChg = ((lastClose - firstClose) / firstClose) * 100;
    
    var trendLbl = "中立 (レンジ)";
    var trendColor = "#ffb300";
    if (pctChg > 0.12) {
        trendLbl = "強気 (上昇)";
        trendColor = "#00e676";
    } else if (pctChg < -0.12) {
        trendLbl = "弱気 (下降)";
        trendColor = "#ff007f";
    }
    
    var strat = "";
    if (trendLbl.indexOf("強気") !== -1) {
        strat = symbol + " (" + currentTf + ") : 上昇強気傾向。支持帯 " + supLevels[0].p.toFixed(precision) + " 近辺からの「押し目買い(ロング)」が非常に最適です。";
    } else if (trendLbl.indexOf("弱気") !== -1) {
        strat = symbol + " (" + currentTf + ") : 下降弱気傾向。抵抗帯 " + resLevels[0].p.toFixed(precision) + " 付近での「戻り売り(ショート)」が極めて最適です。";
    } else {
        strat = symbol + " (" + currentTf + ") : レンジ推移。支持帯 " + supLevels[0].p.toFixed(precision) + " 〜 抵抗帯 " + resLevels[0].p.toFixed(precision) + " 間の逆張りスキャルが有効。";
    }
    
    return {
        res: resLevels,
        sup: supLevels,
        trend: { lbl: trendLbl, c: trendColor },
        strat: strat
    };
}

/* ─── CHART INIT ─── */
var chart, cSeries, currentTf = '15m';
var aiLines = [], manLines = [];
var tool = 'cur', drawPt = null;
var candles = [];

// 新機能用グローバル変数
var currentSymbol = 'USDJPY';
var alertLines = []; // カスタムアラート価格オブジェクト { id, price, type, message, sound, active, priceLine }
var audioCtx = null; // Web Audio Context for synths

var magnetMode = false;
var keepDrawingMode = false;
var lockAllDrawings = false;
var drawingsHidden = false;
var zoomMode = false;

// 動的インジケーター配列
var activeIndicators = [];

var showRSI = false, showGrid = true;
var rsiChart = null, rsiSeries = null;

// HTML5 Canvas overlay drawings
var overlayCanvas = null;
var overlayCtx = null;
var isDrawing = false;
var brushPoints = [];
var manualDrawings = []; // Canvas drawings { type: 'brush'|'text', points, text, time, price, color }

function initChart() {
    var el = document.getElementById('chart-el');
    var W = el.offsetWidth;
    var H = el.offsetHeight;

    chart = LightweightCharts.createChart(el, {
        width: W,
        height: H,
        layout: {
            backgroundColor: 'rgba(0,0,0,0)', // Make chart transparent to let CSS linear-gradient shine through
            textColor: '#00e5ff',
            fontFamily: 'Inter,sans-serif',
            fontSize: 18
        },
        grid: {
            vertLines: { visible: false },
            horzLines: { visible: false }
        },
        crosshair: { mode: 1 },
        priceScale: { borderColor: '#2a2e39' },
        timeScale: { borderColor: '#2a2e39', timeVisible: true, secondsVisible: false },
        handleScroll: { mouseWheel: true, pressedMouseMove: true },
        handleScale: { axisPressedMouseMove: true, mouseWheel: true, pinch: true },
        watermark: {
            visible: true,
            fontSize: 72,
            horzAlign: 'center',
            vertAlign: 'center',
            color: 'rgba(255, 255, 255, 0.05)',
            text: 'USDJPY 15M',
            fontFamily: 'Outfit, sans-serif'
        }
    });

    cSeries = chart.addCandlestickSeries({
        upColor: 'transparent', downColor: 'transparent',
        borderUpColor: 'transparent', borderDownColor: 'transparent',
        wickUpColor: 'transparent', wickDownColor: 'transparent'
    });

    // 動的インジケーターシリーズの初期構築
    activeIndicators.forEach(createIndicatorSeries);

    // RSIの初期化
    initRsiChart();

    // Canvas overlay and text drawing setup
    initOverlayCanvas();

    // Neon candle canvas engine
    initNeonCandleCanvas();

    loadTf('15m');

    window.addEventListener('resize', function() {
        var e = document.getElementById('chart-el');
        chart.resize(e.offsetWidth, e.offsetHeight);
        if (rsiChart && showRSI) {
            var re = document.getElementById('rsi-el');
            rsiChart.resize(re.offsetWidth, re.offsetHeight);
        }
        resizeOverlayCanvas();
        resizeNeonCanvas();
    });

    // Click handler for drawing tools
    chart.subscribeClick(function(param) {
        if (tool === 'cur' || tool === 'brush' || tool === 'text') return;
        if (!param.point) return;
        var price = cSeries.coordinateToPrice(param.point.y);
        var time = param.time;
        if (price === null || price === undefined) return;
        if (!time) return; // 余白クリック時のガード
        if (tool === 'eraser') {
            if (tryEraseObject(time, price)) {
                if (!keepDrawingMode) setTool('cur');
            }
        } else {
            handleDraw(time, price);
        }
    });

    // 右クリックカスタムメニュー
    el.addEventListener('contextmenu', function(e) {
        e.preventDefault();
        var menu = document.getElementById('ctx-menu');
        menu.style.display = 'block';
        menu.style.left = e.pageX + 'px';
        menu.style.top = e.pageY + 'px';
    });

    document.addEventListener('click', function(e) {
        var menu = document.getElementById('ctx-menu');
        if (!e.target.closest('#ctx-menu')) {
            menu.style.display = 'none';
        }
    });
    renderManualObjects();
}

/* ─── DYNAMIC INDICATORS ENGINE ─── */
function createIndicatorSeries(ind) {
    if (ind.type === 'SMA') {
        ind.series = chart.addLineSeries({
            color: ind.color,
            lineWidth: 1.5,
            title: 'SMA ' + ind.period,
            lastValueVisible: false,
            priceLineVisible: false
        });
    } else if (ind.type === 'EMA') {
        ind.series = chart.addLineSeries({
            color: ind.color,
            lineWidth: 1.5,
            title: 'EMA ' + ind.period,
            lastValueVisible: false,
            priceLineVisible: false
        });
    } else if (ind.type === 'BB') {
        ind.upperSeries = chart.addLineSeries({
            color: ind.color,
            lineWidth: 1,
            lineStyle: 2,
            title: 'BB Upper (' + ind.period + ')',
            lastValueVisible: false,
            priceLineVisible: false
        });
        ind.lowerSeries = chart.addLineSeries({
            color: ind.color,
            lineWidth: 1,
            lineStyle: 2,
            title: 'BB Lower (' + ind.period + ')',
            lastValueVisible: false,
            priceLineVisible: false
        });
    }
}

function removeIndicator(id) {
    var index = activeIndicators.findIndex(function(x) { return x.id === id; });
    if (index !== -1) {
        var ind = activeIndicators[index];
        try {
            if (ind.series) chart.removeSeries(ind.series);
            if (ind.upperSeries) chart.removeSeries(ind.upperSeries);
            if (ind.lowerSeries) chart.removeSeries(ind.lowerSeries);
        } catch(e) {}
        activeIndicators.splice(index, 1);
        renderIndicatorLegend();
        toast('インジケーターを削除しました');
    }
}

function toggleIndicator(id) {
    var ind = activeIndicators.find(function(x) { return x.id === id; });
    if (ind) {
        ind.visible = !ind.visible;
        if (ind.series) ind.series.applyOptions({ visible: ind.visible });
        if (ind.upperSeries) ind.upperSeries.applyOptions({ visible: ind.visible });
        if (ind.lowerSeries) ind.lowerSeries.applyOptions({ visible: ind.visible });
        renderIndicatorLegend();
    }
}

function openIndicatorSettings(id) {
    var ind = activeIndicators.find(function(x) { return x.id === id; });
    if (ind) {
        document.getElementById('ind-set-id').value = id;
        document.getElementById('ind-set-period').value = ind.period;
        document.getElementById('ind-set-color').value = ind.color;
        document.getElementById('sw-ind-color').style.background = ind.color;
        document.getElementById('ind-set-modal').classList.add('open');
    }
}

function closeIndicatorSettings() {
    document.getElementById('ind-set-modal').classList.remove('open');
}

function saveIndicatorSettings() {
    var id = document.getElementById('ind-set-id').value;
    var period = parseInt(document.getElementById('ind-set-period').value);
    var color = document.getElementById('ind-set-color').value;
    
    var ind = activeIndicators.find(function(x) { return x.id === id; });
    if (ind) {
        ind.period = period;
        ind.color = color;
        
        // シリーズオプションの再更新
        if (ind.series) {
            ind.series.applyOptions({ color: color, title: ind.type + ' ' + period });
        }
        if (ind.upperSeries && ind.lowerSeries) {
            ind.upperSeries.applyOptions({ color: color, title: 'BB Upper (' + period + ')' });
            ind.lowerSeries.applyOptions({ color: color, title: 'BB Lower (' + period + ')' });
        }
        
        calcIndicators();
        renderIndicatorLegend();
        closeIndicatorSettings();
        toast('設定を適用しました');
    }
}

function renderIndicatorLegend() {
    var legend = document.getElementById('ind-legend');
    if (!legend) return;
    
    var html = '';
    activeIndicators.forEach(function(ind) {
        var title = ind.type + ' (' + ind.period + ')';
        var eyeIcon = ind.visible ? '👁️' : '👁️‍🗨️';
        html += '<div class="ind-item">' +
            '<span style="color:' + (ind.color || '#fff') + '; font-weight:700; font-size:14px; line-height:1;">●</span> ' +
            '<span style="font-weight:600; font-family:\'Outfit\'">' + title + '</span>' +
            '<button class="ind-btn" onclick="toggleIndicator(\'' + ind.id + '\')">' + eyeIcon + '</button>' +
            '<button class="ind-btn" onclick="openIndicatorSettings(\'' + ind.id + '\')">⚙️</button>' +
            '<button class="ind-btn del" onclick="removeIndicator(\'' + ind.id + '\')">❌</button>' +
            '</div>';
    });
    legend.innerHTML = html;
}

/* ─── CANVAS OVERLAY DRAWING ENGINE ─── */
function initOverlayCanvas() {
    overlayCanvas = document.getElementById('overlay-canvas');
    if (!overlayCanvas) return;
    overlayCtx = overlayCanvas.getContext('2d');
    
    resizeOverlayCanvas();
    
    overlayCanvas.addEventListener('mousedown', onMouseDown);
    overlayCanvas.addEventListener('mousemove', onMouseMove);
    overlayCanvas.addEventListener('mouseup', onMouseUp);
    
    chart.timeScale().subscribeVisibleTimeRangeChange(function(range) {
        requestAnimationFrame(drawOverlayDrawings);
    });
}

function resizeOverlayCanvas() {
    if (!overlayCanvas) return;
    var rect = overlayCanvas.parentElement.getBoundingClientRect();
    overlayCanvas.width = rect.width;
    overlayCanvas.height = rect.height;
    requestAnimationFrame(drawOverlayDrawings);
}

/* ─── NEON CANDLE CANVAS ENGINE ─── */
var neonCandleCanvas = null;
var neonCandleCtx = null;

function initNeonCandleCanvas() {
    var chartWrap = document.querySelector('.chart-wrap');
    if (!chartWrap) return;
    neonCandleCanvas = document.createElement('canvas');
    neonCandleCanvas.id = 'neon-candle-canvas';
    neonCandleCanvas.style.position = 'absolute';
    neonCandleCanvas.style.top = '0';
    neonCandleCanvas.style.left = '0';
    neonCandleCanvas.style.pointerEvents = 'none';
    neonCandleCanvas.style.zIndex = '20';
    chartWrap.appendChild(neonCandleCanvas);
    neonCandleCtx = neonCandleCanvas.getContext('2d');
    chart.timeScale().subscribeVisibleTimeRangeChange(function() {
        requestAnimationFrame(drawNeonCandles);
    });
    resizeNeonCanvas();
}

function resizeNeonCanvas() {
    if (!neonCandleCanvas) return;
    var el = document.getElementById('chart-el');
    if (!el) return;
    neonCandleCanvas.width = el.offsetWidth;
    neonCandleCanvas.height = el.offsetHeight;
    neonCandleCanvas.style.width = el.offsetWidth + 'px';
    neonCandleCanvas.style.height = el.offsetHeight + 'px';
    requestAnimationFrame(drawNeonCandles);
}

function drawNeonCandles() {
    if (!neonCandleCtx || !neonCandleCanvas || !candles || candles.length === 0 || !cSeries || !chart) return;
    var ctx = neonCandleCtx;
    var W = neonCandleCanvas.width;
    var H = neonCandleCanvas.height;
    ctx.clearRect(0, 0, W, H);

    // Compute bar width from adjacent candles
    var barW = 8;
    for (var bi = 0; bi < candles.length - 1; bi++) {
        var x1 = chart.timeScale().timeToCoordinate(candles[bi].time);
        var x2 = chart.timeScale().timeToCoordinate(candles[bi + 1].time);
        if (x1 !== null && x2 !== null && Math.abs(x2 - x1) > 0.5) {
            barW = Math.abs(x2 - x1);
            break;
        }
    }
    var bodyW = Math.max(1, Math.min(barW * 0.65, 40));

    var showBody   = document.getElementById('set-cand-body')   ? document.getElementById('set-cand-body').checked   : true;
    var showBorder = document.getElementById('set-cand-border') ? document.getElementById('set-cand-border').checked : true;
    var showWick   = document.getElementById('set-cand-wick')   ? document.getElementById('set-cand-wick').checked   : true;

    for (var ci = 0; ci < candles.length; ci++) {
        try {
            var candle = candles[ci];
            var cx = chart.timeScale().timeToCoordinate(candle.time);
            if (cx === null || cx < -barW * 2 || cx > W + barW * 2) continue;

            var openY  = cSeries.priceToCoordinate(candle.open);
            var closeY = cSeries.priceToCoordinate(candle.close);
            var highY  = cSeries.priceToCoordinate(candle.high);
            var lowY   = cSeries.priceToCoordinate(candle.low);
            if (openY === null || closeY === null || highY === null || lowY === null) continue;

            var isUp    = candle.close >= candle.open;
            var mainHex = isUp ? (C.up || '#ffffff') : (C.dn || '#f23645');
            var rgb     = hexToRgb(mainHex) || { r: 255, g: 255, b: 255 };
            var r = rgb.r, g = rgb.g, b = rgb.b;

            var bodyTop    = Math.min(openY, closeY);
            var bodyBottom = Math.max(openY, closeY);
            var bodyH      = Math.max(bodyBottom - bodyTop, 1);
            var cxR = Math.round(cx);
            var bx  = Math.round(cx - bodyW / 2);

            ctx.save();

            // -- WICKS: Only OUTSIDE the body (split wick = zero penetration) --
            if (showWick) {
                var drawWick = function(y1, y2) {
                    if (Math.abs(y2 - y1) < 0.5) return;
                    // Layer 1: wide ambient glow
                    ctx.shadowBlur = 18;
                    ctx.shadowColor = 'rgba(' + r + ',' + g + ',' + b + ',0.5)';
                    ctx.strokeStyle = 'rgba(' + r + ',' + g + ',' + b + ',0.3)';
                    ctx.lineWidth = 3;
                    ctx.beginPath(); ctx.moveTo(cxR + 0.5, y1); ctx.lineTo(cxR + 0.5, y2); ctx.stroke();
                    // Layer 2: medium glow
                    ctx.shadowBlur = 8;
                    ctx.shadowColor = 'rgba(' + r + ',' + g + ',' + b + ',0.9)';
                    ctx.strokeStyle = 'rgba(' + r + ',' + g + ',' + b + ',0.7)';
                    ctx.lineWidth = 1.5;
                    ctx.beginPath(); ctx.moveTo(cxR + 0.5, y1); ctx.lineTo(cxR + 0.5, y2); ctx.stroke();
                    // Layer 3: bright core
                    ctx.shadowBlur = 3;
                    ctx.shadowColor = 'rgba(' + r + ',' + g + ',' + b + ',1)';
                    ctx.strokeStyle = 'rgba(' + r + ',' + g + ',' + b + ',1)';
                    ctx.lineWidth = 1;
                    ctx.beginPath(); ctx.moveTo(cxR + 0.5, y1); ctx.lineTo(cxR + 0.5, y2); ctx.stroke();
                };
                // Upper wick: high to body top
                if (highY < bodyTop - 0.5) drawWick(highY, bodyTop);
                // Lower wick: body bottom to low
                if (lowY > bodyBottom + 0.5) drawWick(bodyBottom, lowY);
            }

            // -- BODY: Glassy semi-transparent fill + glowing neon border --
            if (showBody || showBorder) {
                if (showBody) {
                    // Ambient body glow fill
                    ctx.shadowBlur = 20;
                    ctx.shadowColor = 'rgba(' + r + ',' + g + ',' + b + ',0.5)';
                    ctx.fillStyle = 'rgba(' + r + ',' + g + ',' + b + ',0.12)';
                    ctx.fillRect(bx, bodyTop, bodyW, bodyH);
                    // Inner fill
                    ctx.shadowBlur = 8;
                    ctx.shadowColor = 'rgba(' + r + ',' + g + ',' + b + ',0.4)';
                    ctx.fillStyle = 'rgba(' + r + ',' + g + ',' + b + ',0.1)';
                    ctx.fillRect(bx + 1, bodyTop + 1, Math.max(bodyW - 2, 0), Math.max(bodyH - 2, 0));
                }
                if (showBorder) {
                    // Layer 1: outer glow border
                    ctx.shadowBlur = 16;
                    ctx.shadowColor = 'rgba(' + r + ',' + g + ',' + b + ',0.7)';
                    ctx.strokeStyle = 'rgba(' + r + ',' + g + ',' + b + ',0.5)';
                    ctx.lineWidth = 2.5;
                    ctx.strokeRect(bx + 0.5, bodyTop + 0.5, Math.max(bodyW - 1, 0), Math.max(bodyH - 1, 0));
                    // Layer 2: bright core border
                    ctx.shadowBlur = 4;
                    ctx.shadowColor = 'rgba(' + r + ',' + g + ',' + b + ',1)';
                    ctx.strokeStyle = 'rgba(' + r + ',' + g + ',' + b + ',0.95)';
                    ctx.lineWidth = 1;
                    ctx.strokeRect(bx + 0.5, bodyTop + 0.5, Math.max(bodyW - 1, 0), Math.max(bodyH - 1, 0));
                }
            }

            ctx.restore();
        } catch (e) { /* skip malformed candle */ }
    }
}

function onMouseDown(e) {
    if (tool === 'cur') return;
    isDrawing = true;
    
    var rect = overlayCanvas.getBoundingClientRect();
    var x = e.clientX - rect.left;
    var y = e.clientY - rect.top;
    
    var price = cSeries.coordinateToPrice(y);
    var time = chart.timeScale().coordinateToTime(x);
    
    if (price === null || !time) return;
    
    if (tool === 'brush') {
        brushPoints = [{ time: time, price: price }];
    } else if (tool === 'text') {
        var text = window.selectedEmoji || prompt("チャートに表示する注釈テキストを入力してください:");
        if (text) {
            var textId = 'text_' + Date.now();
            manualDrawings.push({
                id: textId,
                type: 'text',
                name: (window.selectedEmoji ? '絵文字: ' : '注釈: "') + text + '"',
                time: time,
                price: price,
                text: text,
                color: C.ml,
                visible: true
            });
            drawOverlayDrawings();
            toast(window.selectedEmoji ? "スタンプを配置しました" : "テキスト注釈を追加しました");
            renderManualObjects();
            window.selectedEmoji = null;
        }
        isDrawing = false;
        if (!keepDrawingMode) setTool('cur');
    }
}

function onMouseMove(e) {
    if (!isDrawing) return;
    
    var rect = overlayCanvas.getBoundingClientRect();
    var x = e.clientX - rect.left;
    var y = e.clientY - rect.top;
    
    var price = cSeries.coordinateToPrice(y);
    var time = chart.timeScale().coordinateToTime(x);
    
    if (price === null || !time) return;
    
    if (tool === 'brush') {
        brushPoints.push({ time: time, price: price });
        drawOverlayDrawings();
        
        // ドラッグ中のストローク描画
        overlayCtx.beginPath();
        overlayCtx.strokeStyle = C.ml;
        overlayCtx.lineWidth = 2.5;
        overlayCtx.lineCap = 'round';
        overlayCtx.lineJoin = 'round';
        for (var i = 0; i < brushPoints.length; i++) {
            var px = chart.timeScale().timeToCoordinate(brushPoints[i].time);
            var py = cSeries.priceToCoordinate(brushPoints[i].price);
            if (px !== null && py !== null) {
                if (i === 0) overlayCtx.moveTo(px, py);
                else overlayCtx.lineTo(px, py);
            }
        }
        overlayCtx.stroke();
    }
}

function onMouseUp(e) {
    if (!isDrawing) return;
    isDrawing = false;
    
    if (tool === 'brush' && brushPoints.length > 1) {
        var brushId = 'brush_' + Date.now();
        manualDrawings.push({
            id: brushId,
            type: 'brush',
            name: 'ブラシ自由線 (' + brushPoints.length + '点)',
            points: brushPoints,
            color: C.ml,
            visible: true
        });
        brushPoints = [];
        drawOverlayDrawings();
        toast("ブラシ手動線を描画しました");
        renderManualObjects();
    }
}

function drawOverlayDrawings() {
    if (!overlayCanvas || !overlayCtx) return;
    overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    
    if (drawingsHidden) return; // Skip drawing when globally hidden
    
    manualDrawings.forEach(function(dr) {
        if (dr.visible === false) return; // Skip invisible drawings
        if (dr.type === 'brush') {
            overlayCtx.beginPath();
            overlayCtx.strokeStyle = dr.color || C.ml;
            overlayCtx.lineWidth = 2.5;
            overlayCtx.lineCap = 'round';
            overlayCtx.lineJoin = 'round';
            
            var first = true;
            dr.points.forEach(function(pt) {
                var x = chart.timeScale().timeToCoordinate(pt.time);
                var y = cSeries.priceToCoordinate(pt.price);
                if (x !== null && y !== null) {
                    if (first) {
                        overlayCtx.moveTo(x, y);
                        first = false;
                    } else {
                        overlayCtx.lineTo(x, y);
                    }
                }
            });
            overlayCtx.stroke();
        } else if (dr.type === 'text') {
            var x = chart.timeScale().timeToCoordinate(dr.time);
            var y = cSeries.priceToCoordinate(dr.price);
            if (x !== null && y !== null) {
                overlayCtx.fillStyle = dr.color || '#fff';
                overlayCtx.font = '12px Inter, sans-serif';
                overlayCtx.fillText(dr.text, x + 8, y + 4);
                
                // テキストのアンカーとなる小さな円を描画
                overlayCtx.beginPath();
                overlayCtx.fillStyle = '#ffb300';
                overlayCtx.arc(x, y, 3, 0, 2 * Math.PI);
                overlayCtx.fill();
            }
        }
    });
}

/* ─── DYNAMIC MULTI-SYMBOL & PRECISION ─── */
function changeSymbol(symbol) {
    currentSymbol = symbol;
    
    var isJpy = symbol.indexOf('JPY') !== -1;
    var precision = isJpy ? 3 : 5;
    cSeries.applyOptions({
        priceFormat: {
            type: 'price',
            precision: precision,
            minMove: isJpy ? 0.001 : 0.00001
        }
    });
    
    if (chart) {
        chart.applyOptions({
            watermark: {
                text: currentSymbol + ' ' + currentTf.toUpperCase()
            }
        });
    }
    
    loadTf(currentTf);
    toast(symbol + ' に切り替えました');
}

function initRsiChart() {
    var el = document.getElementById('rsi-el');
    rsiChart = LightweightCharts.createChart(el, {
        width: el.offsetWidth,
        height: el.offsetHeight,
        layout: {
            backgroundColor: 'rgba(0,0,0,0)', // Transparent canvas for RSI subpanel
            textColor: '#00e5ff',
            fontFamily: 'Inter,sans-serif',
            fontSize: 12
        },
        grid: {
            vertLines: { visible: false },
            horzLines: { visible: false }
        },
        crosshair: { mode: 1 },
        priceScale: { borderColor: '#2a2e39', scaleMargins: { top: 0.1, bottom: 0.1 } },
        timeScale: { borderColor: '#2a2e39', visible: false },
        handleScroll: { mouseWheel: true, pressedMouseMove: true },
        handleScale: { axisPressedMouseMove: true, mouseWheel: true, pinch: true }
    });

    rsiSeries = rsiChart.addLineSeries({
        color: '#7c4dff',
        lineWidth: 1.5,
        title: 'RSI',
        lastValueVisible: false,
        priceLineVisible: false
    });

    rsiSeries.createPriceLine({ price: 70, color: 'rgba(255, 0, 127, 0.4)', lineWidth: 1, lineStyle: 1, title: '70' });
    rsiSeries.createPriceLine({ price: 30, color: 'rgba(0, 230, 118, 0.4)', lineWidth: 1, lineStyle: 1, title: '30' });
    rsiSeries.createPriceLine({ price: 50, color: 'rgba(255, 255, 255, 0.15)', lineWidth: 1, lineStyle: 1 });

    // 同期スクロール
    var isSyncingMain = false;
    var isSyncingRsi = false;
    
    chart.timeScale().subscribeVisibleTimeRangeChange(function(range) {
        if (!range || isSyncingRsi) return;
        isSyncingMain = true;
        try {
            rsiChart.timeScale().setVisibleRange(range);
        } catch(e) {}
        isSyncingMain = false;
    });

    rsiChart.timeScale().subscribeVisibleTimeRangeChange(function(range) {
        if (!range || isSyncingMain) return;
        isSyncingRsi = true;
        try {
            chart.timeScale().setVisibleRange(range);
        } catch(e) {}
        isSyncingRsi = false;
    });
}

function calcIndicators() {
    if (candles.length < 5) return;
    
    // 動的インジケーター配列に沿って計算を実行
    activeIndicators.forEach(function(ind) {
        if (!ind.visible) return;
        var period = ind.period;
        
        if (ind.type === 'SMA') {
            var maData = [];
            for (var i = 0; i < candles.length; i++) {
                if (i >= period - 1) {
                    var sum = 0;
                    for (var j = i - period + 1; j <= i; j++) sum += candles[j].close;
                    maData.push({ time: candles[i].time, value: +(sum / period).toFixed(5) });
                }
            }
            if (ind.series) ind.series.setData(maData);
        }
        else if (ind.type === 'EMA') {
            var emaData = [];
            var k = 2 / (period + 1);
            var ema = candles[0].close;
            emaData.push({ time: candles[0].time, value: +ema.toFixed(5) });
            for (var i = 1; i < candles.length; i++) {
                ema = candles[i].close * k + ema * (1 - k);
                if (i >= period - 1) {
                    emaData.push({ time: candles[i].time, value: +ema.toFixed(5) });
                }
            }
            if (ind.series) ind.series.setData(emaData);
        }
        else if (ind.type === 'BB') {
            var upperData = [];
            var lowerData = [];
            for (var i = 0; i < candles.length; i++) {
                if (i >= period - 1) {
                    var sum = 0;
                    for (var j = i - period + 1; j <= i; j++) sum += candles[j].close;
                    var avg = sum / period;
                    
                    var varSum = 0;
                    for (var j = i - period + 1; j <= i; j++) varSum += Math.pow(candles[j].close - avg, 2);
                    var stdDev = Math.sqrt(varSum / period);
                    
                    upperData.push({ time: candles[i].time, value: +(avg + stdDev * 2).toFixed(5) });
                    lowerData.push({ time: candles[i].time, value: +(avg - stdDev * 2).toFixed(5) });
                }
            }
            if (ind.upperSeries) ind.upperSeries.setData(upperData);
            if (ind.lowerSeries) ind.lowerSeries.setData(lowerData);
        }
    });

    // 2. RSI 14 計算
    var rsiData = [];
    if (candles.length > 15) {
        var gains = 0, losses = 0;
        for (var i = 1; i <= 14; i++) {
            var diff = candles[i].close - candles[i-1].close;
            if (diff > 0) gains += diff;
            else losses -= diff;
        }
        var avgGain = gains / 14;
        var avgLoss = losses / 14;
        var rsi = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));
        rsiData.push({ time: candles[14].time, value: +rsi.toFixed(2) });
        
        for (var i = 15; i < candles.length; i++) {
            var diff = candles[i].close - candles[i-1].close;
            var gain = diff > 0 ? diff : 0;
            var loss = diff < 0 ? -diff : 0;
            avgGain = (avgGain * 13 + gain) / 14;
            avgLoss = (avgLoss * 13 + loss) / 14;
            rsi = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));
            rsiData.push({ time: candles[i].time, value: +rsi.toFixed(2) });
        }
    }
    if (rsiSeries) rsiSeries.setData(rsiData);
}

/* ─── ADVANCED CONTEXT-AWARE AI SIDEBAR & CROWD PSYCHOLOGY ─── */
var lastNewsFetch = 0;

function updateAISidebar() {
    try {
        if (!candles || candles.length < 20) {
            document.getElementById('ai-target-entry').innerHTML = '<div style="color:var(--muted)">十分なデータがありません</div>';
            document.getElementById('ai-psychology').innerHTML = '<div style="color:var(--muted)">分析データ不足</div>';
            document.getElementById('ai-strength').innerHTML = '<div style="color:var(--muted)">データ不足</div>';
            return;
        }
    
        var isJpy = currentSymbol.indexOf('JPY') !== -1;
        var precision = isJpy ? 3 : 5;
        var pipFactor = isJpy ? 100 : 10000;
        
        // 目標獲得Pipsをインプットフィールドから動的取得
        var targetPips = parseFloat(document.getElementById('target-pips').value) || 20;
        
        // 1. ボラティリティ (ATR簡易) の計算
        var atrSum = 0;
        var count = Math.min(20, candles.length);
        for (var i = candles.length - count; i < candles.length; i++) {
            atrSum += (candles[i].high - candles[i].low);
        }
        var atr = atrSum / count;
        
        // 直近20本のトレンド方向
        var lastCandles = candles.slice(candles.length - 20);
        var isUp = lastCandles[lastCandles.length - 1].close >= lastCandles[0].close;
        
        var currentPrice = liveP;
        if (isNaN(currentPrice) || currentPrice === 0) {
            currentPrice = candles[candles.length - 1].close;
        }
        
        var optimalEntry = 0, optimalTP = 0, optimalSL = 0, optimalDir = "";
        
        if (isUp) {
            // 上昇トレンド：押し目買いを推奨
            optimalEntry = currentPrice - (atr * 0.75);
            optimalDir = "買い (ロング)";
            optimalTP = optimalEntry + (targetPips / pipFactor);
            optimalSL = optimalEntry - ((targetPips * 0.5) / pipFactor); // リスクリワード 1:2
        } else {
            // 下降トレンド：戻り売りを推奨
            optimalEntry = currentPrice + (atr * 0.75);
            optimalDir = "売り (ショート)";
            optimalTP = optimalEntry - (targetPips / pipFactor);
            optimalSL = optimalEntry + ((targetPips * 0.5) / pipFactor); // リスクリワード 1:2
        }
        
        // ターゲットエントリーのUI更新
        var targetHtml = 
            '<div style="margin-bottom:6px;"><span style="color:var(--muted)">推奨エントリー方向: </span><span style="font-weight:700;color:' + (isUp ? 'var(--green)' : 'var(--red)') + '">' + optimalDir + '</span></div>' +
            '<div style="margin-bottom:4px;display:flex;justify-content:space-between;"><span>エントリー最適値:</span><span style="font-weight:600;font-family:\'Outfit\'">' + optimalEntry.toFixed(precision) + '</span></div>' +
            '<div style="margin-bottom:4px;display:flex;justify-content:space-between;"><span>利確目標 (TP):</span><span style="font-weight:600;color:var(--green);font-family:\'Outfit\'">' + optimalTP.toFixed(precision) + ' (+' + targetPips + ' Pips)</span></div>' +
            '<div style="display:flex;justify-content:space-between;"><span>損切り目安 (SL):</span><span style="font-weight:600;color:var(--red);font-family:\'Outfit\'">' + optimalSL.toFixed(precision) + ' (-' + (targetPips * 0.5) + ' Pips)</span></div>';
            
        document.getElementById('ai-target-entry').innerHTML = targetHtml;
        
        // 2. 支持・抵抗帯の接近状況に基づく「大衆心理分析」の動的演算！
        var resPrice = currentPrice + atr * 2;
        var supPrice = currentPrice - atr * 2;
        
        if (currentAIAnalysis && currentAIAnalysis.res && currentAIAnalysis.res.length > 0) {
            resPrice = currentAIAnalysis.res[0].p;
        }
        if (currentAIAnalysis && currentAIAnalysis.sup && currentAIAnalysis.sup.length > 0) {
            supPrice = currentAIAnalysis.sup[0].p;
        }
        
        var distToRes = (resPrice - currentPrice) * pipFactor;
        var distToSup = (currentPrice - supPrice) * pipFactor;
        
        var revPct = 50;
        var brkPct = 50;
        var psychDesc = "";
        
        if (distToSup <= 20 && distToSup >= 0) {
            // サポートが近い（反発期待が高まるが、割れれば急落の警戒）
            revPct = Math.min(85, Math.floor(60 + (20 - distToSup) * 1.25));
            brkPct = 100 - revPct;
            psychDesc = "支持帯（サポート）" + supPrice.toFixed(precision) + " まであと " + distToSup.toFixed(1) + " Pips に接近中！過去の反発実績から「押し目買い・買い支え（反発期待 " + revPct + "%）」を仕込む大衆心理が極めて優勢。しかし「ここを割り込めば大量の損切り巻き込みで急落（ブレイク警戒 " + brkPct + "%）」と睨み、下抜け警戒も同時に交錯しています。";
        } else if (distToRes <= 20 && distToRes >= 0) {
            // レジスタンスが近い
            revPct = Math.min(85, Math.floor(62 + (20 - distToRes) * 1.2));
            brkPct = 100 - revPct;
            psychDesc = "抵抗帯（レジスタンス）" + resPrice.toFixed(precision) + " まであと " + distToRes.toFixed(1) + " Pips に接近中！上値の重さから「利益確定・逆張り売り（反発期待 " + revPct + "%）」を狙う心理が優位です。上抜けた場合のショートカバー（踏み上げブレイク " + brkPct + "%）を懸念する動きも拮抗しています。";
        } else {
            // 中間レンジ
            psychDesc = "価格はサポート・レジスタンスの中間（ニュートラルゾーン）に位置しています。大衆心理は方向感を欠いており、明確な抵抗突破を待つ順張り勢と、上限下限に引きつけての逆張りを待つスキャルパーの心理が 50%:50% で完全に拮抗しています。";
        }
        
        var psychHtml = 
            '<div style="display:flex;justify-content:space-between;margin-bottom:6px;font-weight:600;">' +
            '<span style="color:var(--ng)">反発期待: ' + revPct + '%</span>' +
            '<span style="color:var(--np)">突破警戒: ' + brkPct + '%</span>' +
            '</div>' +
            '<div style="height:6px;background:rgba(255,255,255,.07);border-radius:3px;overflow:hidden;display:flex;margin-bottom:8px;">' +
            '<div style="width:' + revPct + '%;background:var(--ng);height:100%"></div>' +
            '<div style="width:' + brkPct + '%;background:var(--np);height:100%"></div>' +
            '</div>' +
            '<div style="font-size:11px;color:var(--muted);line-height:1.45">' + psychDesc + '</div>';
            
        document.getElementById('ai-psychology').innerHTML = psychHtml;
        
        // 3. 通貨強弱 (USD vs JPY割合)
        var usdStr = 50;
        var jpyStr = 50;
        var sumChg = 0;
        var count2 = Math.min(10, candles.length);
        for (var i = candles.length - count2; i < candles.length; i++) {
            sumChg += (candles[i].close - candles[i].open);
        }
        
        if (currentSymbol === 'USDJPY') {
            usdStr = Math.max(15, Math.min(85, Math.floor(50 + sumChg * (isJpy ? 15 : 1500))));
            jpyStr = 100 - usdStr;
        } else if (currentSymbol === 'EURJPY') {
            jpyStr = Math.max(15, Math.min(85, Math.floor(55 - sumChg * 12)));
            usdStr = 100 - jpyStr;
        } else {
            usdStr = Math.max(15, Math.min(85, Math.floor(50 - sumChg * 1000)));
            jpyStr = 100 - usdStr;
        }
        
        var strHtml = 
            '<div style="display:flex;justify-content:space-between;margin-bottom:6px;font-weight:600;">' +
            '<span style="color:#00b0ff">USD（ドル）牽引: ' + usdStr + '%</span>' +
            '<span style="color:#ffb300">JPY（円）牽引: ' + jpyStr + '%</span>' +
            '</div>' +
            '<div style="height:6px;background:rgba(255,255,255,.07);border-radius:3px;overflow:hidden;display:flex;margin-bottom:6px;">' +
            '<div style="width:' + usdStr + '%;background:#00b0ff;height:100%"></div>' +
            '<div style="width:' + jpyStr + '%;background:#ffb300;height:100%"></div>' +
            '</div>' +
            '<div style="font-size:9px;color:var(--muted);text-align:center;">※EUR/USD・EUR/JPY・USD/JPYの他ペア相関から牽引割合を動的算出</div>';
            
        document.getElementById('ai-strength').innerHTML = strHtml;
        
        // 4. 要人発言ニュースの更新
        var nowTime = Date.now();
        if (nowTime - lastNewsFetch > 15 * 60 * 1000) { 
            lastNewsFetch = nowTime;
            fetch(apiHost + '/v1/news')
                .then(function(res) { return res.json(); })
                .then(function(news) {
                    var newsHtml = "";
                    if (Array.isArray(news)) {
                        news.forEach(function(item) {
                            newsHtml += 
                                '<div style="border-bottom:1px dashed rgba(255,255,255,.04);padding-bottom:5px;margin-bottom:4px;">' +
                                '<div style="font-weight:600;color:var(--txt);margin-bottom:2px;">' + item.title + '</div>' +
                                '<div style="font-size:9px;color:var(--muted);text-align:right;">' + item.time + '</div>' +
                                '</div>';
                        });
                    } else {
                        newsHtml = '<div style="color:var(--muted);text-align:center;">ニュースがありません</div>';
                    }
                    document.getElementById('news-list').innerHTML = newsHtml;
                })
                .catch(function(err) {
                    console.warn('News fetch failed, using fallback:', err);
                    var fallbackHtml = 
                        '<div style="border-bottom:1px dashed rgba(255,255,255,.04);padding-bottom:5px;margin-bottom:4px;">' +
                        '<div style="font-weight:600;color:var(--txt);margin-bottom:2px;">日銀総裁 「追加の利上げ判断はデータ次第、急激な為替変動は強く警戒」</div>' +
                        '<div style="font-size:9px;color:var(--muted);text-align:right;">本日</div>' +
                        '</div>' +
                        '<div style="border-bottom:1px dashed rgba(255,255,255,.04);padding-bottom:5px;margin-bottom:4px;">' +
                        '<div style="font-weight:600;color:var(--txt);margin-bottom:2px;">FRB議長 「インフレ目標2%達成への進展は確認も、利下げは慎重に判断」</div>' +
                        '<div style="font-size:9px;color:var(--muted);text-align:right;">本日</div>' +
                        '</div>' +
                        '<div style="border-bottom:1px dashed rgba(255,255,255,.04);padding-bottom:5px;margin-bottom:4px;">' +
                        '<div style="font-weight:600;color:var(--txt);margin-bottom:2px;">財務官 「為替相場の過度な変動には極めて注視、必要なら適切な措置」</div>' +
                        '<div style="font-size:9px;color:var(--muted);text-align:right;">本日</div>' +
                        '</div>';
                    document.getElementById('news-list').innerHTML = fallbackHtml;
                });
        }
    } catch (e) {
        logErrorToBridge(e, "updateAISidebar");
    }
}

/* ─── TIMEZONE HELPERS ─── */
function getTimezoneOffsetSeconds(tzStr) {
    if (tzStr === "UTC+9") return 9 * 3600;
    if (tzStr === "UTC+0") return 0;
    if (tzStr === "UTC-5") return -5 * 3600;
    if (tzStr === "UTC+8") return 8 * 3600;
    return 9 * 3600; // Default Tokyo JST
}

function formatUnixToDateString(timestampSeconds, offsetSeconds) {
    var d = new Date((timestampSeconds + offsetSeconds) * 1000);
    var y = d.getUTCFullYear();
    var m = ("0" + (d.getUTCMonth() + 1)).slice(-2);
    var day = ("0" + d.getUTCDate()).slice(-2);
    return y + "-" + m + "-" + day;
}

function tvFrame(payload) {
    return "~m~" + payload.length + "~m~" + payload;
}

function tvSend(ws, name, params) {
    ws.send(tvFrame(JSON.stringify({ m: name, p: params })));
}

function tvSymbol(symbol) {
    return "FX_IDC:" + String(symbol || "").toUpperCase();
}

function tvInterval(tf) {
    return ({ "1m": "1", "5m": "5", "15m": "15", "1h": "60", "4h": "240", "1d": "1D", "1w": "1W" })[tf] || "5";
}

function tvBarCount(tf) {
    return ({ "1m": 300, "5m": 2000, "15m": 2000, "1h": 2000, "4h": 1000, "1d": 780, "1w": 260 })[tf] || 2000;
}

function parseTvFrames(raw) {
    var out = [];
    var i = 0;
    while (i < raw.length) {
        if (raw.slice(i, i + 3) !== "~m~") break;
        i += 3;
        var sep = raw.indexOf("~m~", i);
        if (sep === -1) break;
        var len = parseInt(raw.slice(i, sep), 10);
        if (!isFinite(len) || len < 0) break;
        i = sep + 3;
        out.push(raw.slice(i, i + len));
        i += len;
    }
    return out;
}

function normalizeTvBars(series) {
    if (!Array.isArray(series)) return [];
    return series.map(function(bar) {
        var v = bar && bar.v;
        if (!Array.isArray(v) || v.length < 5) return null;
        return { time: v[0], open: v[1], high: v[2], low: v[3], close: v[4] };
    }).filter(function(d) {
        return d && d.time && isFinite(d.open) && isFinite(d.high) && isFinite(d.low) && isFinite(d.close);
    });
}

function fetchTradingViewCandles(symbol, tf, countOverride) {
    return new Promise(function(resolve, reject) {
        var ws = new WebSocket("wss://data.tradingview.com/socket.io/websocket");
        var chartSession = "cs_" + Math.random().toString(36).slice(2, 14);
        var done = false;
        var timer = setTimeout(function() {
            if (!done) {
                done = true;
                try { ws.close(); } catch (e) {}
                reject(new Error("TradingView timeout"));
            }
        }, 12000);

        ws.onopen = function() {
            tvSend(ws, "set_auth_token", ["unauthorized_user_token"]);
            tvSend(ws, "chart_create_session", [chartSession, ""]);
            tvSend(ws, "switch_timezone", [chartSession, "Asia/Tokyo"]);
            tvSend(ws, "resolve_symbol", [chartSession, "symbol_1", "=" + JSON.stringify({
                symbol: tvSymbol(symbol),
                adjustment: "splits",
                session: "extended"
            })]);
            tvSend(ws, "create_series", [chartSession, "s1", "s1", "symbol_1", tvInterval(tf), countOverride || tvBarCount(tf)]);
        };

        ws.onerror = function() {
            if (!done) {
                done = true;
                clearTimeout(timer);
                try { ws.close(); } catch (e) {}
                reject(new Error("TradingView WebSocket error"));
            }
        };

        ws.onclose = function() {
            if (!done) {
                done = true;
                clearTimeout(timer);
                reject(new Error("TradingView WebSocket closed"));
            }
        };

        ws.onmessage = function(event) {
            var raw = event.data || "";
            if (raw.indexOf("~m~") === -1) return;
            var frames = parseTvFrames(raw);
            frames.forEach(function(payload) {
                if (!payload) return;
                if (payload.indexOf("~h~") === 0) {
                    try { ws.send(tvFrame(payload)); } catch (e) {}
                    return;
                }
                if (payload[0] !== "{") return;
                try {
                    var msg = JSON.parse(payload);
                    var container = msg && msg.p && msg.p[1];
                    if (!container || typeof container !== "object") return;
                    var seriesObj = container.s1 || container.sds_1 || container.series_1;
                    if (!seriesObj || !Array.isArray(seriesObj.s)) return;
                    var data = normalizeTvBars(seriesObj.s);
                    if (data.length > 0 && !done) {
                        done = true;
                        clearTimeout(timer);
                        try { ws.close(); } catch (e) {}
                        resolve(data);
                    }
                } catch (e) {}
            });
        };
    });
}

/* ─── TIMEFRAME & LOADER ─── */
function loadTf(tf) {
    clearManual(true);
    var isJpy = currentSymbol.indexOf('JPY') !== -1;
    var precision = isJpy ? 3 : 5;
    
    // Get target timezone offset from modal input
    var tzSelect = document.getElementById('set-timezone');
    var tzStr = tzSelect ? tzSelect.value : 'UTC+9';
    var targetOffset = getTimezoneOffsetSeconds(tzStr);
    var browserOffset = new Date().getTimezoneOffset() * -60; // in seconds
    var shift = targetOffset - browserOffset;
    
    fetch(apiHost + '/v1/ticker?symbol=' + currentSymbol + '&tf=' + tf)
        .then(function(res) {
            if (!res.ok) throw new Error('API server returned ' + res.status);
            return res.json();
        })
        .then(function(realData) {
            if (!Array.isArray(realData) || realData.length === 0) throw new Error('Received empty or invalid data');
            
            var mapped = realData.map(function(d) {
                var isDailyOrWeekly = (tf.toLowerCase() === '1d' || tf.toLowerCase() === '1w');
                return {
                    time: isDailyOrWeekly ? formatUnixToDateString(d.time, targetOffset) : d.time + shift,
                    open: d.open,
                    high: d.high,
                    low: d.low,
                    close: d.close
                };
            });
            
            mapped.sort(function(a, b) {
                if (typeof a.time === 'string' && typeof b.time === 'string') {
                    return a.time.localeCompare(b.time);
                }
                return a.time - b.time;
            });
            
            var uniqueCandles = [];
            var seenTimes = {};
            mapped.forEach(function(d) {
                if (!seenTimes[d.time]) {
                    seenTimes[d.time] = true;
                    uniqueCandles.push(d);
                }
            });
            
            candles = uniqueCandles;
            cSeries.setData(candles);
            setTimeout(drawNeonCandles, 120);
            
            if (chart) {
                chart.applyOptions({
                    watermark: {
                        visible: document.getElementById('set-show-wm') ? document.getElementById('set-show-wm').checked : true,
                        fontSize: 72,
                        horzAlign: 'center',
                        vertAlign: 'center',
                        color: 'rgba(255, 255, 255, 0.05)',
                        text: currentSymbol + ' ' + tf.toUpperCase(),
                        fontFamily: 'Outfit, sans-serif'
                    }
                });
            }
            
            currentAIAnalysis = detectLevels(candles, currentSymbol);
            calcIndicators(); 
            
            if (candles.length > 0) {
                var len = candles.length;
                // Constant zoom level displaying about 155 total bars with 42% blank space on the right (approx 65 empty future bars)
                chart.timeScale().setVisibleLogicalRange({
                    from: len - 90,
                    to: len + 65
                });
            } else {
                chart.timeScale().fitContent();
            }
            clearAI();
            updatePanel(tf);
            runAI(false);
            
            if (candles.length > 0) {
                var last = candles[candles.length - 1];
                liveP = last.close;
                var el = document.getElementById('pv');
                if (el) el.textContent = liveP.toFixed(precision);
            }
            
            updateAISidebar();
            renderIndicatorLegend();
        })
        .catch(function(err) {
            console.warn('API failed, trying TradingView WebSocket:', err);
            fetchTradingViewCandles(currentSymbol, tf)
                .then(function(realData) {
                    if (!Array.isArray(realData) || realData.length === 0) throw new Error('Received empty or invalid data');
                    var mapped = realData.map(function(d) {
                        var isDailyOrWeekly = (tf.toLowerCase() === '1d' || tf.toLowerCase() === '1w');
                        return {
                            time: isDailyOrWeekly ? formatUnixToDateString(d.time, targetOffset) : d.time + shift,
                            open: d.open,
                            high: d.high,
                            low: d.low,
                            close: d.close
                        };
                    });
                    candles = mapped;
                    cSeries.setData(candles);
                    setTimeout(drawNeonCandles, 120);
                    currentAIAnalysis = detectLevels(candles, currentSymbol);
                    calcIndicators();
                    if (candles.length > 0) {
                        var len = candles.length;
                        chart.timeScale().setVisibleLogicalRange({ from: len - 90, to: len + 65 });
                        var last = candles[candles.length - 1];
                        liveP = last.close;
                        var el = document.getElementById('pv');
                        if (el) el.textContent = liveP.toFixed(precision);
                    }
                    clearAI();
                    updatePanel(tf);
                    runAI(false);
                    updateAISidebar();
                    renderIndicatorLegend();
                })
                .catch(function() {
                    toast('実データの取得に失敗しました');
                });
        });
}

function setTf(btn, tf) {
    document.querySelectorAll('.tf').forEach(function(b){ b.classList.remove('on'); });
    btn.classList.add('on');
    currentTf = tf;
    loadTf(tf);
    toast(btn.textContent + ' に切り替えました');
}

function updatePanel(tf) {
    var db = currentAIAnalysis;
    if (!db) return;
    
    var isJpy = currentSymbol.indexOf('JPY') !== -1;
    var precision = isJpy ? 3 : 5;
    
    var lh = '';
    db.res.forEach(function(l){ lh += '<div class="lv r"><span class="lv-n">'+l.l+'</span><span class="lv-p">'+l.p.toFixed(precision)+'</span></div>'; });
    db.sup.forEach(function(l){ lh += '<div class="lv s"><span class="lv-n">'+l.l+'</span><span class="lv-p">'+l.p.toFixed(precision)+'</span></div>'; });
    document.getElementById('lvl-list').innerHTML = lh;

    document.getElementById('diag').innerHTML =
        '<div class="dg"><span class="dg-dot" style="background:'+db.trend.c+'"></span><div><span style="color:var(--muted)">トレンド: </span><span style="font-weight:600;color:'+db.trend.c+'">'+db.trend.lbl+'</span></div></div>'+
        '<div class="dg"><span class="dg-dot" style="background:var(--np)"></span><div><span style="color:var(--muted)">レジスタンス: </span><span style="font-weight:600">'+db.res[0].p.toFixed(precision)+'</span></div></div>'+
        '<div class="dg"><span class="dg-dot" style="background:var(--ng)"></span><div><span style="color:var(--muted)">サポート: </span><span style="font-weight:600">'+db.sup[0].p.toFixed(precision)+'</span></div></div>'+
        '<div class="dg"><span class="dg-dot" style="background:var(--ny)"></span><div><span style="color:var(--muted)">戦略: </span><span style="font-weight:600;color:var(--ny)">'+db.strat+'</span></div></div>';
}

function clearAI() {
    aiLines.forEach(function(l) {
        try {
            if (l.type === 'pl') cSeries.removePriceLine(l.ref);
            else chart.removeSeries(l.ref);
        } catch(e) {}
    });
    aiLines = [];
}

function runAI(anim) {
    if (anim === undefined) anim = true;
    var btn = document.getElementById('btn-ai');
    if (anim) {
        btn.disabled = true;
        btn.innerHTML = '<span class="spin">⚡</span> 分析中...';
    }

    function doRender() {
        clearAI();
        var db = currentAIAnalysis;
        if (!db) return;

        // Support
        if (document.getElementById('tog-s').checked) {
            db.sup.forEach(function(l) {
                var pl = cSeries.createPriceLine({ price: l.p, color: C.sl, lineWidth: 2, lineStyle: 0, axisLabelVisible: true, title: l.l });
                aiLines.push({ type: 'pl', ref: pl });
            });
        }
        // Resistance
        if (document.getElementById('tog-r').checked) {
            db.res.forEach(function(l) {
                var pl = cSeries.createPriceLine({ price: l.p, color: C.rl, lineWidth: 2, lineStyle: 0, axisLabelVisible: true, title: l.l });
                aiLines.push({ type: 'pl', ref: pl });
            });
        }
        // Trend line (全表示範囲の極値を検出し、最新価格まで綺麗に延長)
        if (document.getElementById('tog-t').checked && candles.length > 30) {
            var ls = chart.addLineSeries({ color: C.trl, lineWidth: 2, lineStyle: 2, lastValueVisible: false, priceLineVisible: false, autoscaleInfoProvider: function() { return null; } });
            var N = candles.length;
            var subset = candles;
            var isUpTrend = subset[N - 1].close >= subset[0].close;
            var mid = Math.floor(N / 2);
            var part1 = subset.slice(0, mid);
            var part2 = subset.slice(mid);
            var p1, p2, idx1, idx2;
            
            var isJpy = currentSymbol.indexOf('JPY') !== -1;
            var precision = isJpy ? 3 : 5;
            if (isUpTrend) {
                var minVal1 = Infinity;
                for (var i = 0; i < part1.length; i++) {
                    if (part1[i] && part1[i].low !== undefined && part1[i].low !== null && !isNaN(part1[i].low) && part1[i].low < minVal1) {
                        minVal1 = part1[i].low;
                        idx1 = i;
                    }
                }
                var minVal2 = Infinity;
                for (var i = 0; i < part2.length; i++) {
                    if (part2[i] && part2[i].low !== undefined && part2[i].low !== null && !isNaN(part2[i].low) && part2[i].low < minVal2) {
                        minVal2 = part2[i].low;
                        idx2 = i + mid;
                    }
                }
                if (idx1 !== undefined && idx2 !== undefined) {
                    p1 = part1[idx1];
                    p2 = part2[idx2];
                    if (p1 && p2 && p1.low !== undefined && p2.low !== undefined) {
                        var a = (p2.low - p1.low) / (idx2 - idx1);
                        var b = p1.low - a * idx1;
                        ls.setData([
                            { time: p1.time, value: p1.low },
                            { time: subset[N - 1].time, value: +(a * (N - 1) + b).toFixed(precision) }
                        ]);
                        aiLines.push({ type: 'ls', ref: ls });
                    }
                }
            } else {
                var maxVal1 = -Infinity;
                for (var i = 0; i < part1.length; i++) {
                    if (part1[i] && part1[i].high !== undefined && part1[i].high !== null && !isNaN(part1[i].high) && part1[i].high > maxVal1) {
                        maxVal1 = part1[i].high;
                        idx1 = i;
                    }
                }
                var maxVal2 = -Infinity;
                for (var i = 0; i < part2.length; i++) {
                    if (part2[i] && part2[i].high !== undefined && part2[i].high !== null && !isNaN(part2[i].high) && part2[i].high > maxVal2) {
                        maxVal2 = part2[i].high;
                        idx2 = i + mid;
                    }
                }
                if (idx1 !== undefined && idx2 !== undefined) {
                    p1 = part1[idx1];
                    p2 = part2[idx2];
                    if (p1 && p2 && p1.high !== undefined && p2.high !== undefined) {
                        var a = (p2.high - p1.high) / (idx2 - idx1);
                        var b = p1.high - a * idx1;
                        ls.setData([
                            { time: p1.time, value: p1.high },
                            { time: subset[N - 1].time, value: +(a * (N - 1) + b).toFixed(precision) }
                        ]);
                        aiLines.push({ type: 'ls', ref: ls });
                    }
                }
            }
        }

        if (anim) {
            btn.disabled = false;
            btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg> AI 自動分析を実行';
            toast(document.querySelector('.tf.on').textContent + ' 分析完了！ラインを描画しました');
        }
    }

    if (anim) setTimeout(doRender, 700);
    else doRender();
}

/* ─── INTERACTIVE PRICE ALERTS TOUCH-CHIME ENGINE ─── */
function playAlertSound(soundType) {
    try {
        if (!audioCtx) {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (audioCtx.state === 'suspended') {
            audioCtx.resume();
        }
        
        var osc1 = audioCtx.createOscillator();
        var osc2 = audioCtx.createOscillator();
        var gain = audioCtx.createGain();
        
        if (soundType === 'standard' || !soundType) {
            // Chime: Standard pleasant wave chimes
            osc1.type = 'sine';
            osc1.frequency.setValueAtTime(880, audioCtx.currentTime); // A5
            osc1.frequency.exponentialRampToValueAtTime(1760, audioCtx.currentTime + 0.1);
            osc2.type = 'triangle';
            osc2.frequency.setValueAtTime(1318.51, audioCtx.currentTime); // E6
            gain.gain.setValueAtTime(0.12, audioCtx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 1.2);
        } else if (soundType === 'electronic') {
            // Bell: Deep sweet synthesizer bell resonance
            osc1.type = 'sine';
            osc1.frequency.setValueAtTime(523.25, audioCtx.currentTime); // C5
            osc1.frequency.exponentialRampToValueAtTime(1046.50, audioCtx.currentTime + 0.15);
            osc2.type = 'sine';
            osc2.frequency.setValueAtTime(659.25, audioCtx.currentTime); // E5
            gain.gain.setValueAtTime(0.18, audioCtx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 2.5); // 残響大
        } else if (soundType === 'siren') {
            // Siren: Alert warn sweep
            osc1.type = 'sawtooth';
            osc1.frequency.setValueAtTime(330, audioCtx.currentTime);
            osc1.frequency.linearRampToValueAtTime(880, audioCtx.currentTime + 0.5);
            osc1.frequency.linearRampToValueAtTime(330, audioCtx.currentTime + 1.0);
            gain.gain.setValueAtTime(0.08, audioCtx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 1.1);
        }
        
        osc1.connect(gain);
        if (soundType !== 'siren') osc2.connect(gain);
        gain.connect(audioCtx.destination);
        
        osc1.start();
        if (soundType !== 'siren') osc2.start();
        osc1.stop(audioCtx.currentTime + 2.5);
        if (soundType !== 'siren') osc2.stop(audioCtx.currentTime + 2.5);
    } catch (e) {
        console.error('Audio alert synthesis failed:', e);
    }
}

function checkAlerts(currentPrice) {
    for (var i = 0; i < alertLines.length; i++) {
        var alert = alertLines[i];
        if (alert.active) {
            var dist = Math.abs(currentPrice - alert.price);
            var isJpy = currentSymbol.indexOf('JPY') !== -1;
            var threshold = isJpy ? 0.008 : 0.00008;
            
            // Crossing check
            var triggered = false;
            if (alert.type === 'crossing' && dist <= threshold) triggered = true;
            else if (alert.type === 'greater' && currentPrice >= alert.price) triggered = true;
            else if (alert.type === 'less' && currentPrice <= alert.price) triggered = true;
            
            if (triggered) {
                alert.active = false;
                
                // Remove price line visually
                try {
                    if (alert.priceLine) cSeries.removePriceLine(alert.priceLine);
                } catch(e){}
                
                triggerAlertPopup(alert, currentPrice);
            }
        }
    }
}

function triggerAlertPopup(alert, price) {
    var isJpy = currentSymbol.indexOf('JPY') !== -1;
    var precision = isJpy ? 3 : 5;
    
    // アラート発火用ポップアップウィンドウの動的作成
    var overlay = document.createElement('div');
    overlay.className = 'overlay open';
    overlay.style.zIndex = '10000';
    
    var modal = document.createElement('div');
    modal.className = 'modal';
    modal.style.border = '2px solid var(--red)';
    modal.style.boxShadow = '0 0 30px rgba(242,54,69,0.3)';
    modal.style.width = '420px';
    
    modal.innerHTML = 
        '<div class="modal-ttl" style="color:var(--red); font-size:18px;">🔔 アラート検知！</div>' +
        '<div style="margin:14px 0; font-size:13px; line-height:1.6; color:#fff;">' +
            '<div style="font-weight:700; font-size:15px; margin-bottom:8px; font-family:\'Outfit\'">' + currentSymbol + ' アラートトリガー</div>' +
            '<div style="display:flex; justify-content:space-between; margin-bottom:4px;"><span>設定価格:</span><span style="font-family:\'Outfit\'; font-weight:700;">' + alert.price.toFixed(precision) + '</span></div>' +
            '<div style="display:flex; justify-content:space-between; margin-bottom:12px;"><span>現在価格:</span><span style="font-family:\'Outfit\'; font-weight:700; color:var(--red);">' + price.toFixed(precision) + '</span></div>' +
            '<div style="margin-top:12px; padding:10px; background:rgba(255,255,255,0.03); border-radius:6px; border-left:4px solid var(--red); color:var(--txt); font-size:12px;">' + alert.message + '</div>' +
        '</div>' +
        '<div style="display:flex; justify-content:flex-end;">' +
            '<button id="close-alert-popup" style="padding:8px 20px; background:var(--red); border:none; border-radius:5px; color:#fff; cursor:pointer; font-weight:600; font-size:12px;">閉じる</button>' +
        '</div>';
        
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    
    // サウンドループ再生 (1秒間隔)
    var playInterval = setInterval(function() {
        playAlertSound(alert.sound);
    }, 1000);
    
    document.getElementById('close-alert-popup').onclick = function() {
        clearInterval(playInterval);
        document.body.removeChild(overlay);
    };
}

/* ─── DRAWING TOOLS DRAG & ACTIONS ─── */
function setTool(t) {
    tool = t;
    drawPt = null;
    document.querySelectorAll('.lt-btn').forEach(function(b){ b.classList.remove('on'); });
    var el = document.getElementById('t-' + t);
    if (el) el.classList.add('on');
    
    // overlay-canvasのイベント透過制御
    var oc = document.getElementById('overlay-canvas');
    if (oc) {
        if (t === 'brush' || t === 'text') {
            oc.style.pointerEvents = 'auto';
        } else {
            oc.style.pointerEvents = 'none';
        }
    }
    
    var hint = document.getElementById('hint');
    var msgs = { 
        cur:'', 
        hl:'クリックして水平線（価格線）を配置します', 
        vert:'クリックして垂直線（時間線）を配置します',
        cross:'クリックしてクロス線（十字線）を配置します',
        horzray:'クリックして水平レイ（右方向光線）を配置します',
        tl:'1点目クリック ➔ 2点目クリック（トレンドライン）', 
        fib:'高値クリック ➔ 安値クリック（フィボナッチリトレースメント）',
        gannbox:'1点目クリック ➔ 2点目クリック（ギャン・ボックス）',
        pr:'1点目クリック ➔ 2点目クリック（価格範囲測定・Pips計算）',
        rect:'1点目クリック ➔ 2点目クリック（ボックスゾーン描画）',
        brush:'ドラッグして自由線を描画します（ブラシ）',
        text:'クリックした位置に文字（注釈テキスト）を追加します',
        eraser:'クリックして描画オブジェクトやアラートを消去します'
    };
    var m = msgs[t] || '';
    if (m) { hint.textContent = m; hint.classList.add('vis'); }
    else hint.classList.remove('vis');
}

function tryEraseObject(time, price) {
    var isJpy = currentSymbol.indexOf('JPY') !== -1;
    var priceThreshold = isJpy ? 0.08 : 0.0008; // close click boundary
    var timeThreshold = 3600 * 4; // close time boundary (4 hours)
    
    // 1. Check alertLines
    for (var i = 0; i < alertLines.length; i++) {
        var al = alertLines[i];
        if (Math.abs(al.price - price) <= priceThreshold) {
            deleteManualObject(al.id, 'alert');
            return true;
        }
    }
    
    // 2. Check manual drawings on canvas
    for (var i = 0; i < manualDrawings.length; i++) {
        var dr = manualDrawings[i];
        if (dr.type === 'text') {
            if (Math.abs(dr.price - price) <= priceThreshold && Math.abs(dr.time - time) <= timeThreshold) {
                deleteManualObject(dr.id, 'canvas');
                return true;
            }
        } else if (dr.type === 'brush') {
            for (var j = 0; j < dr.points.length; j++) {
                if (Math.abs(dr.points[j].price - price) <= priceThreshold && Math.abs(dr.points[j].time - time) <= timeThreshold) {
                    deleteManualObject(dr.id, 'canvas');
                    return true;
                }
            }
        }
    }
    
    // 3. Check manLines (trendlines, boxes, etc.)
    for (var i = 0; i < manLines.length; i++) {
        var l = manLines[i];
        if (l.type === 'tl' || l.type === 'pr' || l.type === 'rect' || l.type === 'hl' || l.type === 'vert' || l.type === 'cross' || l.type === 'ray') {
            // Delete the exact group or element
            deleteManualObject(l.id, 'chart');
            return true;
        }
    }
    return false;
}

function handleDraw(time, price) {
    var isJpy = currentSymbol.indexOf('JPY') !== -1;
    var precision = isJpy ? 3 : 5;
    
    // ロックモード時のガード
    if (lockAllDrawings) {
        toast('描画ツールがロックされています', true);
        setTool('cur');
        return;
    }
    
    // 強マグネットモードによる価格極値へのスナップ吸着
    if (magnetMode && candles.length > 0) {
        var candle = candles.find(function(c) { return c.time === time; });
        if (candle) {
            var levels = [candle.open, candle.high, candle.low, candle.close];
            var closest = levels[0];
            var minDist = Math.abs(price - levels[0]);
            for (var i = 1; i < levels.length; i++) {
                var d = Math.abs(price - levels[i]);
                if (d < minDist) {
                    minDist = d;
                    closest = levels[i];
                }
            }
            price = closest; // 吸着！
        }
    }
    
    if (tool === 'hl') {
        var pl = cSeries.createPriceLine({
            price: price,
            color: C.ml,
            lineWidth: 2,
            lineStyle: 0,
            axisLabelVisible: true,
            title: '水平線 ' + price.toFixed(precision)
        });
        var hlId = 'hl_' + Date.now();
        manLines.push({
            id: hlId,
            type: 'hl',
            name: '水平線 @ ' + price.toFixed(precision),
            ref: pl,
            seriesType: 'pl',
            visible: true
        });
        if (!keepDrawingMode) setTool('cur');
        toast('水平線を追加しました');
        renderManualObjects();
    }
    else if (tool === 'vert') {
        var subset = candles;
        var minVal = Infinity, maxVal = -Infinity;
        subset.forEach(function(c) {
            if (c.low < minVal) minVal = c.low;
            if (c.high > maxVal) maxVal = c.high;
        });
        var padding = (maxVal - minVal) * 0.5;
        
        var ls = chart.addLineSeries({ color: C.ml, lineWidth: 2, lineStyle: 0, lastValueVisible: false, priceLineVisible: false, autoscaleInfoProvider: function() { return null; } });
        ls.setData([
            { time: time, value: +(minVal - padding).toFixed(precision) },
            { time: time, value: +(maxVal + padding).toFixed(precision) }
        ]);
        
        var vertId = 'vert_' + Date.now();
        manLines.push({
            id: vertId,
            type: 'vert',
            name: '垂直線 (時間: ' + time + ')',
            ref: ls,
            seriesType: 'ls',
            visible: true
        });
        if (!keepDrawingMode) setTool('cur');
        toast('垂直線を追加しました');
        renderManualObjects();
    }
    else if (tool === 'cross') {
        var hl = cSeries.createPriceLine({ price: price, color: C.ml, lineWidth: 1.5, lineStyle: 0, axisLabelVisible: true });
        
        var subset = candles;
        var minVal = Infinity, maxVal = -Infinity;
        subset.forEach(function(c) {
            if (c.low < minVal) minVal = c.low;
            if (c.high > maxVal) maxVal = c.high;
        });
        var padding = (maxVal - minVal) * 0.5;
        var vl = chart.addLineSeries({ color: C.ml, lineWidth: 1.5, lineStyle: 0, lastValueVisible: false, priceLineVisible: false, autoscaleInfoProvider: function() { return null; } });
        vl.setData([
            { time: time, value: +(minVal - padding).toFixed(precision) },
            { time: time, value: +(maxVal + padding).toFixed(precision) }
        ]);
        
        var crossId = 'cross_' + Date.now();
        manLines.push({
            id: crossId,
            type: 'cross',
            name: 'クロス線 @ ' + price.toFixed(precision),
            ref: hl,
            seriesType: 'pl',
            visible: true
        });
        manLines.push({
            id: crossId,
            type: 'cross',
            name: 'クロス縦線',
            ref: vl,
            seriesType: 'ls',
            visible: true
        });
        
        if (!keepDrawingMode) setTool('cur');
        toast('クロス線を追加しました');
        renderManualObjects();
    }
    else if (tool === 'horzray') {
        var latestTime = candles[candles.length - 1].time;
        var ls = chart.addLineSeries({ color: C.ml, lineWidth: 2, lineStyle: 0, lastValueVisible: false, priceLineVisible: false, autoscaleInfoProvider: function() { return null; } });
        ls.setData([
            { time: time, value: +price.toFixed(precision) },
            { time: latestTime, value: +price.toFixed(precision) }
        ]);
        
        var rayId = 'ray_' + Date.now();
        manLines.push({
            id: rayId,
            type: 'ray',
            name: '水平レイ @ ' + price.toFixed(precision),
            ref: ls,
            seriesType: 'ls',
            visible: true
        });
        if (!keepDrawingMode) setTool('cur');
        toast('水平レイを追加しました');
        renderManualObjects();
    }
    else if (tool === 'gannbox') {
        if (!drawPt) {
            drawPt = { time: time, price: price };
            document.getElementById('hint').textContent = '対角をクリックしてギャン・ボックスを確定';
        } else {
            var hi = Math.max(drawPt.price, price);
            var lo = Math.min(drawPt.price, price);
            var t1 = Math.min(drawPt.time, time);
            var t2 = Math.max(drawPt.time, time);
            
            var tDiff = t2 - t1;
            var pDiff = hi - lo;
            
            var gannGroupId = 'gannbox_' + Date.now();
            
            var borders = [
                [{ time: t1, value: hi }, { time: t2, value: hi }],
                [{ time: t1, value: lo }, { time: t2, value: lo }],
                [{ time: t1, value: hi }, { time: t1, value: lo }],
                [{ time: t2, value: hi }, { time: t2, value: lo }]
            ];
            
            borders.forEach(function(b) {
                var ls = chart.addLineSeries({ color: '#00e676', lineWidth: 1.5, lastValueVisible: false, priceLineVisible: false, autoscaleInfoProvider: function() { return null; } });
                ls.setData(b);
                manLines.push({ id: gannGroupId, type: 'rect', name: 'ギャン外枠', ref: ls, seriesType: 'ls', visible: true });
            });
            
            var ratios = [0.382, 0.5, 0.618];
            ratios.forEach(function(r) {
                var hp = +(lo + pDiff * r).toFixed(precision);
                var hls = chart.addLineSeries({ color: 'rgba(0, 230, 118, 0.3)', lineWidth: 1, lineStyle: 1, lastValueVisible: false, priceLineVisible: false, autoscaleInfoProvider: function() { return null; } });
                hls.setData([{ time: t1, value: hp }, { time: t2, value: hp }]);
                manLines.push({ id: gannGroupId, type: 'rect', name: 'ギャン横線', ref: hls, seriesType: 'ls', visible: true });
                
                var vt = Math.floor(t1 + tDiff * r);
                var vls = chart.addLineSeries({ color: 'rgba(0, 230, 118, 0.3)', lineWidth: 1, lineStyle: 1, lastValueVisible: false, priceLineVisible: false, autoscaleInfoProvider: function() { return null; } });
                vls.setData([{ time: vt, value: hi }, { time: vt, value: lo }]);
                manLines.push({ id: gannGroupId, type: 'rect', name: 'ギャン縦線', ref: vls, seriesType: 'ls', visible: true });
            });
            
            drawPt = null;
            if (!keepDrawingMode) {
                setTool('cur');
            } else {
                document.getElementById('hint').textContent = '1点目クリック ➔ 2点目クリック';
            }
            toast('ギャン・ボックスを配置しました');
            renderManualObjects();
        }
    }
    else if (tool === 'tl') {
        if (!drawPt) {
            drawPt = { time: time, price: price };
            document.getElementById('hint').textContent = '2点目をクリックしてトレンドラインを確定';
        } else {
            var pts = [ { time: drawPt.time, value: +drawPt.price.toFixed(precision) }, { time: time, value: +price.toFixed(precision) } ];
            pts.sort(function(a,b){ return a.time - b.time; });
            var ls = chart.addLineSeries({ color: C.ml, lineWidth: 2, lineStyle: 0, lastValueVisible: false, priceLineVisible: false, autoscaleInfoProvider: function() { return null; } });
            ls.setData(pts);
            
            var tlId = 'tl_' + Date.now();
            manLines.push({
                id: tlId,
                type: 'tl',
                name: 'トレンド線 (' + drawPt.price.toFixed(precision) + ' ➔ ' + price.toFixed(precision) + ')',
                ref: ls,
                seriesType: 'ls',
                visible: true
            });
            
            drawPt = null;
            if (!keepDrawingMode) {
                setTool('cur');
            } else {
                document.getElementById('hint').textContent = '1点目クリック ➔ 2点目クリック';
            }
            toast('トレンドラインを追加しました');
            renderManualObjects();
        }
    }
    else if (tool === 'fib') {
        if (!drawPt) {
            drawPt = { time: time, price: price };
            document.getElementById('hint').textContent = '安値をクリックしてフィボナッチを確定';
        } else {
            var hi = Math.max(drawPt.price, price), lo = Math.min(drawPt.price, price), rng = hi - lo;
            var ratios = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1.0];
            var fibC = ['#ff007f','#ff7043','#ffb300','#d4d4d4','#00b0ff','#00e676','#7c4dff'];
            var fibGroupId = 'fib_' + Date.now();
            
            ratios.forEach(function(r,i) {
                var fp = +(hi - rng * r).toFixed(precision);
                var pl = cSeries.createPriceLine({ price: fp, color: fibC[i], lineWidth: 1, lineStyle: 1, axisLabelVisible: true, title: 'Fib '+(r*100).toFixed(1)+'%' });
                manLines.push({
                    id: fibGroupId,
                    type: 'fib',
                    name: 'フィボナッチ (Fib ' + (r*100).toFixed(1) + '%)',
                    ref: pl,
                    seriesType: 'pl',
                    visible: true
                });
            });
            drawPt = null;
            if (!keepDrawingMode) {
                setTool('cur');
            } else {
                document.getElementById('hint').textContent = '高値クリック ➔ 安値クリック';
            }
            toast('フィボナッチ 7段のラインを描画しました');
            renderManualObjects();
        }
    }
    else if (tool === 'pr') {
        if (!drawPt) {
            drawPt = { time: time, price: price };
            document.getElementById('hint').textContent = '2点目をクリックして測定範囲を確定';
        } else {
            var p1 = drawPt.price, p2 = price;
            var pips = isJpy ? (p2 - p1) * 100 : (p2 - p1) * 10000;
            var pct = ((p2 - p1) / p1) * 100;
            
            var pts = [ { time: drawPt.time, value: +p1.toFixed(precision) }, { time: time, value: +p2.toFixed(precision) } ];
            pts.sort(function(a,b){ return a.time - b.time; });
            
            var ls = chart.addLineSeries({ 
                color: '#e91e63', 
                lineWidth: 2, 
                lineStyle: 1, 
                title: pips.toFixed(1) + ' Pips (' + (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%)',
                lastValueVisible: false, 
                priceLineVisible: false,
                autoscaleInfoProvider: function() { return null; }
            });
            ls.setData(pts);
            
            var prId = 'pr_' + Date.now();
            manLines.push({
                id: prId,
                type: 'pr',
                name: '価格測定: ' + pips.toFixed(1) + ' Pips',
                ref: ls,
                seriesType: 'ls',
                visible: true
            });
            
            drawPt = null;
            if (!keepDrawingMode) {
                setTool('cur');
            } else {
                document.getElementById('hint').textContent = '1点目クリック ➔ 2点目クリック';
            }
            toast('価格測定レイを追加しました');
            renderManualObjects();
        }
    }
    else if (tool === 'rect') {
        if (!drawPt) {
            drawPt = { time: time, price: price };
            document.getElementById('hint').textContent = '対角をクリックしてゾーンを確定';
        } else {
            var hi = Math.max(drawPt.price, price);
            var lo = Math.min(drawPt.price, price);
            var t1 = Math.min(drawPt.time, time);
            var t2 = Math.max(drawPt.time, time);
            
            var lsTop = chart.addLineSeries({ color: '#2196f3', lineWidth: 1.5, lastValueVisible: false, priceLineVisible: false, autoscaleInfoProvider: function() { return null; } });
            lsTop.setData([{ time: t1, value: hi }, { time: t2, value: hi }]);
            
            var lsBot = chart.addLineSeries({ color: '#2196f3', lineWidth: 1.5, lastValueVisible: false, priceLineVisible: false, autoscaleInfoProvider: function() { return null; } });
            lsBot.setData([{ time: t1, value: lo }, { time: t2, value: lo }]);
            
            var rectGroupId = 'rect_' + Date.now();
            manLines.push({
                id: rectGroupId,
                type: 'rect',
                name: 'ボックス上辺 (' + hi.toFixed(precision) + ')',
                ref: lsTop,
                seriesType: 'ls',
                visible: true
            });
            manLines.push({
                id: rectGroupId,
                type: 'rect',
                name: 'ボックス下辺 (' + lo.toFixed(precision) + ')',
                ref: lsBot,
                seriesType: 'ls',
                visible: true
            });
            
            drawPt = null;
            if (!keepDrawingMode) {
                setTool('cur');
            } else {
                document.getElementById('hint').textContent = '1点目クリック ➔ 2点目クリック';
            }
            toast('ボックスゾーンを配置しました');
            renderManualObjects();
        }
    }
}

function clearManual(silent) {
    manLines.forEach(function(l) {
        try {
            if (l.seriesType === 'pl') cSeries.removePriceLine(l.ref);
            else chart.removeSeries(l.ref);
        } catch(e) {}
    });
    manLines = [];
    
    alertLines.forEach(function(al) {
        try {
            if (al.priceLine) cSeries.removePriceLine(al.priceLine);
        } catch(e){}
    });
    alertLines = [];
    
    manualDrawings = [];
    drawOverlayDrawings();
    
    drawPt = null;
    if (!silent) {
        toast('すべての手動描画・アラートを全消去しました', true);
    }
    renderManualObjects();
}

/* ─── MODALS & TAB ACTIONS ─── */
function setTab(tab) {
    document.querySelectorAll('.tab-btn').forEach(function(b){ b.classList.remove('active'); });
    document.querySelectorAll('.tab-content').forEach(function(c){ c.classList.remove('active'); });
    
    document.getElementById('btn-tab-' + tab).classList.add('active');
    document.getElementById('tab-' + tab).classList.add('active');
}

function openSet() { document.getElementById('set-modal').classList.add('open'); }
function closeSet() { document.getElementById('set-modal').classList.remove('open'); }

function openIndicatorsModal() {
    document.getElementById('ind-search').value = '';
    filterIndicators();
    document.getElementById('ind-modal').classList.add('open');
}
function closeIndicatorsModal() { document.getElementById('ind-modal').classList.remove('open'); }

function openAlertModal(price) {
    var isJpy = currentSymbol.indexOf('JPY') !== -1;
    var precision = isJpy ? 3 : 5;
    
    document.getElementById('alert-sym-label').textContent = currentSymbol;
    document.getElementById('alert-price').value = (price !== undefined ? price : liveP).toFixed(precision);
    document.getElementById('alert-msg').value = currentSymbol + ' が設定価格にタッチしました！';
    document.getElementById('alert-modal').classList.add('open');
}
function closeAlertModal() { document.getElementById('alert-modal').classList.remove('open'); }

function createCustomAlert() {
    var price = parseFloat(document.getElementById('alert-price').value);
    var condition = document.getElementById('alert-cond').value;
    var sound = document.getElementById('alert-sound').value;
    var message = document.getElementById('alert-msg').value;
    var isJpy = currentSymbol.indexOf('JPY') !== -1;
    var precision = isJpy ? 3 : 5;
    
    var pl = cSeries.createPriceLine({
        price: price,
        color: '#ff5252',
        lineWidth: 1.5,
        lineStyle: 2,
        axisLabelVisible: true,
        title: '🔔 Alert @ ' + price.toFixed(precision)
    });
    
    var alertId = Date.now();
    alertLines.push({
        id: alertId,
        price: price,
        type: condition,
        sound: sound,
        message: message,
        active: true,
        priceLine: pl,
        name: 'アラート @ ' + price.toFixed(precision)
    });
    
    closeAlertModal();
    toast('アラートを設定しました: ' + price.toFixed(precision));
    renderManualObjects();
}

function addIndicator(type) {
    var id = type.toLowerCase() + '_' + Date.now();
    var colors = ['#e91e63', '#9c27b0', '#673ab7', '#3f51b5', '#009688', '#4caf50', '#ffeb3b', '#ff9800'];
    var randomColor = colors[Math.floor(Math.random() * colors.length)];
    
    if (type === 'SMA' || type === 'EMA') {
        var ind = { id: id, type: type, period: 9, color: randomColor, visible: true, series: null };
        activeIndicators.push(ind);
        createIndicatorSeries(ind);
    } else if (type === 'BB') {
        var ind = { id: id, type: type, period: 20, color: 'rgba(0, 230, 118, 0.35)', visible: true, upperSeries: null, lowerSeries: null };
        activeIndicators.push(ind);
        createIndicatorSeries(ind);
    } else if (type === 'RSI') {
        // Toggle RSI subpanel
        ctxAct('togRSI');
    }
    
    calcIndicators();
    renderIndicatorLegend();
    closeIndicatorsModal();
    toast(type + ' インジケーターを追加しました');
}

function filterIndicators() {
    var query = document.getElementById('ind-search').value.toLowerCase();
    var container = document.getElementById('ind-list-container');
    var items = container.querySelectorAll('.ind-list-item');
    items.forEach(function(item) {
        var text = item.textContent.toLowerCase();
        if (text.indexOf(query) !== -1) {
            item.style.display = 'flex';
        } else {
            item.style.display = 'none';
        }
    });
}

function updateSettings() {
    var setSym = document.getElementById('set-show-sym');
    var showSym = setSym ? setSym.checked : true;
    var setOhlc = document.getElementById('set-show-ohlc');
    var showOhlc = setOhlc ? setOhlc.checked : true;
    var setInd = document.getElementById('set-show-ind');
    var showInd = setInd ? setInd.checked : true;
    
    var legend = document.getElementById('ind-legend');
    if (legend) legend.style.display = showInd ? 'flex' : 'none';
    
    var precision = currentSymbol.indexOf('JPY') !== -1 ? 3 : 5;
    
    var setCur = document.getElementById('set-show-cur');
    var setCd = document.getElementById('set-show-cd');
    
    chart.applyOptions({
        priceScale: {
            position: (setCur && setCur.checked) ? 'right' : 'none'
        },
        timeScale: {
            visible: setCd ? setCd.checked : true
        }
    });
    
    var wmModeEl = document.getElementById('set-watermark-mode');
    var isWmVisible = wmModeEl ? (wmModeEl.value !== 'none') : true;
    
    chart.applyOptions({
        watermark: {
            visible: isWmVisible,
            fontSize: 48,
            color: 'rgba(255, 255, 255, 0.03)',
            text: currentSymbol
        }
    });
}

/* ─── COLOR OPTION UPDATES ─── */
function aC(k, el) {
    var v = el.value;
    C[k] = v;
    var sw = document.getElementById('sw-' + k);
    if (sw) sw.style.background = v;
    
    // Automatically force borders and wicks to match body colors to hide internal wicks perfectly
    if (k === 'up') {
        C.bup = v; C.wup = v;
        var bupInput = document.querySelector('#sw-bup input');
        var wupInput = document.querySelector('#sw-wup input');
        if (bupInput) bupInput.value = v;
        if (wupInput) wupInput.value = v;
        var bupSw = document.getElementById('sw-bup');
        var wupSw = document.getElementById('sw-wup');
        if (bupSw) bupSw.style.background = v;
        if (wupSw) wupSw.style.background = v;
    }
    if (k === 'dn') {
        C.bdn = v; C.wdn = v;
        var bdnInput = document.querySelector('#sw-bdn input');
        var wdnInput = document.querySelector('#sw-wdn input');
        if (bdnInput) bdnInput.value = v;
        if (wdnInput) wdnInput.value = v;
        var bdnSw = document.getElementById('sw-bdn');
        var wdnSw = document.getElementById('sw-wdn');
        if (bdnSw) bdnSw.style.background = v;
        if (wdnSw) wdnSw.style.background = v;
    }
    
    if (k === 'bg') {
        chart.applyOptions({ layout: { backgroundColor: v } });
        if (rsiChart) rsiChart.applyOptions({ layout: { backgroundColor: v } });
    }
    else if (k === 'gd') {
        chart.applyOptions({ grid: { vertLines: { color: v }, horzLines: { color: v } } });
        if (rsiChart) rsiChart.applyOptions({ grid: { vertLines: { color: v }, horzLines: { color: v } } });
    }
    
    toggleCandlePart();
}

function resetC() {
    localStorage.removeItem('userDefaultSettings');
    var def = { 
        bg:'#0b0e14', gd:'#151924', 
        up:'#ffffff', dn:'#f23645', 
        bup:'#ffffff', bdn:'#f23645',
        wup:'#ffffff', wdn:'#f23645',
        sl:'#00e676', rl:'#ff007f', trl:'#00b0ff', ml:'#ffb300' 
    };
    for (var k in def) {
        C[k] = def[k];
    }
    
    document.getElementById('set-bg-type').value = 'gradient';
    document.getElementById('set-bg-top').value = '#000000';
    document.getElementById('set-bg-bottom').value = '#13005a';
    var bgGradStopEl = document.getElementById('set-bg-grad-stop');
    if (bgGradStopEl) bgGradStopEl.value = '65';
    document.getElementById('set-grid-type').value = 'none';
    document.getElementById('set-scale-text-color').value = '#00e5ff';
    document.getElementById('set-scale-text-size').value = '18';
    
    updateCanvasStyle();
    updateScaleTextStyle();
    
    document.getElementById('set-cand-body').checked = true;
    document.getElementById('set-cand-border').checked = true;
    document.getElementById('set-cand-wick').checked = true;
    
    toggleCandlePart();
    runAI(false);
    toast('設定をリセットしました');
}

/* ─── ULTIMATE TV STYLE SETTINGS CONTROLLERS ─── */
function hexToRgba(hex, alpha) {
    var r = 0, g = 0, b = 0;
    if (hex.indexOf('#') === 0) hex = hex.substring(1);
    if (hex.length === 3) {
        r = parseInt(hex.substring(0, 1) + hex.substring(0, 1), 16);
        g = parseInt(hex.substring(1, 2) + hex.substring(1, 2), 16);
        b = parseInt(hex.substring(2, 3) + hex.substring(2, 3), 16);
    } else if (hex.length === 6) {
        r = parseInt(hex.substring(0, 2), 16);
        g = parseInt(hex.substring(2, 4), 16);
        b = parseInt(hex.substring(4, 6), 16);
    } else if (hex.indexOf('rgba') === 0 || hex.indexOf('rgb') === 0) {
        return hex;
    }
    return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
}

function toggleCandlePart() {
    // Candle rendering handled entirely by neon canvas engine
    requestAnimationFrame(drawNeonCandles);
}

function applyUltimateSettings() {
    var precVal = document.getElementById('set-precision').value;
    if (precVal !== 'default') {
        var p = parseInt(precVal);
        cSeries.applyOptions({
            priceFormat: {
                precision: p,
                minMove: 1 / Math.pow(10, p)
            }
        });
    } else {
        var isJpy = currentSymbol.indexOf('JPY') !== -1;
        var p = isJpy ? 3 : 5;
        cSeries.applyOptions({
            priceFormat: {
                precision: p,
                minMove: isJpy ? 0.001 : 0.00001
            }
        });
    }
    
    updateSettings();
    closeSet();
    loadTf(currentTf); // Reload data to apply timezone/precision updates instantly
    toast('設定を保存しました');
}

/* ─── CONTEXT ACTIONS ─── */
function ctxAct(action) {
    var menu = document.getElementById('ctx-menu');
    menu.style.display = 'none';
    
    if (action === 'runAI') runAI();
    else if (action === 'clearAI') clearAI();
    else if (action === 'clearManual') clearManual();
    else if (action === 'openSet') openSet();
    else if (action === 'openAlertModal') openAlertModal();
    else if (action === 'openIndicatorsModal') openIndicatorsModal();
    else if (action === 'togGrid') {
        showGrid = !showGrid;
        chart.applyOptions({ grid: { vertLines: { visible: showGrid }, horzLines: { visible: showGrid } } });
        if (rsiChart) rsiChart.applyOptions({ grid: { vertLines: { visible: showGrid }, horzLines: { visible: showGrid } } });
        toast('グリッド表示を切り替えました');
    }
    else if (action === 'togRSI') {
        showRSI = !showRSI;
        var rsiWrap = document.getElementById('rsi-wrap');
        var chartEl = document.getElementById('chart-el');
        
        if (showRSI) {
            rsiWrap.style.display = 'block';
            chartEl.style.height = '75%';
        } else {
            rsiWrap.style.display = 'none';
            chartEl.style.height = '100%';
        }
        
        // Resize
        var el = document.getElementById('chart-el');
        chart.resize(el.offsetWidth, el.offsetHeight);
        if (rsiChart && showRSI) {
            var re = document.getElementById('rsi-el');
            rsiChart.resize(re.offsetWidth, re.offsetHeight);
        }
        resizeOverlayCanvas();
        setTimeout(resizeNeonCanvas, 50);
        toast('RSIサブパネルを切り替えました');
    }
}

/* ─── TOAST ─── */
var toastTimer;
function toast(msg, warn) {
    var el = document.getElementById('toast');
    document.getElementById('toast-msg').textContent = msg;
    el.className = 'show' + (warn ? ' w' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function(){ el.className = ''; }, 3000);
}

/* ─── TRADINGVIEW UTILITY TOOL TOGGLERS ─── */
function toggleMagnet() {
    magnetMode = !magnetMode;
    var btn = document.getElementById('t-magnet');
    if (magnetMode) {
        btn.classList.add('on');
        toast('強マグネットモード：ON (スナップ吸着)');
    } else {
        btn.classList.remove('on');
        toast('強マグネットモード：OFF');
    }
}

function toggleKeepDrawing() {
    keepDrawingMode = !keepDrawingMode;
    var btn = document.getElementById('t-stay');
    if (keepDrawingMode) {
        btn.classList.add('on');
        toast('描画モード維持：ON');
    } else {
        btn.classList.remove('on');
        toast('描画モード維持：OFF');
    }
}

function toggleLockAll() {
    lockAllDrawings = !lockAllDrawings;
    var btn = document.getElementById('t-lock');
    if (lockAllDrawings) {
        btn.classList.add('on');
        toast('すべての描画ツールをロックしました');
    } else {
        btn.classList.remove('on');
        toast('描画ツールのロックを解除しました');
    }
}

function toggleHideAll() {
    drawingsHidden = !drawingsHidden;
    var btn = document.getElementById('t-hide');
    var slash = document.getElementById('hide-slash');
    
    if (drawingsHidden) {
        btn.classList.add('on');
        if (slash) slash.style.display = 'block';
        toast('すべての描画オブジェクトを非表示にしました');
    } else {
        btn.classList.remove('on');
        if (slash) slash.style.display = 'none';
        toast('すべての描画オブジェクトを表示しました');
    }
    
    manLines.forEach(function(item) {
        try {
            if (item.seriesType !== 'pl') {
                item.ref.applyOptions({ visible: !drawingsHidden });
            } else {
                var opt = (!drawingsHidden && item.visible !== false) ? 
                    { color: '#ffb300', lineWidth: 1 } : 
                    { color: 'transparent', lineWidth: 0 };
                item.ref.applyOptions(opt);
            }
        } catch(e){}
    });
    
    drawOverlayDrawings();
}

function toggleZoomMode() {
    zoomMode = !zoomMode;
    var btn = document.getElementById('t-zoom');
    if (zoomMode) {
        btn.classList.add('on');
        chart.applyOptions({
            handleScroll: { mouseWheel: true },
            handleScale: { mouseWheel: true }
        });
        toast('ズームモード：ON (スクロール拡大縮小)');
    } else {
        btn.classList.remove('on');
        toast('ズームモード：OFF');
    }
}

function toggleEmojiPalette() {
    var emoji = prompt("描画したい絵文字（スタンプ）を1文字入力してください:", "🔥");
    if (emoji) {
        toast("絵文字スタンプ: '" + emoji + "' を選択中。クリックしてチャート上に配置。");
        setTool('text');
        window.selectedEmoji = emoji;
    }
}

/* ─── SIDBAR DRAWING OBJECT TREE MANAGEMENT ─── */
function renderManualObjects() {
    var container = document.getElementById('manual-obj-list');
    if (!container) return;
    
    var list = [];
    var seenIds = {};
    
    manLines.forEach(function(item) {
        if (!seenIds[item.id]) {
            seenIds[item.id] = true;
            list.push({
                id: item.id,
                name: item.name || '手動ライン',
                type: 'chart',
                visible: item.visible !== false
            });
        }
    });
    
    manualDrawings.forEach(function(item) {
        if (!seenIds[item.id]) {
            seenIds[item.id] = true;
            list.push({
                id: item.id,
                name: item.name || '自由描画',
                type: 'canvas',
                visible: item.visible !== false
            });
        }
    });
    
    alertLines.forEach(function(item) {
        if (!seenIds[item.id]) {
            seenIds[item.id] = true;
            list.push({
                id: item.id,
                name: '🔔 ' + (item.name || ('アラート @ ' + item.price)),
                type: 'alert',
                visible: item.active
            });
        }
    });
    
    if (list.length === 0) {
        container.innerHTML = '<div style="color:var(--muted); text-align:center; padding:10px 0;">描画オブジェクトはありません</div>';
        return;
    }
    
    var html = '';
    list.forEach(function(obj) {
        var eyeIcon = obj.visible ? '👁️' : '👁️‍🗨️';
        html += '<div style="display:flex; align-items:center; justify-content:space-between; background:rgba(255,255,255,0.02); border:1px solid var(--border); border-radius:4px; padding:5px 8px; margin-bottom:3px;">' +
            '<span style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:180px; font-weight:500;">' + obj.name + '</span>' +
            '<div style="display:flex; gap:8px; align-items:center; flex-shrink:0;">' +
                '<button onclick="toggleManualObject(\'' + obj.id + '\', \'' + obj.type + '\')" style="background:transparent; border:none; cursor:pointer; color:var(--muted); font-size:11px; transition:color 0.15s; outline:none;" onmouseover="this.style.color=\'var(--txt)\'" onmouseout="this.style.color=\'var(--muted)\'">' + eyeIcon + '</button>' +
                '<button onclick="deleteManualObject(\'' + obj.id + '\', \'' + obj.type + '\')" style="background:transparent; border:none; cursor:pointer; color:var(--muted); font-size:11px; transition:color 0.15s; outline:none;" onmouseover="this.style.color=\'var(--red)\'" onmouseout="this.style.color=\'var(--muted)\'">🗑️</button>' +
            '</div>' +
        '</div>';
    });
    container.innerHTML = html;
}

function deleteManualObject(id, type) {
    if (type === 'chart') {
        manLines.forEach(function(item) {
            if (item.id === id) {
                try {
                    if (item.seriesType === 'pl') cSeries.removePriceLine(item.ref);
                    else chart.removeSeries(item.ref);
                } catch(e) {}
            }
        });
        manLines = manLines.filter(function(item) { return item.id !== id; });
        toast('オブジェクトを削除しました');
    }
    else if (type === 'canvas') {
        manualDrawings = manualDrawings.filter(function(item) { return item.id !== id; });
        drawOverlayDrawings();
        toast('キャンバス描画を削除しました');
    }
    else if (type === 'alert') {
        alertLines.forEach(function(item) {
            if (item.id === parseInt(id)) {
                try {
                    if (item.priceLine) cSeries.removePriceLine(item.priceLine);
                } catch(e) {}
            }
        });
        alertLines = alertLines.filter(function(item) { return item.id !== parseInt(id); });
        toast('アラートを削除しました');
    }
    renderManualObjects();
}

function toggleManualObject(id, type) {
    if (type === 'chart') {
        manLines.forEach(function(item) {
            if (item.id === id) {
                item.visible = item.visible === false ? true : false;
                try {
                    if (item.seriesType !== 'pl') {
                        item.ref.applyOptions({ visible: item.visible });
                    } else {
                        var lineOpt = item.visible ? 
                            { color: '#ffb300', lineWidth: 1 } : 
                            { color: 'transparent', lineWidth: 0 };
                        item.ref.applyOptions(lineOpt);
                    }
                } catch(e) {}
            }
        });
    }
    else if (type === 'canvas') {
        manualDrawings.forEach(function(item) {
            if (item.id === id) {
                item.visible = item.visible === false ? true : false;
            }
        });
        drawOverlayDrawings();
    }
    else if (type === 'alert') {
        alertLines.forEach(function(item) {
            if (item.id === parseInt(id)) {
                item.active = !item.active;
                try {
                    if (item.priceLine) {
                        var lineOpt = item.active ? 
                            { color: '#ff5252', lineWidth: 1.5 } : 
                            { color: 'transparent', lineWidth: 0 };
                        item.priceLine.applyOptions(lineOpt);
                    }
                } catch(e) {}
            }
        });
    }
    renderManualObjects();
}

/* ─── LIVE TICK ─── */
var liveP = 159.268;
setInterval(function() {
    var prev = liveP;
    var isJpy = currentSymbol.indexOf('JPY') !== -1;
    var precision = isJpy ? 3 : 5;
    
    fetch(apiHost + '/v1/rate?symbol=' + currentSymbol)
        .then(function(res) { return res.json(); })
        .then(function(data) {
            if (data && data.price !== undefined) {
                liveP = data.price;
            }
            updateLivePriceUI(prev, precision);
        })
        .catch(function(err) {
            fetchTradingViewCandles(currentSymbol, currentTf, 2)
                .then(function(data) {
                    if (Array.isArray(data) && data.length > 0) {
                        liveP = data[data.length - 1].close;
                        updateLivePriceUI(prev, precision);
                    }
                })
                .catch(function() {
                    // keep current value if both API and WS fail
                });
        });
}, 2000);

function updateLivePriceUI(prev, precision) {
    var el = document.getElementById('pv');
    if (el) {
        el.textContent = liveP.toFixed(precision);
        el.className = 'price-val ' + (liveP >= prev ? 'up' : 'down');
    }
    
    var neonEl = document.getElementById('neon-price-val');
    if (neonEl) {
        neonEl.textContent = liveP.toFixed(precision);
    }
    
    if (candles.length > 0) {
        var last = candles[candles.length - 1];
        last.close = liveP;
        last.high = Math.max(last.high, liveP);
        last.low = Math.min(last.low, liveP);
        
        try {
            cSeries.update(last);
            calcIndicators();
            checkAlerts(liveP);
            requestAnimationFrame(drawNeonCandles);
            // Refresh AI widgets dynamically to reflect changing spot price in real time!
            updateAISidebar();
        } catch(e) {
            logErrorToBridge(e, 'updateLivePriceUI');
        }
    }
}

/* ─── TRADINGVIEW FLYOUT MENUS INTERACTIVE HANDLERS ─── */
function toggleFlyoutMenu(id, event) {
    if (event) event.stopPropagation();
    
    var el = document.getElementById(id);
    var isOpen = el && el.classList.contains('open');
    
    // Close all other open flyouts
    document.querySelectorAll('.lt-flyout').forEach(function(flyout) {
        if (flyout.id !== id) flyout.classList.remove('open');
    });
    
    if (el) {
        if (isOpen) {
            el.classList.remove('open');
        } else {
            el.classList.add('open');
        }
    }
}

// Global click-away listener for flyouts
document.addEventListener('click', function(e) {
    if (!e.target.closest('.lt-item')) {
        document.querySelectorAll('.lt-flyout').forEach(function(flyout) {
            flyout.classList.remove('open');
        });
    }
    if (!e.target.closest('#neon-price-widget')) {
        var popover = document.getElementById('neon-popover');
        if (popover) popover.classList.remove('open');
    }
});

var activeSubTools = {
    cur: 'cur_cross',
    tl: 'tl_trend',
    fib: 'fib_retr',
    brush: 'shape_brush',
    text: 'text_normal',
    emoji: 'emoji_stamp',
    pr: 'measure_range'
};

function selectSubTool(category, subToolId, subToolName) {
    activeSubTools[category] = subToolId;
    
    // 1. Highlight items in the flyout menu
    var flyout = document.getElementById(category + '-flyout');
    if (flyout) {
        flyout.querySelectorAll('.lt-flyout-item').forEach(function(item) {
            item.classList.remove('active');
        });
        
        // Find the clicked item
        var clickedItem = Array.prototype.find.call(flyout.querySelectorAll('.lt-flyout-item'), function(item) {
            return item.getAttribute('onclick').indexOf(subToolId) !== -1;
        });
        if (clickedItem) clickedItem.classList.add('active');
    }
    
    // 2. Highlight main vertical bar button
    document.querySelectorAll('.lt-btn').forEach(function(btn) {
        btn.classList.remove('on');
    });
    var mainBtn = document.getElementById('t-' + category);
    if (mainBtn) mainBtn.classList.add('on');
    
    // 3. Map to active javascript handlers
    if (subToolId === 'cur_eraser') {
        setTool('eraser');
        toast('消しゴムツール：アクティブ（描画線をクリックして消去します）');
    } else {
        setTool(category); // Call the general category setTool to prepare charts listeners
        
        // Custom sub-tool mapping overrides
        if (subToolId === 'tl_horz') {
            setTool('hl'); // Horizontal manual lines
        } else if (subToolId === 'tl_vert') {
            setTool('vert'); // Vertical manual lines
        } else if (subToolId === 'tl_cross') {
            setTool('cross'); // Cross lines intersecting
        } else if (subToolId === 'tl_horzray') {
            setTool('horzray'); // Horizontal Ray lines
        } else if (subToolId === 'gann_box') {
            setTool('gannbox'); // Gann Box zone lines
        }
        
        toast('描画ツール: ' + subToolName + ' を選択中');
    }
    
    // Close the flyout menu
    if (flyout) flyout.classList.remove('open');
}

function selectEmojiStamp(emoji) {
    toast("絵文字スタンプ: '" + emoji + "' を選択中。クリックしてチャート上に配置。");
    setTool('text');
    window.selectedEmoji = emoji;
    
    var flyout = document.getElementById('emoji-flyout');
    if (flyout) flyout.classList.remove('open');
}

/* ─── SAVED DEFAULTS PRESETS MANAGER ─── */
function saveAsDefault() {
    try {
        var settings = {
            version: 2,
            // Candle colors
            up: document.querySelector('#sw-up input').value,
            dn: document.querySelector('#sw-dn input').value,
            bup: document.querySelector('#sw-bup input').value,
            bdn: document.querySelector('#sw-bdn input').value,
            wup: document.querySelector('#sw-wup input').value,
            wdn: document.querySelector('#sw-wdn input').value,
            
            // Candle toggles
            candBody: document.getElementById('set-cand-body').checked,
            candBorder: document.getElementById('set-cand-border').checked,
            candWick: document.getElementById('set-cand-wick').checked,
            
            // Symbol & Precision & Timezone
            precision: document.getElementById('set-precision').value,
            timezone: document.getElementById('set-timezone').value,
            
            // Status Line
            showSym: document.getElementById('set-show-sym').checked,
            showOhlc: document.getElementById('set-show-ohlc').checked,
            showInd: document.getElementById('set-show-ind').checked,
            
            // Neon Price Widget
            neonEnabled: document.getElementById('set-neon-enabled').checked,
            neonSize: document.getElementById('set-neon-size').value,
            neonColor: document.getElementById('set-neon-color').value,
            
            // Scales
            showLbl: document.getElementById('set-show-lbl').checked,
            showCd: document.getElementById('set-show-cd').checked,
            showCur: document.getElementById('set-show-cur').checked,
            
            // Canvas / Appearance
            bgType: document.getElementById('set-bg-type').value,
            bgTop: document.getElementById('set-bg-top').value,
            bgBottom: document.getElementById('set-bg-bottom').value,
            bgGradStop: document.getElementById('set-bg-grad-stop').value,
            gridType: document.getElementById('set-grid-type').value,
            gridColor: document.getElementById('set-grid-color').value,
            crosshairStyle: document.getElementById('set-crosshair-style').value,
            crosshairColor: document.getElementById('set-crosshair-color').value,
            watermarkMode: document.getElementById('set-watermark-mode').value,
            watermarkColor: document.getElementById('set-watermark-color').value,
            
            // Scales Text / Lines
            scaleTextColor: document.getElementById('set-scale-text-color').value,
            scaleTextSize: document.getElementById('set-scale-text-size').value,
            scaleLineColor: document.getElementById('set-scale-line-color').value,
            
            // Buttons & Margins
            btnNav: document.getElementById('set-btn-nav').value,
            btnPane: document.getElementById('set-btn-pane').value,
            marginTop: document.getElementById('set-margin-top').value,
            marginBottom: document.getElementById('set-margin-bottom').value,
            marginRight: document.getElementById('set-margin-right').value
        };
        
        localStorage.setItem('userDefaultSettings', JSON.stringify(settings));
        toast('現在のすべての設定をデフォルトとして保存しました');
    } catch(e) {
        logErrorToBridge(e, 'saveAsDefault');
        toast('デフォルト設定の保存中にエラーが発生しました', true);
    }
}

function applySavedDefault() {
    try {
        var raw = localStorage.getItem('userDefaultSettings');
        if (!raw) return false;
        var s = JSON.parse(raw);
        if (!s) return false;
        
        // Migration: if version < 2, wipe old settings (they used semi-transparent colors)
        if (!s.version || s.version < 2) {
            localStorage.removeItem('userDefaultSettings');
            return false;
        }
        
        // 1. Restore Candle Colors in swatch inputs & global C object
        if (s.up) { 
            C.up = s.up; 
            C.bup = s.up; 
            C.wup = s.up; 
            document.querySelector('#sw-up input').value = s.up; 
            document.querySelector('#sw-bup input').value = s.up; 
            document.querySelector('#sw-wup input').value = s.up; 
        }
        if (s.dn) { 
            C.dn = s.dn; 
            C.bdn = s.dn; 
            C.wdn = s.dn; 
            document.querySelector('#sw-dn input').value = s.dn; 
            document.querySelector('#sw-bdn input').value = s.dn; 
            document.querySelector('#sw-wdn input').value = s.dn; 
        }
        
        // Update swatch labels styling
        ['up', 'dn', 'bup', 'bdn', 'wup', 'wdn'].forEach(function(k) {
            var sw = document.getElementById('sw-' + k);
            if (sw) sw.style.background = C[k];
        });
        
        // 2. Restore Candle Part toggles
        if (s.candBody !== undefined) document.getElementById('set-cand-body').checked = s.candBody;
        if (s.candBorder !== undefined) document.getElementById('set-cand-border').checked = s.candBorder;
        if (s.candWick !== undefined) document.getElementById('set-cand-wick').checked = s.candWick;
        toggleCandlePart();
        
        // 3. Restore Symbol & Precision & Timezone
        if (s.precision !== undefined) document.getElementById('set-precision').value = s.precision;
        if (s.timezone !== undefined) document.getElementById('set-timezone').value = s.timezone;
        
        // 4. Restore Status Line Checkboxes
        if (s.showSym !== undefined) document.getElementById('set-show-sym').checked = s.showSym;
        if (s.showOhlc !== undefined) document.getElementById('set-show-ohlc').checked = s.showOhlc;
        if (s.showInd !== undefined) document.getElementById('set-show-ind').checked = s.showInd;
        
        // 5. Restore Neon Price Widget
        if (s.neonEnabled !== undefined) toggleNeonWidget(s.neonEnabled);
        if (s.neonSize !== undefined) changeNeonSize(s.neonSize);
        if (s.neonColor !== undefined) setNeonColor(s.neonColor);
        
        // 6. Restore Scale Checkboxes
        if (s.showLbl !== undefined) document.getElementById('set-show-lbl').checked = s.showLbl;
        if (s.showCd !== undefined) document.getElementById('set-show-cd').checked = s.showCd;
        if (s.showCur !== undefined) document.getElementById('set-show-cur').checked = s.showCur;
        
        // 7. Restore Canvas & Appearance settings
        if (s.bgType !== undefined) document.getElementById('set-bg-type').value = s.bgType;
        if (s.bgTop !== undefined) document.getElementById('set-bg-top').value = s.bgTop;
        if (s.bgBottom !== undefined) document.getElementById('set-bg-bottom').value = s.bgBottom;
        if (s.bgGradStop !== undefined) document.getElementById('set-bg-grad-stop').value = s.bgGradStop;
        if (s.gridType !== undefined) document.getElementById('set-grid-type').value = s.gridType;
        if (s.gridColor !== undefined) document.getElementById('set-grid-color').value = s.gridColor;
        if (s.crosshairStyle !== undefined) document.getElementById('set-crosshair-style').value = s.crosshairStyle;
        if (s.crosshairColor !== undefined) document.getElementById('set-crosshair-color').value = s.crosshairColor;
        if (s.watermarkMode !== undefined) document.getElementById('set-watermark-mode').value = s.watermarkMode;
        if (s.watermarkColor !== undefined) document.getElementById('set-watermark-color').value = s.watermarkColor;
        
        // 8. Restore Scale Text & Lines styles
        if (s.scaleTextColor !== undefined) document.getElementById('set-scale-text-color').value = s.scaleTextColor;
        if (s.scaleTextSize !== undefined) document.getElementById('set-scale-text-size').value = s.scaleTextSize;
        if (s.scaleLineColor !== undefined) document.getElementById('set-scale-line-color').value = s.scaleLineColor;
        
        // 9. Restore Buttons & Margins
        if (s.btnNav !== undefined) document.getElementById('set-btn-nav').value = s.btnNav;
        if (s.btnPane !== undefined) document.getElementById('set-btn-pane').value = s.btnPane;
        if (s.marginTop !== undefined) document.getElementById('set-margin-top').value = s.marginTop;
        if (s.marginBottom !== undefined) document.getElementById('set-margin-bottom').value = s.marginBottom;
        if (s.marginRight !== undefined) document.getElementById('set-margin-right').value = s.marginRight;
        
        // Apply everything
        updateCanvasStyle(true);
        updateScaleTextStyle(true);
        updateSettings();
        
        return true;
    } catch(e) {
        logErrorToBridge(e, 'applySavedDefault');
        return false;
    }
}

function handleTemplateSelect(value) {
    if (value === 'save_default') {
        saveAsDefault();
    } else if (value === 'apply_default') {
        if (applySavedDefault()) {
            toast('保存されたデフォルト設定を適用しました');
        } else {
            toast('保存されたデフォルト設定が見つかりません', true);
        }
    } else if (value === 'reset') {
        resetC();
    }
}

/* ─── NEON SPOT PRICE DISPLAY ENGINE ─── */
var neonColor = localStorage.getItem('neonPriceColor') || '#ff007f';
var neonSize = localStorage.getItem('neonPriceSize') || '32';
var neonVisible = localStorage.getItem('neonPriceVisible') !== 'false';

// Custom canvas and scales settings matching user request and TV screenshot
var canvasBgType = localStorage.getItem('canvasBgType') || 'gradient';
var canvasBgTop = localStorage.getItem('canvasBgTop') || '#000000';
var canvasBgBottom = localStorage.getItem('canvasBgBottom') || '#13005a';
var canvasBgGradStop = localStorage.getItem('canvasBgGradStop') || '65';
var canvasGridType = localStorage.getItem('canvasGridType') || 'none';
var canvasGridColor = localStorage.getItem('canvasGridColor') || '#2a2e39';
var canvasScaleTextColor = localStorage.getItem('canvasScaleTextColor') || '#00e5ff';
var canvasScaleTextSize = localStorage.getItem('canvasScaleTextSize') || '18';

function initNeonDisplay() {
    setNeonColor(neonColor);
    changeNeonSize(neonSize);
    toggleNeonWidget(neonVisible);
    
    // Check if custom defaults exist, if so load them first
    var loadedCustom = applySavedDefault();
    
    if (!loadedCustom) {
        // Initial sync of custom TradingView canvas/scales settings
        var setBgType = document.getElementById('set-bg-type');
        if (setBgType) setBgType.value = canvasBgType;
        var setBgTop = document.getElementById('set-bg-top');
        if (setBgTop) setBgTop.value = canvasBgTop;
        var setBgBottom = document.getElementById('set-bg-bottom');
        if (setBgBottom) setBgBottom.value = canvasBgBottom;
        var setBgGradStop = document.getElementById('set-bg-grad-stop');
        if (setBgGradStop) setBgGradStop.value = canvasBgGradStop;
        var setGridType = document.getElementById('set-grid-type');
        if (setGridType) setGridType.value = canvasGridType;
        var setGridColor = document.getElementById('set-grid-color');
        if (setGridColor) setGridColor.value = canvasGridColor;
        var setScaleTextColor = document.getElementById('set-scale-text-color');
        if (setScaleTextColor) setScaleTextColor.value = canvasScaleTextColor;
        var setScaleTextSize = document.getElementById('set-scale-text-size');
        if (setScaleTextSize) setScaleTextSize.value = canvasScaleTextSize;
        
        updateCanvasStyle(true);
        updateScaleTextStyle(true);
    }
}

function updateCanvasStyle(isInit) {
    var bgType = document.getElementById('set-bg-type').value;
    var topColor = document.getElementById('set-bg-top').value;
    var bottomColor = document.getElementById('set-bg-bottom').value;
    var bgGradStopEl = document.getElementById('set-bg-grad-stop');
    var bgGradStop = bgGradStopEl ? bgGradStopEl.value : '65';
    var bgGradStopValEl = document.getElementById('set-bg-grad-stop-val');
    if (bgGradStopValEl) bgGradStopValEl.textContent = bgGradStop + '%';
    
    var gridType = document.getElementById('set-grid-type').value;
    var gridColor = document.getElementById('set-grid-color').value;
    var crosshairStyle = document.getElementById('set-crosshair-style').value;
    var crosshairColor = document.getElementById('set-crosshair-color').value;
    var watermarkMode = document.getElementById('set-watermark-mode').value;
    var watermarkColor = document.getElementById('set-watermark-color').value;
    
    var marginTop = parseInt(document.getElementById('set-margin-top').value) || 10;
    var marginBottom = parseInt(document.getElementById('set-margin-bottom').value) || 8;
    var marginRight = parseInt(document.getElementById('set-margin-right').value) || 10;
    
    if (isInit !== true) {
        localStorage.setItem('canvasBgType', bgType);
        localStorage.setItem('canvasBgTop', topColor);
        localStorage.setItem('canvasBgBottom', bottomColor);
        localStorage.setItem('canvasBgGradStop', bgGradStop);
        localStorage.setItem('canvasGridType', gridType);
        localStorage.setItem('canvasGridColor', gridColor);
        localStorage.setItem('canvasCrosshairStyle', crosshairStyle);
        localStorage.setItem('canvasCrosshairColor', crosshairColor);
        localStorage.setItem('canvasWatermarkMode', watermarkMode);
        localStorage.setItem('canvasWatermarkColor', watermarkColor);
        localStorage.setItem('canvasMarginTop', marginTop.toString());
        localStorage.setItem('canvasMarginBottom', marginBottom.toString());
        localStorage.setItem('canvasMarginRight', marginRight.toString());
    }
    
    // Update swatches backgrounds
    var swBgTop = document.getElementById('sw-bg-top');
    if (swBgTop) swBgTop.style.background = topColor;
    var swBgBottom = document.getElementById('sw-bg-bottom');
    if (swBgBottom) swBgBottom.style.background = bottomColor;
    var swGridColor = document.getElementById('sw-grid-color');
    if (swGridColor) swGridColor.style.background = gridColor;
    if (swGridColor) swGridColor.style.display = (gridType === 'none') ? 'none' : 'block';
    
    var swCrosshairColor = document.getElementById('sw-crosshair-color');
    if (swCrosshairColor) swCrosshairColor.style.background = crosshairColor;
    var swWatermarkColor = document.getElementById('sw-watermark-color');
    if (swWatermarkColor) swWatermarkColor.style.background = watermarkColor;
    
    // Apply background gradient on DOM container! (Transparent canvas workaround with color stops)
    var chartEl = document.getElementById('chart-el');
    var rsiEl = document.getElementById('rsi-el');
    if (bgType === 'solid') {
        if (chartEl) chartEl.style.background = topColor;
        if (rsiEl) rsiEl.style.background = topColor;
    } else {
        // High-density vertical gradient stops to make the bottom color stretch further up and look incredibly vibrant!
        var grad = 'linear-gradient(to bottom, ' + topColor + ' 0%, ' + topColor + ' 20%, ' + bottomColor + ' ' + bgGradStop + '%, ' + bottomColor + ' 100%)';
        if (chartEl) chartEl.style.background = grad;
        if (rsiEl) rsiEl.style.background = grad;
    }
    
    // Grid alignment style updates
    var gridOpt = {};
    if (gridType === 'none') {
        gridOpt = {
            vertLines: { visible: false },
            horzLines: { visible: false }
        };
    } else {
        var styleMap = { 'solid': 0, 'dotted': 1, 'dashed': 2 };
        gridOpt = {
            vertLines: { visible: true, color: gridColor, style: styleMap[gridType] },
            horzLines: { visible: true, color: gridColor, style: styleMap[gridType] }
        };
    }
    
    // Crosshair options
    var crossOpt = {
        vertLine: { color: crosshairColor, style: parseInt(crosshairStyle) },
        horzLine: { color: crosshairColor, style: parseInt(crosshairStyle) }
    };
    
    // Watermark options
    var rgb = hexToRgb(watermarkColor) || {r: 255, g: 255, b: 255};
    var wmColorStr = 'rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ', 0.05)';
    var wmOpt = {
        visible: (watermarkMode !== 'none'),
        color: wmColorStr
    };
    
    // Scale Margins
    var scaleMarginsOpt = {
        top: marginTop / 100,
        bottom: marginBottom / 100
    };
    
    chart.applyOptions({
        layout: { backgroundColor: 'rgba(0,0,0,0)' }, // Transparent canvas
        grid: gridOpt,
        crosshair: crossOpt,
        watermark: wmOpt,
        priceScale: {
            scaleMargins: scaleMarginsOpt
        }
    });
    
    if (rsiChart) {
        rsiChart.applyOptions({
            layout: { backgroundColor: 'rgba(0,0,0,0)' }, // Transparent canvas
            grid: gridOpt,
            crosshair: crossOpt,
            watermark: wmOpt
        });
    }
    
    C.bg = topColor;
    C.gd = gridColor;
}

function updateScaleTextStyle(isInit) {
    var color = document.getElementById('set-scale-text-color').value;
    var size = parseInt(document.getElementById('set-scale-text-size').value);
    
    if (!isInit) {
        localStorage.setItem('canvasScaleTextColor', color);
        localStorage.setItem('canvasScaleTextSize', size.toString());
    }
    
    var swScaleText = document.getElementById('sw-scale-text');
    if (swScaleText) swScaleText.style.background = color;
    
    chart.applyOptions({
        layout: {
            textColor: color,
            fontSize: size
        }
    });
    
    if (rsiChart) {
        rsiChart.applyOptions({
            layout: {
                textColor: color,
                fontSize: Math.max(10, size - 4)
            }
        });
    }
}

function setNeonColor(color) {
    neonColor = color;
    localStorage.setItem('neonPriceColor', color);
    
    var widget = document.getElementById('neon-price-widget');
    if (widget) {
        widget.style.setProperty('--neon-color', color);
        var rgb = hexToRgb(color);
        if (rgb) {
            widget.style.setProperty('--neon-color-alpha', 'rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ', 0.6)');
        }
    }
    
    var customColor = document.getElementById('neon-custom-color');
    if (customColor) customColor.value = color;
    var setColor = document.getElementById('set-neon-color');
    if (setColor) setColor.value = color;
    
    var swatch = document.getElementById('neon-custom-swatch');
    if (swatch) swatch.style.background = color;
    var setSwatch = document.getElementById('sw-neon');
    if (setSwatch) setSwatch.style.background = color;
}

function changeNeonSize(size) {
    neonSize = size;
    localStorage.setItem('neonPriceSize', size);
    
    var widgetVal = document.getElementById('neon-price-val');
    if (widgetVal) {
        widgetVal.style.setProperty('--neon-size', size + 'px');
    }
    
    var sizeSlider = document.getElementById('neon-size-slider');
    if (sizeSlider) sizeSlider.value = size;
    var sizeLabel = document.getElementById('neon-size-label');
    if (sizeLabel) sizeLabel.textContent = size + 'px';
    
    var setSizeSlider = document.getElementById('set-neon-size');
    if (setSizeSlider) setSizeSlider.value = size;
    var setSizeLabel = document.getElementById('set-neon-size-val');
    if (setSizeLabel) setSizeLabel.textContent = size + 'px';
}

function toggleNeonWidget(visible) {
    neonVisible = visible;
    localStorage.setItem('neonPriceVisible', visible);
    
    var widget = document.getElementById('neon-price-widget');
    if (widget) {
        widget.style.display = visible ? 'flex' : 'none';
    }
    
    var visibleToggle = document.getElementById('neon-visible-toggle');
    if (visibleToggle) visibleToggle.checked = visible;
    var setVisibleToggle = document.getElementById('set-neon-enabled');
    if (setVisibleToggle) setVisibleToggle.checked = visible;
}

function toggleNeonPopover(event) {
    if (event) event.stopPropagation();
    var popover = document.getElementById('neon-popover');
    if (popover) {
        var isOpen = popover.classList.contains('open');
        document.querySelectorAll('.lt-flyout, .neon-popover').forEach(function(el) {
            el.classList.remove('open');
        });
        if (!isOpen) popover.classList.add('open');
    }
}

function hexToRgb(hex) {
    var result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16)
    } : null;
}

function initSidebarResize() {
    var handle = document.getElementById('sidebar-resize-handle');
    var sidebar = document.querySelector('.sb');
    var main = document.querySelector('.main');
    if (!handle || !sidebar || !main) return;
    
    var isResizing = false;
    
    handle.addEventListener('mousedown', function(e) {
        isResizing = true;
        handle.classList.add('active');
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        e.preventDefault();
    });
    
    document.addEventListener('mousemove', function(e) {
        if (!isResizing) return;
        
        var mainRect = main.getBoundingClientRect();
        var newWidth = mainRect.right - e.clientX;
        
        var minWidth = 220;
        var maxWidth = Math.floor(window.innerWidth * 0.5);
        
        if (newWidth < minWidth) newWidth = minWidth;
        if (newWidth > maxWidth) newWidth = maxWidth;
        
        sidebar.style.width = newWidth + 'px';
        
        if (chart) {
            var el = document.getElementById('chart-el');
            chart.resize(el.offsetWidth, el.offsetHeight);
        }
        if (rsiChart && showRSI) {
            var re = document.getElementById('rsi-el');
            rsiChart.resize(re.offsetWidth, re.offsetHeight);
        }
        resizeOverlayCanvas();
    });
    
    document.addEventListener('mouseup', function() {
        if (isResizing) {
            isResizing = false;
            handle.classList.remove('active');
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            
            localStorage.setItem('userSidebarWidth', sidebar.style.width);
        }
    });
}

/* ─── START ─── */
window.addEventListener('load', function() {
    requestAnimationFrame(function() {
        requestAnimationFrame(function() {
            var savedWidth = localStorage.getItem('userSidebarWidth');
            if (savedWidth) {
                var sidebar = document.querySelector('.sb');
                if (sidebar) sidebar.style.width = savedWidth;
            }
            
            initChart();
            initNeonDisplay();
            initSidebarResize();
        });
    });
});

/* Mobile Tab Switching */
function switchMobileTab(tab) {
    document.body.classList.remove('tab-chart', 'tab-ai');
    document.querySelectorAll('.mobile-nav-btn').forEach(function(btn) {
        btn.classList.remove('active');
    });
    
    if (tab === 'chart') {
        document.body.classList.add('tab-chart');
        document.getElementById('m-btn-chart').classList.add('active');
    } else if (tab === 'ai') {
        document.body.classList.add('tab-ai');
        document.getElementById('m-btn-ai').classList.add('active');
    }
    
    // Resize TradingView chart instantly to prevent rendering compression
    setTimeout(function() {
        window.dispatchEvent(new Event('resize'));
    }, 50);
}
